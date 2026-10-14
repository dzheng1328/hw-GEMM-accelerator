"""The vector commands' semantics at command level (spec section 3), for
golden.py: each VOP reads and writes whole tensors of the 8 stories in lockstep
through the memory images, calling model/fixedpoint.py for the arithmetic, so
rtl/vpu*.v (4.3e) has one definition to be bit-exact to.

Layouts (spec section 2), with f a feature, s a story, and a "feature word
array" meaning one word per feature:
  int8 feature words    word f, byte s
  int16 feature words   words 2f and 2f + 1; lanes 0-3 (stories 0-3), then 4-7
  K^T cache             word (d, position block j >> 3), byte j & 7
  V cache               word per position, byte d
  q scratch (A memory)  word per dim d, byte i = query head 2h + i (bytes 2-7 zero)
  probabilities         word per position, byte i = query head 2h + i
  scores (RESULT16)     per (story, KV head): 2 rows of 256 int16 positions
Operand registers hold word addresses (activation words, or A-memory words where
noted); a parameter word at an A-memory address is m | sh << 16 | eps_q << 32.
Each sub-op's operands are in its method's docstring."""

import numpy as np

import golden
import isa
from fixedpoint import requant16, rmsnorm_q, rope_q, sample_q, silu_mul_q, softmax_q
from lm_layout import KT_WORDS, KV_NEST_WORDS, NESTS, POS_PER_WORD, PROB_NEST_WORDS, Q_NEST_WORDS, SCORE_NEST_WORDS
from lm_spec import BATCH, CTX, DIM, HEAD_DIM, HIDDEN, N_HEADS, N_KV_HEADS, VOCAB


def pos_blocks(t):
    """Positions covered by a decode step at position t: t + 1 rounded up to 8."""
    return (t + 8) & ~7


def execute(g, pc, v):
    """Run VOP v (an isa.Vop) on Golden g at program counter pc."""
    name = isa.VOP_NAMES.get(v.sub)
    if name is None:
        raise golden.GoldenError(pc, f"invalid VOP sub-op {v.sub}")
    getattr(Vpu(g, pc), name.lower())(*(g.regs[r] for r in (v.ra, v.rb, v.rc)))


