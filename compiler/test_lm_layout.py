"""pytest for compiler/lm_layout.py."""

import numpy as np
import pytest

import isa
from lm_layout import (CHUNK, KV_LAYER_WORDS, MATS, SILU_BLOCK_WORDS, layout, pack_a, pack_act, pack_down, pack_matrix,
                       param_word)
from lm_reference import random_quantized
from lm_spec import BATCH, CTX, DIM, HIDDEN, N_LAYERS, VOCAB


def test_the_map_fits_both_memories_and_matches_the_spec_budget():
    lay = layout(256)
    assert lay.a_words <= isa.WEIGHT_WORDS and lay.act_words <= isa.ACT_WORDS
    assert lay.rope == isa.A_ROPE and lay.toklog == isa.ACT_TOKLOG
    weights = sum(n * k // 8 for _, n, k in MATS) * N_LAYERS
    assert weights * 8 == 240 * 1024  # spec: layer weights 240 KB
    assert KV_LAYER_WORDS * N_LAYERS * 8 == 640 * 1024  # spec: K^T and V caches 640 KB


def regions(lay):
    a = [(lay.rope, 2 * CTX), (lay.emb_param, 1), (lay.emb, VOCAB * DIM // 8), (lay.cls, VOCAB * DIM // 8),
         (lay.normf, 1), (lay.logit_exp, 1), (lay.seeds, BATCH // 2), (lay.qs, 256), (lay.prob, 32 * CTX)]
    act = [(lay.toklog, 2 * (lay.n_steps + 1)), (lay.res, 128), (lay.h, 64), (lay.qf, 64), (lay.kf, 32), (lay.vf, 32),
           (lay.sc, 32 * 128), (lay.avout, 64), (lay.att, 64), (lay.obuf, 128), (lay.gu, 384), (lay.hh, 192),
           (lay.logits, 1024)]
    for addr in lay.layers:
        a += [(addr.mats[name], n * k // 8) for name, n, k in MATS]
        a += [(addr.norm1, 1), (addr.norm2, 1), (addr.exp, 1), (addr.silu, SILU_BLOCK_WORDS)]
        act.append((addr.kv, KV_LAYER_WORDS))
    return a, act


@pytest.mark.parametrize("n_steps", [1, 8, 256])
def test_no_two_regions_overlap(n_steps):
    for mem in regions(layout(n_steps)):
        mem = sorted(mem)
        for (s0, n0), (s1, _) in zip(mem, mem[1:]):
            assert s0 + n0 <= s1


@pytest.mark.parametrize("n_steps", [0, 257])
def test_n_steps_outside_the_context_is_rejected(n_steps):
    with pytest.raises(ValueError, match="n_steps"):
        layout(n_steps)


def test_pack_matrix_puts_output_channel_8g_plus_i_at_byte_i_of_word_g_times_k_plus_k():
    rng = np.random.default_rng(0)
    w = rng.integers(-128, 128, (24, 64))
    words = pack_matrix(w)
    assert words.dtype == np.dtype("<u8") and len(words) == 3 * 64
    lanes = words.view(np.int8).reshape(3, 64, 8)
    for g, k, i in [(0, 0, 0), (2, 63, 7), (1, 17, 3)]:
        assert lanes[g, k, i] == w[8 * g + i, k]
    with pytest.raises(ValueError, match="multiple of 8"):
        pack_matrix(w[:20])
    with pytest.raises(ValueError, match="int8"):
        pack_matrix(w + 200)


def test_the_down_projection_packs_as_three_64_wide_chunks_chunk_major():
    rng = np.random.default_rng(1)
    w = rng.integers(-128, 128, (DIM, HIDDEN))
    lanes = pack_down(w).view(np.int8).reshape(3, DIM // 8, CHUNK, 8)
    for c, g, k, i in [(0, 0, 0, 0), (1, 7, 63, 7), (2, 3, 10, 5)]:
        assert lanes[c, g, k, i] == w[8 * g + i, 64 * c + k]


def test_param_word_packs_m_sh_and_eps_and_rejects_overflow():
    assert int(param_word(0xABCD, 37, 18)) == 0xABCD | (37 << 16) | (18 << 32)
    for bad in [(1 << 16, 0, 0), (0, 64, 0), (0, 0, 1 << 32), (-1, 0, 0)]:
        with pytest.raises(ValueError, match="parameter"):
            param_word(*bad)


def test_pack_a_places_every_table_where_the_layout_says():
    q = random_quantized(3)
    lay = layout(8)
    seeds = np.arange(1, 9) * 2654435761 % (1 << 32)
    mem = pack_a(q, lay, seeds)
    assert len(mem) == lay.a_words
    rope = mem[lay.rope + 10 : lay.rope + 12].view("<i2")
    assert list(rope[:4]) == list(q["rope_cos"][5]) and list(rope[4:]) == list(q["rope_sin"][5])
    assert list(mem[lay.emb + 8 * 300 + 2 : lay.emb + 8 * 300 + 3].view(np.int8)) == list(q["emb"][300, 16:24])
    assert int(mem[lay.emb_param]) == int(param_word(int(q["emb_m"]), int(q["emb_sh"])))
    assert int(mem[lay.normf]) >> 32 == int(q["eps_q"])
    assert list(mem[lay.seeds : lay.seeds + 4].view("<u4")) == list(seeds)
    last = lay.layers[N_LAYERS - 1]
    assert list(mem[last.silu + 1 : last.silu + SILU_BLOCK_WORDS].view("<i2")) == list(q[f"l{N_LAYERS - 1}_silu_table"])
    assert np.array_equal(mem[last.mats["wq"] : last.mats["wq"] + 512], pack_matrix(q[f"l{N_LAYERS - 1}_wq"]))
    assert mem[lay.prob : lay.prob + 32 * CTX].max() == 0 and mem[lay.qs : lay.qs + 256].max() == 0


def test_pack_a_rejects_seeds_that_are_not_32_bit_per_story():
    q, lay = random_quantized(0), layout(4)
    for bad in (np.arange(7), np.full(8, 1 << 32), -np.ones(8)):
        with pytest.raises(ValueError, match="seed"):
            pack_a(q, lay, bad)


def test_pack_act_writes_the_prompt_into_every_stories_lane_of_the_token_log():
    lay = layout(8)
    mem = pack_act(lay, [1, 404, 409])
    log = mem[:6].view("<i2").reshape(3, 8)
    assert (log == np.array([1, 404, 409])[:, None]).all() and not mem[6:].any()
    for bad in ([], list(range(10)), [VOCAB], [-1]):
        with pytest.raises(ValueError, match="prompt"):
            pack_act(lay, bad)
