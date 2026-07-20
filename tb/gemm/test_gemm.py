"""cocotb testbench for rtl/gemm_tile.v -- the self-sequencing GEMM tile
(rtl/gemm_sequencer.v driving rtl/tile.v).

This is the hardware replacement for the Python compute_nblock() in
tb/mnist/test_mnist.py: we preload the operand buffers, pulse `start`, wait for
`done`, and read the 8x8 int32 result -- the FSM does all the K-chunk
sequencing (accumulate back-to-back, no reset between chunks) itself. A pass
means the hardware tiled matmul matches an untiled NumPy A@B bit-for-bit, which
(by integer-add associativity) is a direct proof the K-chunk accumulation and
the 22-cycle wave spacing are contamination-free.
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

N = 8
KMAX = 8  # must match the RTL parameter
GEMM_RANDOM_SEED = 0x6E33
DONE_TIMEOUT_CYCLES = 8 * (3 * N - 2) * KMAX  # generous upper bound on one run


def to_signed32(value: int) -> int:
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def unpack_acc(raw: int, i: int, j: int) -> int:
    field = (raw >> (32 * (i * N + j))) & 0xFFFFFFFF
    return to_signed32(field)


def pack_operands(A_full, B_full, k_chunks):
    """Pack an (8 x 8K) A and an (8K x 8) B into the flattened a_buf / b_buf the
    FSM indexes. For chunk k: A_chunk = A_full[:, 8k:8k+8], B_chunk =
    B_full[8k:8k+8, :]. Layout mirrors the RTL: a_buf elem (k,i,c) at bit
    8*((k*N+i)*N+c), b_buf elem (k,c,j) at 8*((k*N+c)*N+j). Unused chunks
    (k >= k_chunks, up to KMAX) are left zero."""
    a_buf = 0
    b_buf = 0
    for k in range(k_chunks):
        for i in range(N):
            for c in range(N):
                a_off = 8 * ((k * N + i) * N + c)
                a_buf |= (int(A_full[i][8 * k + c]) & 0xFF) << a_off
        for c in range(N):
            for j in range(N):
                b_off = 8 * ((k * N + c) * N + j)
                b_buf |= (int(B_full[8 * k + c][j]) & 0xFF) << b_off
    return a_buf, b_buf


async def run_nblock(dut, A_full, B_full, k_chunks):
    """Preload operands, pulse start, wait for done, return the 8x8 result."""
    a_buf, b_buf = pack_operands(A_full, B_full, k_chunks)
    dut.a_buf.value = a_buf
    dut.b_buf.value = b_buf
    dut.k_chunks.value = k_chunks

    # One-cycle start pulse.
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0

    for _ in range(DONE_TIMEOUT_CYCLES):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
        if dut.done.value == 1:
            break
    else:
        raise AssertionError(f"done never asserted within {DONE_TIMEOUT_CYCLES} cycles")

    raw = dut.acc_out.value.integer
    return np.array([[unpack_acc(raw, i, j) for j in range(N)] for i in range(N)])


async def reset_dut(dut, cycles=2):
    dut.rst.value = 1
    dut.start.value = 0
    dut.k_chunks.value = 0
    dut.a_buf.value = 0
    dut.b_buf.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)


def check(dut, got, A_full, B_full, tag):
    expected = (np.array(A_full, dtype=np.int64) @ np.array(B_full, dtype=np.int64))
    expected = np.vectorize(to_signed32)(expected)
    assert np.array_equal(got, expected), (
        f"{tag} mismatch:\n{got}\nvs expected\n{expected}"
    )


@cocotb.test()
async def test_single_chunk_identity(dut):
    """k_chunks=1, A=identity, B[i][j]=i*8+j -> result = B. Hand-checkable, and
    exercises the full start/reset/run/drain/done handshake once."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)

    A = [[1 if i == k else 0 for k in range(N)] for i in range(N)]
    B = [[i * N + j for j in range(N)] for i in range(N)]
    got = await run_nblock(dut, A, B, k_chunks=1)
    check(dut, got, A, B, "identity(k=1)")


@cocotb.test()
async def test_tiled_gemm_random_k(dut):
    """Random int8 A (8 x 8K) and B (8K x 8) for several K, tiled across K
    chunks by the FSM, checked vs NumPy A@B. K>1 is the real test of the
    no-reset K-accumulation and the 22-cycle anti-contamination spacing."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)

    rng = random.Random(GEMM_RANDOM_SEED)
    for k_chunks in (1, 2, 3, 4, 8):
        for trial in range(4):
            K = 8 * k_chunks
            A = [[rng.randint(-128, 127) for _ in range(K)] for _ in range(N)]
            B = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(K)]
            got = await run_nblock(dut, A, B, k_chunks=k_chunks)
            check(dut, got, A, B, f"random(k={k_chunks},trial={trial})")


@cocotb.test()
async def test_back_to_back_nblocks(dut):
    """Two N-blocks issued back-to-back without an intervening system reset --
    the FSM must give the array its own fresh reset each run (the N-block reset
    that compute_nblock did). If it leaked, block 2 would carry block 1's sum."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)

    rng = random.Random(GEMM_RANDOM_SEED ^ 0xABCD)
    for block in range(2):
        A = [[rng.randint(-128, 127) for _ in range(16)] for _ in range(N)]
        B = [[rng.randint(-128, 127) for _ in range(N)] for _ in range(16)]
        got = await run_nblock(dut, A, B, k_chunks=2)
        check(dut, got, A, B, f"back_to_back(block={block})")
