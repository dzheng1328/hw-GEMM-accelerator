"""pytest for compiler/golden_vop.py: every VOP against model/fixedpoint.py on
random and edge inputs, with the memory layouts written out independently of
the helpers under test (one explicit loop per layout)."""

import numpy as np
import pytest

import isa
from fixedpoint import (quantize_multiplier, requant16, rmsnorm_q, rope_q, rope_table, sample_q, silu_mul_q,
                        silu_table, softmax_q)
from golden import Golden, GoldenError
from lm_spec import CTX, DIM, HEAD_DIM, HIDDEN, N_HEADS, N_KV_HEADS, ROPE_THETA, VOCAB

RA, RB, RC = 22, 23, 24


def vop_prog(sub, a=0, b=0, c=0, regs=None):
    regs = {RA: a, RB: b, RC: c, **(regs or {})}
    return [isa.alu(isa.ALU_ADD, r, 0, imm=v) for r, v in regs.items()] + [isa.vop(sub, RA, RB, RC), isa.end()]


def run_vop(sub, a=0, b=0, c=0, regs=None, setup=None):
    g = Golden(1, 1, vop_prog(sub, a, b, c, regs), [], [])
    if setup:
        setup(g)
    g.run()
    return g


def param(m, sh, eps=0):
    return m | (sh << 16) | (eps << 32)


# --- layouts, written out by hand ---

def put8(g, base, x):
    """x (8 stories, n): word base + f, byte s."""
    for f in range(x.shape[1]):
        g.act[(base + f) * 8 : (base + f) * 8 + 8] = np.asarray(x[:, f], dtype=np.int8).view(np.uint8)


def get8(g, base, n):
    return np.stack([g.act[(base + f) * 8 : (base + f) * 8 + 8].view(np.int8) for f in range(n)], axis=1).astype(np.int64)


def put16(g, base, x):
    """x (8, n): word base + 2f + h holds stories 4h..4h+3 as int16 lanes."""
    for f in range(x.shape[1]):
        for h in range(2):
            lane = np.asarray(x[4 * h : 4 * h + 4, f], dtype="<i2")
            g.act[(base + 2 * f + h) * 8 : (base + 2 * f + h) * 8 + 8] = lane.view(np.uint8)


def get16(g, base, n):
    out = np.zeros((8, n), np.int64)
    for f in range(n):
        for h in range(2):
            out[4 * h : 4 * h + 4, f] = g.act[(base + 2 * f + h) * 8 : (base + 2 * f + h) * 8 + 8].view("<i2")
    return out


def rand8(rng, n, lo=-128, hi=128):
    return rng.integers(lo, hi, (8, n))


# --- one test group per sub-op ---

def test_embed_looks_up_each_stories_token_at_step_t_and_requantizes_to_int16():
    rng = np.random.default_rng(0)
    emb = rng.integers(-128, 128, (VOCAB, DIM))
    toks = rng.integers(0, VOCAB, (5, 8))
    m, sh = quantize_multiplier(64.0)

    def setup(g):
        for t in range(VOCAB):
            g.wmem[100 + 8 * t : 108 + 8 * t] = emb[t].astype(np.int8).view("<u8")
        g.wmem[99] = param(m, sh)
        for step in range(5):
            g.act[isa.ACT_TOKLOG * 8 + 16 * step : isa.ACT_TOKLOG * 8 + 16 * step + 16] = toks[step].astype("<i2").view(np.uint8)

    g = run_vop(isa.EMBED, 100, 5000, 99, regs={isa.T: 3}, setup=setup)
    assert np.array_equal(get16(g, 5000, DIM), requant16(emb[toks[3]], m, sh))


def test_embed_faults_on_a_token_outside_the_vocabulary():
    def setup(g):
        g.act[0:2] = np.array([VOCAB], dtype="<i2").view(np.uint8)

    with pytest.raises(GoldenError, match="outside the vocabulary"):
        run_vop(isa.EMBED, 100, 5000, 99, setup=setup)


