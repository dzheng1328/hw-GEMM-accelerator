"""Fixed-point requantization, the single definition shared by the model
side (quantize/evaluate scripts, later the compiler) and every testbench
that checks rtl/requant.v.

A real, positive rescale factor M (e.g. s_in * s_w / s_out) is encoded as a
16-bit multiplier m and a right shift sh with M ~= m * 2**-sh, m normalized
into [2**15, 2**16) so it keeps 16 significant bits (relative error below
2**-16, far under int8 quantization noise). Applied to an int32 accumulator:

    q = sat_int8(relu?((acc * m + 2**(sh-1)) >> sh))      (>> is floor)

that is, round half up, optional ReLU, then saturate to [-128, 127]. The
rounding term is 0 when sh == 0. This is exactly what rtl/requant.v computes.

The 4.3 story model's vector unit ops follow, each bit-exact to its
rtl/vpu*.v counterpart (spec section 3).
"""

import math

import numpy as np

M_BITS = 16
SH_BITS = 6


def quantize_multiplier(M: float) -> tuple[int, int]:
    """Encode a real rescale factor 0 < M < 2**16 as (m, sh), M ~= m * 2**-sh."""
    if not M > 0:
        raise ValueError(f"rescale factor must be positive, got {M}")
    sh = (M_BITS - 1) - math.floor(math.log2(M))
    m = round(M * 2.0**sh)
    if m == 1 << M_BITS:  # rounding carried out of 16 bits
        m, sh = m >> 1, sh - 1
    if not 0 <= sh < (1 << SH_BITS):
        raise ValueError(f"rescale factor {M} needs shift {sh}, outside [0, {(1 << SH_BITS) - 1}]")
    return m, sh


def _round_shift(v, sh):
    """(v + 2**(sh-1)) >> sh elementwise, with no rounding term at sh == 0."""
    sh = np.asarray(sh, dtype=np.int64)
    half = np.where(sh > 0, np.left_shift(np.int64(1), np.maximum(sh - 1, 0)), 0)
    return (v + half) >> sh


def _rescale(acc, m, sh):
    m = np.asarray(m, dtype=np.int64)
    sh = np.asarray(sh, dtype=np.int64)
    if m.size and (m.min() < 0 or m.max() >= (1 << M_BITS) or sh.min() < 0 or sh.max() >= (1 << SH_BITS)):
        raise ValueError(f"(m={m}, sh={sh}) out of range")
    acc = np.asarray(acc, dtype=np.int64)
    if acc.size and (acc.max() >= 2**31 or acc.min() < -(2**31)):
        raise ValueError("accumulator outside int32")
    return _round_shift(acc * m, sh)


def requant(acc, m, sh, relu: bool) -> np.ndarray:
    """Requantize int32 accumulators to int8, bit-exact to rtl/requant.v.
    m and sh may be arrays broadcast against acc (one per requant group).

    int64 is exact here: |acc| < 2**31 and m < 2**16 give |acc * m| < 2**47,
    and the rounding term is at most 2**62, so the sum stays below 2**63."""
    return np.clip(_rescale(acc, m, sh), 0 if relu else -128, 127).astype(np.int64)


def requant16(acc, m, sh) -> np.ndarray:
    """RESULT16: requant saturating to int16 (spec section 2)."""
    return np.clip(_rescale(acc, m, sh), -32768, 32767).astype(np.int64)


def _bit_length(u):
    """Exact for 0 <= u < 2**53: frexp gives u = f * 2**e with f in [0.5, 1)."""
    return np.frexp(np.asarray(u, dtype=np.float64))[1].astype(np.int64)


def _check_range(u, name):
    u = np.asarray(u, dtype=np.int64)
    if u.size and (u.min() < 1 or u.max() >= 2**40):
        raise ValueError(f"{name} input outside [1, 2**40)")
    return u


def _shift_to(u, s):
    """u >> s for s >= 0, u << -s for s < 0, elementwise."""
    return np.where(s >= 0, u >> np.maximum(s, 0), u << np.maximum(-s, 0))


RSQRT_LUT = np.array([round(2**15 / math.sqrt((i + 0.5) / 16)) for i in range(16, 64)], dtype=np.int64)
RECIP_LUT = np.array([round(2**15 / ((i + 0.5) / 32)) for i in range(32, 64)], dtype=np.int64)


def rsqrt_q(u):
    """1/sqrt(u) ~= r * 2**-(15 + k): u normalized by an even shift to v in
    [1, 4) as Q2.14, a 48-entry seed indexed by v's top 6 bits, one Newton
    step r' = r * (3 - v r^2) / 2."""
    u = _check_range(u, "rsqrt")
    k = (_bit_length(u) - 1) // 2
    v = _shift_to(u, 2 * k - 14)
    r = RSQRT_LUT[(v >> 10) - 16]
    t = (v * r * r) >> 29
    return (r * (3 * 2**15 - t)) >> 16, k


def recip_q(u):
    """1/u ~= r * 2**-(15 + k): u normalized to v in [1, 2) as Q1.15, a
    32-entry seed, one Newton step r' = r * (2 - v r)."""
    u = _check_range(u, "recip")
    k = _bit_length(u) - 1
    v = _shift_to(u, k - 15)
    r = RECIP_LUT[(v >> 10) - 32]
    t = (v * r) >> 15
    return (r * (2**16 - t)) >> 15, k


EXP_A, EXP_B = 44049, 11281  # 2**-f ~= 1 - 0.67214 f + 0.17214 f^2, max error 0.0019


