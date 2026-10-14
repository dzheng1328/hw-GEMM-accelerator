"""cocotb testbench for rtl/vpu.v: every VOP sub-op, run on random memory
images and edge cases, must leave both memories identical to
compiler/golden_vop.py's (vpulib.check). The images are fully random, so a
stray write anywhere, or a read of the wrong address, fails."""

import cocotb
import numpy as np

from vpulib import SUBS, Images, check, put_i16, put_param, scale, start_clock, run_op

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


@cocotb.test()
async def test_silu_mul(dut):
    await start_clock(dut)
    rng = rng_for("silu")
    for trial in range(3):
        img = Images(rng)
        m, sh = scale(rng, 10, 24)
        put_param(img, 200, m, sh)
        table = rng.integers(-32768, 32768, 256) if trial else np.round(np.arange(-128, 128) * 30.0)
        put_i16(img.amem, 201, table)
        cycles = await check(dut, img, SUBS["SILU_MUL"], ra=3000, rb=4000, rc=200)
    dut._log.info(f"SILU_MUL: {cycles} cycles")


@cocotb.test()
async def test_rope(dut):
    await start_clock(dut)
    rng = rng_for("rope")
    for t in (0, 1, 7, 100, 255):
        img = Images(rng)
        cycles = await check(dut, img, SUBS["ROPE"], ra=1000, rb=2000, rc=4000, t=t)
    dut._log.info(f"ROPE: {cycles} cycles")


@cocotb.test()
async def test_kvwrite(dut):
    await start_clock(dut)
    rng = rng_for("kvwrite")
    for t in (0, 5, 8, 255):
        img = Images(rng)
        cycles = await check(dut, img, SUBS["KVWRITE"], ra=1000, rb=1100, rc=20000, t=t)
    dut._log.info(f"KVWRITE: {cycles} cycles")


def softmax_images(rng, kind):
    img = Images(rng)
    scores = rng.integers(-32768, 32768, (32, 2, 256)) if kind == "wide" else rng.integers(-300, 300, (32, 2, 256))
    if kind == "equal":
        scores[:] = 1234
    for n in range(32):
        for r in range(2):
            put_i16(img.act, 6000 + 128 * n + 64 * r, scores[n, r])
    m, sh = scale(rng, 5, 12)
    put_param(img, 30, m, sh)
    return img


@cocotb.test()
async def test_softmax(dut):
    await start_clock(dut)
    rng = rng_for("softmax")
    for kind, t in [("narrow", 0), ("narrow", 7), ("narrow", 8), ("wide", 100), ("equal", 31), ("narrow", 255),
                    ("wide", 255)]:
        img = softmax_images(rng, kind)
        cycles = await check(dut, img, SUBS["SOFTMAX"], ra=6000, rb=8000, rc=30, t=t)
        dut._log.info(f"SOFTMAX {kind} t={t}: {cycles} cycles")


def sample_images(rng, kind):
    img = Images(rng)
    if kind == "equal":
        logits = np.full((512, 8), 77)
    elif kind == "single":
        logits = rng.integers(-500, 500, (512, 8))
        logits[rng.integers(0, 512, 8), np.arange(8)] = 30000
    else:
        logits = rng.integers(-3000, 3000, (512, 8))
    for v in range(512):  # word 2v: stories 0-3; word 2v + 1: stories 4-7
        put_i16(img.act, 6000 + 2 * v, logits[v, :4])
        put_i16(img.act, 6000 + 2 * v + 1, logits[v, 4:])
    m, sh = scale(rng, 8, 16)
    put_param(img, 300, m, sh)
    img.amem[400:404] = rng.integers(1, 2**64, 4, dtype=np.uint64)
    return img


@cocotb.test()
async def test_sample(dut):
    await start_clock(dut)
    rng = rng_for("sample")
    for kind in ("random", "equal", "single"):
        for inv in (0, 256, 100, 65535, 1):
            img = sample_images(rng, kind)
            cycles = await check(dut, img, SUBS["SAMPLE"], ra=6000, rb=300, rc=400, t=5, plen=3, inv_temp=inv)
        dut._log.info(f"SAMPLE {kind}: {cycles} cycles")
    # the prompt copy writes nothing, whatever the logits
    img = sample_images(rng, "random")
    await check(dut, img, SUBS["SAMPLE"], expect_change=False, ra=6000, rb=300, rc=400, t=1, plen=9, inv_temp=256)
    # a long run at temperature 1.0 and 0: the generator states carry from step to step
    img = sample_images(rng, "random")
    for t in range(2, 30):
        await check(dut, img, SUBS["SAMPLE"], ra=6000, rb=300, rc=400, t=t, plen=3, inv_temp=256)


def seeds_with_r16(rng, want):
    """8 xorshift32 states whose first draw (the new state's top 16 bits) is want[i]."""
    from fixedpoint import xorshift32
    pool = rng.integers(1, 2**32, 4_000_000)
    r16 = xorshift32(pool) >> 16
    out = []
    for w in want:
        hit = np.flatnonzero(r16 == w)
        assert len(hit), f"no seed draws {w}"
        out.append(int(pool[hit[0]]))
    return out


