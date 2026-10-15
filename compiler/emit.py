"""Memory images for the RTL's $readmemh loads (spec section 2): one
16-digit hex word per line, the activation memory split into its four
word-interleaved banks (word w in bank w mod 4, at bank address w // 4)."""

from pathlib import Path

import numpy as np

from isa import ACT_BANKS


def hex_words(words):
    return "".join(f"{int(w):016x}\n" for w in words)


def images(b):
    """(program, weight or A memory image, activation image) of a conv Build
    (build.py) or a story-model LmBuild (lower_lm.py)."""
    return (b.program, b.a_mem if hasattr(b, "a_mem") else b.lowered.weights, b.act)


def emit(out_dir, b):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    program, weights, act = images(b)
    act = np.asarray(act, dtype="<u8")
    act = np.append(act, np.zeros(-len(act) % ACT_BANKS, dtype="<u8"))
    files = {"program.hex": program, "weights.hex": weights}
    files.update({f"act_bank{i}.hex": act[i::ACT_BANKS] for i in range(ACT_BANKS)})
    for name, words in files.items():
        (out / name).write_text(hex_words(words))
    return {name: out / name for name in files}
