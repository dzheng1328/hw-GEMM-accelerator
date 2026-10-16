"""Tests for the data tooling. Run: .venv/bin/python -m pytest web/sim-build -q"""

import base64

import numpy as np
import pytest

import data
import sources


@pytest.fixture(scope="module")
def q():
    return data.load_q()


def raw(b64):
    return np.frombuffer(base64.b64decode(b64), dtype=np.uint8)


def test_every_rtl_file_is_hashed_or_excluded():
    on_disk = {f"rtl/{p.name}" for p in (sources.REPO / "rtl").glob("*.v")}
    listed = {f for f in sources.RTL_FILES if f.startswith("rtl/")}
    assert on_disk == listed | set(sources.EXCLUDED_RTL)


def test_every_hashed_file_exists():
    for rel in sources.HASHED:
        assert (sources.REPO / rel).is_file(), rel


def test_examples_are_the_first_test_image_of_each_class(q):
    examples = data.example_entries(q)
    assert [e["class"] for e in examples] == list(range(10))
    for e in examples:
        first = int(np.flatnonzero(q["test_labels"] == e["class"])[0])
        assert e["index"] == first
        assert e["name"] == data.CLASS_NAMES[e["class"]]


def test_example_logits_and_packing_match_independent_expectations(q):
    from cifar_reference import run_int8

    for e in data.example_entries(q):
        img = raw(e["pixels"]).reshape(3, 32, 32)
        assert e["logits"] == [int(v) for v in run_int8(q, img[None])[-1][0]]
        want = np.concatenate(
            [(img.astype(np.int16) - 128).astype(np.int8).reshape(-1), np.zeros(1024, np.int8)]
        ).view(np.uint8)
        assert np.array_equal(raw(e["packed"]), want)
        assert e["int8Pred"] == int(np.argmax(e["logits"][:10]))


def test_extremes_have_pixels_packing_and_sixteen_logits(q):
    extremes = data.extreme_entries(q)
    assert sorted(extremes) == ["black", "noise", "white"]
    for name, e in extremes.items():
        assert raw(e["pixels"]).size == 3072, name
        assert raw(e["packed"]).size == 4096, name
        assert len(e["logits"]) == 16, name


def test_requant_cases_cover_the_extremes_and_match_the_python_requant():
    from fixedpoint import requant

    cases = data.requant_cases()
    accs = {c[0] for c in cases}
    assert {-(2**31), 2**31 - 1, 0} <= accs
    assert {c[2] for c in cases} >= {0, 1, 63}
    for acc, m, sh, out in cases:
        assert out == int(requant(np.array([acc]), m, sh, relu=True)[0])


def test_model_json_decodes_to_the_npz_arrays(q):
    from cifar_spec import LAYERS

    layers = data.model_json(q)["layers"]
    assert [layer["name"] for layer in layers] == [l.name for l in LAYERS]
    for layer in layers:
        w = q[f"{layer['name']}_w"]
        assert np.array_equal(raw(layer["weights"]).view(np.int8), w.reshape(-1))
        assert layer["cout"] == w.shape[0] and layer["cin"] == w.shape[1]
        assert layer["biasVal"] == int(q[f"{layer['name']}_bias_val"])


def test_weights_are_the_same_on_every_mesh_and_the_input_is_all_the_activation_the_program_needs(q):
    progs = data.programs(q)
    first = next(iter(progs.values()))
    for p in progs.values():
        assert np.array_equal(p.weights, first.weights)
        act = p.build.act.view(np.uint8)
        assert not act[4096:].any(), "activation memory beyond the input must start zeroed"
        assert len(p.words) <= 4096


def test_layer_ranges_partition_each_program(q):
    import isa

    for key, p in data.programs(q).items():
        ranges = data.layer_ranges(p.build)
        assert [r["name"] for r in ranges] == ["conv1", "conv2", "conv3", "conv4", "conv5", "fc"], key
        assert ranges[0]["pcStart"] == 0 and ranges[-1]["pcEnd"] == len(p.words), key
        for a, b in zip(ranges, ranges[1:]):
            assert a["pcEnd"] == b["pcStart"], key
        for r in ranges:
            assert r["pcEnd"] > r["pcStart"], key
        for r in ranges[:-1]:
            assert int(p.words[r["pcEnd"] - 1]) == int(isa.wait()), f"{key}: layer {r['name']} must end in WAIT"
