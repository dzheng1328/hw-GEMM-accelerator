"""cocotb end-to-end test for rtl/accel.v, level 3 of the verification
ladder (docs/specs/2026-09-25-command-processor-cifar10-design.md section
4): a compiled conv stack runs from one start pulse, and the final
activation memory equals compiler/golden.py's word for word. One run is one
case (ACCEL_CASE, tb/accel/cases.py) whose images the memories loaded at
time 0; tb/accel/Makefile runs every case. ACCEL_PROBE selects a negative
test instead."""

import json
import os

import cocotb
import numpy as np
from cocotb.handle import Force
from cocotb.triggers import FallingEdge, First, RisingEdge, Timer
from cocotb.utils import get_sim_time

import cases
from cifar_report import check_split
from golden import Tracer
from lower import read_buffer, read_output

MESH = (int(os.environ.get("MESH_W", "2")), int(os.environ.get("MESH_H", "2")))
CASE = os.environ.get("ACCEL_CASE", "")
PROBE = os.environ.get("ACCEL_PROBE", "")
COUNTERS = ("run_cyc", "blocks", "slot_cyc", "go_cyc", "inj_stall_cyc", "wait_cyc", "credit_cyc", "other_cyc",
            "wb_words")
# Guards 4.3a's zero refill gap above the DMA: cmd_perf's Other cycles (the
# injection port idle with no WAIT/END or credit stall) per BLOCK. What is
# left in Other is per-run and per-layer cost (the DMA pipeline filling after
# each WAIT, a layer's register ADDs) amortized over the BLOCKs: 0.05 on
# cifar8 and at most 0.98 on any small case, on every mesh tested. The 4.2
# DMA's 3-cycle refill per BLOCK (cmd_seq issuing only once the DMA drained)
# measured 2.7 to 3.7 on the same cases. 1.5 sits between with margin.
OTHER_PER_BLOCK_MAX = 1.5
# rtl/node_perf.v counters at node (0,0), where every flit enters and every
# RESULT leaves the mesh (router LOCAL input: injection + the tile's results).
CORNER = ("lcl_in_xfer", "lcl_in_stall", "out_xfer_l", "out_xfer_n", "out_xfer_e", "out_stall_n", "out_stall_e")


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


def mesh_perf(dut):
    """node_perf counters for the scaling study: node (0,0)'s ports, and
    every tile's feed (64-MAC) and busy cycles, in node order (x + W * y)."""
    nodes = [dut.accel.mesh.g_node[i].node.g_perf.perf for i in range(MESH[0] * MESH[1])]
    return {"corner": {n: int(getattr(nodes[0], n).value) for n in CORNER},
            "feed_cyc": [int(p.feed_cyc.value) for p in nodes],
            "busy_cyc": [int(p.busy_cyc.value) for p in nodes]}


def read_act(dut, n_words):
    """Activation words 0 .. n_words - 1 (word w: bank w mod 4, address w >> 2)."""
    banks = [dut.accel.g_act[b].bank.mem for b in range(4)]
    return np.array([int(banks[w % 4][w >> 2].value) for w in range(n_words)], dtype=np.uint64)


def check_cifar(b, words, n):
    """Level 1 of the ladder on the RTL's own memory: every image's logits
    and the last image's activations at every layer equal
    model/cifar_reference.py's; returns accuracy from the RTL's logits."""
    from cifar_reference import N_CLASSES, NPZ_PATH, run_int8

    q = np.load(NPZ_PATH)
    act = words.astype("<u8").view(np.uint8)
    ref = run_int8(q, q["test_images"][:n])
    logits = np.stack([read_output(b.lowered, act, i).reshape(-1) for i in range(n)])
    assert np.array_equal(logits, ref[-1]), "RTL logits differ from the NumPy reference"
    for i in range(len(ref) - 1):
        assert np.array_equal(read_buffer(b.lowered, act, i), ref[i][-1]), f"layer {i} differs from the NumPy reference"
    preds = np.argmax(logits[:, :N_CLASSES], axis=1)
    return {"images": n,
            "int8_accuracy": float(np.mean(preds == q["test_labels"][:n])),
            "float_accuracy": float(np.mean(q["float_preds"][:n] == q["test_labels"][:n])),
            "float_agreement": float(np.mean(preds == q["float_preds"][:n])),
            "reference_agreement": float(np.mean(preds == np.argmax(ref[-1][:, :N_CLASSES], axis=1)))}


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
    cycles = await run(dut, cases.cycle_budget(g.slots, g.wb_words, MESH[0] * MESH[1]))
    got = read_act(dut, len(want))
    bad = np.flatnonzero(got != want)
    assert not bad.size, (f"{bad.size} of {len(want)} activation words differ; first word {bad[0]}: "
                          f"got {int(got[bad[0]]):016x}, want {int(want[bad[0]]):016x}")
    perf = dut.accel.g_perf.perf
    counts = {n: int(getattr(perf, n).value) for n in COUNTERS}
    # blocks counts DMA starts; slot_cyc and go_cyc count OPERAND and GO
    # flits injected at node (0,0) while running, so they match golden only
    # if every flit entered the mesh before done.
    assert counts["blocks"] == len(g.blocks), counts
    assert counts["slot_cyc"] == g.slots, counts
    assert counts["go_cyc"] == len(g.blocks), counts
    assert counts["wb_words"] == g.wb_words, counts
    assert counts["run_cyc"] == cycles, (counts, cycles)
    check_split(counts)
    other = counts["other_cyc"] / len(g.blocks)
    dut._log.info("other_cyc %d over %d BLOCKs: %.3f per BLOCK", counts["other_cyc"], len(g.blocks), other)
    assert other <= OTHER_PER_BLOCK_MAX, (
        f"{other:.3f} Other cycles per BLOCK (limit {OTHER_PER_BLOCK_MAX}): a refill gap between BLOCKs? {counts}")
    n = cases.is_cifar(CASE)
    if n is not None:
        record = check_cifar(b, got, n)
        record.update(mesh=f"{MESH[0]}x{MESH[1]}", cycles=cycles, cycles_per_image=cycles / n,
                      slot_utilization=g.slots / cycles, counters=counts, mesh_perf=mesh_perf(dut))
        dut._log.info("%s", record)
        if os.environ.get("CIFAR_RESULTS"):
            with open(os.environ["CIFAR_RESULTS"], "w") as f:
                json.dump(record, f, indent=2)
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
