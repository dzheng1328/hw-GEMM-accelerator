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
import isa
from cifar_report import check_split
from emit import images
from golden import Tracer
from lm_perf import ATTN, SPLIT, add, check_categories, delta
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


def snapshot(dut):
    """Every counter lm_report.py reads, at this instant, in lm_perf's shape."""
    perf = dut.accel.g_perf.perf
    vpu = dut.accel.vpu.g_perf.perf.cnt
    nodes = [dut.accel.mesh.g_node[i].node.g_perf.perf for i in range(MESH[0] * MESH[1])]
    return {"cmd": {n: int(getattr(perf, n).value) for n in COUNTERS + ATTN},
            "vpu": [int(vpu[i].value) for i in range(10)],
            "feed": [int(p.feed_cyc.value) for p in nodes],
            "busy": [int(p.busy_cyc.value) for p in nodes]}


async def watch_steps(dut, snaps):
    """Append a snapshot at the end of each SAMPLE VOP, the last command of a decode step's VPU work. It wakes at
    every VPU busy fall (one per VOP, about 48 a step), waits 1 ns so every counter has settled after the clock
    edge that dropped busy, and keeps a snapshot only when vpu_perf's SAMPLE counter moved."""
    sample = dut.accel.vpu.g_perf.perf.cnt[9]
    last = 0
    while True:
        await FallingEdge(dut.accel.vpu_busy)
        await Timer(1, "ns")
        n = int(sample.value)
        if n != last:
            last = n
            snaps.append(snapshot(dut))


async def watch_tag(dut, high):
    """Append, for each interval PERF_TAG was high, its length in clock cycles: an independent oracle for cmd_perf's
    tagged counters that wakes on the tag's edges only (the tag moves on clock edges, 10 ns apart)."""
    tag = dut.accel.perf_tag
    while True:
        await RisingEdge(tag)
        t0 = get_sim_time("ns")
        await FallingEdge(tag)
        high.append(round((get_sim_time("ns") - t0) / 10))


def read_act(dut, n_words):
    """Activation words 0 .. n_words - 1 (word w: bank w mod 4, address w >> 2)."""
    banks = [dut.accel.g_act[b].bank.mem for b in range(4)]
    return np.array([int(banks[w % 4][w >> 2].value) for w in range(n_words)], dtype=np.uint64)


def read_amem(dut, n_words):
    """A memory words 0 .. n_words - 1 (the weight memory, which the VPU also writes)."""
    mem = dut.accel.wt_mem.mem
    return np.array([int(mem[w].value) for w in range(n_words)], dtype=np.uint64)


