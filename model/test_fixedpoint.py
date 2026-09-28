"""pytest for model/fixedpoint.py (run by ./test.sh)."""

import numpy as np
import pytest

from fixedpoint import quantize_multiplier, requant


@pytest.mark.parametrize("M", [5.26e-3, 1.0, 0.5, 0.999999, 3.0, 1e-9, 2.0**14 * 1.9])
def test_quantize_multiplier_is_normalized_and_accurate(M):
    m, sh = quantize_multiplier(M)
    assert (1 << 15) <= m < (1 << 16)
    assert abs(m * 2.0**-sh - M) <= M * 2.0**-16


def test_quantize_multiplier_carry_renormalizes():
    # 0.99999999 rounds to m = 2**16 at sh = 16; it must renormalize to 2**15.
    assert quantize_multiplier(0.99999999) == (1 << 15, 15)


@pytest.mark.parametrize("M", [0.0, -1.0, 2.0**16, 2.0**-60])
def test_quantize_multiplier_rejects_unencodable(M):
    with pytest.raises(ValueError):
        quantize_multiplier(M)


def test_requant_rounds_half_up_and_saturates():
    m, sh = 1 << 15, 16  # M = 0.5
    acc = np.array([1, -1, 3, -3, 254, 255, 256, -256, -257, -258, 2**31 - 1, -(2**31)])
    # 0.5, -0.5, 1.5, -1.5 round half up to 1, 0, 2, -1.
    assert requant(acc, m, sh, relu=False).tolist() == [1, 0, 2, -1, 127, 127, 127, -128, -128, -128, 127, -128]
    assert requant(acc, m, sh, relu=True).tolist() == [1, 0, 2, 0, 127, 127, 127, 0, 0, 0, 127, 0]


def test_requant_shift_zero_has_no_rounding_term():
    assert requant(np.array([5, -5, 200]), 1, 0, relu=False).tolist() == [5, -5, 127]


def test_requant_int64_matches_exact_math_at_extremes():
    rng = np.random.default_rng(0)
    acc = np.concatenate([rng.integers(-(2**31), 2**31, 100000), [2**31 - 1, -(2**31), 0, 1, -1]])
    for m, sh in ((65535, 63), (65535, 0), (1 << 15, 16), (44139, 23)):
        exact = [min(127, max(-128, (int(a) * m + ((1 << sh) >> 1)) >> sh)) for a in acc[:2000]]
        assert requant(acc, m, sh, relu=False)[:2000].tolist() == exact
        assert requant(acc, m, sh, relu=False).dtype == np.int64


def test_requant_rejects_accumulators_outside_int32():
    with pytest.raises(ValueError):
        requant(np.array([2**31]), 1, 0, relu=False)


import math

from fixedpoint import (exp2neg_q, exp_arg, recip_q, requant16, rmsnorm_q, rope_q, rope_table, rsqrt_q,
                        sample_q, silu_mul_q, silu_table, softmax_q, xorshift32)


def test_requant_accepts_per_column_multipliers():
    acc = np.array([[100, 100], [-100, -100]])
    got = requant(acc, np.array([1 << 15, 1 << 15]), np.array([16, 15]), relu=False)
    assert got.tolist() == [[50, 100], [-50, -100]]


def test_requant_array_shift_63_rounds_correctly():
    assert requant(np.array([2**31 - 1]), np.array([65535]), np.array([63]), relu=False).tolist() == [0]


def test_requant16_saturates_to_int16():
    assert requant16(np.array([70000, -70000, 3]), 1 << 15, 15).tolist() == [32767, -32768, 3]


def test_rsqrt_q_accuracy():
    u = np.unique(np.concatenate([np.arange(1, 5000), np.geomspace(1, 2**40 - 1, 20000).astype(np.int64)]))
    r, k = rsqrt_q(u)
    approx = r * np.exp2(-(15.0 + k))
    # Measured worst case 3.66e-4 (e.g. u=4097), at the low edge of each seed bucket, where the
    # arithmetic-mean LUT seed is farthest from the true value; every consumer rounds to int8,
    # whose half-LSB at full scale is ~4e-3 relative, so this is still a ~10x margin.
    assert np.max(np.abs(approx * np.sqrt(u) - 1)) < 4e-4


def test_recip_q_accuracy():
    u = np.unique(np.concatenate([np.arange(1, 5000), np.geomspace(1, 2**40 - 1, 20000).astype(np.int64)]))
    r, k = recip_q(u)
    # Measured worst case 2.51e-4 (e.g. u=33791), same low-edge-of-bucket effect as rsqrt_q above;
    # every consumer rounds to int8, whose half-LSB at full scale is ~4e-3 relative, so this margin
    # is still ample.
    assert np.max(np.abs(r * np.exp2(-(15.0 + k)) * u - 1)) < 3e-4


@pytest.mark.parametrize("fn", [rsqrt_q, recip_q])
def test_rsqrt_recip_reject_out_of_range(fn):
    with pytest.raises(ValueError):
        fn(np.array([0]))
    with pytest.raises(ValueError):
        fn(np.array([2**40]))


