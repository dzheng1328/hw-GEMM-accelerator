"""cocotb testbench for rtl/vpu_rng.v: loaded with 8 seeds through the four
A-memory seed words, every `adv` must move all 8 states exactly as
fixedpoint.xorshift32 does, for a long run from several seed sets."""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

from fixedpoint import xorshift32

SEED = 0x8A9D
STEPS = 2000


async def start(dut):
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    dut.ld.value = 0
    dut.adv.value = 0
    dut.ld_idx.value = 0
    dut.ld_data.value = 0
    await RisingEdge(dut.clk)


def state_of(dut):
    v = int(dut.state.value)
    return [(v >> (32 * i)) & 0xFFFFFFFF for i in range(8)]


@cocotb.test()
async def test_states_follow_xorshift32(dut):
    await start(dut)
    rng = random.Random(SEED)
    for trial, seeds in enumerate([[rng.randint(1, 2**32 - 1) for _ in range(8)],
                                   [1, 2, 3, 4, 5, 6, 7, 0xFFFFFFFF],
                                   [0x80000000] * 8]):
        for i in range(4):  # seed word i = states 2i (low half) and 2i + 1 (high half)
            dut.ld_idx.value = i
            dut.ld_data.value = seeds[2 * i] | (seeds[2 * i + 1] << 32)
            dut.ld.value = 1
            await RisingEdge(dut.clk)
        dut.ld.value = 0
        await FallingEdge(dut.clk)
        assert state_of(dut) == seeds, f"trial {trial}: load"
        ref = np.array(seeds, dtype=np.int64)
        for step in range(STEPS):
            dut.adv.value = 1
            await RisingEdge(dut.clk)
            dut.adv.value = 0
            ref = xorshift32(ref)
            await FallingEdge(dut.clk)
            assert state_of(dut) == [int(x) for x in ref], f"trial {trial} step {step}"
            if step % 7 == 3:  # idle cycles must hold the state
                await RisingEdge(dut.clk)
                await FallingEdge(dut.clk)
                assert state_of(dut) == [int(x) for x in ref], f"trial {trial} step {step}: hold"
    dut._log.info("8 generators bit-exact over 3 seed sets")
