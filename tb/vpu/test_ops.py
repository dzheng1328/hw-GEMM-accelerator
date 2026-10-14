"""cocotb testbench for rtl/vpu.v: every VOP sub-op, run on random memory
images and edge cases, must leave both memories identical to
compiler/golden_vop.py's (vpulib.check). The images are fully random, so a
stray write anywhere, or a read of the wrong address, fails."""

import cocotb
import numpy as np

from vpulib import SUBS, Images, check, put_i16, put_param, scale, start_clock

SEED = 0x70F0


def rng_for(name):
    return np.random.default_rng(SEED + sum(map(ord, name)))


@cocotb.test()
async def test_add(dut):
    await start_clock(dut)
    rng = rng_for("add")
    for trial in range(3):
        img = Images(rng)
        if trial == 1:  # lanes 0 and 1 saturate at the two rails, lanes 2 and 3 land just inside them
            put_i16(img.act, 1000, np.tile([32767, -32768, 32767, -32768], 128))
            put_i16(img.act, 2000, np.tile([1, -1, -5, 5], 128))
        await check(dut, img, SUBS["ADD"], ra=1000, rb=2000)
    img = Images(rng)
    cycles = await check(dut, img, SUBS["ADD"], ra=70000, rb=70128)  # adjacent buffers, high addresses
    dut._log.info(f"ADD: {cycles} cycles")


@cocotb.test()
async def test_transpose(dut):
    await start_clock(dut)
    rng = rng_for("transpose")
    for count in (0, 1, 2, 5, 32):
        img = Images(rng)
        cycles = await check(dut, img, SUBS["TRANSPOSE"], expect_change=count > 0, ra=3000, rb=9000, rc=count)
        dut._log.info(f"TRANSPOSE x{count}: {cycles} cycles")
    img = Images(rng)  # in place
    await check(dut, img, SUBS["TRANSPOSE"], ra=4000, rb=4000, rc=3)