def test_exp2neg_q_accuracy_and_ends():
    z = np.arange(0, 20 * 65536, 97)
    got = exp2neg_q(z) / 65536
    assert np.max(np.abs(got - np.exp2(-z / 65536))) < 2e-3
    assert exp2neg_q(np.array([0])).tolist() == [65536]
    assert exp2neg_q(np.array([17 * 65536, 40 * 65536])).tolist() == [0, 0]


def test_softmax_q_tracks_float_softmax():
    rng = np.random.default_rng(0)
    s_score = 0.01
    m, sh = quantize_multiplier(s_score * math.log2(math.e) * 2**16)
    scores = rng.integers(-2000, 2000, (50, 64))
    valid = np.ones((1, 64), dtype=bool)
    p = softmax_q(scores, valid, m, sh)
    ref = np.exp(scores * s_score)
    ref /= ref.sum(-1, keepdims=True)
    assert np.max(np.abs(p / 127 - ref)) < 0.01
    assert p.min() >= 0 and p.max() <= 127


def test_softmax_single_valid_position():
    valid = np.arange(8)[None, :] < 1
    p = softmax_q(np.array([[-5, 900, 3, 0, 0, 0, 0, 0]]), valid, *quantize_multiplier(0.05 * 1.4427 * 65536))
    assert p.tolist() == [[127, 0, 0, 0, 0, 0, 0, 0]]


def test_xorshift32_known_sequence():
    assert xorshift32(np.array([1], dtype=np.int64)).tolist() == [270369]
    x = np.array([2463534242], dtype=np.int64)
    for _ in range(3):
        x = xorshift32(x)
        assert 0 < x[0] < 2**32


def test_sample_argmax_ties_and_state():
    logits = np.array([[3, 9, 9, 1], [5, 5, 5, 5]])
    state = np.array([7, 8], dtype=np.int64)
    tok, new = sample_q(logits, 0, 1, 0, state)
    assert tok.tolist() == [1, 0] and new.tolist() == [7, 8]


def test_sample_matches_distribution():
    s_logit = 0.05
    m, sh = quantize_multiplier(s_logit * math.log2(math.e) * 2**16)
    logits = np.tile(np.array([0, 20, 40, 0, -300, 10, 10, 10]), (4000, 1))
    state = np.arange(1, 4001, dtype=np.int64) * 2654435761 % 2**32
    tok, new = sample_q(logits, 256, m, sh, state)  # inv_temp 256 = temperature 1.0
    assert (new != state).all()
    freq = np.bincount(tok, minlength=8) / len(tok)
    ref = np.exp(logits[0] * s_logit)
    ref /= ref.sum()
    assert np.max(np.abs(freq - ref)) < 0.03


def test_rope_q_matches_float_rotation():
    cos, sin = rope_table(256, 8, 10000.0)
    assert cos.shape == (256, 4) and cos[0].tolist() == [16384] * 4 and sin[0].tolist() == [0] * 4
    rng = np.random.default_rng(3)
    x = rng.integers(-127, 128, (256, 8))
    y = rope_q(x, cos, sin)
    ang = np.arange(256)[:, None] * (1.0 / 10000.0 ** (np.arange(0, 8, 2) / 8))[None, :]
    ref0 = x[:, 0::2] * np.cos(ang) - x[:, 1::2] * np.sin(ang)
    ref1 = x[:, 0::2] * np.sin(ang) + x[:, 1::2] * np.cos(ang)
    assert np.max(np.abs(y[:, 0::2] - np.clip(ref0, -128, 127))) <= 1
    assert np.max(np.abs(y[:, 1::2] - np.clip(ref1, -128, 127))) <= 1


def test_silu_mul_q_tracks_float():
    s_g, s_u, s_h = 0.05, 0.04, 0.02
    table = silu_table(s_g, 6.4 / 32767)
    assert table.shape == (256,) and table.dtype == np.int64
    m, sh = quantize_multiplier((6.4 / 32767) * s_u / s_h)
    g = np.arange(-128, 128)
    u = np.full(256, 50)
    got = silu_mul_q(g, u, table, m, sh) * s_h
    x = g * s_g
    ref = np.clip(x / (1 + np.exp(-x)) * 50 * s_u, -128 * s_h, 127 * s_h)
    assert np.max(np.abs(got - ref)) <= s_h


def test_rmsnorm_q_tracks_float():
    rng = np.random.default_rng(5)
    x = rng.integers(-20000, 20000, (100, 64))
    s_n = 4.0 / 127
    m, sh = quantize_multiplier(1 / s_n)
    y = rmsnorm_q(x, 1, m, sh)
    ref = x / np.sqrt((x.astype(float) ** 2).mean(-1, keepdims=True))
    assert np.max(np.abs(y * s_n - np.clip(ref, -128 * s_n, 127 * s_n))) <= s_n
