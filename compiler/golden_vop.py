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
from fixedpoint import requant16, rmsnorm_q, silu_mul_q
from lm_spec import CTX, DIM, HIDDEN, VOCAB


def execute(g, pc, v):
    """Run VOP v (an isa.Vop) on Golden g at program counter pc."""
    name = isa.VOP_NAMES.get(v.sub)
    if name is None:
        raise golden.GoldenError(pc, f"invalid VOP sub-op {v.sub}")
    method = getattr(Vpu(g, pc), name.lower(), None)
    if method is None:
        raise golden.GoldenError(pc, f"VOP {name} is not implemented")
    method(*(g.regs[r] for r in (v.ra, v.rb, v.rc)))


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
        self.put8(dst, rmsnorm_q(self.get16(src, DIM).copy(), eps, m, sh))

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