@cocotb.test()
async def test_sample_inverse_cdf_boundaries(dut):
    """The first entry whose running sum EXCEEDS u: a draw of 0, and draws that put u exactly on a
    running sum (all logits equal, so e = 2^16 everywhere and the sums are multiples of 2^16)."""
    await start_clock(dut)
    rng = rng_for("cdf")
    # u = 0: only the dominant entry has e > 0, so the token is its index, not entry 0
    img = sample_images(rng, "single")
    put_param(img, 300, 50000, 8)  # z = 29500 * 50000 >> 8: every other entry underflows to e = 0
    img.amem[400:404] = np.array(seeds_with_r16(rng, [0] * 8), dtype="<u4").view("<u8")
    await check(dut, img, SUBS["SAMPLE"], ra=6000, rb=300, rc=400, t=5, plen=3, inv_temp=256)
    # u = r16 * 512 lands exactly on the running sum of entry r16 / 128 - 1
    img = sample_images(rng, "equal")
    img.amem[400:404] = np.array(seeds_with_r16(rng, [128, 256, 128 * 7, 128 * 100, 128 * 511, 128 * 300, 128 * 2, 640]),
                                 dtype="<u4").view("<u8")
    await check(dut, img, SUBS["SAMPLE"], ra=6000, rb=300, rc=400, t=5, plen=3, inv_temp=256)


@cocotb.test()
async def test_sample_prompt_boundary(dut):
    """Where T + 1 meets PLEN: below it the log already holds the prompt token and nothing is written, at it and
    above it the token is drawn. PLEN is a full 32-bit register, and INV_TEMP is only checked when a token is drawn."""
    await start_clock(dut)
    rng = rng_for("plen")
    for t, plen, draws in [(5, 7, False), (5, 6, True), (5, 5, True), (5, 0, True), (5, 0xFFFFFFFF, False), (5, 1 << 31, False),
                           (0, 1, True), (0, 2, False), (254, 255, True), (254, 256, False)]:
        img = sample_images(rng, "random")
        await check(dut, img, SUBS["SAMPLE"], expect_change=draws, ra=6000, rb=300, rc=400, t=t, plen=plen, inv_temp=256)
    img = sample_images(rng, "random")  # a prompt-copy step takes no fault from an INV_TEMP a drawn step would reject
    await check(dut, img, SUBS["SAMPLE"], expect_change=False, ra=6000, rb=300, rc=400, t=1, plen=9, inv_temp=1 << 16)


ACT_END, A_END = 131072, 65536


def rmsnorm_params(rng, img, addr):
    m, sh = scale(rng, 5, 30)
    put_param(img, addr, m, sh, int(rng.integers(1, 1 << 12)))


@cocotb.test()
async def test_operands_at_the_top_of_each_memory(dut):
    """Every address register at its largest legal value: no address arithmetic may wrap or truncate."""
    await start_clock(dut)
    rng = rng_for("top")

    def fresh():
        return Images(rng)

    await check(dut, fresh(), SUBS["ADD"], ra=ACT_END - 256, rb=ACT_END - 128)
    await check(dut, fresh(), SUBS["TRANSPOSE"], ra=ACT_END - 32, rb=ACT_END - 64, rc=4)
    img = fresh()
    put_i16(img.act, 2 * 255, [0, 511, 5, 6, 7, 8, 9, 10])
    put_param(img, A_END - 4097, *scale(rng, 4, 12))
    await check(dut, img, SUBS["EMBED"], ra=A_END - 4096, rb=ACT_END - 128, rc=A_END - 4097, t=255)
    img = fresh()
    rmsnorm_params(rng, img, A_END - 1)
    await check(dut, img, SUBS["RMSNORM"], ra=ACT_END - 128, rb=ACT_END - 192, rc=A_END - 1)
    img = fresh()
    put_param(img, A_END - 65, *scale(rng, 10, 24))
    await check(dut, img, SUBS["SILU_MUL"], ra=ACT_END - 384, rb=ACT_END - 576, rc=A_END - 65)
    await check(dut, fresh(), SUBS["ROPE"], ra=ACT_END - 64, rb=ACT_END - 96, rc=A_END - 256, t=255)
    await check(dut, fresh(), SUBS["KVWRITE"], ra=ACT_END - 16384 - 64, rb=ACT_END - 16384 - 32, rc=ACT_END - 16384, t=255)
    img = softmax_images(rng, "narrow")
    put_param(img, A_END - 1, *scale(rng, 5, 12))
    for n in range(32):  # the scores of every nest at the top of activation memory
        for r in range(2):
            put_i16(img.act, ACT_END - 4096 + 128 * n + 64 * r, rng.integers(-300, 300, 256))
    await check(dut, img, SUBS["SOFTMAX"], ra=ACT_END - 4096, rb=A_END - 8192, rc=A_END - 1, t=255)
    img = sample_images(rng, "random")
    put_param(img, A_END - 5, *scale(rng, 8, 16))
    img.amem[A_END - 4 : A_END] = rng.integers(1, 2**64, 4, dtype=np.uint64)
    logits = rng.integers(-3000, 3000, 1024 * 4)
    put_i16(img.act, ACT_END - 1024, logits)
    await check(dut, img, SUBS["SAMPLE"], ra=ACT_END - 1024, rb=A_END - 5, rc=A_END - 4, t=255, plen=3, inv_temp=256)


