"""cocotb testbench for rtl/vpu_exparg.v + rtl/vpu_exp.v: the exponent
argument must equal fixedpoint.exp_arg (scaled by inv >> 8, as SAMPLE does)
and the exponential must equal fixedpoint.exp2neg_q, bit for bit, over the
n = 16 / n = 17 boundary, z = 0, SOFTMAX's inv = 256, and a random sweep."""

import random

import cocotb
from cocotb.triggers import Timer

from fixedpoint import exp2neg_q, exp_arg

SEED = 0x4E3E
RANDOM_VECTORS = 20000


def vectors(rng):
    # z = d << k with m = 2**k, sh = 0, inv = 256: every exponent n, both sides of n = 16 / 17.
    for k in range(16):
        for d in (0, 1, 2, 3, 15, 16, 17, 255, 256, 4095, 4096, 65535):
            yield d, 1 << k, 0, 256
    # the model's real scales: sh around 7 (attention) and 12-29 (others), inv = 256 and a Q8.8 temperature range
    for _ in range(RANDOM_VECTORS):
        d = rng.randint(0, 65535) if rng.random() < 0.7 else rng.randint(0, 600)
        m = rng.randint(1 << 15, (1 << 16) - 1) if rng.random() < 0.7 else rng.randint(0, 65535)
        sh = rng.randint(5, 30) if rng.random() < 0.7 else rng.randint(0, 63)
        inv = 256 if rng.random() < 0.4 else rng.randint(0, 65535)
        yield d, m, sh, inv


@cocotb.test()
async def test_exponent_path_matches_fixedpoint(dut):
    rng = random.Random(SEED)
    checked = zeros = fulls = 0
    for d, m, sh, inv in vectors(rng):
        dut.d.value, dut.m.value, dut.sh.value, dut.inv.value = d, m, sh, inv
        await Timer(1, units="ns")
        z_ref = int((int(exp_arg(-d, m, sh)) * inv) >> 8)
        e_ref = int(exp2neg_q(z_ref))
        assert int(dut.z.value) == z_ref, f"z: d={d} m={m} sh={sh} inv={inv}: RTL {int(dut.z.value)} vs {z_ref}"
        assert int(dut.e.value) == e_ref, f"e: z={z_ref}: RTL {int(dut.e.value)} vs {e_ref}"
        checked += 1
        zeros += e_ref == 0
        fulls += e_ref == 65536
    assert zeros > 500 and fulls > 100, f"weak coverage: {zeros} zeros, {fulls} full-scale"
    dut._log.info(f"{checked} vectors bit-exact ({zeros} underflow to 0, {fulls} at 2^16)")
