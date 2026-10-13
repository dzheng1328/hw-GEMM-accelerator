"""Level 3 of the verification ladder on the story model (issue #84): compile
the frozen model for each mesh shape and temperature, run the golden executor,
and require bit-exact equality with model/lm_reference.py: the token log of
all 8 stories, and the K and V caches (the final memory state that outlives a
step).

    python compiler/check_lm.py [--steps 256] [--mesh 1x1 2x2 4x3] [--temps 0 256] [--random SEED]

A full 256-step run executes about 1M BLOCKs in Python (under a minute per mesh
and temperature); pytest uses short runs."""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "model"))

import numpy as np  # noqa: E402

from lm_reference import NPZ_PATH, generate, random_quantized  # noqa: E402
from lower_lm import lm_build, run_lm_golden  # noqa: E402

RANDOM_PROMPT = np.array([1, 404, 409, 261, 380])
RANDOM_SEEDS = np.array([3653403231, 2735729615, 2195314465, 1158725112, 1322117304, 175979945, 323153949, 70985654])


def check(q, prompt, seeds, mesh, steps, inv_temp):
    """(tokens equal, K cache equal, V cache equal, golden seconds) for one configuration."""
    t0 = time.time()
    _, tokens, cache = run_lm_golden(lm_build(q, *mesh, steps, inv_temp, prompt, seeds))
    took = time.time() - t0
    ref, ref_cache = generate(q, prompt, steps, inv_temp, seeds, return_cache=True)
    return (np.array_equal(tokens, ref), np.array_equal(cache["k"], ref_cache["k"]),
            np.array_equal(cache["v"], ref_cache["v"]), took)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--steps", type=int, default=256)
    ap.add_argument("--mesh", nargs="+", default=["1x1", "2x2", "4x3"])
    ap.add_argument("--temps", nargs="+", type=int, default=[0, 256], help="inverse temperature, Q8.8 (0 = argmax)")
    ap.add_argument("--random", type=int, metavar="SEED", help="a synthetic model instead of the frozen one")
    args = ap.parse_args()

    if args.random is None:
        q = dict(np.load(NPZ_PATH))
        prompt, seeds = q["prompt_ids"], q["seeds"]
    else:
        q, prompt, seeds = random_quantized(args.random), RANDOM_PROMPT, RANDOM_SEEDS
    ok = True
    for temp in args.temps:
        for spec in args.mesh:
            w, h = map(int, spec.split("x"))
            tokens, k, v, took = check(q, prompt, seeds, (w, h), args.steps, temp)
            ok &= tokens and k and v
            print(f"{spec} temp {temp}: golden {'==' if tokens and k and v else '!='} reference "
                  f"(tokens {tokens}, K {k}, V {v}) over {args.steps} steps ({took:.1f}s)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
