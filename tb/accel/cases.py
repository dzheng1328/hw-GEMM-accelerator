"""tb/accel test cases: conv stacks compiled end to end, one per simulator
run (rtl/accel.v's memories load their $readmemh images at time 0).

    python cases.py list                 the cases `make` runs
    python cases.py probes               the fault probes of `make error-check`
    python cases.py message PROBE W H    the log fragment PROBE must produce on a WxH build
    python cases.py emit CASE W H DIR    CASE's images for a WxH build, into DIR

The cocotb test rebuilds the same case (each is deterministic in its name)
to run the golden executor. The fault probe wrong_mesh is the small net
compiled for a mesh one column wider than the build's, so its first BLOCK
to the extra column must stop the run. cifarN (1 <= N <= 128) is the frozen
CIFAR-10 network on the first N test images of model/cifar_quantized.npz."""

import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

N_RANDOM = 4
# Story-model cases (spec 4.3 section 5): name -> (model, steps, inv_temp). "random<N>" is
# model/lm_reference.random_quantized(N) with the prompt and seeds of compiler/check_lm.py,
# "real" the frozen model with its own. lm_t0 samples greedily, lm_t256 at temperature 1 (Q8.8).
LM_CASES = {"lm_t0": ("random0", 10, 0), "lm_t256": ("random1", 12, 256)}
LM_EXTRA = {"lm_real8": ("real", 8, 0), "lm_real8_t256": ("real", 8, 256),
            "lm_rounds": ("random2", 66, 256)}  # T = 7 to 8 and 63 to 64: AV's second round
CASES = ["small", "wide"] + [f"rand{i}" for i in range(N_RANDOM)] + list(LM_CASES)
# Fault probes: tiny programs that must stop the run on a cmd_seq $fatal (`make error-check`).
# name -> (program builder, the message fragment the log must hold, golden's fault pc). wrong_mesh is
# the small net for a mesh one column wider than the build's (its message names the build's mesh).
def probe_programs():
    import isa

    setr = lambda r, v: isa.alu(isa.ALU_ADD, r, 0, imm=v)  # noqa: E731
    rf = isa.block(isa.Block(0, 0, 0, 0, 0, reg_form=True))
    return {
        "loop_zero": ([isa.LOOP << 60, isa.endloop(), isa.end()], "LOOP count 0 is not 1 to 65535 at pc 0", 0),
        "loop_depth": ([isa.loop(1)] * 5 + [isa.endloop()] * 5 + [isa.end()], "LOOP nested deeper than 4 at pc 4", 4),
        "loopr_zero": ([isa.loopr(25), isa.endloop(), isa.end()], "LOOPR count 0 is not 1 to 65535 at pc 0", 0),
        "loopr_big": ([setr(25, 65536), isa.loopr(25), isa.endloop(), isa.end()],
                      "LOOPR count 65536 is not 1 to 65535 at pc 1", 1),
        "rf_round": ([setr(isa.ROUND, 128), rf, isa.end()], "register-form ROUND 128 out of range at pc 1", 1),
        "rf_rows": ([setr(isa.ROWS, 8), rf, isa.end()],
                    "register-form ROWS 8 out of range (rows minus 1, 0..7) at pc 1", 1),
        "rf_rmode": ([setr(isa.RMODE, 3), rf, isa.end()], "register-form RMODE 3 out of range at pc 1", 1),
        "vop_sub": ([(isa.VOP << 60) | (10 << 56), isa.end()], "invalid VOP sub-op 10 at pc 0", 0),
        "vpu_t": ([setr(isa.T, 256), isa.vop(isa.SAMPLE), isa.end()], "the VPU faulted on the VOP at pc 1", 1),
    }


PROBES = ("wrong_mesh",) + tuple(probe_programs())
# A program that runs a VOP and stops, for the Icarus probes of `make vpu-check` (they Force a signal while it runs).
VOP_NOP = "vop_nop"
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


