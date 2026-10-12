"""cocotb tests for rtl/writeback.v (tb/writeback/writeback_tb.v, 4x3 mesh):
RESULT8 rows, RESULT16 half rows, and raw RESULT cells, each for a block
limited to its first 1-8 rows, land where their tile's oldest entry says,
whatever the interleaving across tiles; full and idle track the entries
cycle-exactly, including a push and a pop on one tile in one cycle and an
entry that pops after its row limit's last flit; a RESULT with no pending
entry, or of another mode than its entry, is fatal."""

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
MODE_RAW, MODE_Q8, MODE_Q16 = 0, 1, 2
FLITS_PER_ROW = {MODE_RAW: 8, MODE_Q8: 1, MODE_Q16: 2}


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
    push = (tile, mode, rows_m1, base, step); res = (tile, mode, idx, data);
    mode is MODE_RAW, MODE_Q8, or MODE_Q16."""
    await RisingEdge(dut.clk)
    dut.push.value = int(push is not None)
    if push is not None:
        dut.push_tile.value, dut.push_mode.value, dut.push_rows_m1.value = push[:3]
        dut.push_base.value, dut.push_step.value = push[3:]
    dut.res_valid.value = int(res is not None)
    if res is not None:
        tile, mode, idx, data = res
        dut.res_src_x.value, dut.res_src_y.value = tile % W, tile // W
        dut.res_q8.value, dut.res_q16.value = int(mode != MODE_RAW), int(mode == MODE_Q16)
        dut.res_idx.value, dut.res_data.value = idx, data
    await FallingEdge(dut.clk)


def entry(blk):
    return blk["tile"], blk["mode"], blk["rows"] - 1, blk["base"], blk["step"]


def make_blocks(rng, n, modes=(MODE_RAW, MODE_Q8), limit_rows=False):
    """n blocks in disjoint address regions, random tile, mode, and step
    (and, with limit_rows, a random row limit in 1..8)."""
    region = isa.ACT_WORDS // n
    out = []
    for i in range(n):
        mode = rng.choice(modes)
        rows = rng.randint(1, 8) if limit_rows else 8
        max_step = (region - 16) // 7  # 7 steps plus a block's width must fit in the region
        step = {MODE_RAW: 8 * rng.randint(1, min(48, max_step // 8)), MODE_Q8: rng.randint(1, min(256, max_step)),
                MODE_Q16: rng.randint(2, min(256, max_step))}[mode]
        out.append({"tile": rng.randrange(NT), "mode": mode, "rows": rows, "step": step,
                    "base": i * region + rng.randrange(region - 7 * step - 8),
                    "data": [rng.getrandbits(64) for _ in range(FLITS_PER_ROW[mode] * rows)]})
    return out


def check_memory(dut, blocks):
    for n, blk in enumerate(blocks):
        words = entry_words(blk["base"], blk["step"], blk["mode"] == MODE_RAW, blk["mode"] == MODE_Q16, blk["rows"])
        for k, (w, d) in enumerate(zip(words, blk["data"])):
            got = int(dut.g_act[int(w) % 4].bank.mem[int(w) >> 2].value)
            assert got == d, f"block {n} flit {k}: word {int(w)} holds {got:016x}, expected {d:016x}"


async def run_random_blocks(dut, rng, blocks):
    """Push and return `blocks` the way cmd_seq and the mesh would, with
    random interleaving across tiles, then check every word landed."""
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
            res = (tile, s[0]["mode"], s[1], s[0]["data"][s[1]])
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
async def test_random_blocks_land_at_their_addresses(dut):
    await setup(dut)
    rng = random.Random(1)
    await run_random_blocks(dut, rng, make_blocks(rng, 40))


@cocotb.test()
async def test_mixed_modes_and_row_limits_land_at_their_addresses(dut):
    """Raw, RESULT8 and RESULT16 blocks of 1-8 rows interleaved across tiles:
    every flit at base + i * step (+ j, or + h), every entry popping on its
    own mode's last flit while other tiles' entries are in flight."""
    await setup(dut)
    rng = random.Random(3)
    blocks = make_blocks(rng, 60, modes=(MODE_RAW, MODE_Q8, MODE_Q16), limit_rows=True)
    assert {b["mode"] for b in blocks} == {MODE_RAW, MODE_Q8, MODE_Q16} and {b["rows"] for b in blocks} == set(range(1, 9))
    await run_random_blocks(dut, rng, blocks)


@cocotb.test()
async def test_full_and_idle_track_entries(dut):
    """Cycle-exact: a flit is registered, then written; the last write pops
    the entry at the end of its cycle. c is pushed in the cycle b pops."""
    await setup(dut)
    rng = random.Random(2)
    tile = 5
    a, b, c = ({"tile": tile, "mode": MODE_Q8, "rows": 8, "base": 1000 + 100 * i, "step": 3,
                "data": [rng.getrandbits(64) for _ in range(8)]} for i in range(3))
    await cycle(dut, push=entry(a))                          # cycle 0
    await cycle(dut, push=entry(b))                          # cycle 1: a's entry registered
    assert not (int(dut.full.value) >> tile) & 1 and not dut.idle.value
    for k in range(8):                                       # cycles 2..9 (b registered at cycle 2)
        await cycle(dut, res=(tile, MODE_Q8, k, a["data"][k]))
        assert (int(dut.full.value) >> tile) & 1, f"full dropped before a's row {k} was written"
    await cycle(dut)                                         # cycle 10: a's row 7 written, a pops
    assert (int(dut.full.value) >> tile) & 1
    for k in range(7):                                       # cycles 11..17
        await cycle(dut, res=(tile, MODE_Q8, k, b["data"][k]))
        assert not (int(dut.full.value) >> tile) & 1
    await cycle(dut, res=(tile, MODE_Q8, 7, b["data"][7]))      # cycle 18
    await cycle(dut, push=entry(c))                          # cycle 19: b pops as c is pushed
    await cycle(dut)                                         # cycle 20
    assert not dut.idle.value and not (int(dut.full.value) >> tile) & 1, "one entry (c) must remain"
    for k in range(8):                                       # cycles 21..28
        await cycle(dut, res=(tile, MODE_Q8, k, c["data"][k]))
    await cycle(dut)                                         # cycle 29: c's row 7 written, c pops
    assert not dut.idle.value
    await cycle(dut)                                         # cycle 30
    assert dut.idle.value and not int(dut.full.value)
    check_memory(dut, [a, b, c])


@cocotb.test()
async def test_row_limited_entry_pops_after_its_last_flit(dut):
    """An entry limited to R rows pops on flit 8R-1 (raw), R-1 (RESULT8), or
    2R-1 (RESULT16), not one flit early or late: it stays outstanding until
    exactly then."""
    await setup(dut)
    rng = random.Random(4)
    base = 2000
    for mode in (MODE_RAW, MODE_Q8, MODE_Q16):
        for rows in (1, 2, 8):
            n = FLITS_PER_ROW[mode] * rows
            blk = {"tile": 7, "mode": mode, "rows": rows, "base": base, "step": 16, "data": [rng.getrandbits(64) for _ in range(n)]}
            await cycle(dut, push=entry(blk))
            for k in range(n - 1):
                await cycle(dut, res=(7, mode, k, blk["data"][k]))
            await cycle(dut)
            await cycle(dut)
            assert not dut.idle.value, f"mode {mode} rows {rows}: popped before flit {n - 1}"
            await cycle(dut, res=(7, mode, n - 1, blk["data"][n - 1]))
            await cycle(dut)
            await cycle(dut)
            assert dut.idle.value, f"mode {mode} rows {rows}: still outstanding after its last flit"
            check_memory(dut, [blk])
            base += 200


@cocotb.test(skip=os.environ.get("WRITEBACK_MODE_PROBE") not in ("q16_for_q8", "q8_for_q16"))
async def test_flit_of_the_wrong_mode_is_fatal(dut):
    """Negative test, run only by `make mode-check`: a RESULT16 flit for a
    RESULT8 entry (and the reverse) must stop the run; reaching the end means
    the check did NOT fire."""
    await setup(dut)
    entry_mode, flit_mode = (MODE_Q8, MODE_Q16) if os.environ["WRITEBACK_MODE_PROBE"] == "q16_for_q8" else (MODE_Q16, MODE_Q8)
    await cycle(dut, push=(3, entry_mode, 7, 100, 4))
    await cycle(dut, res=(3, flit_mode, 0, 0x1234))
    for _ in range(3):
        await cycle(dut)
    raise AssertionError(f"a {flit_mode=} flit for a {entry_mode=} entry did not stop the run")


@cocotb.test(skip=os.environ.get("WRITEBACK_ORPHAN_PROBE") != "1")
async def test_orphan_result_is_fatal(dut):
    """Negative test, run only by `make orphan-check`: reaching the end means
    the check did NOT fire; orphan-check expects this run to die."""
    await setup(dut)
    await cycle(dut, res=(3, MODE_Q8, 0, 0x1234))
    for _ in range(3):
        await cycle(dut)
    raise AssertionError("a RESULT8 with no pending entry did not stop the run")