def exp2neg_q(z):
    """2**-(z / 2**16) in Q0.16 for integer z >= 0 (I-BERT style: integer
    part n as a shift, fraction f by a second-order polynomial)."""
    z = np.asarray(z, dtype=np.int64)
    if z.size and z.min() < 0:
        raise ValueError("exp2neg_q needs z >= 0")
    n, f = z >> 16, z & 0xFFFF
    p = 65536 - ((EXP_A * f + (1 << 15)) >> 16) + ((EXP_B * f * f + (1 << 31)) >> 32)
    return np.where(n >= 17, 0, p >> np.minimum(n, 16))


def exp_arg(d, m, sh):
    """z = round(-d * s * log2(e) * 2**16) for d <= 0, with
    (m, sh) = quantize_multiplier(s * log2(e) * 2**16)."""
    return _round_shift(-np.asarray(d, dtype=np.int64) * m, sh)


def softmax_q(scores, valid, m, sh):
    """Attention softmax over the last axis of int16 scores (spec section 3,
    SOFTMAX): probabilities as integers 0..127 in units of 1/127, 0 where
    `valid` (broadcast against scores) is False."""
    s = np.asarray(scores, dtype=np.int64)
    valid = np.broadcast_to(valid, s.shape)
    mx = np.where(valid, s, -(2**31)).max(-1, keepdims=True)
    e = np.where(valid, exp2neg_q(exp_arg(np.where(valid, s - mx, 0), m, sh)), 0)
    r, k = recip_q(e.sum(-1, keepdims=True))
    return np.minimum(_round_shift(e * 127 * r, 15 + k), 127)


def xorshift32(x):
    x = np.asarray(x, dtype=np.int64)
    x = x ^ ((x << 13) & 0xFFFFFFFF)
    x = x ^ (x >> 17)
    return x ^ ((x << 5) & 0xFFFFFFFF)


def sample_q(logits, inv_temp: int, m, sh, state):
    """One token per row of int16 logits (spec section 3, SAMPLE). inv_temp
    is Q8.8 (256 = temperature 1.0); 0 selects argmax, lowest index on ties,
    and leaves `state` untouched. Otherwise each row's xorshift32 state
    advances once, r16 is its top 16 bits, and the token is the first whose
    running sum of exp values exceeds (r16 * S) >> 16. Returns (tokens, state)."""
    L = np.asarray(logits, dtype=np.int64)
    if inv_temp == 0:
        return L.argmax(-1), np.asarray(state, dtype=np.int64)
    z = (exp_arg(L - L.max(-1, keepdims=True), m, sh) * inv_temp) >> 8
    e = exp2neg_q(z)
    state = xorshift32(state)
    u = ((state >> 16) * e.sum(-1)) >> 16
    return (np.cumsum(e, -1) > u[:, None]).argmax(-1), state


def rope_table(ctx: int, head_dim: int, theta: float):
    """cos and sin in Q1.14, shape (ctx, head_dim // 2), for pairs (2i, 2i+1)."""
    freqs = 1.0 / theta ** (np.arange(0, head_dim, 2) / head_dim)
    ang = np.arange(ctx)[:, None] * freqs[None, :]
    return np.round(np.cos(ang) * 2**14).astype(np.int64), np.round(np.sin(ang) * 2**14).astype(np.int64)


def rope_q(x, cos, sin):
    """Rotate adjacent pairs of int8 x (..., head_dim) by Q1.14 cos/sin
    broadcast against (..., head_dim // 2); round half up, saturate int8."""
    x = np.asarray(x, dtype=np.int64)
    x0, x1 = x[..., 0::2], x[..., 1::2]
    out = np.empty(np.broadcast_shapes(x.shape, cos.shape[:-1] + x.shape[-1:]), dtype=np.int64)
    out[..., 0::2] = np.clip(_round_shift(x0 * cos - x1 * sin, 14), -128, 127)
    out[..., 1::2] = np.clip(_round_shift(x0 * sin + x1 * cos, 14), -128, 127)
    return out


def silu_table(s_g: float, s_t: float) -> np.ndarray:
    """SiLU of every int8 gate value g (scale s_g) in int16 units of s_t,
    indexed by g + 128. Built in float64 once; the table is the definition."""
    x = np.arange(-128, 128) * s_g
    return np.clip(np.round(x / (1 + np.exp(-x)) / s_t), -32768, 32767).astype(np.int64)


def silu_mul_q(g, u, table, m, sh):
    """SwiGLU's gate: requant(table[g] * u) to int8 (spec section 3, SILU_MUL)."""
    return requant(table[np.asarray(g, dtype=np.int64) + 128] * np.asarray(u, dtype=np.int64), m, sh, relu=False)


def rmsnorm_q(x, eps_q: int, m, sh):
    """RMSNorm of int16 rows (last axis, a power-of-two width) to int8:
    u = (sum x^2 >> log2 n) + eps_q, (r, k) = rsqrt_q(u), then
    y = round(x * r * m * 2**-(sh + 15 + k)), where (m, sh) encodes 1/s_out."""
    x = np.asarray(x, dtype=np.int64)
    n = x.shape[-1]
    assert n & (n - 1) == 0, "RMSNORM width must be a power of two"
    u = ((x * x).sum(-1) >> (n.bit_length() - 1)) + eps_q
    r, k = rsqrt_q(u)
    return np.clip(_round_shift(x * r[..., None] * m, sh + 15 + k[..., None]), -128, 127)