def check_lm(dut, b, g, lm, got_act):
    """Levels 3 and 2 of the ladder on the RTL's own memory: the token log
    equals model/lm_reference.py's, and the K and V caches (the state that
    outlives a step) equal the reference's. The memories already equal the
    golden's word for word."""
    from types import SimpleNamespace

    from lm_reference import generate
    from lower_lm import read_cache, read_tokens

    q, prompt, seeds, steps, inv_temp = lm
    ref, ref_cache = generate(q, prompt, steps, inv_temp, seeds, return_cache=True)
    rtl = SimpleNamespace(actw=got_act, act=got_act.view(np.uint8))
    assert np.array_equal(read_tokens(b, rtl), ref), "the RTL's token log differs from model/lm_reference.py's"
    cache = read_cache(b, rtl)
    assert np.array_equal(cache["k"], ref_cache["k"]) and np.array_equal(cache["v"], ref_cache["v"]), \
        "the RTL's K or V cache differs from model/lm_reference.py's"
    return {"steps": steps, "inv_temp": inv_temp, "tokens": read_tokens(b, rtl).T.tolist()}


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
    lm = cases.lm_case(CASE)
    g = Tracer(*MESH, *images(b))
    g.run(50_000_000)
    # Conv stacks compare the words the compiler allocated; a story model compares every word of both memories.
    want = g.actw if lm else g.actw[: b.lowered.mem.total_words]
    budget = cases.cycle_budget(g.slots, g.wb_words, MESH[0] * MESH[1])
    tag_high, snaps = [], []
    base = snapshot(dut)  # counters are zero after reset; taken before the start pulse
    tag_task = cocotb.start_soon(watch_tag(dut, tag_high))
    step_task = cocotb.start_soon(watch_steps(dut, snaps)) if lm else None
    cycles = await run(dut, budget + (cases.lm_extra_cycles(lm[3], len(g.vops), g.slots) if lm else 0))
    final = snapshot(dut)
    tag_task.kill()
    if step_task is not None:
        step_task.kill()
    got = read_act(dut, len(want))
    bad = np.flatnonzero(got != want)
    assert not bad.size, (f"{bad.size} of {len(want)} activation words differ; first word {bad[0]}: "
                          f"got {int(got[bad[0]]):016x}, want {int(want[bad[0]]):016x}")
    if lm:
        got_a = read_amem(dut, isa.WEIGHT_WORDS)
        bad = np.flatnonzero(got_a != g.wmem)
        assert not bad.size, (f"{bad.size} of {isa.WEIGHT_WORDS} A memory words differ; first word {bad[0]}: "
                              f"got {int(got_a[bad[0]]):016x}, want {int(g.wmem[bad[0]]):016x}")
        lm_info = check_lm(dut, b, g, lm, got)
        dut._log.info("%s", {k: v for k, v in lm_info.items() if k != "tokens"})
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
    attn = {n: int(getattr(perf, n).value) for n in ATTN}
    # The tagged counters against the golden's own count of tagged BLOCKs and slots. A tag cleared too late (no WAIT
    # before the clear) is caught by attn_go_cyc == attn_blocks on 2x2 and 4x3, by the slot equality only on some
    # meshes (2x2 yes, 4x3 no), and by neither on 1x1: there the guard is compiler/test_lower_lm.py's static
    # WAIT-before-clear test.
    assert attn["attn_blocks"] == g.tagged_blocks(), (attn, g.tagged_blocks())
    assert attn["attn_go_cyc"] == attn["attn_blocks"], attn
    assert attn["attn_slot_cyc"] == g.tagged_slots, (attn, g.tagged_slots)
    assert all(attn["attn_" + k] <= counts[k] for k in SPLIT), (attn, counts)
    assert sum(attn["attn_" + k] for k in SPLIT) == sum(tag_high), (attn, tag_high)
    if CASE == cases.SMALL_TAG:
        assert 0 < attn["attn_blocks"] < counts["blocks"], (attn, counts)
        assert attn["attn_wait_cyc"] > 0, attn  # the WAIT that drains the tagged BLOCKs is inside the window
    check_split(counts)
    other = counts["other_cyc"] / len(g.blocks)
    dut._log.info("other_cyc %d over %d BLOCKs: %.3f per BLOCK", counts["other_cyc"], len(g.blocks), other)
    if lm:
        # A story-model program interleaves BLOCKs with ALUs, loops and VOPs; the zero-gap guard below is
        # CIFAR-10's. The VPU's busy cycles are counted as wait_cyc (cmd_seq's wait_stall covers a VOP).
        vpu = dut.accel.vpu.g_perf.perf.cnt
        busy = [int(vpu[i].value) for i in range(10)]
        assert busy[0] == sum(busy[1:]) and busy[0] > 0, busy
        assert counts["wait_cyc"] >= busy[0], (counts, busy)
        used = {v[1] for v in g.vops}
        assert all((busy[sub] > 0) == (sub in used) for sub in range(1, 10)), (busy, used)
        assert len(snaps) == lm[3], f"{len(snaps)} SAMPLE snapshots for {lm[3]} steps"
        marks = [base] + snaps + [final]
        intervals = [delta(a, b) for a, b in zip(marks, marks[1:])]
        step_deltas, tail = intervals[:-1], intervals[-1]
        for n, d in enumerate(step_deltas):
            check_categories(d, f"step {n}")
            assert d["vpu"][9] > 0, f"step {n} has no SAMPLE cycles"
        check_categories(tail, "tail")
        assert tail["vpu"][0] == 0, "the VPU ran after the last SAMPLE"
        whole = tail
        for d in reversed(step_deltas):
            whole = add(d, whole)
        assert whole == delta(base, final), "the step intervals do not sum to the run"
        assert {k: final["cmd"][k] for k in COUNTERS} == counts
        record = {"case": CASE, "mesh": f"{MESH[0]}x{MESH[1]}", "steps": lm[3], "inv_temp": lm[4], "cycles": cycles,
                  "slots": g.slots, "blocks": len(g.blocks), "slot_utilization": g.slots / cycles,
                  "counters": counts, "attn": {n: final["cmd"][n] for n in ATTN}, "vpu": busy,
                  "mesh_perf": mesh_perf(dut), "step_deltas": step_deltas, "tail": tail,
                  "tokens": lm_info["tokens"]}
        if os.environ.get("LM_RESULTS"):
            with open(os.environ["LM_RESULTS"], "w") as f:
                json.dump(record, f)
    else:
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
    dut._log.info("%s on %dx%d: %d cycles, %d BLOCKs, %d slots (%.1f%% of cycles), %s, tagged %s over %d windows",
                  CASE, *MESH, cycles, len(g.blocks), g.slots, 100 * g.slots / cycles, counts, attn, len(tag_high))


