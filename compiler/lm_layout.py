"""Memory map and packing for the 4.3 story model (spec sections 2 and 4):
where every weight, table, scratch region, cache, and buffer lives in A memory
(the weight memory, 64K words) and activation memory, and the initial images.

A memory: the RoPE table at isa.A_ROPE, then the embedding and classifier
tables, the parameter words, every layer's weights and SiLU block, the seeds,
and the VPU's q and probability scratch. Activation memory: the token log at
isa.ACT_TOKLOG, the residual and feature buffers, the scores, and the
K^T / V caches (one 16384-word region per layer; nest 4 * story + KV head at
512 * nest holds K^T then V).

Weight matrices pack as pack_matrix: word group * K + k holds output channels
8 * group .. 8 * group + 7 (byte i = channel 8 * group + i) at input k. The
down projection (K = 192, not a power of two, which the DMA's channel counter
needs) packs as three 64-wide chunks, chunk-major."""

from dataclasses import dataclass

import numpy as np

import isa
from lm_spec import BATCH, CTX, DIM, GROUP, HEAD_DIM, HIDDEN, KV_DIM, N_KV_HEADS, N_LAYERS, VOCAB

CHUNK = 64  # the down projection's K chunk (a power of two the gather can address)
NESTS = BATCH * N_KV_HEADS
KT_WORDS = HEAD_DIM * CTX // BATCH  # a nest's K^T words (8 dims x 32 position blocks); V follows
KV_NEST_WORDS = 2 * KT_WORDS
Q_NEST_WORDS = HEAD_DIM  # a nest's rotated-q scratch: one word per dim
KV_LAYER_WORDS = NESTS * KV_NEST_WORDS
SCORE_NEST_WORDS = 2 * CTX // 4
PROB_NEST_WORDS = CTX
SILU_BLOCK_WORDS = 1 + 256 // 4

# (name, output channels, input channels) of the per-layer matrices.
MATS = (("wq", DIM, DIM), ("wk", KV_DIM, DIM), ("wv", KV_DIM, DIM), ("wo", DIM, DIM),
        ("w1", HIDDEN, DIM), ("w3", HIDDEN, DIM), ("w2", DIM, HIDDEN))


@dataclass(frozen=True)
class LayerAddrs:
    mats: dict  # matrix name -> A word (w2: the first of its three chunks, 8 * 64 words apart)
    norm1: int  # parameter words
    norm2: int
    exp: int
    silu: int  # parameter word, then the 64-word table
    kv: int  # activation word of the layer's cache region


@dataclass(frozen=True)
class LmLayout:
    n_steps: int
    # A memory words
    rope: int
    emb_param: int
    emb: int
    cls: int
    normf: int
    logit_exp: int
    seeds: int
    qs: int
    prob: int
    layers: tuple
    a_words: int
    # activation words
    toklog: int
    res: int
    h: int
    qf: int
    kf: int
    vf: int
    sc: int
    avout: int
    att: int
    obuf: int
    gu: int
    hh: int
    logits: int
    act_words: int


class _Bump:
    def __init__(self, start=0):
        self.n = start

    def take(self, words):
        at, self.n = self.n, self.n + words
        return at


