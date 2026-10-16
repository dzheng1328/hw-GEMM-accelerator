"""pytest for compiler/lower_lm.py: the compiled program on the golden
executor against model/lm_reference.py (level 3 of the verification ladder),
and the structure the RTL relies on."""

import numpy as np
import pytest

import isa
from check_lm import RANDOM_PROMPT, RANDOM_SEEDS, check
from lm_reference import NPZ_PATH, random_quantized
from lower_lm import lm_build


def q_random():
    return random_quantized(0)


@pytest.mark.parametrize("steps, temp, mesh", [
    (6, 0, (1, 1)),  # one position past the 5-token prompt
    (16, 256, (2, 2)),  # sampling with a temperature
    (12, 0, (4, 3)),  # a mesh wider than 8 stories' tiles
    (10, 256, (8, 8)),  # more tiles than stories
])
def test_golden_equals_the_reference_on_a_random_model(steps, temp, mesh):
    assert check(q_random(), RANDOM_PROMPT, RANDOM_SEEDS, mesh, steps, temp)[:3] == (True, True, True)


def test_golden_equals_the_reference_across_the_attention_round_boundaries():
    """T = 7 to 8 grows the QK^T blocks and the AV slots; T = 63 to 64 adds a
    second AV round (acc_keep, only the last round returns)."""
    assert check(q_random(), RANDOM_PROMPT, RANDOM_SEEDS, (2, 2), 66, 256)[:3] == (True, True, True)


@pytest.mark.parametrize("temp", [0, 256])
def test_golden_equals_the_reference_on_the_real_model(temp):
    q = dict(np.load(NPZ_PATH))
    assert check(q, q["prompt_ids"], q["seeds"], (2, 2), 8, temp)[:3] == (True, True, True)


def test_the_tests_would_notice_a_wrong_program(monkeypatch):
    """A guard against vacuous comparisons: dropping the down projection's
    partial-sum accumulation must change the tokens or the caches."""
    import lower_lm

    real = isa.Block

    def forget_acc_keep(*a, **kw):
        kw["acc_keep"] = False if kw.get("no_ret") is None and kw.get("reg_form") else kw.get("acc_keep", False)
        return real(*a, **kw)

    monkeypatch.setattr(lower_lm, "Block", forget_acc_keep)
    assert check(q_random(), RANDOM_PROMPT, RANDOM_SEEDS, (1, 1), 6, 0)[:3] != (True, True, True)


@pytest.mark.parametrize("mesh", [(1, 1), (2, 2), (4, 3), (8, 8)])
def test_the_program_fits_program_memory_and_waits_only_before_a_tag_clear(mesh):
    from lm_spec import N_LAYERS

    b = lm_build(q_random(), *mesh, 4, 0, RANDOM_PROMPT[:4], RANDOM_SEEDS)
    assert len(b.program) <= isa.PROGRAM_WORDS
    ops = [isa.decode(w)[0] for w in b.program]
    waits = [n for n, op in enumerate(ops) if op == isa.WAIT]
    assert len(waits) == 2 * N_LAYERS  # one per attention window
    assert all(_alu_write(b.program[n + 1]) == (isa.PERF_TAG, 0) for n in waits)
    assert ops[-1] == isa.END and ops.count(isa.END) == 1


def test_attention_pins_each_story_to_tile_s_mod_mesh_size():
    b = lm_build(q_random(), 2, 2, 4, 0, RANDOM_PROMPT[:4], RANDOM_SEEDS)
    reg_form = [isa.decode(w)[1] for w in b.program if isa.decode(w)[0] == isa.BLOCK and isa.decode(w)[1].reg_form
                and isa.decode(w)[1].group == 0 and isa.decode(w)[1].pixel_block == 0]
    attention = [blk for blk in reg_form if blk.m == int(q_random()["l0_score_m"]) or blk.m == int(q_random()["l0_att_m"])]
    tiles = [(blk.tile_x, blk.tile_y) for blk in attention]
    assert set(tiles) == {(0, 0), (1, 0), (0, 1), (1, 1)}
    story_tiles = [tiles[i] for i in range(8)]
    assert story_tiles == [(s % 2, (s % 4) // 2) for s in range(8)]


@pytest.mark.parametrize("kwargs, msg", [
    (dict(n_steps=257), "n_steps"),
    (dict(n_steps=2), "prompt"),
    (dict(inv_temp=1 << 16), "inv_temp"),
    (dict(mesh=(9, 1)), "mesh"),
])
def test_lm_build_rejects_unsupported_configurations(kwargs, msg):
    args = dict(mesh=(1, 1), n_steps=8, inv_temp=0)
    args.update(kwargs)
    with pytest.raises(ValueError, match=msg):
        lm_build(q_random(), *args["mesh"], args["n_steps"], args["inv_temp"], RANDOM_PROMPT, RANDOM_SEEDS)


def _alu_write(word):
    """(register, immediate) of an ALU command with an immediate, else None."""
    if word >> 60 == isa.ALU and (word >> 47) & 1:
        return (word >> 55) & 0x1F, word & 0xFFFF_FFFF
    return None


def test_the_perf_tag_wraps_exactly_the_attention_block_loops():
    """Set before each QK^T and AV loop nest, cleared after a WAIT (an ALU does not wait for the DMA, so a
    bare clear would count the last tagged BLOCK's flits as untagged), no VOP inside a window."""
    from lm_spec import N_LAYERS

    b = lm_build(q_random(), 2, 2, 4, 256, RANDOM_PROMPT, RANDOM_SEEDS)
    tag, tagged, untagged, windows = 0, 0, 0, 0
    for n, word in enumerate(b.program):
        write = _alu_write(word)
        if write and write[0] == isa.PERF_TAG:
            if write[1] == 0:
                assert b.program[n - 1] >> 60 == isa.WAIT, f"tag cleared at pc {n} without a WAIT before it"
            else:
                windows += 1
            tag = write[1]
        elif word >> 60 == isa.VOP:
            assert not tag, f"a VOP at pc {n} lies inside a tagged window"
        elif word >> 60 == isa.BLOCK:
            tagged, untagged = tagged + bool(tag), untagged + (not tag)
    assert tag == 0, "the program ends with the tag set"
    assert windows == 2 * N_LAYERS
    assert tagged == 2 * 8 * N_LAYERS  # one BLOCK word per story in each of the QK^T and AV nests
    assert untagged > 0


def test_the_tracer_counts_the_tagged_blocks_and_slots():
    """The golden's tagged BLOCK count equals the lowering's loop structure: per step, per layer, per story and KV
    head, (T // 8 + 1) QK^T BLOCKs and ceil(K slots / 64) AV rounds."""
    from emit import images
    from golden import Tracer
    from lm_spec import BATCH, N_KV_HEADS, N_LAYERS

    steps = 10
    b = lm_build(q_random(), 2, 2, steps, 256, RANDOM_PROMPT, RANDOM_SEEDS)
    g = Tracer(*b.mesh, *images(b))
    g.run(50_000_000)
    want = 0
    for t in range(steps):
        k_slots = (t + 8) & ~7
        want += N_LAYERS * BATCH * N_KV_HEADS * ((t >> 3) + 1 + (k_slots + 63) // 64)
    assert g.tagged_blocks() == want
    assert 0 < g.tagged_slots < g.slots
