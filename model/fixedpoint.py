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


def requant(acc, m: int, sh: int, relu: bool) -> np.ndarray:
    """Requantize int32 accumulators to int8, bit-exact to rtl/requant.v.

    int64 is exact here: |acc| < 2**31 and m < 2**16 give |acc * m| < 2**47,
    and the rounding term is at most 2**62, so the sum stays below 2**63."""
    if not (0 <= m < (1 << M_BITS) and 0 <= sh < (1 << SH_BITS)):
        raise ValueError(f"(m={m}, sh={sh}) out of range")
    acc = np.asarray(acc, dtype=np.int64)
    if acc.size and (acc.max() >= 2**31 or acc.min() < -(2**31)):
        raise ValueError("accumulator outside int32")
    y = (acc * np.int64(m) + np.int64((1 << sh) >> 1)) >> np.int64(sh)
    lo = 0 if relu else -128
    return np.clip(y, lo, 127).astype(np.int64)
