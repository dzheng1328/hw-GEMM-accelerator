"""pytest for compiler/lower.py."""

import numpy as np
import pytest

import isa
from cifar_reference import NPZ_PATH
from cifar_spec import LAYERS
from lower import lower, pack_inputs, pack_weights
from nets import NETS, random_net


def cifar(n_images=1):
    return lower(np.load(NPZ_PATH), LAYERS, (4, 32, 32), n_images)


def test_pack_weights_places_taps_then_bias_rows():
    rng = np.random.default_rng(0)
    w = rng.integers(-128, 128, (16, 4, 3, 3)).astype(np.int8)
    bias = rng.integers(-128, 128, (4, 16)).astype(np.int8)
    words = pack_weights(w, bias)
    assert words.dtype == np.dtype("<u8") and len(words) == 2 * 40
    lanes = words.view(np.int8).reshape(2, 40, 8)
    assert np.array_equal(lanes[1, (2 * 3 + 1) * 4 + 3], w[8:16, 3, 2, 1])
    assert np.array_equal(lanes[1, 36 + 2], bias[2, 8:16])


def test_cifar_lowering_matches_the_spec_table():
    lw = cifar()
    assert [L.ks for L in lw.layers] == [40, 152, 296, 296, 584, 4104]
    assert [L.tap_slots for L in lw.layers] == [36, 144, 288, 288, 576, 4096]
    assert [(L.hout, L.wout) for L in lw.layers] == [(32, 32), (16, 16), (16, 16), (8, 8), (8, 8), (1, 1)]
    assert [L.raw for L in lw.layers] == [False] * 5 + [True]
    assert len(lw.weights) == sum(L.groups * L.ks for L in lw.layers) == 17120
    fc = lw.layers[-1]
    assert fc.rounds == 65 and fc.pixel_blocks == 1 and fc.out_words == 16 * 8
    assert [fc.round_start_tap(r) for r in (0, 1, 8, 63, 64)] == [(0, 0), (0, 1), (1, 0), (7, 7), (0, 0)]
    assert lw.layers[4].round_start_tap(3) == (1, 0)
    regs = lw.layers[1].regs()
    assert regs[isa.BIAS] == 144 | (int(np.load(NPZ_PATH)["conv2_bias_val"]) << 16)
    assert regs[isa.IN_BASE] == lw.layers[0].out_base * 8 and regs[isa.OSTRIDE] == 32


def test_round_start_tap_when_a_tap_spans_rounds():
    shape, specs = NETS["wide"]
    lw = lower(*random_net(np.random.default_rng(1), shape, specs), shape, 1)
    first = lw.layers[0]
    assert first.tap_slots == 1152 and first.rounds == 19
    assert [first.round_start_tap(r) for r in (1, 2, 3, 17, 18)] == [(0, 0), (0, 1), (0, 1), (2, 2), (0, 0)]


def test_memory_map_is_disjoint_and_ordered():
    lw = cifar(4)
    m = lw.mem
    assert (m.input_base, m.input_words) == (0, 512)
    assert lw.layers[0].out_base == 4 * 512
    ends = [L.out_base + L.out_words for L in lw.layers[:-1]]
    assert all(e <= L.out_base for e, L in zip(ends, lw.layers[1:]))
    assert m.output_base == lw.layers[-1].out_base and m.total_words == m.output_base + 4 * 128


def test_too_many_images_for_activation_memory():
    with pytest.raises(ValueError, match="activation"):
        cifar(300)


def test_bias_rows_must_end_k_on_a_multiple_of_8():
    shape, specs = NETS["small"]
    q, layers = random_net(np.random.default_rng(2), shape, specs)
    q["l0_bias"] = q["l0_bias"][:3]
    with pytest.raises(isa.ShapeError, match="l0"):
        lower(q, layers, shape, 1)


def test_pack_inputs_lays_images_out_chw():
    shape, specs = NETS["small"]
    q, layers = random_net(np.random.default_rng(3), shape, specs)
    lw = lower(q, layers, shape, 2)
    x = np.random.default_rng(4).integers(-128, 128, (2,) + shape)
    act = pack_inputs(lw, x).view(np.int8)
    assert len(act) == lw.mem.total_words * 8
    assert np.array_equal(act[: x.size], x.reshape(-1))
    with pytest.raises(ValueError, match="shape"):
        pack_inputs(lw, x[:1])


def test_too_many_weights_for_weight_memory(monkeypatch):
    monkeypatch.setattr(isa, "WEIGHT_WORDS", 17119)
    with pytest.raises(ValueError, match="weight memory"):
        cifar()
