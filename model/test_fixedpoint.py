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
