"""cocotb testbench for rtl/tile.v -- rtl/skew_feeder.v wired to
rtl/systolic_array.v.

The point of this suite is to prove the RTL skew feeder reproduces, bit-for-bit,
what the Python feed_wave() helper used to do -- but now the testbench presents
UNSKEWED operands (A one column per cycle, B one row per cycle) and the hardware
does its own staggering/zero-padding. Since the underlying array is already
trusted (tb/array/), a bit-exact A@B out of this tile is a direct proof that the
feeder's skew is correct.

Two things worth calling out vs tb/array/test_systolic_array.py:
  * We drive a_col / b_row (unskewed) instead of the pre-skewed a_west / b_north.
  * The array's valid_in is tied high inside tile.v, so there is no valid_in to
    drive here; correctness relies on the feeder zero-padding outside each PE's
    window (in_valid gates that).
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

N = 8
ACC_LATENCY = 2  # matches rtl/pe.v's pipelined accumulate latency
# Feed N real columns/rows, then drain long enough for the deepest lane
# (delay N-1) plus the array's own 3N-2 latency plus pe.v's ACC_LATENCY to
# fully settle. Generous on purpose -- the accumulators are stationary, so
# reading late never hurts.
FEED_CYCLES = N
TOTAL_CYCLES = 4 * N + (ACC_LATENCY - 1)
TILE_RANDOM_SEED = 0x715E  # distinct from the PE (0xC0C07B) and array (0xA55A9E) seeds
TILE_RANDOM_TRIALS = 20


def to_signed32(value: int) -> int:
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def pack_lanes(values):
    """Pack N int8 lane values into a flattened bus int (lane i in bits
    [8*i+7 : 8*i]), matching the RTL's `a_col[8*i +: 8]` ordering."""
    packed = 0
    for lane, v in enumerate(values):
        packed |= (v & 0xFF) << (8 * lane)
    return packed


def unpack_acc(raw: int, i: int, j: int) -> int:
    field = (raw >> (32 * (i * N + j))) & 0xFFFFFFFF
    return to_signed32(field)


async def reset_dut(dut, cycles=2):
    dut.reset.value = 1
    dut.in_valid.value = 0
    dut.a_col.value = 0
    dut.b_row.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.reset.value = 0


def numpy_matrix_reference(A, B):
    A_np = np.array(A, dtype=np.int64)
    B_np = np.array(B, dtype=np.int64)
    C = A_np @ B_np
    return [[to_signed32(int(C[i][j])) for j in range(N)] for i in range(N)]


async def run_matmul(dut, A, B):
    """Drive UNSKEWED A (column-by-column) and B (row-by-row) through the tile
    and return the 8x8 accumulator grid after TOTAL_CYCLES."""
    await reset_dut(dut)
    for t in range(TOTAL_CYCLES):
        if t < FEED_CYCLES:
            # Input column t of A on the a lanes, input row t of B on the b lanes.
            a_lanes = [A[i][t] for i in range(N)]
            b_lanes = [B[t][j] for j in range(N)]
            dut.in_valid.value = 1
            dut.a_col.value = pack_lanes(a_lanes)
            dut.b_row.value = pack_lanes(b_lanes)
        else:
            # Drain: in_valid low -> the feeder zero-pads on its own.
            dut.in_valid.value = 0
            dut.a_col.value = 0
            dut.b_row.value = 0
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")

    raw = dut.acc_out.value.integer
    return [[unpack_acc(raw, i, j) for j in range(N)] for i in range(N)]


@cocotb.test()
async def test_identity_times_matrix(dut):
    """A = identity, B[i][j] = i*8+j -> C = A@B = B. Same hand-computable case
    as the array suite, but fed UNSKEWED through the RTL feeder."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())

    A = [[1 if i == k else 0 for k in range(N)] for i in range(N)]
    B = [[i * N + j for j in range(N)] for i in range(N)]

    got = await run_matmul(dut, A, B)
    for i in range(N):
        for j in range(N):
            assert got[i][j] == B[i][j], (
                f"C[{i}][{j}] = {got[i][j]}, expected {B[i][j]} "
                f"(A@B should equal B since A is identity)"
            )


@cocotb.test()
async def test_random_matrices_vs_numpy(dut):
    """Genuinely random int8 A and B, fed UNSKEWED, checked against NumPy A@B
    across all 64 output cells. A pass means the RTL feeder's skew matches the
    old Python feed_wave() convention bit-for-bit."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())

    rng = random.Random(TILE_RANDOM_SEED)
    for trial in range(TILE_RANDOM_TRIALS):
        A = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(N)]
        B = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(N)]
        expected = numpy_matrix_reference(A, B)

        got = await run_matmul(dut, A, B)
        for i in range(N):
            for j in range(N):
                assert got[i][j] == expected[i][j], (
                    f"trial {trial} (seed={TILE_RANDOM_SEED}): "
                    f"C[{i}][{j}] = {got[i][j]}, expected {expected[i][j]}"
                )
