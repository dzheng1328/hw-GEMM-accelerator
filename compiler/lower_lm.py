"""Lower the quantized story model to the command processor's terms (spec
section 4): the per-step program of BLOCKs, ALUs, loops, and VOPs, and the
A-memory and activation images it runs on (memory map and packing in
lm_layout.py, command semantics in golden.py and golden_vop.py).

One decode step of 8 stories (a LOOP over steps; layers are unrolled because
each BLOCK carries its own (m, sh)):

    ALU: nblk, KS, rounds from T                 (once per step)
    VOP EMBED
    per layer:
      VOP RMSNORM; q, k, v matmuls; VOP ROPE; VOP KVWRITE
      QK^T:  per story (unrolled, tile s mod W*H): LOOP 4 KV heads { LOOPR nblk { BLOCK } }
      VOP SOFTMAX
      AV:    per story, LOOP 4 { ROUND = 0; LOOPR rounds { BLOCK; ROUND += 1 } }
      VOP TRANSPOSE; o matmul (RESULT16); VOP ADD
      VOP RMSNORM; gate and up matmuls; VOP SILU_MUL
      down matmul (3 K=64 chunks, RESULT16); VOP ADD
    VOP RMSNORM; classifier matmul (RESULT16); VOP SAMPLE; ALU T += 1

A VOP drains outstanding BLOCKs like WAIT, so no WAIT is emitted."""

from dataclasses import dataclass

import numpy as np

import isa
from golden import Golden
from isa import ALU_ADD, ALU_AND, ALU_SHR, Block
from lm_layout import CHUNK, KV_NEST_WORDS, KT_WORDS, NESTS, PROB_NEST_WORDS, SCORE_NEST_WORDS, layout, pack_a, pack_act
from lm_spec import BATCH, CTX, DIM, HEAD_DIM, HIDDEN, N_KV_HEADS, N_LAYERS, VOCAB

# Registers the compiler uses beyond the hardware-defined ones.
R_A, R_B, R_C = 22, 23, 24  # VOP operands
R_NBLK, R_KS, R_RND = 25, 26, 27  # per step: QK^T blocks, AV K slots, AV rounds
R_IN, R_OUT, R_TMP = 28, 29, 30  # QK^T nest bases, scratch


class _Prog:
    """Straight-line emission with a cache of register values the program has
    set, so a register is rewritten only when it changes. Loop bodies run many
    times, so the cache is dropped at every loop boundary."""

    def __init__(self):
        self.words, self.known = [], {}

    def emit(self, word):
        self.words.append(word)

    def set(self, reg, value):
        if self.known.get(reg) != value:
            self.emit(isa.alu(ALU_ADD, reg, 0, imm=value))
            self.known[reg] = value

    def alu(self, op, dst, src, imm=None, src2=None):
        self.emit(isa.alu(op, dst, src, src2=src2, imm=imm))
        self.known.pop(dst, None)

    def bump(self, reg, imm):
        self.alu(ALU_ADD, reg, reg, imm=imm)

    def loop(self, count):
        self.emit(isa.loop(count))
        self.known.clear()

    def loopr(self, reg):
        self.emit(isa.loopr(reg))
        self.known.clear()

    def endloop(self):
        self.emit(isa.endloop())
        self.known.clear()

    def vop(self, sub, a=0, b=0, c=0):
        self.set(R_A, a)
        self.set(R_B, b)
        self.set(R_C, c)
        self.emit(isa.vop(sub, R_A, R_B, R_C))


def _matmul_regs(p, cin, ks, ostride):
    p.set(isa.CIN_LOG2, isa.log2(cin))
    p.set(isa.H_LOG2, 0)
    p.set(isa.W_LOG2, 3)
    p.set(isa.WOUT_LOG2, 3)
    p.set(isa.STRIDE, 1)
    p.set(isa.PAD, 0)
    p.set(isa.KSIZE, 1)
    p.set(isa.KS, ks)
    p.set(isa.BIAS, ks)  # no bias slots: the first slot past the taps is past the end
    p.set(isa.OSTRIDE, ostride)