class Vpu:
    def __init__(self, g, pc):
        self.g, self.pc = g, pc
        self.T = g.regs[isa.T]

    def fail(self, msg):
        raise golden.GoldenError(self.pc, msg)

    def _words(self, mem, start, n, what):
        if start < 0 or start + n > len(mem):
            self.fail(f"{what}: words {start}..{start + n - 1} are outside the memory")
        return mem[start : start + n]

    # --- word-array helpers: x is (8 stories, n features) ---

    def get8(self, base, n, what="activation"):
        w = self._words(self.g.actw, base, n, what)
        return w.view(np.int8).reshape(n, 8).astype(np.int64).T

    def put8(self, base, x, what="activation"):
        x = np.asarray(x)
        w = self._words(self.g.actw, base, x.shape[1], what)
        w[:] = np.ascontiguousarray(x.T.astype(np.int8)).view("<u8").reshape(-1)

    def get16(self, base, n, what="activation"):
        w = self._words(self.g.actw, base, 2 * n, what)
        return w.view("<i2").reshape(n, 8).astype(np.int64).T

    def put16(self, base, x, what="activation"):
        x = np.asarray(x)
        w = self._words(self.g.actw, base, 2 * x.shape[1], what)
        w[:] = np.ascontiguousarray(x.T.astype("<i2")).reshape(-1, 4).view("<u8").reshape(-1)

    def param(self, ptr):
        p = int(self._words(self.g.wmem, ptr, 1, "parameter word")[0])
        return p & 0xFFFF, (p >> 16) & 0x3F, p >> 32

    def check_t(self):
        if self.T >= CTX:
            self.fail(f"T={self.T} is not below the context {CTX}")

    def token_words(self, step):
        return isa.ACT_TOKLOG + 2 * step

    # --- sub-ops ---

    def embed(self, emb, res, param):
        """ra = embedding table (A word; row t is 8 words), rb = residual
        (int16 feature words, 64), rc = parameter word (m, sh). Each story's
        token comes from the token log at step T."""
        self.check_t()
        toks = self._words(self.g.actw, self.token_words(self.T), 2, "token log").view("<i2").astype(np.int64)
        if toks.min() < 0 or toks.max() >= VOCAB:
            self.fail(f"token {int(toks.max())} outside the vocabulary")
        m, sh, _ = self.param(param)
        rows = np.stack([self._words(self.g.wmem, emb + 8 * int(t), 8, "embedding table").view(np.int8) for t in toks])
        self.put16(res, requant16(rows.astype(np.int64), m, sh))

    def rmsnorm(self, src, dst, param):
        """ra = residual (int16 feature words, 64), rb = destination (int8
        feature words), rc = parameter word (m, sh, eps_q)."""
        m, sh, eps = self.param(param)
        try:
            y = rmsnorm_q(self.get16(src, DIM).copy(), eps, m, sh)
        except ValueError as e:  # a zero rsqrt input, or a shift beyond 63
            self.fail(str(e))
        self.put8(dst, y)

    def rope(self, qf, kf, qs):
        """ra = q (int8 feature words, 64), rb = k (int8 feature words, 32,
        rotated in place), rc = rotated-q destination (A word, 256: the q
        scratch of the 32 nests). cos and sin of position T come from the
        RoPE table at isa.A_ROPE (word 2t cos, 2t + 1 sin; 4 int16 lanes)."""
        self.check_t()
        tab = self._words(self.g.wmem, isa.A_ROPE + 2 * self.T, 2, "RoPE table").view("<i2").astype(np.int64)
        cos, sin = tab[:4], tab[4:]
        q = rope_q(self.get8(qf, DIM).reshape(BATCH, N_HEADS, HEAD_DIM), cos, sin)
        k = rope_q(self.get8(kf, N_KV_HEADS * HEAD_DIM).reshape(BATCH, N_KV_HEADS, HEAD_DIM), cos, sin)
        self.put8(kf, k.reshape(BATCH, -1))
        scratch = np.zeros((BATCH, N_KV_HEADS, HEAD_DIM, 8), np.int8)  # (story, kvh, d, byte)
        scratch[..., :2] = q.reshape(BATCH, N_KV_HEADS, 2, HEAD_DIM).transpose(0, 1, 3, 2)
        self._words(self.g.wmem, qs, NESTS * Q_NEST_WORDS, "q scratch")[:] = scratch.reshape(-1).view("<u8")

    def kvwrite(self, kf, vf, kv):
        """ra = rotated k, rb = v (int8 feature words, 32 each), rc = this
        layer's cache base (activation word): nest n = 4 * story + kvh holds
        K^T (256 words) then V (256 words) at kv + 512 * n. Writes position T."""
        self.check_t()
        k = self.get8(kf, N_KV_HEADS * HEAD_DIM).reshape(BATCH, N_KV_HEADS, HEAD_DIM)
        v = self.get8(vf, N_KV_HEADS * HEAD_DIM).reshape(BATCH, N_KV_HEADS, HEAD_DIM)
        nest = (np.arange(BATCH)[:, None] * N_KV_HEADS + np.arange(N_KV_HEADS)[None, :])[:, :, None]
        d = np.arange(HEAD_DIM)[None, None, :]
        base = kv + KV_NEST_WORDS * nest
        kt = (base + (CTX // POS_PER_WORD) * d + (self.T >> 3)) * 8 + (self.T & 7)
        vv = (base + KT_WORDS + self.T) * 8 + d
        if max(kt.max(), vv.max()) >= len(self.g.act) or kv < 0:
            self.fail("KV cache address past activation memory")
        self.g.act[kt] = k.astype(np.uint8)
        self.g.act[vv] = v.astype(np.uint8)

    def softmax(self, sc, prob, param):
        """ra = scores (activation words; nest n at 128 n: row i at +64 i,
        position p at lane p & 3 of word p >> 2), rb = probabilities (A word;
        nest n at 256 n), rc = parameter word (exp m, sh). Positions 0..T
        attend; word p of each nest holds the two heads' probabilities, zero
        past T up to the next multiple of 8 (the AV BLOCK's K slots)."""
        self.check_t()
        m, sh, _ = self.param(param)
        n = pos_blocks(self.T)
        s = self._words(self.g.actw, sc, NESTS * SCORE_NEST_WORDS, "scores").view("<i2").astype(np.int64)
        s = s.reshape(NESTS, 2, CTX)[:, :, :n]
        p = softmax_q(s, (np.arange(n) <= self.T)[None, None, :], m, sh)
        words = np.zeros((NESTS, n, 8), np.uint8)
        words[..., :2] = p.transpose(0, 2, 1)
        for i in range(NESTS):
            self._words(self.g.wmem, prob + PROB_NEST_WORDS * i, n, "probability scratch")[:] = words[i].view("<u8").reshape(n)

    def silu_mul(self, gate, dst, table):
        """ra = gate (int8 feature words, 192; up follows at ra + 192), rb =
        destination, rc = SiLU block (A word): a parameter word (m, sh) then
        the 256-entry int16 table in 64 words, entry g + 128 for gate value g."""
        m, sh, _ = self.param(table)
        tab = self._words(self.g.wmem, table + 1, 64, "SiLU table").view("<i2").astype(np.int64)
        self.put8(dst, silu_mul_q(self.get8(gate, HIDDEN), self.get8(gate + HIDDEN, HIDDEN), tab, m, sh))

    def add(self, res, buf, _unused):
        """ra = residual (int16 feature words, 64, updated in place), rb = a
        RESULT16 buffer of the same shape: res = saturate(res + buf)."""
        self.put16(res, np.clip(self.get16(res, DIM) + self.get16(buf, DIM), -32768, 32767))

    def transpose(self, src, dst, count):
        """ra = source, rb = destination (activation words), rc = a block
        count: each 8-word block is an 8 x 8 byte matrix, transposed."""
        blocks = self._words(self.g.actw, src, 8 * count, "transpose source").view(np.uint8)
        t = np.ascontiguousarray(blocks.reshape(count, 8, 8).transpose(0, 2, 1))
        self._words(self.g.actw, dst, 8 * count, "transpose destination")[:] = t.view("<u8").reshape(-1)

    def sample(self, logits, param, seeds):
        """ra = logits (int16 feature words, 512), rb = parameter word (the
        logit exp m, sh), rc = seeds (A word: 4 words, story s's xorshift32
        state in 32-bit lane s). Writes the token log at step T + 1: the
        prompt token already there while T + 1 < PLEN, else a sample."""
        self.check_t()
        if self.T + 1 < self.g.regs[isa.PLEN]:
            return
        inv = self.g.regs[isa.INV_TEMP]
        if inv >= 1 << 16:
            self.fail(f"INV_TEMP {inv} does not fit Q8.8 in 16 bits")
        m, sh, _ = self.param(param)
        state = self._words(self.g.wmem, seeds, 4, "seeds")
        tok, new = sample_q(self.get16(logits, VOCAB), inv, m, sh, state.view("<u4").astype(np.int64))
        self._words(self.g.actw, self.token_words(self.T + 1), 2, "token log")[:] = \
            np.asarray(tok, dtype="<i2").reshape(2, 4).view("<u8").reshape(2)
        if inv:
            state[:] = np.asarray(new, dtype="<u4").view("<u8")