@pytest.mark.parametrize("name", ["random", "edges"])
def test_rmsnorm_matches_fixedpoint(name):
    rng = np.random.default_rng(1)
    x = rng.integers(-3000, 3000, (8, DIM))
    if name == "edges":
        x[0], x[1], x[2], x[3] = 32767, -32768, 0, 1
    m, sh = quantize_multiplier(32.0)

    def setup(g):
        put16(g, 3000, x)
        g.wmem[40] = param(m, sh, 18)

    g = run_vop(isa.RMSNORM, 3000, 4000, 40, setup=setup)
    assert np.array_equal(get8(g, 4000, DIM), rmsnorm_q(x, 18, m, sh))


def test_add_saturates_the_residual_at_both_int16_rails():
    rng = np.random.default_rng(2)
    r, y = rng.integers(-32768, 32768, (8, DIM)), rng.integers(-32768, 32768, (8, DIM))
    r[0, :4], y[0, :4] = (32767, -32768, 32767, -32768), (1, -1, 32767, -32768)

    def setup(g):
        put16(g, 3000, r)
        put16(g, 3200, y)

    g = run_vop(isa.VADD, 3000, 3200, setup=setup)
    want = np.clip(r + y, -32768, 32767)
    assert np.array_equal(get16(g, 3000, DIM), want) and list(want[0, :4]) == [32767, -32768, 32767, -32768]


def test_silu_mul_gates_through_the_layers_table():
    rng = np.random.default_rng(3)
    gate, up = rand8(rng, HIDDEN), rand8(rng, HIDDEN)
    tab = silu_table(0.05, 6.4 / 32767)
    m, sh = quantize_multiplier(1 / 256)

    def setup(g):
        put8(g, 3000, gate)
        put8(g, 3000 + HIDDEN, up)
        g.wmem[200] = param(m, sh)
        g.wmem[201:265] = tab.astype("<i2").view("<u8")

    g = run_vop(isa.SILU_MUL, 3000, 4000, 200, setup=setup)
    assert np.array_equal(get8(g, 4000, HIDDEN), silu_mul_q(gate, up, tab, m, sh)) and len(np.unique(get8(g, 4000, HIDDEN))) > 10


def test_transpose_flips_each_8x8_byte_block():
    rng = np.random.default_rng(4)
    blocks = rng.integers(0, 256, (3, 8, 8), dtype=np.uint8)

    def setup(g):
        g.act[3000 * 8 : 3000 * 8 + 192] = blocks.reshape(-1)

    g = run_vop(isa.TRANSPOSE, 3000, 4000, 3, setup=setup)
    got = g.act[4000 * 8 : 4000 * 8 + 192].reshape(3, 8, 8)
    for b in range(3):
        for s in range(8):
            for d in range(8):
                assert got[b, d, s] == blocks[b, s, d]


def test_an_operand_outside_a_memory_faults_with_the_vop_pc():
    with pytest.raises(GoldenError, match="outside the memory") as e:
        run_vop(isa.RMSNORM, isa.ACT_WORDS - 4, 0, 0)
    assert e.value.pc == len(vop_prog(isa.RMSNORM)) - 2


def test_a_vop_drains_outstanding_blocks_like_a_wait():
    """The BLOCK's write-back must be visible, and not pending, to the next VOP."""
    wmem = np.zeros(isa.WEIGHT_WORDS, np.uint64)
    wmem[0] = 0x0101010101010101
    act = np.zeros(isa.ACT_WORDS, np.uint64)
    act[0:8] = 0x0101010101010101
    regs = {isa.IN_BASE: 0, isa.OUT_BASE: 100, isa.W_BASE: 0, isa.CIN_LOG2: 3, isa.H_LOG2: 0, isa.W_LOG2: 3,
            isa.WOUT_LOG2: 3, isa.STRIDE: 1, isa.PAD: 0, isa.KSIZE: 1, isa.KS: 8, isa.BIAS: 8, isa.OSTRIDE: 1}
    prog = [isa.alu(isa.ALU_ADD, r, 0, imm=v) for r, v in regs.items()]
    prog += [isa.block(isa.Block(0, 0, 0, 0, 0, requant=True, sh=0, m=1)), isa.vop(isa.VADD, 0, 0, 0), isa.end()]
    g = Golden(1, 1, prog, wmem, act)
    g.run()
    assert not (g.pending >= 0).any()