def _wave(tiles, groups):
    """The (tile, group) pairs of each wave of W * H output blocks."""
    for start in range(0, groups, len(tiles)):
        yield list(zip(tiles, range(start, min(start + len(tiles), groups))))


def _matmul(p, tiles, q, name, in_word, out_word, w_word, groups, out16):
    """One 1x1-conv matmul of 8 stories: Cin = 64 features in, `groups` * 8 out.
    RESULT8 uses the immediate BLOCK form; RESULT16 the register form."""
    _matmul_regs(p, DIM, DIM, 2 if out16 else 1)
    p.set(isa.IN_BASE, in_word * 8)
    p.set(isa.OUT_BASE, out_word)
    p.set(isa.W_BASE, w_word)
    if out16:
        p.set(isa.ROUND, 0)
        p.set(isa.ROWS, 7)
        p.set(isa.RMODE, isa.RMODE_Q16)
    ms, shs = q[f"{name}_m"], q[f"{name}_sh"]
    for wave in _wave(tiles, groups):
        for (x, y), g in wave:
            m, sh = int(ms[g]), int(shs[g])
            p.emit(isa.block(Block(x, y, g, 0, 0, sh=sh, m=m, reg_form=True) if out16
                             else Block(x, y, g, 0, 0, requant=True, sh=sh, m=m)))


