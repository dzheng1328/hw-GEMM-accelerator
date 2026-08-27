"""cocotb testbench for rtl/systolic_array.v -- the 8x8 output-stationary
systolic array built from rtl/pe.v.

Covers both the "Build 8x8 systolic array from the PE" task (wiring/skew
correctness via a hand-computable identity-matrix case) and the "Verify
array vs NumPy reference" task (genuinely random A/B, checked against a
real NumPy matmul across all 64 output cells).
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

N = 8
TOTAL_CYCLES = 3 * N - 2  # 22 -- see docs/decisions.md for the derivation
ACC_LATENCY = 2  # matches rtl/pe.v's pipelined accumulate latency
ARRAY_RANDOM_SEED = 0xA55A9E  # distinct from tb/test_pe.py's 0xC0C07B PE-level fuzz seed
ARRAY_RANDOM_TRIALS = 20


def to_signed32(value: int) -> int:
    """Wrap a Python int into the RTL accumulator's 32-bit two's-complement
    range. Mirrors the identically-named helper in tb/test_pe.py (kept as a
    small local copy rather than a cross-module import, since cocotb's
    per-directory MODULE resolution makes that import fragile for a 5-line
    utility)."""
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def pack_lanes(values):
    """Pack N int8 lane values into a single flattened bus int, matching the
    RTL's `a_west[8*i +: 8]` / `b_north[8*j +: 8]` bit ordering (lane i in
    bits [8*i+7 : 8*i])."""
    packed = 0
    for lane, v in enumerate(values):
        packed |= (v & 0xFF) << (8 * lane)
    return packed


def unpack_acc(raw: int, i: int, j: int) -> int:
    """Extract PE(i,j)'s signed 32-bit accumulator from the flattened
    acc_out bus (PE(i,j) occupies bits [32*(i*N+j)+31 : 32*(i*N+j)])."""
    field = (raw >> (32 * (i * N + j))) & 0xFFFFFFFF
    return to_signed32(field)


async def reset_dut(dut, cycles=2):
    dut.reset.value = 1
    dut.valid_in.value = 0
    dut.a_west.value = 0
    dut.b_north.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.reset.value = 0


def numpy_matrix_reference(A, B):
    """Reference C = A @ B via NumPy's real matmul operator. Both operands
    are upcast to np.int64 before the multiply so NumPy's own int8/int16
    default-dtype overflow rules can't silently corrupt the *reference*
    model -- mirrors numpy_mac_reference in tb/test_pe.py. to_signed32 is
    applied per-cell only at comparison time, to mirror the RTL's actual
    32-bit accumulator width. With full int8 operands the max |sum of 8
    products| per cell is 8*128*128=131072, nowhere near the 2**31
    wraparound boundary -- to_signed32 here is defensive/consistency-
    preserving, not something this test exercises the wraparound branch of.
    """
    A_np = np.array(A, dtype=np.int64)
    B_np = np.array(B, dtype=np.int64)
    C = A_np @ B_np
    return [[to_signed32(int(C[i][j])) for j in range(N)] for i in range(N)]


@cocotb.test()
async def test_reset_clears_all_accumulators(dut):
    """Every PE's acc_out must read 0 after reset, not just PE(0,0)."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")

    raw = dut.acc_out.value.integer
    for i in range(N):
        for j in range(N):
            got = unpack_acc(raw, i, j)
            assert got == 0, f"PE({i},{j}) acc_out should be 0 after reset, got {got}"


@cocotb.test()
async def test_identity_times_matrix(dut):
    """A = identity, B[i][j] = i*8+j -> C = A@B = B exactly. Hand-computable
    with no oracle, while still exercising the full 8-row/8-column skew and
    all 22 cycles of real wiring."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)

    A = [[1 if i == k else 0 for k in range(N)] for i in range(N)]
    B = [[i * N + j for j in range(N)] for i in range(N)]

    dut.valid_in.value = 1
    for t in range(TOTAL_CYCLES):
        a_lanes = [A[i][t - i] if i <= t < i + N else 0 for i in range(N)]
        b_lanes = [B[t - j][j] if j <= t < j + N else 0 for j in range(N)]
        dut.a_west.value = pack_lanes(a_lanes)
        dut.b_north.value = pack_lanes(b_lanes)
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
    # Drain: every PE needs ACC_LATENCY cycles after its last real input
    # before its final product has landed in acc_out.
    for _ in range(ACC_LATENCY - 1):
        dut.a_west.value = 0
        dut.b_north.value = 0
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
    dut.valid_in.value = 0

    raw = dut.acc_out.value.integer
    for i, j in [(0, 0), (0, N - 1), (N - 1, 0), (N - 1, N - 1), (3, 3), (4, 4)]:
        expected = B[i][j]
        got = unpack_acc(raw, i, j)
        assert got == expected, (
            f"C[{i}][{j}] = acc_out={got}, expected {expected} (A@B should equal B "
            f"since A is the identity matrix)"
        )


@cocotb.test()
async def test_random_matrices_vs_numpy(dut):
    """Genuinely random A and B (not just B, unlike test_identity_times_matrix),
    checked against a real NumPy A@B reference across all 64 output cells
    (not a sample). Seed is fixed and distinct from tb/test_pe.py's PE-level
    fuzz seed for reproducible failures."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())

    rng = random.Random(ARRAY_RANDOM_SEED)

    for trial in range(ARRAY_RANDOM_TRIALS):
        A = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(N)]
        B = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(N)]
        expected = numpy_matrix_reference(A, B)

        await reset_dut(dut)
        dut.valid_in.value = 1
        for t in range(TOTAL_CYCLES):
            a_lanes = [A[i][t - i] if i <= t < i + N else 0 for i in range(N)]
            b_lanes = [B[t - j][j] if j <= t < j + N else 0 for j in range(N)]
            dut.a_west.value = pack_lanes(a_lanes)
            dut.b_north.value = pack_lanes(b_lanes)
            await RisingEdge(dut.clk)
            await Timer(1, units="ns")
        # Drain: every PE needs ACC_LATENCY cycles after its last real input
        # before its final product has landed in acc_out.
        for _ in range(ACC_LATENCY - 1):
            dut.a_west.value = 0
            dut.b_north.value = 0
            await RisingEdge(dut.clk)
            await Timer(1, units="ns")
        dut.valid_in.value = 0

        raw = dut.acc_out.value.integer
        for i in range(N):
            for j in range(N):
                got = unpack_acc(raw, i, j)
                assert got == expected[i][j], (
                    f"trial {trial} (seed={ARRAY_RANDOM_SEED}): "
                    f"C[{i}][{j}] = acc_out={got}, expected {expected[i][j]}"
                )