def test_rope_rotates_q_into_the_nest_scratch_and_k_in_place():
    rng = np.random.default_rng(5)
    q, k = rand8(rng, DIM), rand8(rng, N_KV_HEADS * HEAD_DIM)
    cos, sin = rope_table(CTX, HEAD_DIM, ROPE_THETA)
    t = 37

    def setup(g):
        put8(g, 3000, q)
        put8(g, 3100, k)
        g.wmem[isa.A_ROPE + 2 * t] = np.ascontiguousarray(cos[t].astype("<i2")).view("<u8")[0]
        g.wmem[isa.A_ROPE + 2 * t + 1] = np.ascontiguousarray(sin[t].astype("<i2")).view("<u8")[0]

    g = run_vop(isa.ROPE, 3000, 3100, 900, regs={isa.T: t}, setup=setup)
    qr = rope_q(q.reshape(8, N_HEADS, HEAD_DIM), cos[t], sin[t])
    assert np.array_equal(get8(g, 3100, 32), rope_q(k.reshape(8, N_KV_HEADS, HEAD_DIM), cos[t], sin[t]).reshape(8, -1))
    for s in range(8):
        for kvh in range(4):
            for d in range(HEAD_DIM):
                word = g.wmem[900 + (s * 4 + kvh) * 8 + d : 901 + (s * 4 + kvh) * 8 + d].view(np.int8)
                assert list(word[:2]) == [qr[s, 2 * kvh, d], qr[s, 2 * kvh + 1, d]] and not word[2:].any()


def test_kvwrite_changes_only_position_t_and_leaves_its_neighbours():
    rng = np.random.default_rng(6)
    k, v = rand8(rng, 32), rand8(rng, 32)
    t, base = 13, 20000
    before = {}

    def setup(g):
        put8(g, 3000, k)
        put8(g, 3100, v)
        g.act[base * 8 : (base + 32 * 512) * 8] = rng.integers(1, 255, 32 * 512 * 8, dtype=np.uint8)
        before["act"] = g.act.copy()

    g = run_vop(isa.KVWRITE, 3000, 3100, base, regs={isa.T: t}, setup=setup)
    changed = np.flatnonzero(g.act != before["act"])
    expect = set()
    for s in range(8):
        for kvh in range(4):
            n = s * 4 + kvh
            for d in range(8):
                kt = (base + n * 512 + d * 32 + (t >> 3)) * 8 + (t & 7)
                assert g.act[kt] == np.uint8(k[s, kvh * 8 + d] & 0xFF)
                expect.add(kt)
                vb = (base + n * 512 + 256 + t) * 8 + d
                assert g.act[vb] == np.uint8(v[s, kvh * 8 + d] & 0xFF)
                expect.add(vb)
    assert set(changed) <= expect and len(changed) > 0.9 * len(expect)


