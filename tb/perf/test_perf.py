"""cocotb measurement harness for the 2x2 mesh (issue #54).

Every workload runs fully packetized through the host injector at node
(0,0) (OPERAND + GO flits out, RESULT flits back) and is checked bit-exactly
against NumPy before any measurement is recorded.
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

from host import CLK_NS, MESH_H, MESH_W, TILE_ORDER, read_counters, reset_dut, run_gemm, wrap32
from perflib import COUNTERS, PORTS, node_key

SEED = 0x54_0B5E


def rand_i8(rng, rows, cols):
    return np.array([[rng.randint(-128, 127) for _ in range(cols)] for _ in range(rows)], dtype=np.int64)


async def start(dut):
    cocotb.start_soon(Clock(dut.clk, CLK_NS, units="ns").start())
    await reset_dut(dut)


@cocotb.test()
async def test_run_gemm_is_bit_exact(dut):
    """The host driver computes an 8x16x40 GEMM (5 jobs, so the last wave is
    partial) on 1, 2, and 4 tiles, bit-exact against NumPy each time."""
    await start(dut)
    rng = random.Random(SEED)
    A, B = rand_i8(rng, 8, 16), rand_i8(rng, 16, 40)
    for tiles in (1, 2, 4):
        C, chunks = await run_gemm(dut, A, B, TILE_ORDER[:tiles])
        assert np.array_equal(C, wrap32(A @ B)), f"{tiles} tiles: result mismatch"
        assert chunks == 2 * 5


def _bit(value, i):
    """Bit i of a sampled vector as '0', '1', 'x', or 'z' (binstr is MSB first)."""
    return value.binstr[-1 - i].lower()


async def shadow_counters(dut, totals):
    """Independently re-derive every node_perf counter by sampling the same
    handshakes at each falling edge (mid-cycle, when they are settled).
    ready is only read when valid is 1: idle router outputs can carry X flits."""
    nodes = [(x, y) for y in range(MESH_H) for x in range(MESH_W)]
    while True:
        await FallingEdge(dut.clk)
        for x, y in nodes:
            node = getattr(dut, f"node{x}{y}")
            t = totals[node_key(x, y)]
            t["busy_cyc"] += int(node.busy.value)
            t["feed_cyc"] += int(node.tile_feeding.value)
            ov, orr = node.r_out_valid.value, node.r_out_ready.value
            for p, name in enumerate(PORTS):
                if _bit(ov, p) == "1":
                    r = _bit(orr, p)
                    assert r in "01", f"node ({x},{y}) port {name}: ready is {r} while valid"
                    t[f"out_xfer_{name}" if r == "1" else f"out_stall_{name}"] += 1
            if _bit(node.r_in_valid.value, 0) == "1":
                r = _bit(node.r_in_ready.value, 0)
                assert r in "01", f"node ({x},{y}) LOCAL in: ready is {r} while valid"
                t["lcl_in_xfer" if r == "1" else "lcl_in_stall"] += 1


@cocotb.test()
async def test_counters_match_shadow_model(dut):
    """Every counter on every node equals an independent per-cycle Python
    count over a contended 4-tile run, plus exact analytical totals."""
    cocotb.start_soon(Clock(dut.clk, CLK_NS, units="ns").start())
    await reset_dut(dut)
    assert all(v == 0 for n in read_counters(dut).values() for v in n.values()), "counters not zero after reset"

    totals = {node_key(x, y): {c: 0 for c in COUNTERS} for y in range(MESH_H) for x in range(MESH_W)}
    shadow = cocotb.start_soon(shadow_counters(dut, totals))

    rng = random.Random(SEED ^ 0x5)
    A, B = rand_i8(rng, 8, 16), rand_i8(rng, 16, 32)  # 4 jobs, k_chunks=2, one wave
    C, chunks = await run_gemm(dut, A, B, TILE_ORDER)
    assert np.array_equal(C, wrap32(A @ B))
    for _ in range(20):  # quiescent tail: nothing in flight, so sampling phase cannot matter
        await RisingEdge(dut.clk)
    shadow.kill()

    rtl = read_counters(dut)
    for node, counts in totals.items():
        for c in COUNTERS:
            assert rtl[node][c] == counts[c], f"node {node} {c}: RTL {rtl[node][c]} vs shadow {counts[c]}"

    # Analytical totals: 4 jobs x (16 operand flits + 1 GO) injected, 4 x 64 results returned.
    assert sum(n["feed_cyc"] for n in rtl.values()) == 8 * chunks == 64
    assert rtl["0,0"]["out_xfer_l"] == 4 * 64 + 17        # results + tile (0,0)'s own load
    assert rtl["0,0"]["lcl_in_xfer"] == 4 * 17 + 64       # injected flits + tile (0,0)'s results
    assert sum(n["out_xfer_l"] for n in rtl.values()) == sum(n["lcl_in_xfer"] for n in rtl.values())
    assert sum(n[c] for n in rtl.values() for c in COUNTERS if "stall" in c) > 0, "no stalls exercised"
