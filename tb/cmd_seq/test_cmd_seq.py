"""cocotb tests for rtl/cmd_seq.v (tb/cmd_seq/cmd_seq_tb.v, 4x3 mesh):
compiled programs issue exactly the BLOCKs compiler/golden.py executes, with
the registers and write-back entries they imply, holding every DMA input
until done, never past an undrained WAIT or END, and never to a full
write-back FIFO; ADD, LOOP, and restart match golden; every fault stops at
golden's pc and stays stopped."""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

import isa
from build import build
from golden import Golden, GoldenError, Tracer
from hwview import dma_ports, entry_words
from nets import NETS, random_net

MESH = (4, 3)
BLOCK_PORTS = tuple(isa.BLOCK_FIELDS)
REG_PORTS = ("in_base", "w_base", "cin_log2", "h_log2", "w_log2", "wout_log2", "stride2", "pad",
             "ksize", "ks", "bias_start", "bias_val")
PUSH_PORTS = ("wb_push", "wb_tile", "wb_raw", "wb_base", "wb_step")

# Registers for hand-written programs: one 1x1-kernel BLOCK over a 64-byte
# input row (as compiler/test_golden.py's window_program), OSTRIDE 8 so
# pixel blocks 0..7 write disjoint words.
SETUP = [isa.add(r, isa.ZERO, v) for r, v in {
    isa.W_LOG2: 6, isa.WOUT_LOG2: 3, isa.STRIDE: 1, isa.KSIZE: 1, isa.KS: 8,
    isa.BIAS: 1 | (1 << 16), isa.OSTRIDE: 8, isa.OUT_BASE: 64}.items()]

_loaded = 0  # program words written by earlier tests (zeroed on the next load)


def blk(x, y, pb=0, **flags):
    return isa.block(isa.Block(x, y, 0, pb, 0, **flags))


def net_build(name, n_images=2, seed=0):
    rng = np.random.default_rng(seed)
    shape, specs = NETS[name]
    q, layers = random_net(rng, shape, specs)
    return build(q, layers, rng.integers(-128, 128, (n_images,) + shape), *MESH)


async def setup_dut(dut):
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset(dut)


async def reset(dut):
    for sig in ("start", "prog_we", "dma_busy", "dma_done", "wb_full"):
        getattr(dut, sig).value = 0
    dut.wb_idle.value = 1
    dut.rst.value = 1
    for _ in range(3):
        await RisingEdge(dut.clk)
    dut.rst.value = 0


async def load(dut, program):
    """Write the program, then zero whatever an earlier test left beyond it."""
    global _loaded
    words = list(program) + [0] * max(0, _loaded - len(program))
    for addr, word in enumerate(words):
        dut.prog_we.value, dut.prog_waddr.value, dut.prog_wdata.value = 1, addr, int(word)
        await RisingEdge(dut.clk)
    dut.prog_we.value = 0
    _loaded = max(_loaded, len(program))


def ports(dut, names):
    return {n: int(getattr(dut, n).value) for n in names}


def block_of(dut):
    f = ports(dut, BLOCK_PORTS)
    return isa.Block(**{n: bool(v) if isa.BLOCK_FIELDS[n][1] == 1 else v for n, v in f.items()})


class Env:
    """Stands in for rtl/dma_gather.v and rtl/writeback.v around the
    sequencer and records every BLOCK issue. The DMA takes a random number
    of cycles and checks its inputs hold until done; write-back retires
    entries at random, oldest first per tile, at most `budget` more of them
    (None: no limit)."""

    def __init__(self, dut, rng, dma_cycles=(1, 12), retire_prob=0.3):
        self.dut, self.rng = dut, rng
        self.dma_cycles, self.retire_prob = dma_cycles, retire_prob
        self.issues = []   # {"block", "regs", "push", "pending"} per BLOCK issued
        self.pending = []  # (tile, issue index) of entries not yet written back, oldest first
        self.budget = None
        self.tasks = [cocotb.start_soon(self.dma()), cocotb.start_soon(self.writeback())]

    def stop(self):
        for t in self.tasks:
            t.kill()

    async def dma(self):
        dut = self.dut
        while True:
            await FallingEdge(dut.clk)
            if not dut.dma_start.value:
                continue
            assert not dut.dma_busy.value, "dma_start while the DMA is busy"
            push = ports(dut, PUSH_PORTS)
            self.issues.append({"block": block_of(dut), "regs": ports(dut, REG_PORTS), "push": push,
                                "pending": [i for _, i in self.pending]})
            n = len(self.issues) - 1
            if push["wb_push"]:
                tile = push["wb_tile"]
                assert sum(t == tile for t, _ in self.pending) < 2, f"BLOCK {n} pushed to tile {tile}'s full FIFO"
                self.pending.append((tile, n))
            held = ports(dut, BLOCK_PORTS + REG_PORTS)
            await RisingEdge(dut.clk)
            dut.dma_busy.value = 1
            for _ in range(self.rng.randint(*self.dma_cycles)):
                await FallingEdge(dut.clk)
                assert ports(dut, BLOCK_PORTS + REG_PORTS) == held, f"BLOCK {n}: DMA inputs changed before done"
                assert not dut.dma_start.value, f"BLOCK {n}: dma_start while the DMA is busy"
                await RisingEdge(dut.clk)
            dut.dma_done.value = 1
            await FallingEdge(dut.clk)
            assert ports(dut, BLOCK_PORTS + REG_PORTS) == held, f"BLOCK {n}: DMA inputs changed in the done cycle"
            await RisingEdge(dut.clk)
            dut.dma_done.value = 0
            dut.dma_busy.value = 0

    async def writeback(self):
        dut = self.dut
        while True:
            await FallingEdge(dut.clk)
            assert not dut.wb_push.value or dut.dma_start.value, "wb_push without dma_start"
            await RisingEdge(dut.clk)
            if self.pending and self.budget != 0 and self.rng.random() < self.retire_prob:
                tile = self.rng.choice(self.pending)[0]
                self.pending.remove(next(p for p in self.pending if p[0] == tile))
                if self.budget is not None:
                    self.budget -= 1
            tiles = [t for t, _ in self.pending]
            dut.wb_full.value = sum(1 << t for t in set(tiles) if tiles.count(t) >= 2)
            dut.wb_idle.value = int(not self.pending)


