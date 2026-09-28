"""cocotb end-to-end test for rtl/accel.v, level 3 of the verification
ladder (docs/specs/2026-09-25-command-processor-cifar10-design.md section
4): a compiled conv stack runs from one start pulse, and the final
activation memory equals compiler/golden.py's word for word. One run is one
case (ACCEL_CASE, tb/accel/cases.py) whose images the memories loaded at
time 0; tb/accel/Makefile runs every case. ACCEL_PROBE selects a negative
test instead."""

import os

import cocotb
import numpy as np
from cocotb.handle import Force
from cocotb.triggers import FallingEdge, First, RisingEdge, Timer
from cocotb.utils import get_sim_time

import cases
from golden import Tracer

MESH = (int(os.environ.get("MESH_W", "2")), int(os.environ.get("MESH_H", "2")))
CASE = os.environ.get("ACCEL_CASE", "")
PROBE = os.environ.get("ACCEL_PROBE", "")
COUNTERS = ("run_cyc", "blocks", "slot_cyc", "inj_stall_cyc", "wait_cyc", "credit_cyc", "wb_words")


async def reset(dut):
    dut.start.value = 0
    dut.rst.value = 1
    for _ in range(3):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)


async def run(dut, max_cycles):
    """Pulse start and wait for done; returns the clock edges from the one
    that samples start to the one that raises done (cmd_perf's run_cyc).
    Fails on error or after max_cycles."""
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0
    t0 = get_sim_time("ns")
    await First(RisingEdge(dut.done), RisingEdge(dut.error), Timer(10 * max_cycles, "ns"))
    await FallingEdge(dut.clk)
    assert not dut.error.value, f"error at pc {int(dut.error_pc.value)}"
    assert dut.done.value, f"no done within {max_cycles} cycles"
    return round((get_sim_time("ns") - t0 - 5) / 10)


def read_act(dut, n_words):
    """Activation words 0 .. n_words - 1 (word w: bank w mod 4, address w >> 2)."""
    banks = [dut.accel.g_act[b].bank.mem for b in range(4)]
    return np.array([int(banks[w % 4][w >> 2].value) for w in range(n_words)], dtype=np.uint64)


@cocotb.test(skip=bool(PROBE))
async def test_case_matches_golden(dut):
    assert CASE, "no ACCEL_CASE: run `make` (every case) or `make ACCEL_CASES=...`"
    await reset(dut)
    if CASE in cases.PROBES:
        await run(dut, 1_000_000)
        raise AssertionError(f"probe {CASE} ran to done: the error path did not stop the run")
    b = cases.case_build(CASE, *MESH)
    g = Tracer(*MESH, b.program, b.lowered.weights, b.act)
    want = g.run().view(np.uint64)[: b.lowered.mem.total_words]
    cycles = await run(dut, 40 * g.slots + 10_000)
    got = read_act(dut, len(want))
    bad = np.flatnonzero(got != want)
    assert not bad.size, (f"{bad.size} of {len(want)} activation words differ; first word {bad[0]}: "
                          f"got {int(got[bad[0]]):016x}, want {int(want[bad[0]]):016x}")
    perf = dut.accel.g_perf.perf
    counts = {n: int(getattr(perf, n).value) for n in COUNTERS}
    assert counts["blocks"] == len(g.blocks), counts
    assert counts["slot_cyc"] == g.slots, counts
    assert counts["wb_words"] == g.wb_words, counts
    assert counts["run_cyc"] == cycles, (counts, cycles)
    dut._log.info("%s on %dx%d: %d cycles, %d BLOCKs, %d slots (%.1f%% of cycles), %s",
                  CASE, *MESH, cycles, len(g.blocks), g.slots, 100 * g.slots / cycles, counts)


@cocotb.test(skip=PROBE != "stray")
async def test_stray_result_is_fatal(dut):
    """Run only by `make stray-check` (Icarus): a RESULT forced onto node
    (1,0)'s delivery port must stop the run; reaching the end means it did not."""
    await reset(dut)
    dut.accel.mesh.res_valid.value = Force(0b10)
    for _ in range(5):
        await RisingEdge(dut.clk)
    raise AssertionError("a RESULT at node (1,0) did not stop the run")
