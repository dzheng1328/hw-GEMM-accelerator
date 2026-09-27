"""cocotb tests for rtl/dma_gather.v (with rtl/flit_pack.v): every BLOCK's
OPERAND flits carry exactly compiler/golden.py's A columns and B rows, then
one GO flit, on random shapes, strides, pads, edges, and bias slots; one
slot per cycle without backpressure; nothing lost or reordered under it."""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

import flits
import isa
from golden import Golden
from lower import lower, pack_inputs
from nets import random_net

AW = 3


async def reset(dut):
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    for sig in ("start", "act_we", "wt_we"):
        getattr(dut, sig).value = 0
    dut.inj_ready.value = 1
    dut.rst.value = 1
    for _ in range(3):
        await RisingEdge(dut.clk)
    dut.rst.value = 0


class Layer:
    """One random single-layer network, lowered, with a Golden holding the
    same memories and registers the harness is loaded with. in_words moves
    the input up that many words (IN_BASE = 8 * in_words), as for any layer
    after the first."""

    def __init__(self, rng, shape, spec, in_words=0):
        q, layers = random_net(np.random.default_rng(rng.randrange(1 << 30)), shape, [spec])
        x = np.random.default_rng(rng.randrange(1 << 30)).integers(-128, 128, (1,) + shape)
        self.lw = lower(q, layers, shape, 1)
        self.plan = self.lw.layers[0]
        self.in_words = in_words
        self.act = np.concatenate([np.zeros(in_words, dtype="<u8"), pack_inputs(self.lw, x)])
        self.regs = self.plan.regs()
        self.regs[isa.IN_BASE] = 8 * in_words
        self.golden = Golden(1, 1, [], self.lw.weights, self.act)
        for reg, value in self.regs.items():
            self.golden.regs[reg] = value

    async def load(self, dut):
        for addr in range(self.in_words, self.in_words + self.lw.mem.input_words):
            dut.act_we.value, dut.act_waddr.value, dut.act_wdata.value = 1, addr, int(self.act[addr])
            await RisingEdge(dut.clk)
        dut.act_we.value = 0
        for addr, word in enumerate(self.lw.weights):
            dut.wt_we.value, dut.wt_waddr.value, dut.wt_wdata.value = 1, addr, int(word)
            await RisingEdge(dut.clk)
        dut.wt_we.value = 0

    def drive_regs(self, dut):
        r = self.regs
        dut.in_base.value = r[isa.IN_BASE]
        dut.w_base.value = r[isa.W_BASE]
        dut.cin_log2.value, dut.h_log2.value = r[isa.CIN_LOG2], r[isa.H_LOG2]
        dut.w_log2.value, dut.wout_log2.value = r[isa.W_LOG2], r[isa.WOUT_LOG2]
        dut.stride2.value, dut.pad.value = int(r[isa.STRIDE] == 2), r[isa.PAD]
        dut.ksize.value, dut.ks.value = r[isa.KSIZE], r[isa.KS]
        dut.bias_start.value, dut.bias_val.value = r[isa.BIAS] & 0xFFFF, r[isa.BIAS] >> 16

    def block(self, rng, group, pb, rnd):
        ky0, kx0 = self.plan.round_start_tap(rnd)
        return isa.Block(rng.randrange(8), rng.randrange(8), group, pb, rnd, ky0, kx0,
                         acc_keep=bool(rng.randrange(2)), no_ret=bool(rng.randrange(2)),
                         requant=bool(rng.randrange(2)), relu=bool(rng.randrange(2)),
                         sh=rng.randrange(64), m=rng.randrange(1 << 16))

    def expected(self, b):
        a, bm = self.golden.operands(b)
        dest = (b.tile_x, b.tile_y)
        want = [flits.operand(AW, dest, k, tuple(a[k]), tuple(bm[k])) for k in range(len(a))]
        want.append(flits.go(AW, dest, len(a) // 8, m=b.m, sh=b.sh, relu=b.relu, requant=b.requant,
                             acc_keep=b.acc_keep, no_ret=b.no_ret))
        return want