@pytest.mark.parametrize("t", [0, 7, 8, 63, 200])
def test_softmax_normalizes_over_positions_0_to_t_and_zero_pads_to_the_next_8(t):
    rng = np.random.default_rng(7 + t)
    scores = rng.integers(-2000, 2000, (32, 2, CTX))
    m, sh = quantize_multiplier(0.02 * 1.4427 * 65536)
    n = (t + 8) & ~7

    def setup(g):
        for i in range(32):
            for row in range(2):
                for p in range(CTX):
                    g.act[(6000 + i * 128 + row * 64 + (p >> 2)) * 8 + 2 * (p & 3) : (6000 + i * 128 + row * 64 + (p >> 2)) * 8 + 2 * (p & 3) + 2] = \
                        np.array([scores[i, row, p]], dtype="<i2").view(np.uint8)
        g.wmem[30] = param(m, sh)
        g.wmem[1000 : 1000 + 32 * 256] = 0xA5A5A5A5A5A5A5A5

    g = run_vop(isa.SOFTMAX, 6000, 1000, 30, regs={isa.T: t}, setup=setup)
    want = softmax_q(scores[:, :, : t + 1], True, m, sh)
    for i in (0, 5, 31):
        words = g.wmem[1000 + i * 256 : 1000 + i * 256 + n].view(np.int8).reshape(n, 8)
        assert np.array_equal(words[: t + 1, :2].T, want[i]) and not words[:, 2:].any() and not words[t + 1 :].any()
        assert (g.wmem[1000 + i * 256 + n : 1000 + (i + 1) * 256] == 0xA5A5A5A5A5A5A5A5).all()


def logits_setup(logits, state, m, sh):
    def setup(g):
        put16(g, 7000, logits)
        g.wmem[50] = param(m, sh)
        g.wmem[60:64] = np.asarray(state, dtype="<u4").view("<u8")

    return setup


def toks(g, step):
    return g.act[16 * step : 16 * step + 16].view("<i2").astype(np.int64)


def test_sample_at_temperature_zero_takes_the_lowest_index_among_equal_logits():
    logits = np.zeros((8, VOCAB), np.int64)
    logits[1, 100] = logits[1, 7] = 5
    logits[2, 511] = 3
    state = np.arange(1, 9) * 7919
    g = run_vop(isa.SAMPLE, 7000, 50, 60, regs={isa.T: 4, isa.PLEN: 3}, setup=logits_setup(logits, state, 1, 0))
    assert list(toks(g, 5)) == [0, 7, 511, 0, 0, 0, 0, 0]
    assert np.array_equal(g.wmem[60:64].view("<u4"), state), "argmax must not advance the generators"


def test_sample_with_a_temperature_matches_fixedpoint_and_advances_every_state():
    rng = np.random.default_rng(8)
    logits = rng.integers(-3000, 3000, (8, VOCAB))
    state = rng.integers(1, 2**32, 8)
    m, sh = quantize_multiplier(0.01 * 1.4427 * 65536)
    g = run_vop(isa.SAMPLE, 7000, 50, 60, regs={isa.T: 9, isa.PLEN: 5, isa.INV_TEMP: 256},
                setup=logits_setup(logits, state, m, sh))
    want, new = sample_q(logits, 256, m, sh, state)
    assert np.array_equal(toks(g, 10), want) and np.array_equal(g.wmem[60:64].view("<u4"), new)


def test_sample_inside_the_prompt_copies_nothing_and_draws_nothing():
    state = np.arange(1, 9) * 104729

    def setup(g):
        logits_setup(np.ones((8, VOCAB), np.int64), state, 1, 0)(g)
        g.act[16 * 3 : 16 * 3 + 16] = (np.arange(8) + 100).astype("<i2").view(np.uint8)

    g = run_vop(isa.SAMPLE, 7000, 50, 60, regs={isa.T: 2, isa.PLEN: 4, isa.INV_TEMP: 256}, setup=setup)
    assert list(toks(g, 3)) == [100 + i for i in range(8)]
    assert np.array_equal(g.wmem[60:64].view("<u4"), state)


@pytest.mark.parametrize("sub", [isa.EMBED, isa.ROPE, isa.KVWRITE, isa.SOFTMAX, isa.SAMPLE])
def test_ops_that_index_by_position_fault_when_t_reaches_the_context(sub):
    with pytest.raises(GoldenError, match="is not below the context"):
        run_vop(sub, 100, 5000, 99, regs={isa.T: CTX})