async def run(dut, env, max_cycles=200_000):
    """Pulse start; return the falling edges counted from the one after start
    was sampled up to the first with done or error high."""
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0
    for cycles in range(1, max_cycles + 1):
        await FallingEdge(dut.clk)
        if dut.done.value or dut.error.value:
            if dut.done.value:
                assert not env.pending, "done with write-back entries outstanding"
            return cycles
    raise AssertionError(f"neither done nor error within {max_cycles} cycles")


def check_trace(env, tracer):
    assert len(env.issues) == len(tracer.blocks), f"{len(env.issues)} BLOCKs issued, golden ran {len(tracer.blocks)}"
    for n, (issue, (pc, b, regs, epoch, words)) in enumerate(zip(env.issues, tracer.blocks)):
        where = f"BLOCK {n} (pc {pc})"
        assert issue["block"] == b, f"{where}: issued {issue['block']}, expected {b}"
        assert issue["regs"] == dma_ports(regs), f"{where}: DMA registers {issue['regs']}, expected {dma_ports(regs)}"
        push = issue["push"]
        if words is None:
            assert not push["wb_push"], f"{where} is no_ret but pushed a write-back entry"
        else:
            assert push["wb_push"], f"{where} returns results but pushed no entry"
            assert push["wb_tile"] == b.tile_y * MESH[0] + b.tile_x, f"{where}: entry for tile {push['wb_tile']}"
            assert push["wb_raw"] == int(not b.requant), f"{where}: entry raw={push['wb_raw']}"
            got = entry_words(push["wb_base"], push["wb_step"], push["wb_raw"])
            assert np.array_equal(got, words), f"{where}: entry covers {got[:4]}..., golden writes {words[:4]}..."
        stale = [i for i in issue["pending"] if tracer.blocks[i][3] != epoch]
        assert not stale, f"{where} issued before BLOCK {stale[0]}'s write-back drained (a WAIT lies between them)"


def golden_regs(program):
    g = Golden(*MESH, program, [], [])
    g.run()
    return g.regs


def dut_regs(dut):
    return [int(dut.seq.regs[i].value) for i in range(isa.N_REGS)]


@cocotb.test()
async def test_compiled_programs_issue_what_golden_executes(dut):
    """Two compiled nets back to back (the second start restarts a finished
    program); the second with rare retires, so credit stalls are frequent."""
    await setup_dut(dut)
    rng = random.Random(1)
    for name, retire_prob in (("small", 0.3), ("wide", 0.05)):
        b = net_build(name)
        tracer = Tracer(*MESH, b.program, b.lowered.weights, b.act)
        tracer.run()
        await load(dut, b.program)
        env = Env(dut, rng, retire_prob=retire_prob)
        await run(dut, env)
        env.stop()
        assert dut.done.value and not dut.error.value, f"{name}: error at pc {int(dut.error_pc.value)}"
        check_trace(env, tracer)


@cocotb.test()
async def test_random_adds_match_golden_one_per_cycle(dut):
    await setup_dut(dut)
    rng = random.Random(2)
    imms = lambda: rng.choice((rng.randrange(1 << 32), rng.randrange(-(1 << 31), 0), 1, 0xFFFF_FFFF))
    prog = [isa.add(rng.randrange(16), rng.randrange(16), imms()) for _ in range(300)] + [isa.end()]
    await load(dut, prog)
    env = Env(dut, rng)
    cycles = await run(dut, env)
    env.stop()
    assert dut.done.value
    assert dut_regs(dut) == golden_regs(prog)
    # Command i executes at the (i+1)th edge after start; done is registered
    # at END's edge and seen at the next falling edge.
    assert cycles == len(prog) + 1, f"{cycles} cycles for {len(prog)} commands: not one command per cycle"