def lm_case(name):
    """(q, prompt, seeds, steps, inv_temp) of a story-model case, or None."""
    spec = LM_CASES.get(name) or LM_EXTRA.get(name)
    if spec is None:
        return None
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "model"))
    from check_lm import RANDOM_PROMPT, RANDOM_SEEDS
    from lm_reference import NPZ_PATH, random_quantized

    model, steps, inv_temp = spec
    if model == "real":
        q = dict(np.load(NPZ_PATH))
        return q, q["prompt_ids"], q["seeds"], steps, inv_temp
    return random_quantized(int(model[len("random"):])), RANDOM_PROMPT, RANDOM_SEEDS, steps, inv_temp


@dataclass(frozen=True)
class ProbeBuild:
    """A bare program on empty memories, for emit.images and the golden."""

    program: list
    mesh: tuple
    a_mem: tuple = ()
    act: tuple = ()


def probe_message(name, w, h):
    """The message fragment a fault probe's log must contain."""
    if name == "wrong_mesh":
        return f"is outside the {w}x{h} mesh"
    return probe_programs()[name][1]


def cycle_budget(slots, wb_words, tiles):
    """Cycles a case gets before the test calls it hung. Node (0,0) injects
    at most one OPERAND slot and delivers at most one result word per cycle,
    and each tile computes its share of the slots while it cannot load more;
    measured runs take 0.9-1.2x (slots + words written back) on 2x2 and up,
    and 2.3x on one tile, so this ends a deadlocked run within about three
    times its real length."""
    return 2 * (slots + wb_words) + 2 * slots // tiles + 10_000


def lm_extra_cycles(steps, vops, slots):
    """The story model's cycles on top of cycle_budget's: the VPU's, which run alone (the mesh
    idles; SAMPLE alone reads the vocabulary three times, about 3K cycles a step, and SOFTMAX
    grows with the position), the drains in front of every VOP, and each step's ALUs and loop
    bookkeeping. The VPU's share grows with the context just as the attention slots do, so
    2 cycles per slot stands for it at any length. Measured against 1x1, 2x2 and 4x3 runs of
    8 to 66 steps and a 256-step one: 1.5 to 2.8 times the real cycles."""
    return 9_000 * steps + 40 * vops + 2 * slots + 20_000


def is_cifar(name):
    """N for a case named cifarN, else None."""
    if name.startswith("cifar") and name[5:].isdigit() and 1 <= int(name[5:]) <= N_CIFAR_IMAGES:
        return int(name[5:])
    return None


def case_build(name, w, h):
    """The case compiled for a WxH build (a wider mesh for wrong_mesh)."""
    from build import build

    lm = lm_case(name)
    if lm is not None:
        from lower_lm import lm_build

        q, prompt, seeds, steps, inv_temp = lm
        return lm_build(q, w, h, steps, inv_temp, prompt, seeds)
    n = is_cifar(name)
    if n is not None:
        from build import cifar_build
        from cifar_reference import NPZ_PATH

        q = np.load(NPZ_PATH)
        return cifar_build(q, q["test_images"][:n], w, h)
    if name == "wrong_mesh":
        return build(*case_net("small"), *((w + 1, h) if w < 8 else (w, h + 1)))
    if name in probe_programs():
        return ProbeBuild(probe_programs()[name][0], (w, h))
    if name == VOP_NOP:
        import isa

        setr = lambda r, v: isa.alu(isa.ALU_ADD, r, 0, imm=v)  # noqa: E731
        return ProbeBuild([setr(22, 0), setr(23, 128), isa.vop(isa.VADD, 22, 23), isa.end()], (w, h))
    if name not in CASES:
        raise ValueError(f"unknown case {name}")
    return build(*case_net(name), w, h)


def main(argv):
    if argv[1:] == ["list"]:
        print(" ".join(CASES))
        return 0
    if argv[1:2] == ["probes"]:
        print(" ".join(PROBES))
        return 0
    if len(argv) == 5 and argv[1] == "message":
        print(probe_message(argv[2], int(argv[3]), int(argv[4])))
        return 0
    if len(argv) == 6 and argv[1] == "emit":
        from emit import emit

        emit(argv[5], case_build(argv[2], int(argv[3]), int(argv[4])))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
