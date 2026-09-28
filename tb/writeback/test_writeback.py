"""cocotb tests for rtl/writeback.v (tb/writeback/writeback_tb.v, 4x3 mesh):
RESULT8 rows and raw RESULT cells land where their tile's oldest entry
says, whatever the interleaving across tiles; full and idle track the
entries cycle-exactly, including a push and a pop on one tile in one cycle;
a RESULT with no pending entry is fatal."""

import os
import random
from collections import deque

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

import isa
from hwview import entry_words

W, H = 4, 3
NT = W * H


async def setup(dut):
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    for sig in ("push", "res_valid"):
        getattr(dut, sig).value = 0
    dut.rst.value = 1
    for _ in range(3):
        await RisingEdge(dut.clk)
    dut.rst.value = 0


async def cycle(dut, push=None, res=None):
    """One cycle: drive after the rising edge, return at the falling edge.
    push = (tile, raw, base, step); res = (tile, q8, idx, data)."""
    await RisingEdge(dut.clk)
    dut.push.value = int(push is not None)
    if push is not None:
        dut.push_tile.value, dut.push_raw.value, dut.push_base.value, dut.push_step.value = push
    dut.res_valid.value = int(res is not None)
    if res is not None:
        tile, q8, idx, data = res
        dut.res_src_x.value, dut.res_src_y.value = tile % W, tile // W
        dut.res_q8.value, dut.res_idx.value, dut.res_data.value = int(q8), idx, data
    await FallingEdge(dut.clk)


def entry(blk):
    return blk["tile"], int(blk["raw"]), blk["base"], blk["step"]


def make_blocks(rng, n):
    """n blocks in disjoint address regions, random tile, kind, and step."""
    region = isa.ACT_WORDS // n
    out = []
    for i in range(n):
        raw = rng.random() < 0.5
        step = 8 * rng.randint(1, 48) if raw else rng.randint(1, 256)
        out.append({"tile": rng.randrange(NT), "raw": raw, "step": step,
                    "base": i * region + rng.randrange(region - 7 * step - 8),
                    "data": [rng.getrandbits(64) for _ in range(64 if raw else 8)]})
    return out


def check_memory(dut, blocks):
    for n, blk in enumerate(blocks):
        for k, (w, d) in enumerate(zip(entry_words(blk["base"], blk["step"], blk["raw"]), blk["data"])):
            got = int(dut.g_act[int(w) % 4].bank.mem[int(w) >> 2].value)
            assert got == d, f"block {n} flit {k}: word {int(w)} holds {got:016x}, expected {d:016x}"


@cocotb.test()
async def test_random_blocks_land_at_their_addresses(dut):
    await setup(dut)
    rng = random.Random(1)
    blocks = make_blocks(rng, 40)
    queue = deque(blocks)
    streams = {t: deque() for t in range(NT)}  # per tile: [block, next flit, push cycle], oldest first
    last_push, full, t = {}, 0, 0
    while queue or any(streams.values()):
        push = res = None
        # Push like cmd_seq: only when the tile's FIFO has room. full as sampled
        # here predates a push driven last cycle, so skip a tile pushed then.
        if queue and rng.random() < 0.5:
            blk = queue[0]
            if not (full >> blk["tile"]) & 1 and last_push.get(blk["tile"]) != t - 1:
                push = entry(blk)
                queue.popleft()
                streams[blk["tile"]].append([blk, 0, t])
                last_push[blk["tile"]] = t
        # One RESULT flit per cycle at most, from a tile whose oldest block
        # was pushed in an earlier cycle (a tile returns blocks in order).
        ready = [tile for tile, s in streams.items() if s and s[0][2] < t]
        if ready and rng.random() < 0.7:
            tile = rng.choice(ready)
            s = streams[tile][0]
            res = (tile, not s[0]["raw"], s[1], s[0]["data"][s[1]])
            s[1] += 1
            if s[1] == len(s[0]["data"]):
                streams[tile].popleft()
        await cycle(dut, push, res)
        full = int(dut.full.value)
        t += 1
    for _ in range(3):
        await cycle(dut)
    assert dut.idle.value and not int(dut.full.value), "entries left after every block was written"
    check_memory(dut, blocks)


@cocotb.test()
async def test_full_and_idle_track_entries(dut):
    """Cycle-exact: a flit is registered, then written; the last write pops
    the entry at the end of its cycle. c is pushed in the cycle b pops."""
    await setup(dut)
    rng = random.Random(2)
    tile = 5
    a, b, c = ({"tile": tile, "raw": False, "base": 1000 + 100 * i, "step": 3,
                "data": [rng.getrandbits(64) for _ in range(8)]} for i in range(3))
    await cycle(dut, push=entry(a))                          # cycle 0
    await cycle(dut, push=entry(b))                          # cycle 1: a's entry registered
    assert not (int(dut.full.value) >> tile) & 1 and not dut.idle.value
    for k in range(8):                                       # cycles 2..9 (b registered at cycle 2)
        await cycle(dut, res=(tile, True, k, a["data"][k]))
        assert (int(dut.full.value) >> tile) & 1, f"full dropped before a's row {k} was written"
    await cycle(dut)                                         # cycle 10: a's row 7 written, a pops
    assert (int(dut.full.value) >> tile) & 1
    for k in range(7):                                       # cycles 11..17
        await cycle(dut, res=(tile, True, k, b["data"][k]))
        assert not (int(dut.full.value) >> tile) & 1
    await cycle(dut, res=(tile, True, 7, b["data"][7]))      # cycle 18
    await cycle(dut, push=entry(c))                          # cycle 19: b pops as c is pushed
    await cycle(dut)                                         # cycle 20
    assert not dut.idle.value and not (int(dut.full.value) >> tile) & 1, "one entry (c) must remain"
    for k in range(8):                                       # cycles 21..28
        await cycle(dut, res=(tile, True, k, c["data"][k]))
    await cycle(dut)                                         # cycle 29: c's row 7 written, c pops
    assert not dut.idle.value
    await cycle(dut)                                         # cycle 30
    assert dut.idle.value and not int(dut.full.value)
    check_memory(dut, [a, b, c])


@cocotb.test(skip=os.environ.get("WRITEBACK_ORPHAN_PROBE") != "1")
async def test_orphan_result_is_fatal(dut):
    """Negative test, run only by `make orphan-check`: reaching the end means
    the check did NOT fire; orphan-check expects this run to die."""
    await setup(dut)
    await cycle(dut, res=(3, True, 0, 0x1234))
    for _ in range(3):
        await cycle(dut)
    raise AssertionError("a RESULT8 with no pending entry did not stop the run")
