"""cocotb testbench for rtl/requant.v: every output must equal
model/fixedpoint.py's requant() bit-exactly, over directed corner cases
(rounding ties, saturation at both ends, sh = 0, sh = 63, extreme
accumulators) and a large random sweep of every input."""

import random

import cocotb
from cocotb.triggers import Timer

from fixedpoint import requant

SEED = 0x5EED56
RANDOM_VECTORS = 20000
INT32_MIN, INT32_MAX = -(2**31), 2**31 - 1


def directed_vectors():
    accs = [0, 1, -1, 2, -2, 3, -3, 127, 128, -128, -129, 255, 256, -256, -257, INT32_MAX, INT32_MIN]
    for acc in accs:
        for m in (0, 1, 1 << 15, (1 << 16) - 1):
            for sh in (0, 1, 15, 16, 31, 47, 48, 62, 63):
                for relu in (0, 1):
                    yield acc, m, sh, relu


def random_vectors(rng):
    for _ in range(RANDOM_VECTORS):
        # Mix full-range accumulators with small ones, and realistic shifts
        # (a normalized m near 2**15 with sh around 15-40) with any shift.
        acc = rng.randint(INT32_MIN, INT32_MAX) if rng.random() < 0.5 else rng.randint(-5000, 5000)
        m = rng.randint(1 << 15, (1 << 16) - 1) if rng.random() < 0.7 else rng.randint(0, (1 << 16) - 1)
        sh = rng.randint(10, 40) if rng.random() < 0.7 else rng.randint(0, 63)
        yield acc, m, sh, rng.randint(0, 1)


@cocotb.test()
async def test_matches_fixedpoint_reference(dut):
    rng = random.Random(SEED)
    checked = 0
    saturated = {"hi": 0, "lo": 0, "relu": 0}
    for acc, m, sh, relu in [*directed_vectors(), *random_vectors(rng)]:
        dut.acc.value = acc
        dut.m.value = m
        dut.sh.value = sh
        dut.relu.value = relu
        await Timer(1, units="ns")
        got = dut.q.value.signed_integer
        exp = int(requant([acc], m, sh, bool(relu))[0])
        assert got == exp, f"acc={acc} m={m} sh={sh} relu={relu}: RTL {got} vs reference {exp}"
        checked += 1
        saturated["hi"] += exp == 127
        saturated["lo"] += exp == -128
        saturated["relu"] += relu and exp == 0 and acc * m < 0
    # The sweep must actually reach both saturation rails and the ReLU clamp.
    assert all(v > 100 for v in saturated.values()), f"weak coverage: {saturated}"
    dut._log.info(f"{checked} vectors bit-exact; saturation coverage {saturated}")
