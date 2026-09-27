"""cocotb tests for rtl/flit_pack.v: beats become OPERAND/GO flits exactly
as compiler/flits.py builds them, in order, at one flit per cycle, through
any pattern of injection backpressure."""

import random

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

import flits

AW = 3


async def reset(dut):
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    dut.rst.value = 1
    dut.in_valid.value = 0
    dut.inj_ready.value = 1
    for _ in range(3):
        await RisingEdge(dut.clk)
    dut.rst.value = 0


def random_block(rng):
    return {"dest_x": rng.randrange(8), "dest_y": rng.randrange(8), "acc_keep": rng.randrange(2),
            "no_ret": rng.randrange(2), "requant": rng.randrange(2), "relu": rng.randrange(2),
            "sh": rng.randrange(64), "m": rng.randrange(1 << 16)}


def beats_and_flits(rng, blk, n):
    """n OPERAND beats then a GO beat, with the flits they must become."""
    beats, want = [], []
    dest = (blk["dest_x"], blk["dest_y"])
    for slot in range(n):
        a = tuple(rng.randrange(-128, 128) for _ in range(8))
        b = tuple(rng.randrange(-128, 128) for _ in range(8))
        beats.append((0, slot, flits.lanes(a), flits.lanes(b), 0))
        want.append(flits.operand(AW, dest, slot, a, b))
    beats.append((1, 0, 0, 0, n // 8))
    want.append(flits.go(AW, dest, n // 8, m=blk["m"], sh=blk["sh"], relu=bool(blk["relu"]),
                         requant=bool(blk["requant"]), acc_keep=bool(blk["acc_keep"]), no_ret=bool(blk["no_ret"])))
    return beats, want


def present(dut, beat):
    go, slot, a, b, kch = beat
    dut.in_valid.value, dut.in_go.value, dut.in_slot.value = 1, go, slot
    dut.in_a.value, dut.in_b.value, dut.in_kchunks.value = a, b, kch


async def run(dut, rng, blocks, ready_prob):
    """Drive every block's beats back to back; return (flits seen, flits expected)."""
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

    col = cocotb.start_soon(collect())
    bp = cocotb.start_soon(backpressure())
    want = []
    for blk, n in blocks:
        beats, w = beats_and_flits(rng, blk, n)
        want += w
        for name, value in blk.items():
            getattr(dut, name).value = value
        for beat in beats:
            present(dut, beat)
            while True:
                await FallingEdge(dut.clk)
                accepted = bool(dut.in_ready.value)
                await RisingEdge(dut.clk)
                if accepted:
                    break
        dut.in_valid.value = 0
    bp.kill()
    dut.inj_ready.value = 1
    for _ in range(10):
        await RisingEdge(dut.clk)
    col.kill()
    return seen, want


@cocotb.test()
async def test_beats_become_flits(dut):
    await reset(dut)
    rng = random.Random(1)
    seen, want = await run(dut, rng, [(random_block(rng), n) for n in (8, 64, 16)], ready_prob=1.0)
    assert [flits.decode(AW, f) for f in seen] == [flits.decode(AW, f) for f in want]
    assert seen == want


@cocotb.test()
async def test_random_backpressure_keeps_every_flit_in_order(dut):
    await reset(dut)
    rng = random.Random(2)
    seen, want = await run(dut, rng, [(random_block(rng), rng.choice((8, 24, 64))) for _ in range(6)], ready_prob=0.4)
    assert seen == want


@cocotb.test()
async def test_one_flit_per_cycle_without_backpressure(dut):
    await reset(dut)
    rng = random.Random(3)
    blk = random_block(rng)
    beats, want = beats_and_flits(rng, blk, 64)
    for name, value in blk.items():
        getattr(dut, name).value = value
    valid_cycles = 0

    async def count():
        nonlocal valid_cycles
        while True:
            await FallingEdge(dut.clk)
            valid_cycles += int(dut.inj_valid.value)

    c = cocotb.start_soon(count())
    for beat in beats:
        present(dut, beat)
        await FallingEdge(dut.clk)
        assert dut.in_ready.value, "flit_pack stalled with inj_ready held high"
        await RisingEdge(dut.clk)
    dut.in_valid.value = 0
    for _ in range(4):
        await RisingEdge(dut.clk)
    c.kill()
    assert valid_cycles == len(want)
