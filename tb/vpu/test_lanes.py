"""cocotb testbench for rtl/vpu_lanes.v: every lane, with its own accumulator,
multiplier and shift, must equal fixedpoint.requant (QW = 8) or requant16
(QW = 16, no ReLU) bit for bit. rtl/requant.v has its own exhaustive suite;
this one proves the lane array wires each lane's fields to its own slice."""

import os
import random

import cocotb
from cocotb.triggers import Timer

from fixedpoint import requant, requant16

SEED = 0x1A4E5
VECTORS = 4000
INT32_MIN, INT32_MAX = -(2**31), 2**31 - 1


@cocotb.test()
async def test_each_lane_uses_its_own_fields(dut):
    rng = random.Random(SEED)
    lanes = len(dut.acc) // 32
    qw = len(dut.q) // lanes
    assert qw == int(os.environ.get("LANES_QW", "8")), f"built with QW={qw}, the Makefile asked for {os.environ.get('LANES_QW')}"
    for _ in range(VECTORS):
        accs = [rng.randint(INT32_MIN, INT32_MAX) if rng.random() < 0.5 else rng.randint(-5000, 5000) for _ in range(lanes)]
        ms = [rng.randint(0, 65535) for _ in range(lanes)]
        shs = [rng.randint(0, 63) for _ in range(lanes)]
        dut.acc.value = sum((a & 0xFFFFFFFF) << (32 * i) for i, a in enumerate(accs))
        dut.m.value = sum(m << (16 * i) for i, m in enumerate(ms))
        dut.sh.value = sum(s << (6 * i) for i, s in enumerate(shs))
        await Timer(1, units="ns")
        q = int(dut.q.value)
        for i in range(lanes):
            got = (q >> (qw * i)) & ((1 << qw) - 1)
            got -= (1 << qw) if got >> (qw - 1) else 0
            ref = int(requant([accs[i]], ms[i], shs[i], False)[0] if qw == 8 else requant16([accs[i]], ms[i], shs[i])[0])
            assert got == ref, f"lane {i} acc={accs[i]} m={ms[i]} sh={shs[i]}: RTL {got} vs {ref}"