def drive_block(dut, b):
    for name in ("tile_x", "tile_y", "group", "pixel_block", "round", "ky0", "kx0", "sh", "m"):
        getattr(dut, name).value = getattr(b, name)
    for name in ("acc_keep", "no_ret", "requant", "relu"):
        getattr(dut, name).value = int(getattr(b, name))


async def run_blocks(dut, layer, blocks, rng, ready_prob=1.0):
    """Issue blocks back to back (each starts right after the previous
    done); return (flits seen, flits expected)."""
    seen = []

    async def collect():
        while True:
            await FallingEdge(dut.clk)
            if dut.inj_valid.value and dut.inj_ready.value:
                seen.append(int(dut.inj_flit.value))

    async def backpressure():
        while True:
            await RisingEdge(dut.clk)
            dut.inj_ready.value = int(rng.random() < ready_prob)

    col, bp = cocotb.start_soon(collect()), cocotb.start_soon(backpressure())
    layer.drive_regs(dut)
    want = []
    for b in blocks:
        want += layer.expected(b)
        drive_block(dut, b)
        dut.start.value = 1
        await RisingEdge(dut.clk)
        dut.start.value = 0
        while True:
            await FallingEdge(dut.clk)
            if dut.done.value:
                break
        await RisingEdge(dut.clk)
    bp.kill()
    dut.inj_ready.value = 1
    for _ in range(20):
        await RisingEdge(dut.clk)
    col.kill()
    return seen, want


def compare(seen, want):
    for i, (s, w) in enumerate(zip(seen, want)):
        assert s == w, f"flit {i}: got {flits.decode(AW, s)}, expected {flits.decode(AW, w)}"
    assert len(seen) == len(want), f"{len(seen)} flits, expected {len(want)}"


# (input shape, (cout, ksize, stride, pad)): fixed shapes that pin the edge cases.
FIXED = [
    ((4, 32, 32), (16, 3, 1, 1)),    # CIFAR conv1: pad 1 at every border, Cin padding channel
    ((16, 32, 32), (32, 3, 2, 1)),   # CIFAR conv2: stride-2 windows spanning three words
    ((64, 8, 8), (16, 8, 1, 0)),     # CIFAR fc: Wout = 1 (lane 0 only), 65 rounds, bias-only last round
    ((128, 16, 16), (8, 3, 2, 1)),   # Cin 128: rounds that start mid-tap
    ((8, 16, 16), (8, 1, 2, 0)),     # 1x1 stride 2
]


def random_shape(rng):
    while True:
        cin = rng.choice((1, 2, 4, 8, 16, 32, 64))
        h, w = rng.choice((8, 16, 32)), rng.choice((8, 16, 32))
        if cin * h * w > 16384:
            continue
        spec = (rng.choice((8, 16)),) + rng.choice(((3, 1, 1), (3, 2, 1), (1, 1, 0), (1, 2, 0), (w, 1, 0)))
        try:
            isa.check_shape("t", cin, h, w, *spec)
        except isa.ShapeError:
            continue
        return (cin, h, w), spec


def pick_blocks(rng, layer, count):
    p = layer.plan
    rounds = sorted({0, p.rounds - 1, rng.randrange(p.rounds)})
    pbs = sorted({0, p.pixel_blocks - 1, rng.randrange(p.pixel_blocks)})
    out = [layer.block(rng, rng.randrange(p.groups), pb, r) for pb in pbs for r in rounds]
    rng.shuffle(out)
    return out[:count]


@cocotb.test()
async def test_fixed_edge_shapes_match_golden(dut):
    await reset(dut)
    rng = random.Random(10)
    for shape, spec in FIXED:
        layer = Layer(rng, shape, spec)
        await layer.load(dut)
        compare(*await run_blocks(dut, layer, pick_blocks(rng, layer, 6), rng))


