"""Shared harness for the vector unit's sub-op suites (milestone 4.3e).

The testbench is the memory: `run_op` plays both memories of rtl/vpu.v from
numpy images with rtl/sim_mem.v's timing (a registered read that returns the
old word when a write hits the same address in the same cycle), runs one
command, and returns the cycles the VPU was busy. `check`
then runs compiler/golden_vop.py on a copy of the same images and demands
that both memories match word for word, so a stray write anywhere fails.

Driving follows AGENTS.md: inputs change right after a rising edge, outputs
are sampled at the falling edge."""

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

import golden
import golden_vop
import isa
from lm_layout import param_word

ACT_WORDS = isa.ACT_WORDS
A_WORDS = isa.WEIGHT_WORDS
SUBS = {name: sub for sub, name in isa.VOP_NAMES.items()}


def scale(rng, lo_sh=8, hi_sh=24):
    """A random (m, sh): a normalized 16-bit multiplier and a realistic shift."""
    return int(rng.integers(1 << 15, 1 << 16)), int(rng.integers(lo_sh, hi_sh))


def put_param(img, addr, m, sh, eps=0):
    img.amem[addr] = param_word(m, sh, eps)


def put_i16(mem, base, values):
    """int16 values into '<u8' words starting at word `base` (4 per word)."""
    v = np.ascontiguousarray(np.asarray(values, dtype="<i2")).reshape(-1)
    mem[base : base + len(v) // 4] = v.view("<u8")


class Images:
    """The two memories as numpy '<u8' word arrays."""

    def __init__(self, rng, fill="random"):
        if fill == "random":
            self.act = rng.integers(0, 2**64, ACT_WORDS, dtype=np.uint64)
            self.amem = rng.integers(0, 2**64, A_WORDS, dtype=np.uint64)
        else:
            self.act = np.zeros(ACT_WORDS, dtype=np.uint64)
            self.amem = np.zeros(A_WORDS, dtype=np.uint64)

    def copy(self):
        c = Images.__new__(Images)
        c.act, c.amem = self.act.copy(), self.amem.copy()
        return c


async def start_clock(dut):
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    dut.rst.value = 1
    dut.start.value = 0
    dut.sub.value = 0
    for p in ("ra", "rb", "rc", "t", "plen", "inv_temp", "act_rdata", "a_rdata"):
        getattr(dut, p).value = 0
    for _ in range(3):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)


async def run_op(dut, img, sub, ra=0, rb=0, rc=0, t=0, plen=0, inv_temp=0, max_cycles=40_000, expect_fault=False):
    """Run one command to `done` against the images in `img` (modified in
    place); returns the cycles busy was high. With expect_fault the command
    must instead raise `fault` and never `done`, and all four memory
    enables must stay low for the 8 cycles after it."""
    dut.sub.value, dut.ra.value, dut.rb.value, dut.rc.value = sub, ra, rb, rc
    dut.t.value, dut.plen.value, dut.inv_temp.value = t, plen, inv_temp
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0
    busy_cycles = 0
    for _ in range(max_cycles):
        await FallingEdge(dut.clk)
        busy = int(dut.busy.value)
        act_re, a_re = int(dut.act_re.value), int(dut.a_re.value)
        act_we, a_we = int(dut.act_we.value), int(dut.a_we.value)
        if not busy and not int(dut.done.value):
            assert not (act_re or a_re or act_we or a_we), "a memory port is active while the VPU is idle"
        act_ra, a_ra = int(dut.act_raddr.value), int(dut.a_raddr.value)
        act_wa, a_wa = int(dut.act_waddr.value), int(dut.a_waddr.value)
        act_wd, a_wd = int(dut.act_wdata.value), int(dut.a_wdata.value)
        if expect_fault:
            assert not int(dut.done.value), "a faulted command reached done"
            if int(dut.fault.value):
                for _ in range(8):
                    await RisingEdge(dut.clk)
                    await FallingEdge(dut.clk)
                    assert not int(dut.done.value) and not int(dut.busy.value)
                    assert not (int(dut.act_re.value) or int(dut.a_re.value) or int(dut.act_we.value) or int(dut.a_we.value)), \
                        "a memory port is still active after the fault"
                return busy_cycles
        elif int(dut.done.value):
            return busy_cycles
        else:
            assert not int(dut.fault.value), "the VPU faulted"
        busy_cycles += busy
        await RisingEdge(dut.clk)
        if act_re:
            dut.act_rdata.value = int(img.act[act_ra])
        if a_re:
            dut.a_rdata.value = int(img.amem[a_ra])
        if act_we:
            img.act[act_wa] = np.uint64(act_wd)
        if a_we:
            img.amem[a_wa] = np.uint64(a_wd)
    raise AssertionError(f"no done within {max_cycles} cycles")


def run_golden(img, sub, ra=0, rb=0, rc=0, t=0, plen=0, inv_temp=0):
    """The golden's memories after the same command, on a copy of img."""
    g = golden.Golden(1, 1, [], img.amem.copy(), img.act.copy())
    g.regs[1], g.regs[2], g.regs[3] = ra, rb, rc
    g.regs[isa.T], g.regs[isa.PLEN], g.regs[isa.INV_TEMP] = t, plen, inv_temp
    golden_vop.execute(g, 0, isa.Vop(sub, 1, 2, 3))
    out = Images.__new__(Images)
    out.act, out.amem = g.actw.copy(), g.wmem.copy()
    return out


def assert_same(got, want, what):
    for name in ("act", "amem"):
        a, b = getattr(got, name), getattr(want, name)
        if not np.array_equal(a, b):
            bad = np.flatnonzero(a != b)
            first = bad[:6]
            detail = ", ".join(f"[{i}] RTL {int(a[i]):#018x} vs golden {int(b[i]):#018x}" for i in first)
            raise AssertionError(f"{what}: {name} memory differs in {len(bad)} words: {detail}")


async def check(dut, img, sub, expect_change=True, **regs):
    """Run the command on the RTL and on the golden, from the same images;
    both memories must end identical. Returns the busy cycles. A command that
    the golden says changes nothing (a zero-count TRANSPOSE, a prompt-copy
    SAMPLE) must be declared with expect_change=False, so that a test that
    compares two untouched memories cannot pass vacuously; None skips the
    check, for a command repeated on its own output."""
    want = run_golden(img, sub, **regs)
    changed = not (np.array_equal(want.act, img.act) and np.array_equal(want.amem, img.amem))
    if expect_change is not None:
        assert changed == expect_change, f"the golden {'left both memories unchanged' if expect_change else 'changed a memory'}"
    cycles = await run_op(dut, img, sub, **regs)
    assert_same(img, want, f"sub-op {isa.VOP_NAMES[sub]} {regs}")
    return cycles
