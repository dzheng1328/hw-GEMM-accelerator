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


@cocotb.test()
async def test_embed(dut):
    await start_clock(dut)
    rng = rng_for("embed")
    for t, tokens, (m, sh) in [(0, rng.integers(0, 512, 8), scale(rng, 4, 12)),
                               (3, rng.integers(0, 512, 8), scale(rng, 4, 12)),
                               (255, [0, 511, 0, 511, 1, 2, 510, 255], (65535, 0)),   # saturates the int16 rails
                               (17, [7] * 8, (1 << 15, 6))]:
        img = Images(rng)
        put_i16(img.act, 2 * t, tokens)
        put_param(img, 999, m, sh)
        cycles = await check(dut, img, SUBS["EMBED"], ra=1000, rb=5000, rc=999, t=t)
    dut._log.info(f"EMBED: {cycles} cycles")


@cocotb.test()
async def test_rmsnorm(dut):
    await start_clock(dut)
    rng = rng_for("rmsnorm")
    cases = {"random": None, "small": 40, "max": "max", "zero": "zero", "min": "min", "mixed": "mixed"}
    for name, kind in cases.items():
        img = Images(rng)
        x = rng.integers(-32768, 32768, (64, 8))
        if kind == "zero":
            x[:] = 0
        elif kind == "max":
            x[:] = 32767
        elif kind == "min":
            x[:] = -32768
        elif kind == "mixed":
            x[:, :4] = 0
            x[:, 4:] = rng.integers(-3, 4, (64, 4))
        elif kind:
            x = rng.integers(-kind, kind + 1, (64, 8))
        for f in range(64):  # word 2f: stories 0-3; word 2f + 1: stories 4-7
            put_i16(img.act, 3000 + 2 * f, x[f, :4])
            put_i16(img.act, 3000 + 2 * f + 1, x[f, 4:])
        m, sh = scale(rng, 5, 30)
        put_param(img, 40, m, sh, int(rng.integers(1, 1 << 12)))
        cycles = await check(dut, img, SUBS["RMSNORM"], ra=3000, rb=4000, rc=40)
        dut._log.info(f"RMSNORM {name}: {cycles} cycles")


@cocotb.test()
async def test_rmsnorm_at_the_shift_limit(dut):
    """sh + 15 + k = 63 is the largest shift the golden accepts (fixedpoint.MAX_SHIFT): the rounding term 1 << 62 and
    the 48-bit product must neither overflow nor truncate. All 8 stories share one magnitude, so one sh fits every k."""
    from fixedpoint import MAX_SHIFT, rsqrt_q
    await start_clock(dut)
    rng = rng_for("rmsnorm63")
    for mag in (1, 100, 3000, 32767):
        img = Images(rng)
        x = mag * rng.choice([-1, 1], (64, 8))
        for f in range(64):
            put_i16(img.act, 3000 + 2 * f, x[f, :4])
            put_i16(img.act, 3000 + 2 * f + 1, x[f, 4:])
        eps = 18
        k = int(rsqrt_q(np.array([mag * mag + eps]))[1][0])
        put_param(img, 40, 1 << 15, MAX_SHIFT - 15 - k, eps)
        await check(dut, img, SUBS["RMSNORM"], ra=3000, rb=4000, rc=40)
