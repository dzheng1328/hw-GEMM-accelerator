"""tb/accel test cases: conv stacks compiled end to end, one per simulator
run (rtl/accel.v's memories load their $readmemh images at time 0).

    python cases.py list                 the cases `make` runs
    python cases.py emit CASE W H DIR    CASE's images for a WxH build, into DIR

The cocotb test rebuilds the same case (each is deterministic in its name)
to run the golden executor. The fault probe wrong_mesh is the small net
compiled for a mesh one column wider than the build's, so its first BLOCK
to the extra column must stop the run. cifarN (1 <= N <= 128) is the frozen
CIFAR-10 network on the first N test images of model/cifar_quantized.npz."""

import sys
import zlib

import numpy as np

N_RANDOM = 4
CASES = ["small", "wide"] + [f"rand{i}" for i in range(N_RANDOM)]
PROBES = ("wrong_mesh",)
N_CIFAR_IMAGES = 128  # test images frozen in model/cifar_quantized.npz

# (ksize, stride, pad) of the random stacks' conv layers.
CONVS = ((3, 1, 1), (3, 2, 1), (1, 1, 0), (1, 2, 0))


def random_stack(rng):
    """(input shape, layer specs): 2-3 layers the compiler accepts over up to
    16 channels of 8 or 16 pixels per side; half the time the last layer is
    a classifier (kernel = its input width, one output pixel)."""
    import isa

    while True:
        shape = (int(rng.choice([1, 2, 4, 8, 16])), int(rng.choice([8, 16])), int(rng.choice([8, 16])))
        c, h, w = shape
        n, specs = int(rng.integers(2, 4)), []
        try:
            for i in range(n):
                cout = int(rng.choice([8, 16, 32]))
                if i == n - 1 and rng.random() < 0.5:
                    spec = (cout, w, 1, 0)
                else:
                    spec = (cout,) + CONVS[int(rng.integers(len(CONVS)))]
                h, w = isa.check_shape(f"l{i}", c, h, w, *spec)
                specs.append(spec)
                c = cout
        except isa.ShapeError:
            continue
        return shape, specs


def case_net(name):
    """(q, layers, x) of a case, deterministic in its name."""
    from nets import NETS, random_net

    rng = np.random.default_rng(zlib.crc32(name.encode()))
    if name in NETS:
        (shape, specs), n_images = NETS[name], (1 if name == "wide" else 2)
    else:
        (shape, specs), n_images = random_stack(rng), 2
    q, layers = random_net(rng, shape, specs)
    return q, layers, rng.integers(-128, 128, (n_images,) + shape)


def is_cifar(name):
    """N for a case named cifarN, else None."""
    if name.startswith("cifar") and name[5:].isdigit() and 1 <= int(name[5:]) <= N_CIFAR_IMAGES:
        return int(name[5:])
    return None


def case_build(name, w, h):
    """The case compiled for a WxH build (a wider mesh for wrong_mesh)."""
    from build import build

    n = is_cifar(name)
    if n is not None:
        from build import cifar_build
        from cifar_reference import NPZ_PATH

        q = np.load(NPZ_PATH)
        return cifar_build(q, q["test_images"][:n], w, h)
    if name == "wrong_mesh":
        return build(*case_net("small"), *((w + 1, h) if w < 8 else (w, h + 1)))
    if name not in CASES:
        raise ValueError(f"unknown case {name}")
    return build(*case_net(name), w, h)


def main(argv):
    if argv[1:] == ["list"]:
        print(" ".join(CASES))
        return 0
    if len(argv) == 6 and argv[1] == "emit":
        from emit import emit

        emit(argv[5], case_build(argv[2], int(argv[3]), int(argv[4])))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