@cocotb.test()
async def test_in_place_operands(dut):
    """Where a sub-op's destination is its source, the streaming RTL must still equal the golden's
    read-everything-then-write result (RMSNORM and SILU_MUL write behind their reads)."""
    await start_clock(dut)
    rng = rng_for("inplace")
    img = Images(rng)
    rmsnorm_params(rng, img, 40)
    await check(dut, img, SUBS["RMSNORM"], ra=3000, rb=3000, rc=40)
    img = Images(rng)
    put_param(img, 200, *scale(rng, 10, 24))
    await check(dut, img, SUBS["SILU_MUL"], ra=3000, rb=3000, rc=200)


CHAIN = [("EMBED", dict(ra=1000, rb=5000, rc=999, t=12)),
         ("RMSNORM", dict(ra=5000, rb=5300, rc=40)),
         ("ROPE", dict(ra=5300, rb=5400, rc=4000, t=12)),
         ("KVWRITE", dict(ra=5400, rb=5450, rc=20000, t=12)),
         ("SOFTMAX", dict(ra=6000, rb=8000, rc=30, t=12)),
         ("SILU_MUL", dict(ra=9000, rb=9500, rc=200)),
         ("ADD", dict(ra=5000, rb=5300)),
         ("TRANSPOSE", dict(ra=5300, rb=5600, rc=8)),
         ("SAMPLE", dict(ra=6000, rb=300, rc=400, t=12, plen=3, inv_temp=256))]


def chain_image(rng):
    """Memories with every sub-op's parameter words in place, for the chain and reset tests."""
    img = Images(rng)
    put_i16(img.act, 2 * 12, rng.integers(0, 512, 8))
    put_param(img, 999, *scale(rng, 4, 12))      # EMBED
    rmsnorm_params(rng, img, 40)                  # RMSNORM
    put_param(img, 30, *scale(rng, 5, 12))        # SOFTMAX
    put_param(img, 200, *scale(rng, 10, 24))      # SILU_MUL
    put_param(img, 300, *scale(rng, 8, 16))       # SAMPLE
    img.amem[400:404] = rng.integers(1, 2**64, 4, dtype=np.uint64)
    return img


@cocotb.test()
async def test_every_sub_op_back_to_back_without_reset(dut):
    """One run of all nine sub-ops, each started in the cycle `done` is high for the one before, on
    memories that carry each one's output into the next: no state may leak from one command to the next."""
    await start_clock(dut)
    img = chain_image(rng_for("chain"))
    for round_ in range(2):
        for name, regs in CHAIN:
            await check(dut, img, SUBS[name], expect_change=True if round_ == 0 else None, **regs)


@cocotb.test()
async def test_perf_counters_count_busy_cycles_per_sub_op(dut):
    await start_clock(dut)
    rng = rng_for("perf")

    def snapshot():
        return [int(dut.g_perf.perf.cnt[i].value) for i in range(10)]

    base = snapshot()
    total = 0
    for name, regs in [("ADD", dict(ra=1000, rb=2000)), ("TRANSPOSE", dict(ra=3000, rb=9000, rc=4)),
                       ("ADD", dict(ra=1000, rb=2000))]:
        cycles = await check(dut, Images(rng), SUBS[name], **regs)
        total += cycles
        after = snapshot()
        delta = [a - b for a, b in zip(after, base)]
        base = after
        assert delta[SUBS[name]] == cycles, f"{name}: counter {delta[SUBS[name]]} vs {cycles} busy cycles"
        assert delta[0] == cycles and sum(delta[1:]) == cycles, f"{name}: the total counter is the sum of the others"
    assert snapshot()[0] == total


@cocotb.test()
async def test_reset_in_the_middle_of_a_command_leaves_no_state_behind(dut):
    """A reset that lands while a command runs, one or two clocks long, must drop it: the VPU goes idle with every
    memory port low, and the next command, the same sub-op, is exact. The aborted run's partial writes stay in the
    images, so the golden starts from them."""
    await start_clock(dut)
    img = chain_image(rng_for("reset"))
    for name, regs in CHAIN:
        for abort_after, reset_cycles in [(1, 1), (6, 2), (40, 1), (150, 2)]:
            await run_op(dut, img, SUBS[name], reset_after=abort_after, reset_cycles=reset_cycles, **regs)
            await check(dut, img, SUBS[name], expect_change=None, **regs)
