"""Golden data, examples, model weights and program images for the live demo.

Everything here comes from the repository's own references (model/cifar_reference.py,
compiler/); nothing is computed a second way. The TypeScript side is tested against these files."""

import base64
import json
from collections import namedtuple

import numpy as np

import sources

CLASS_NAMES = ["airplane", "automobile", "bird", "cat", "deer", "dog", "frog", "horse", "ship", "truck"]
INPUT_BYTES = 4096  # 4 channels x 32 x 32 int8; the fourth channel is zero
Program = namedtuple("Program", "build words weights")


def load_q():
    from cifar_reference import NPZ_PATH

    return np.load(NPZ_PATH)


def b64(array):
    return base64.b64encode(np.ascontiguousarray(array).tobytes()).decode("ascii")


def golden_logits(q, images):
    from cifar_reference import run_int8

    return run_int8(q, images)[-1]  # (N, 16) int64


def packed_input(q, image):
    """The first 4096 bytes of activation memory for one (3, 32, 32) uint8 image, from the compiler's own packer."""
    from build import cifar_build

    act = cifar_build(q, image[None], 2, 2).act.view(np.uint8)
    assert not act[INPUT_BYTES:].any()
    return act[:INPUT_BYTES].copy()


def _entry(q, image):
    return {
        "pixels": b64(image),
        "packed": b64(packed_input(q, image)),
        "logits": [int(v) for v in golden_logits(q, image[None])[0]],
    }


def example_entries(q):
    out = []
    for c in range(10):
        index = int(np.flatnonzero(q["test_labels"] == c)[0])
        e = _entry(q, q["test_images"][index])
        e.update({
            "class": c, "name": CLASS_NAMES[c], "index": index,
            "int8Pred": int(np.argmax(e["logits"][:10])), "floatPred": int(q["float_preds"][index]),
        })
        out.append(e)
    return out


def extreme_entries(q):
    rng = np.random.default_rng(1)
    images = {
        "noise": rng.integers(0, 256, (3, 32, 32)).astype(np.uint8),
        "white": np.full((3, 32, 32), 255, dtype=np.uint8),
        "black": np.zeros((3, 32, 32), dtype=np.uint8),
    }
    return {name: _entry(q, image) for name, image in images.items()}


def requant_cases():
    """[acc, m, sh, out] with ReLU, from model/fixedpoint.py, covering int32 extremes and every shift range."""
    from fixedpoint import requant

    rng = np.random.default_rng(7)
    accs = [-(2**31), -(2**31) + 1, -12345, -1, 0, 1, 12345, 2**31 - 2, 2**31 - 1]
    accs += [int(v) for v in rng.integers(-(2**31), 2**31, 12)]
    cases = []
    for sh in (0, 1, 8, 15, 23, 31, 47, 62, 63):
        for acc in accs:
            m = int(rng.integers(2**15, 2**16))
            cases.append([acc, m, sh, int(requant(np.array([acc]), m, sh, relu=True)[0])])
    return cases


def model_json(q):
    from cifar_spec import LAYERS

    layers = []
    for i, layer in enumerate(LAYERS):
        w, bias = q[f"{layer.name}_w"], q[f"{layer.name}_bias"]
        last = i == len(LAYERS) - 1
        layers.append({
            "name": layer.name, "cin": int(w.shape[1]), "cout": int(w.shape[0]),
            "ksize": layer.ksize, "stride": layer.stride, "pad": layer.pad,
            "weights": b64(w.astype(np.int8)), "biasRows": int(bias.shape[0]), "bias": b64(bias.astype(np.int8)),
            "biasVal": int(q[f"{layer.name}_bias_val"]),
            "m": [] if last else [int(v) for v in q[f"{layer.name}_m"]],
            "sh": [] if last else [int(v) for v in q[f"{layer.name}_sh"]],
        })
    return {"layers": layers}


def programs(q):
    """{mesh: Program(build, program words, weight words)} for the first test image on every mesh."""
    from build import cifar_build

    out = {}
    for key, (w, h) in sources.MESHES.items():
        b = cifar_build(q, q["test_images"][:1], w, h)
        out[key] = Program(b, np.asarray(b.program, dtype="<u8"), np.asarray(b.lowered.weights, dtype="<u8"))
    return out


def layer_ranges(b):
    """Program-word range of each layer: its register setup, its BLOCKs and the WAIT after it.
    The first layer also owns the prologue and the last owns the epilogue."""
    from cifar_spec import LAYERS
    from schedule import _blocks, _setup

    mesh_w, mesh_h = b.mesh
    tiles = [(t % mesh_w, t // mesh_w) for t in range(mesh_w * mesh_h)]
    layers = b.lowered.layers
    pc, ranges = 3, []  # the prologue is two ADDs and the LOOP
    for i, (spec, plan) in enumerate(zip(LAYERS, layers)):
        last = i == len(layers) - 1
        n = len(_setup(plan, first=i == 0, last=last)) + len(_blocks(plan, tiles)) + (0 if last else 1)
        ranges.append({"name": spec.name, "pcStart": 0 if i == 0 else pc, "pcEnd": pc + n})
        pc += n
    ranges[-1]["pcEnd"] = len(b.program)
    assert pc + 4 == len(b.program), f"expected a 4-word epilogue, program has {len(b.program) - pc}"
    return ranges


def dump_json(path, obj):
    path.write_text(json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n")


def write_data():
    q = load_q()
    out = sources.ARTIFACTS
    out.mkdir(parents=True, exist_ok=True)
    dump_json(out / "examples.json", example_entries(q))
    dump_json(out / "golden.json", {"extremes": extreme_entries(q), "requant": requant_cases()})
    dump_json(out / "cifar-model.json", model_json(q))
    progs = programs(q)
    first = next(iter(progs.values()))
    (out / "weights.bin").write_bytes(first.weights.tobytes())
    for key, p in progs.items():
        assert np.array_equal(p.weights, first.weights), f"weights differ on {key}"
        (out / f"program-{key}.bin").write_bytes(p.words.tobytes())