@cocotb.test()
async def test_loops_match_golden(dut):
    """A loop whose body starts with a BLOCK, a LOOP of 1 around a no_ret
    BLOCK, and an ENDLOOP that falls straight into END."""
    await setup_dut(dut)
    prog = SETUP + [
        isa.loop(3), blk(1, 2), isa.add(isa.IN_BASE, isa.IN_BASE, 8), isa.wait(), isa.endloop(),
        isa.loop(1), blk(3, 0, no_ret=True), isa.endloop(),
        isa.loop(2), isa.add(14, 14, 1), isa.endloop(),
        isa.end(),
    ]
    tracer = Tracer(*MESH, prog, [], [])
    tracer.run()
    await load(dut, prog)
    env = Env(dut, random.Random(3))
    await run(dut, env)
    env.stop()
    assert dut.done.value and not dut.error.value
    check_trace(env, tracer)
    assert dut_regs(dut) == tracer.regs


@cocotb.test()
async def test_wait_and_end_hold_until_write_back_drains(dut):
    await setup_dut(dut)
    prog = SETUP + [blk(0, 0), isa.wait(), blk(1, 0), isa.end()]
    await load(dut, prog)
    env = Env(dut, random.Random(4), retire_prob=1.0)
    env.budget = 0
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0
    for _ in range(60):
        await FallingEdge(dut.clk)
    assert len(env.issues) == 1 and dut.wait_stall.value, "the second BLOCK passed a WAIT with write-back pending"
    env.budget = 1
    for _ in range(60):
        await FallingEdge(dut.clk)
    assert len(env.issues) == 2, "the WAIT did not release once write-back drained"
    assert not dut.done.value and dut.wait_stall.value, "END raised done with write-back pending"
    env.budget = None
    for _ in range(20):
        await FallingEdge(dut.clk)
        if dut.done.value:
            break
    env.stop()
    assert dut.done.value and not env.pending


@cocotb.test()
async def test_a_full_write_back_fifo_holds_only_returning_blocks(dut):
    await setup_dut(dut)
    prog = SETUP + [blk(0, 0, 0), blk(0, 0, 1), blk(0, 0, 2, no_ret=True), blk(0, 0, 3), isa.end()]
    await load(dut, prog)
    env = Env(dut, random.Random(5))
    env.budget = 0
    dut.start.value = 1
    await RisingEdge(dut.clk)
    dut.start.value = 0
    for _ in range(80):
        await FallingEdge(dut.clk)
    assert len(env.issues) == 3, f"{len(env.issues)} BLOCKs issued: the no_ret BLOCK must pass a full FIFO, the fourth must not"
    assert dut.credit_stall.value
    env.budget = None
    for _ in range(200):
        await FallingEdge(dut.clk)
        if dut.done.value:
            break
    env.stop()
    assert dut.done.value and len(env.issues) == 4


@cocotb.test()
async def test_start_clears_registers(dut):
    await setup_dut(dut)
    rng = random.Random(7)
    for prog in ([isa.add(5, 0, 7), isa.loop(4), isa.end()],  # leaves r5 set and a loop active
                 [isa.add(6, 5, 1), isa.loop(2), isa.endloop(), isa.end()]):
        await load(dut, prog)
        env = Env(dut, rng)
        await run(dut, env)
        env.stop()
        assert dut.done.value and not dut.error.value, f"error at pc {int(dut.error_pc.value)}"
        assert dut_regs(dut) == golden_regs(prog)


# Fault programs; golden supplies each expected pc.
FAULTS = [
    [0],                                           # opcode 0: zeroed memory
    [isa.add(1, 0, 1), 7 << 60],                   # first opcode past END
    [15 << 60],
    [isa.add(1, 0, 1)],                            # runs off the program into zeroed memory
    [isa.loop(2), isa.loop(2)],
    [isa.endloop()],
    [isa.LOOP << 60],                              # LOOP 0
    [blk(4, 0)],                                   # tile_x = W
    [isa.add(1, 0, 1), blk(0, 3)],                 # tile_y = H
]


def golden_fault_pc(prog):
    try:
        Golden(*MESH, prog, [], []).run()
    except GoldenError as e:
        return e.pc
    raise AssertionError(f"golden ran fault program {prog} to END")


@cocotb.test()
async def test_every_fault_stops_at_its_pc(dut):
    await setup_dut(dut)
    rng = random.Random(6)
    for prog in FAULTS:
        want = golden_fault_pc(prog)
        await reset(dut)
        await load(dut, prog)
        env = Env(dut, rng)
        await run(dut, env)
        assert dut.error.value and not dut.done.value, f"{prog}: no fault"
        assert int(dut.error_pc.value) == want, f"{prog}: error_pc {int(dut.error_pc.value)}, golden {want}"
        assert not env.issues, f"{prog}: a BLOCK issued"
        # Sticky: another start changes nothing.
        dut.start.value = 1
        await RisingEdge(dut.clk)
        dut.start.value = 0
        for _ in range(10):
            await FallingEdge(dut.clk)
            assert dut.error.value and not dut.busy.value and int(dut.error_pc.value) == want
        env.stop()