def seq_regs(dut):
    """cmd_seq's register file, r0 to r31."""
    return [int(dut.accel.seq.regs[i].value) for i in range(isa.N_REGS)]


async def start_vop_nop(dut):
    """Run cases.VOP_NOP (loaded by the Makefile) until the VPU is busy."""
    await reset(dut)
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0
    for _ in range(2000):
        await RisingEdge(dut.clk)
        if int(dut.accel.vpu_busy.value):
            return
    raise AssertionError("the VOP never started")


@cocotb.test(skip=PROBE != "vpu_overlap")
async def test_vpu_running_with_the_dma_busy_is_fatal(dut):
    """Run only by `make vpu-check` (Icarus): the DMA reporting busy while the VPU runs must stop the run."""
    await start_vop_nop(dut)
    dut.accel.dma_busy.value = Force(1)
    for _ in range(5):
        await RisingEdge(dut.clk)
    raise AssertionError("a busy DMA during a VOP did not stop the run")


@cocotb.test(skip=PROBE != "reset_vop")
async def test_reset_during_a_vop_returns_everything_to_idle(dut):
    """Run only by `make reset-check`: a reset while the VPU runs leaves the sequencer, the VPU and every memory
    request line idle, the register file and loop depth as the golden's before it runs (all zero), and the machine
    runs the program again from a fresh start to the golden's final registers."""
    g = Tracer(*MESH, *images(cases.case_build(cases.VOP_NOP, *MESH)))
    zeros = list(g.regs)
    g.run()
    await start_vop_nop(dut)
    for _ in range(3):
        await RisingEdge(dut.clk)
    assert int(dut.accel.vpu_busy.value), "the reset is meant to hit a running VOP"
    assert seq_regs(dut) != zeros, "the registers are meant to hold the program's values when the reset hits"
    dut.rst.value = 1
    for _ in range(2):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await FallingEdge(dut.clk)
    a = dut.accel
    assert not (int(a.vpu_busy.value) or int(dut.done.value) or int(dut.error.value)), "not idle after the reset"
    for line in ("v_act_re", "v_act_we", "v_a_re", "v_a_we"):
        assert not int(getattr(a, line).value), f"{line} is active after the reset"
    assert seq_regs(dut) == zeros and not int(a.seq.depth.value), "the register file or loop depth survived the reset"
    await run(dut, 5000)
    assert seq_regs(dut) == g.regs, "the rerun's registers differ from the golden's"


@cocotb.test(skip=PROBE != "vpu_stray")
async def test_a_vpu_request_while_idle_is_fatal(dut):
    """Run only by `make vpu-check` (Icarus): a VPU memory request outside a VOP must stop the run."""
    await reset(dut)
    dut.accel.v_act_we.value = Force(1)
    for _ in range(5):
        await RisingEdge(dut.clk)
    raise AssertionError("a VPU write request while idle did not stop the run")


@cocotb.test(skip=PROBE != "stray")
async def test_stray_result_is_fatal(dut):
    """Run only by `make stray-check` (Icarus): a RESULT forced onto node
    (1,0)'s delivery port must stop the run; reaching the end means it did not."""
    await reset(dut)
    dut.accel.mesh.res_valid.value = Force(0b10)
    for _ in range(5):
        await RisingEdge(dut.clk)
    raise AssertionError("a RESULT at node (1,0) did not stop the run")
