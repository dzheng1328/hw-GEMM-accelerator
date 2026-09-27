"""Level 2 of the verification ladder on CIFAR-10 (issue #69): compile the
frozen network for each mesh shape, run the golden executor over the frozen
test images, and require bit-exact equality with model/cifar_reference.py:
every image's logits, and the last image's activations at every layer.

    python compiler/check_cifar.py [--images 128] [--mesh 1x1 2x2 4x3 4x4]"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "model"))

import numpy as np  # noqa: E402

from build import cifar_build, run_golden  # noqa: E402
from cifar_reference import N_CLASSES, NPZ_PATH, run_int8  # noqa: E402
from lower import read_buffer, read_output  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--images", type=int, default=128)
    ap.add_argument("--mesh", nargs="+", default=["1x1", "2x2", "4x3", "4x4"])
    args = ap.parse_args()

    q = np.load(NPZ_PATH)
    images = q["test_images"][: args.images]
    ref = run_int8(q, images)
    ok = True
    for spec in args.mesh:
        w, h = map(int, spec.split("x"))
        t0 = time.time()
        b = cifar_build(q, images, w, h)
        act = run_golden(b)
        logits = np.stack([read_output(b.lowered, act, n).reshape(-1) for n in range(len(images))])
        same = np.array_equal(logits, ref[-1]) and all(
            np.array_equal(read_buffer(b.lowered, act, i), ref[i][-1]) for i in range(len(ref) - 1))
        ok &= same
        print(f"{spec}: {len(b.program)} commands, golden {'==' if same else '!='} reference "
              f"on {len(images)} images ({time.time() - t0:.1f}s)")
    preds = np.argmax(ref[-1][:, :N_CLASSES], axis=1)
    n = len(images)
    print(f"int8 accuracy {np.mean(preds == q['test_labels'][:n]) * 100:.2f}%, "
          f"agrees with float on {np.mean(preds == q['float_preds'][:n]) * 100:.2f}%")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
