"""cocotb measurement harness for the 2x2 mesh (issue #54).

Every workload runs fully packetized through the host injector at node
(0,0) (OPERAND + GO flits out, RESULT flits back) and is checked bit-exactly
against NumPy before any measurement is recorded.
"""

import json
import os
import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

from fixedpoint import quantize_multiplier, requant
from host import CLK_NS, MESH_H, MESH_W, TILE_ORDER, measure, node_scope, read_counters, reset_dut, run_gemm, wrap32
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
            node = node_scope(dut, x, y)
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


RECORDS = []
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def save_records():
    path = os.environ["PERF_RESULTS"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(RECORDS, f, indent=1, sort_keys=True)


@cocotb.test()
async def test_gemm_sweep(dut):
    """Strong scaling: an 8 x K x 32 GEMM (4 jobs, fixed work) for each K on
    1, 2, and 4 tiles, one measured region per configuration, with raw int32
    results and again with on-chip requantized int8 results (_q8). K=128
    exceeds a tile's 64 operand slots, so each block runs as two rounds."""
    await start(dut)
    rng = random.Random(SEED ^ 0x10)
    for K in (8, 16, 32, 64, 128):
        A, B = rand_i8(rng, 8, K), rand_i8(rng, K, 32)
        # Spread outputs over the int8 range: |acc| is about 5000 * sqrt(K).
        rq = (*quantize_multiplier(1 / (80 * K**0.5)), False)
        for tiles in (1, 2, 4):
            for suffix, mode in (("", None), ("_q8", rq)):
                C, rec = await measure(
                    dut, f"gemm_K{K}_T{tiles}{suffix}", run_gemm(dut, A, B, TILE_ORDER[:tiles], mode),
                    chunks_expected=(K // 8) * 4, tiles_used=tiles, workload="gemm", K=K, N=32,
                    output="int8" if mode else "int32",
                )
                exp = requant(A @ B, *mode) if mode else wrap32(A @ B)
                assert np.array_equal(C, exp), f"K={K} tiles={tiles} rq={mode}: result mismatch"
                RECORDS.append(rec)
    save_records()


@cocotb.test()
async def test_mnist_layers(dut):
    """The MNIST MLP over the mesh, one measured region per layer. Layer 1's
    requantize + ReLU run on-chip (issue #56), so its int8 activations come
    straight back from the tiles and feed layer 2 unchanged; layer 2 returns
    raw int32 logits for the argmax."""
    await start(dut)
    data = np.load(os.path.join(REPO_ROOT, "model", "mnist_quantized.npz"))
    W1 = data["W1_int8"].astype(np.int64)  # (64, 32)
    W2 = data["W2_int8"].astype(np.int64)  # (32, 16)
    A0 = data["test_images_int8"].astype(np.int64)  # (8, 64)
    M1 = (float(data["s_input"]) * float(data["s_W1"])) / float(data["s_hidden"])
    rq1 = (*quantize_multiplier(M1), True)

    H, rec1 = await measure(
        dut, "mnist_l1", run_gemm(dut, A0, W1, TILE_ORDER, rq1),
        chunks_expected=8 * 4, tiles_used=4, workload="mnist", K=64, N=32, output="int8",
    )
    assert np.array_equal(H, requant(A0 @ W1, *rq1)), "layer 1 mismatch"

    logits_raw, rec2 = await measure(
        dut, "mnist_l2", run_gemm(dut, H, W2, TILE_ORDER),
        chunks_expected=4 * 2, tiles_used=2, workload="mnist", K=32, N=16, output="int32",
    )
    assert np.array_equal(logits_raw, wrap32(H @ W2)), "layer 2 mismatch"
    preds = np.argmax(logits_raw[:, :10], axis=1)
    labels = data["test_labels"]
    float_preds = data["float_model_preds"]
    dut._log.info(f"predictions {preds.tolist()} vs labels {labels.tolist()} "
                  f"({int(np.sum(preds == labels))}/8 match), float model {float_preds.tolist()}")
    # The on-chip int8 datapath must classify exactly like the float model on
    # the frozen demo images (model/evaluate_quantized.py checks the same
    # pipeline over all 10,000 test images).
    assert np.array_equal(preds, float_preds), "on-chip pipeline diverged from the float model"
    RECORDS.extend([rec1, rec2])
    save_records()
