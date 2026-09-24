"""cocotb measurement harness for the 2x2 mesh (issue #54).

Every workload runs fully packetized through the host injector at node
(0,0) (OPERAND + GO flits out, RESULT flits back) and is checked bit-exactly
against NumPy before any measurement is recorded.
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock

from host import CLK_NS, TILE_ORDER, reset_dut, run_gemm, wrap32

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
