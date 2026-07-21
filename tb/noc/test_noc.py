"""cocotb testbench for rtl/noc_pair.v -- two full NoC nodes (router +
registered link buffers + self-sequencing GEMM tile each) joined by one
east-west link.

This is the integration claim the standalone router suite (tb/router/) could
not make: operand flits injected at ONE node's local port, addressed by mesh
coordinate, are (a) routed multi-hop across a registered link, (b) delivered
through the LOCAL port straight into the destination tile's operand memory,
and (c) actually correct -- both tiles then compute their matmuls from what
the network delivered, checked bit-exactly against NumPy. If any flit were
lost, reordered, misrouted, or corrupted anywhere along the way, the final
accumulator comparison would fail.

The injector obeys the valid/ready handshake (it holds each flit until the
network accepts it), so link backpressure through the 2-deep flit buffers is
exercised by construction: flits are offered every cycle and the network
paces them.
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

N = 8
KMAX = 8
AW = 2
ADDRW = 6
PW = ADDRW + 16 * N          # {wr_addr, wr_a_col, wr_b_row} = 134
TW = 2                       # flit type field; OPERAND=0, so these flits' numeric values are unchanged
FW = TW + PW + 2 * AW        # 140
NOC_RANDOM_SEED = 0x0C1128
DONE_TIMEOUT_CYCLES = 8 * (3 * N - 2) * KMAX
DRAIN_CYCLES = 40            # generous: 32 flits + 2 hops + buffering


def to_signed32(value: int) -> int:
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def pack_lanes(values):
    packed = 0
    for lane, v in enumerate(values):
        packed |= (int(v) & 0xFF) << (8 * lane)
    return packed


def unpack_acc(raw: int, i: int, j: int) -> int:
    field = (raw >> (32 * (i * N + j))) & 0xFFFFFFFF
    return to_signed32(field)


def read_acc(sig):
    raw = sig.value.integer
    return np.array([[unpack_acc(raw, i, j) for j in range(N)] for i in range(N)])


def make_flit(dest_x, dest_y, wr_addr, a_col_lanes, b_row_lanes):
    """{ {wr_addr, wr_a_col, wr_b_row}, dest_y, dest_x } -- must match
    noc_node.v's LOCAL-delivery payload slicing."""
    payload = (wr_addr << (16 * N)) | (pack_lanes(a_col_lanes) << (8 * N)) | pack_lanes(b_row_lanes)
    return (payload << (2 * AW)) | ((dest_y & 3) << AW) | (dest_x & 3)


def operand_flits(dest_x, dest_y, A_full, B_full, k_chunks):
    """All slot-writes for one tile's matmul, as flits: slot k*N+c holds
    A_full[:, 8k+c] and B_full[8k+c, :]."""
    flits = []
    for k in range(k_chunks):
        for c in range(N):
            a_col = [A_full[i][8 * k + c] for i in range(N)]
            b_row = [B_full[8 * k + c][j] for j in range(N)]
            flits.append(make_flit(dest_x, dest_y, k * N + c, a_col, b_row))
    return flits


async def reset_dut(dut, cycles=3):
    dut.rst.value = 1
    dut.inj_valid.value = 0
    dut.inj_flit.value = 0
    dut.start_0.value = 0
    dut.start_1.value = 0
    dut.k_chunks_0.value = 0
    dut.k_chunks_1.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)


async def inject(dut, flits):
    """Offer flits back-to-back, holding each until inj_ready accepts it --
    the valid/ready discipline a real source must follow."""
    for flit in flits:
        dut.inj_valid.value = 1
        dut.inj_flit.value = flit
        while True:
            await Timer(1, units="ns")          # let combinational ready settle
            accepted = int(dut.inj_ready.value) == 1
            await RisingEdge(dut.clk)
            if accepted:
                break
    dut.inj_valid.value = 0
    dut.inj_flit.value = 0


async def wait_done(dut, done_sig):
    for _ in range(DONE_TIMEOUT_CYCLES):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
        if int(done_sig.value) == 1:
            return
    raise AssertionError("done never asserted")


def reference(A, B):
    C = np.array(A, dtype=np.int64) @ np.array(B, dtype=np.int64)
    return np.vectorize(to_signed32)(C)


@cocotb.test()
async def test_routed_delivery_both_tiles(dut):
    """Interleave operand flits for tile (0,0) (self-delivery, LOCAL->LOCAL)
    and tile (1,0) (multi-hop east over the registered link) through the one
    injection point, then run both tiles and check both matmuls bit-exactly.
    A handful of garbage flits are sent to node 1's slots first and then
    overwritten by the real ones -- so in-order delivery (last write wins) is
    checked too, not just arrival."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)

    rng = random.Random(NOC_RANDOM_SEED)
    k_chunks = 2
    K = 8 * k_chunks
    A0 = [[rng.randint(-128, 127) for _ in range(K)] for _ in range(N)]
    B0 = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(K)]
    A1 = [[rng.randint(-128, 127) for _ in range(K)] for _ in range(N)]
    B1 = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(K)]

    # Garbage first (must be overwritten by the real flits arriving later).
    garbage = [
        make_flit(1, 0, addr, [rng.randint(-128, 127)] * N, [rng.randint(-128, 127)] * N)
        for addr in (0, 5, 9, 15)
    ]
    f0 = operand_flits(0, 0, A0, B0, k_chunks)
    f1 = operand_flits(1, 0, A1, B1, k_chunks)
    interleaved = []
    for a, b in zip(f0, f1):
        interleaved += [a, b]

    await inject(dut, garbage + interleaved)
    for _ in range(DRAIN_CYCLES):
        await RisingEdge(dut.clk)

    # Run both tiles concurrently on what the network delivered.
    dut.k_chunks_0.value = k_chunks
    dut.k_chunks_1.value = k_chunks
    dut.start_0.value = 1
    dut.start_1.value = 1
    await RisingEdge(dut.clk)
    dut.start_0.value = 0
    dut.start_1.value = 0

    await wait_done(dut, dut.done_0)
    await wait_done(dut, dut.done_1)

    got0, got1 = read_acc(dut.acc_out_0), read_acc(dut.acc_out_1)
    exp0, exp1 = reference(A0, B0), reference(A1, B1)
    assert np.array_equal(got0, exp0), f"tile(0,0) mismatch:\n{got0}\nvs\n{exp0}"
    assert np.array_equal(got1, exp1), f"tile(1,0) mismatch:\n{got1}\nvs\n{exp1}"


@cocotb.test()
async def test_reload_and_recompute_over_noc(dut):
    """Second round on the same hardware with no reset in between: new
    operands routed to tile (1,0), fresh start, fresh correct result --
    delivery and compute are repeatable, nothing stale survives."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)

    rng = random.Random(NOC_RANDOM_SEED ^ 0x5A5A)
    for round_idx in range(2):
        k_chunks = 3
        K = 8 * k_chunks
        A = [[rng.randint(-128, 127) for _ in range(K)] for _ in range(N)]
        B = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(K)]

        await inject(dut, operand_flits(1, 0, A, B, k_chunks))
        for _ in range(DRAIN_CYCLES):
            await RisingEdge(dut.clk)

        dut.k_chunks_1.value = k_chunks
        dut.start_1.value = 1
        await RisingEdge(dut.clk)
        dut.start_1.value = 0
        await wait_done(dut, dut.done_1)

        got, exp = read_acc(dut.acc_out_1), reference(A, B)
        assert np.array_equal(got, exp), f"round {round_idx} mismatch:\n{got}\nvs\n{exp}"
