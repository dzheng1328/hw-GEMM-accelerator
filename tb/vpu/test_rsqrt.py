"""cocotb testbench for rtl/vpu_rsqrt.v: (r, k) must equal fixedpoint.rsqrt_q
(recip = 0) and fixedpoint.recip_q (recip = 1) bit for bit. Every normalized
mantissa is covered exhaustively (so every seed-table entry and every Newton
input), at several exponents, plus every bit length of u from 1 to 40 bits,
the edge inputs 1 and 2**40 - 1, and u = 0, which raises `zero`."""

import random

import cocotb
from cocotb.triggers import Timer

from fixedpoint import recip_q, rsqrt_q

SEED = 0x25C7
U_MAX = (1 << 40) - 1


def rsqrt_vectors(rng):
    for v in range(1 << 14, 1 << 16):  # every mantissa; shift 0 (even)
        yield v
    for v in range(1 << 14, 1 << 16, 7):  # and at a spread of exponents, odd and even
        for s in (1, 2, 11, 22, 23):
            yield min(v << s, U_MAX)
    for bits in range(1, 41):  # every bit length, random mantissas
        for _ in range(40):
            yield rng.randint(1 << (bits - 1), (1 << bits) - 1)
    yield 1
    yield U_MAX


def recip_vectors(rng):
    for v in range(1 << 15, 1 << 16):
        yield v
    for v in range(1 << 15, 1 << 16, 5):
        for s in (1, 2, 11, 23, 24):
            yield min(v << s, U_MAX)
    for bits in range(1, 41):
        for _ in range(40):
            yield rng.randint(1 << (bits - 1), (1 << bits) - 1)
    yield 1
    yield U_MAX


async def check(dut, recip, vectors, ref):
    dut.recip.value = recip
    n = 0
    for u in vectors:
        dut.u.value = u
        await Timer(1, units="ns")
        r_ref, k_ref = ref(u)
        got = (int(dut.r.value), int(dut.k.value))
        assert got == (int(r_ref), int(k_ref)), f"recip={recip} u={u}: RTL {got} vs reference {(int(r_ref), int(k_ref))}"
        assert int(dut.zero.value) == 0
        assert int(dut.r.value) < 1 << 15, f"u={u}: r={int(dut.r.value)} does not fit the lanes' int32 accumulator"
        n += 1
    return n


@cocotb.test()
async def test_rsqrt_matches_fixedpoint(dut):
    n = await check(dut, 0, rsqrt_vectors(random.Random(SEED)), rsqrt_q)
    dut._log.info(f"rsqrt: {n} vectors bit-exact")


@cocotb.test()
async def test_recip_matches_fixedpoint(dut):
    n = await check(dut, 1, recip_vectors(random.Random(SEED + 1)), recip_q)
    dut._log.info(f"recip: {n} vectors bit-exact")


@cocotb.test()
async def test_zero_input_raises_zero(dut):
    for recip in (0, 1):
        dut.recip.value = recip
        dut.u.value = 0
        await Timer(1, units="ns")
        assert int(dut.zero.value) == 1 and int(dut.r.value) == 0 and int(dut.k.value) == 0