def _down(p, tiles, q, name, lay, addr):
    """The down projection: K = 192 is not a power of two, so each output block
    is three K = 64 BLOCKs on one tile (the partial sum held between them),
    the last returning RESULT16 into the residual buffer."""
    _matmul_regs(p, DIM, DIM, 2)
    p.set(isa.OUT_BASE, lay.obuf)
    p.set(isa.ROUND, 0)
    p.set(isa.ROWS, 7)
    p.set(isa.RMODE, isa.RMODE_Q16)
    ms, shs = q[f"{name}_m"], q[f"{name}_sh"]
    for wave in _wave(tiles, DIM // 8):
        for c in range(HIDDEN // CHUNK):
            p.set(isa.IN_BASE, (lay.hh + CHUNK * c) * 8)
            p.set(isa.W_BASE, addr.mats["w2"] + c * (DIM // 8) * CHUNK)
            for (x, y), g in wave:
                m, sh = int(ms[g]), int(shs[g])
                if c < 2:
                    p.emit(isa.block(Block(x, y, g, 0, 0, acc_keep=c > 0, no_ret=True)))
                else:
                    p.emit(isa.block(Block(x, y, g, 0, 0, acc_keep=True, sh=sh, m=m, reg_form=True)))


def _attention(p, tiles, q, l, lay, addr):
    p.vop(isa.ROPE, lay.qf, lay.kf, lay.qs)
    p.vop(isa.KVWRITE, lay.kf, lay.vf, addr.kv)
    sm, ssh = int(q[f"l{l}_score_m"]), int(q[f"l{l}_score_sh"])
    am, ash = int(q[f"l{l}_att_m"]), int(q[f"l{l}_att_sh"])

    # QK^T: nest n = 4 * story + KV head; its 8 query-head-pair words, its K^T
    # words, and its 2 x 256 int16 scores sit at n * (8, 512, 128) words.
    for reg, v in {isa.CIN_LOG2: 3, isa.H_LOG2: 0, isa.W_LOG2: 8, isa.WOUT_LOG2: 8, isa.STRIDE: 1, isa.PAD: 0,
                   isa.KSIZE: 1, isa.KS: HEAD_DIM, isa.BIAS: HEAD_DIM, isa.OSTRIDE: CTX // 4,
                   isa.ROUND: 0, isa.ROWS: 1, isa.RMODE: isa.RMODE_Q16, R_IN: addr.kv * 8, R_OUT: lay.sc,
                   isa.W_BASE: lay.qs}.items():
        p.set(reg, v)
    for s in range(BATCH):
        x, y = tiles[s % len(tiles)]
        p.loop(N_KV_HEADS)
        p.alu(ALU_ADD, isa.IN_BASE, R_IN, imm=0)
        p.alu(ALU_ADD, isa.OUT_BASE, R_OUT, imm=0)
        p.loopr(R_NBLK)
        p.emit(isa.block(Block(x, y, 0, 0, 0, sh=ssh, m=sm, reg_form=True)))
        p.bump(isa.IN_BASE, 8)
        p.bump(isa.OUT_BASE, 2)
        p.endloop()
        p.bump(R_IN, KV_NEST_WORDS * 8)
        p.bump(R_OUT, SCORE_NEST_WORDS)
        p.bump(isa.W_BASE, HEAD_DIM)
        p.endloop()
    p.vop(isa.SOFTMAX, lay.sc, lay.prob, addr.exp)

    # AV: K slots = 8 * ceil((T + 1) / 8) in rounds of 64; the probabilities
    # word of position j is the A word of slot j, the V word the B row.
    for reg, v in {isa.CIN_LOG2: 8, isa.H_LOG2: 0, isa.W_LOG2: 3, isa.WOUT_LOG2: 3, isa.STRIDE: 1, isa.PAD: 0,
                   isa.KSIZE: 1, isa.BIAS: CTX, isa.OSTRIDE: DIM // 8, isa.ROWS: 1, isa.RMODE: isa.RMODE_Q8,
                   isa.IN_BASE: (addr.kv + KT_WORDS) * 8, isa.W_BASE: lay.prob}.items():
        p.set(reg, v)
    p.alu(ALU_ADD, isa.KS, R_KS, imm=0)
    for s in range(BATCH):
        x, y = tiles[s % len(tiles)]
        p.set(isa.OUT_BASE, lay.avout + s)
        p.loop(N_KV_HEADS)
        p.alu(ALU_ADD, isa.ROUND, 0, imm=0)
        p.loopr(R_RND)
        p.emit(isa.block(Block(x, y, 0, 0, 0, sh=ash, m=am, reg_form=True)))
        p.bump(isa.ROUND, 1)
        p.endloop()
        p.bump(isa.IN_BASE, KV_NEST_WORDS * 8)
        p.bump(isa.W_BASE, PROB_NEST_WORDS)
        p.bump(isa.OUT_BASE, 2 * (DIM // 8))
        p.endloop()
    p.vop(isa.TRANSPOSE, lay.avout, lay.att, DIM // 8)


def lower_program(q, lay, mesh_w, mesh_h, n_steps, prompt_len, inv_temp):
    if not (1 <= mesh_w <= isa.MAX_MESH and 1 <= mesh_h <= isa.MAX_MESH):
        raise ValueError(f"mesh {mesh_w}x{mesh_h} outside 1x1..{isa.MAX_MESH}x{isa.MAX_MESH}")
    if not 0 <= inv_temp < 1 << 16:
        raise ValueError("inv_temp is Q8.8: 0..65535")
    tiles = [(t % mesh_w, t // mesh_w) for t in range(mesh_w * mesh_h)]
    p = _Prog()
    p.set(isa.PLEN, prompt_len)
    p.set(isa.INV_TEMP, inv_temp)
    p.loop(n_steps)
    p.alu(ALU_SHR, R_TMP, isa.T, imm=3)
    p.alu(ALU_ADD, R_NBLK, R_TMP, imm=1)
    p.alu(ALU_ADD, R_TMP, isa.T, imm=8)
    p.alu(ALU_AND, R_KS, R_TMP, imm=0xFFFF_FFF8)
    p.alu(ALU_ADD, R_TMP, R_KS, imm=isa.SLOTS_PER_ROUND - 1)
    p.alu(ALU_SHR, R_RND, R_TMP, imm=6)
    p.vop(isa.EMBED, lay.emb, lay.res, lay.emb_param)
    for l, addr in enumerate(lay.layers):
        L = f"l{l}_"
        p.vop(isa.RMSNORM, lay.res, lay.h, addr.norm1)
        _matmul(p, tiles, q, L + "wq", lay.h, lay.qf, addr.mats["wq"], DIM // 8, False)
        _matmul(p, tiles, q, L + "wk", lay.h, lay.kf, addr.mats["wk"], HEAD_DIM * N_KV_HEADS // 8, False)
        _matmul(p, tiles, q, L + "wv", lay.h, lay.vf, addr.mats["wv"], HEAD_DIM * N_KV_HEADS // 8, False)
        _attention(p, tiles, q, l, lay, addr)
        _matmul(p, tiles, q, L + "wo", lay.att, lay.obuf, addr.mats["wo"], DIM // 8, True)
        p.vop(isa.VADD, lay.res, lay.obuf)
        p.vop(isa.RMSNORM, lay.res, lay.h, addr.norm2)
        _matmul(p, tiles, q, L + "w1", lay.h, lay.gu, addr.mats["w1"], HIDDEN // 8, False)
        _matmul(p, tiles, q, L + "w3", lay.h, lay.gu + HIDDEN, addr.mats["w3"], HIDDEN // 8, False)
        p.vop(isa.SILU_MUL, lay.gu, lay.hh, addr.silu)
        _down(p, tiles, q, L + "w2", lay, addr)
        p.vop(isa.VADD, lay.res, lay.obuf)
    p.vop(isa.RMSNORM, lay.res, lay.h, lay.normf)
    _matmul(p, tiles, q, "cls", lay.h, lay.logits, lay.cls, VOCAB // 8, True)
    p.vop(isa.SAMPLE, lay.logits, lay.logit_exp, lay.seeds)
    p.bump(isa.T, 1)
    p.endloop()
    p.emit(isa.end())
    if len(p.words) > isa.PROGRAM_WORDS:
        raise ValueError(f"program needs {len(p.words)} words; program memory holds {isa.PROGRAM_WORDS}")
    return p.words


@dataclass(frozen=True)
class LmBuild:
    layout: object
    program: list
    a_mem: np.ndarray  # '<u8' words
    act: np.ndarray
    mesh: tuple
    n_steps: int


def lm_build(q, mesh_w, mesh_h, n_steps, inv_temp, prompt_ids, seeds):
    """Compile the model q (a lm_quantized.npz layout) for a mesh: decode
    n_steps positions of 8 stories from the prompt, at inverse temperature
    inv_temp (Q8.8; 0 = argmax), generators seeded by `seeds`."""
    lay = layout(n_steps)
    program = lower_program(q, lay, mesh_w, mesh_h, n_steps, len(prompt_ids), inv_temp)
    return LmBuild(lay, program, pack_a(q, lay, seeds), pack_act(lay, prompt_ids), (mesh_w, mesh_h), n_steps)


def run_lm_golden(b, max_commands=50_000_000):
    """The golden executor after running b: (golden, token log (n_steps + 1, 8),
    K and V caches shaped like model/lm_reference.new_cache)."""
    g = Golden(*b.mesh, b.program, b.a_mem, b.act)
    g.run(max_commands)
    return g, read_tokens(b, g), read_cache(b, g)


def read_tokens(b, g):
    lay = b.layout
    words = g.actw[lay.toklog : lay.toklog + 2 * (b.n_steps + 1)]
    return words.view("<i2").reshape(b.n_steps + 1, BATCH).astype(np.int64)


def read_cache(b, g):
    """{"k", "v"}: (N_LAYERS, 8 stories, CTX, KV heads, head_dim) int64, from the
    K^T bytes (word (d, j >> 3), byte j & 7) and V words (word j, byte d)."""
    k = np.zeros((N_LAYERS, BATCH, CTX, N_KV_HEADS, HEAD_DIM), np.int64)
    v = np.zeros_like(k)
    for l, addr in enumerate(b.layout.layers):
        reg = g.act[addr.kv * 8 : (addr.kv + NESTS * KV_NEST_WORDS) * 8].view(np.int8).reshape(
            BATCH, N_KV_HEADS, 2, HEAD_DIM, CTX // 8, 8)  # (story, kvh, K^T | V, ...)
        kt = reg[:, :, 0].reshape(BATCH, N_KV_HEADS, HEAD_DIM, CTX)  # [d, j] with j = 8 * (j >> 3) + (j & 7)
        vv = g.act[addr.kv * 8 : (addr.kv + NESTS * KV_NEST_WORDS) * 8].view(np.int8).reshape(
            BATCH, N_KV_HEADS, 2, CTX, HEAD_DIM)[:, :, 1]  # (story, kvh, position, d)
        k[l] = kt.transpose(0, 3, 1, 2)
        v[l] = vv.transpose(0, 2, 1, 3)
    return {"k": k, "v": v}