@cocotb.test()
async def test_nonzero_in_base_and_every_bank_rotation(dut):
    """IN_BASE at word offsets 1-3 (later layers never start at 0): with
    offset 0 these put the stride-2 three-word windows in all four banks."""
    await reset(dut)
    rng = random.Random(15)
    for off in IN_OFFSETS:
        for shape, spec in FIXED[:2]:
            layer = Layer(rng, shape, spec, in_words=off)
            await layer.load(dut)
            p = layer.plan
            blocks = [layer.block(rng, rng.randrange(p.groups), pb, 0) for pb in range(p.pixel_blocks)]
            compare(*await run_blocks(dut, layer, blocks, rng))


@cocotb.test()
async def test_mid_tap_rounds_with_cin_above_64(dut):
    """Cin 128: odd rounds start at channel 64, halfway through a tap."""
    await reset(dut)
    rng = random.Random(16)
    layer = Layer(rng, *FIXED[3])
    await layer.load(dut)
    blocks = [layer.block(rng, 0, pb, r) for pb in (0, layer.plan.pixel_blocks - 1) for r in (1, 3, 17)]
    compare(*await run_blocks(dut, layer, blocks, rng))


@cocotb.test()
async def test_random_shapes_match_golden(dut):
    await reset(dut)
    rng = random.Random(11)
    for _ in range(12):
        layer = Layer(rng, *random_shape(rng))
        await layer.load(dut)
        compare(*await run_blocks(dut, layer, pick_blocks(rng, layer, 4), rng))


@cocotb.test()
async def test_random_backpressure_changes_nothing(dut):
    await reset(dut)
    rng = random.Random(12)
    layer = Layer(rng, *FIXED[1])
    await layer.load(dut)
    compare(*await run_blocks(dut, layer, pick_blocks(rng, layer, 8), rng, ready_prob=0.35))


@cocotb.test()
async def test_one_slot_per_cycle_without_backpressure(dut):
    await reset(dut)
    rng = random.Random(13)
    layer = Layer(rng, *FIXED[3])
    await layer.load(dut)
    layer.drive_regs(dut)
    drive_block(dut, layer.block(rng, 0, 1, 1))  # a full 64-slot round
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0
    cycles = []
    for cycle in range(120):
        await FallingEdge(dut.clk)
        if dut.inj_valid.value:
            cycles.append(cycle)
    assert len(cycles) == 65 and cycles[-1] - cycles[0] == 64, f"{len(cycles)} flits over cycles {cycles[0]}..{cycles[-1]}"


# Input word offsets for the IN_BASE tests: a first layer lowers to IN_BASE 0,
# but later layers start anywhere, so every word offset mod 4 is exercised.
IN_OFFSETS = (1, 2, 3)


def three_word_rotations(plan, in_base):
    """Bank rotations (window start word mod 4) of the slots whose valid lanes
    really span three words, for a stride-2 layer at byte address in_base."""
    rots = set()
    for pb in range(plan.pixel_blocks):
        oy, ox0 = divmod(8 * pb, plan.wout)
        for ky in range(plan.ksize):
            for kx in range(plan.ksize):
                iy = plan.stride * oy + ky - plan.pad
                ix = [plan.stride * (ox0 + l) + kx - plan.pad for l in range(8)]
                ix = [v for v in ix if 0 <= v < plan.w]
                if not 0 <= iy < plan.h or not ix:
                    continue
                first, last = in_base + iy * plan.w + ix[0], in_base + iy * plan.w + ix[-1]
                if (last >> 3) - (first >> 3) == 2:
                    ix0 = plan.stride * ox0 + kx - plan.pad
                    rots.add(((in_base + iy * plan.w + ix0) >> 3) % 4)
    return rots


@cocotb.test()
async def test_every_bank_rotation_occurs(dut):
    """Across the IN_BASE offsets the tests run, stride-2 windows whose valid
    lanes span three words start in every bank (spec: four banks), so every
    rotation's third word carries real data. Pure Python coverage check."""
    p = Layer(random.Random(14), *FIXED[1]).plan
    rots = set()
    for off in (0,) + IN_OFFSETS:
        rots |= three_word_rotations(p, 8 * off)
    assert rots == {0, 1, 2, 3}, f"three-word windows only in rotations {sorted(rots)}"