def layout(n_steps):
    if not 1 <= n_steps <= CTX:
        raise ValueError(f"n_steps={n_steps} must be 1..{CTX}")
    a = _Bump()
    rope = a.take(2 * CTX)
    assert rope == isa.A_ROPE
    emb_param, emb, cls = a.take(1), a.take(VOCAB * DIM // 8), a.take(VOCAB * DIM // 8)
    normf, logit_exp, seeds = a.take(1), a.take(1), a.take(BATCH // 2)
    qs, prob = a.take(NESTS * HEAD_DIM), a.take(NESTS * PROB_NEST_WORDS)
    act = _Bump()
    toklog = act.take(2 * (n_steps + 1))
    assert toklog == isa.ACT_TOKLOG
    res, h, qf, kf, vf = act.take(2 * DIM), act.take(DIM), act.take(DIM), act.take(KV_DIM), act.take(KV_DIM)
    sc, avout, att = act.take(NESTS * SCORE_NEST_WORDS), act.take(DIM), act.take(DIM)
    obuf, gu, hh, logits = act.take(2 * DIM), act.take(2 * HIDDEN), act.take(HIDDEN), act.take(2 * VOCAB)
    layers = []
    for _ in range(N_LAYERS):
        mats = {name: a.take(n * k // 8) for name, n, k in MATS}
        layers.append(LayerAddrs(mats, a.take(1), a.take(1), a.take(1), a.take(SILU_BLOCK_WORDS),
                                 act.take(KV_LAYER_WORDS)))
    if a.n > isa.WEIGHT_WORDS:
        raise ValueError(f"A memory needs {a.n} words; it holds {isa.WEIGHT_WORDS}")
    if act.n > isa.ACT_WORDS:
        raise ValueError(f"activation memory needs {act.n} words; it holds {isa.ACT_WORDS}")
    return LmLayout(n_steps, rope, emb_param, emb, cls, normf, logit_exp, seeds, qs, prob, tuple(layers), a.n,
                    toklog, res, h, qf, kf, vf, sc, avout, att, obuf, gu, hh, logits, act.n)


def pack_matrix(w):
    """(N, K) int8 -> N / 8 * K '<u8' words, word group * K + k."""
    w = np.asarray(w)
    n, k = w.shape
    if n % GROUP or w.min() < -128 or w.max() > 127:
        raise ValueError(f"matrix {w.shape} must have a multiple of 8 rows and int8 values")
    lanes = w.astype(np.int8).reshape(n // GROUP, GROUP, k).transpose(0, 2, 1)
    return np.ascontiguousarray(lanes).view("<u8").reshape(-1)


def pack_down(w):
    """The (DIM, HIDDEN) down projection as three 64-wide chunks, chunk-major."""
    return np.concatenate([pack_matrix(np.asarray(w)[:, c : c + CHUNK]) for c in range(0, HIDDEN, CHUNK)])


def param_word(m, sh, eps=0):
    if not (0 <= m < 1 << 16 and 0 <= sh < 1 << 6 and 0 <= eps < 1 << 32):
        raise ValueError(f"parameter (m={m}, sh={sh}, eps={eps}) does not fit a parameter word")
    return np.uint64(m | (sh << 16) | (eps << 32))


def _scalar(q, name):
    return int(q[f"{name}_m"]), int(q[f"{name}_sh"])


def pack_a(q, lay, seeds):
    """The initial A memory image ('<u8' words, lay.a_words)."""
    mem = np.zeros(lay.a_words, dtype="<u8")
    eps = int(q["eps_q"])
    cos, sin = np.asarray(q["rope_cos"]), np.asarray(q["rope_sin"])
    mem[lay.rope : lay.rope + 2 * CTX] = np.stack([cos, sin], axis=1).astype("<i2").view("<u8").reshape(-1)
    mem[lay.emb_param] = param_word(*_scalar(q, "emb"))
    mem[lay.emb : lay.emb + VOCAB * DIM // 8] = np.asarray(q["emb"]).astype(np.int8).view("<u8").reshape(-1)
    mem[lay.cls : lay.cls + VOCAB * DIM // 8] = pack_matrix(q["cls"])
    mem[lay.normf] = param_word(*_scalar(q, "normf"), eps)
    mem[lay.logit_exp] = param_word(*_scalar(q, "logit_exp"))
    seeds = np.asarray(seeds, dtype=np.int64)
    if seeds.shape != (BATCH,) or seeds.min() < 0 or seeds.max() >= 1 << 32:
        raise ValueError("need one 32-bit seed per story")
    mem[lay.seeds : lay.seeds + BATCH // 2] = seeds.astype("<u4").view("<u8")
    for l, addr in enumerate(lay.layers):
        for name, n, k in MATS:
            words = pack_down(q[f"l{l}_{name}"]) if name == "w2" else pack_matrix(q[f"l{l}_{name}"])
            mem[addr.mats[name] : addr.mats[name] + len(words)] = words
        mem[addr.norm1] = param_word(*_scalar(q, f"l{l}_norm1"), eps)
        mem[addr.norm2] = param_word(*_scalar(q, f"l{l}_norm2"), eps)
        mem[addr.exp] = param_word(*_scalar(q, f"l{l}_exp"))
        mem[addr.silu] = param_word(*_scalar(q, f"l{l}_silu"))
        mem[addr.silu + 1 : addr.silu + SILU_BLOCK_WORDS] = np.asarray(q[f"l{l}_silu_table"]).astype("<i2").view("<u8")
    return mem


def pack_act(lay, prompt_ids):
    """The initial activation memory image: the prompt in the token log, every
    story reading the same prompt; everything else zero."""
    prompt = np.asarray(prompt_ids, dtype=np.int64)
    if not 1 <= len(prompt) <= lay.n_steps + 1 or prompt.min() < 0 or prompt.max() >= VOCAB:
        raise ValueError(f"prompt of {len(prompt)} tokens does not fit {lay.n_steps} steps and a {VOCAB}-token vocabulary")
    mem = np.zeros(lay.act_words, dtype="<u8")
    lanes = np.repeat(prompt.astype("<i2"), BATCH).reshape(-1, 4)
    mem[lay.toklog : lay.toklog + 2 * len(prompt)] = lanes.view("<u8").reshape(-1)
    return mem
