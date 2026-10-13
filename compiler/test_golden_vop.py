"""pytest for compiler/golden_vop.py: every VOP against model/fixedpoint.py on
random and edge inputs, with the memory layouts written out independently of
the helpers under test (one explicit loop per layout)."""

import numpy as np
import pytest

import isa
from fixedpoint import quantize_multiplier, requant16, rmsnorm_q, silu_mul_q, silu_table
from golden import Golden, GoldenError
from lm_spec import DIM, HIDDEN, VOCAB

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
