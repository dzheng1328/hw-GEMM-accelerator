"""Memory images for the RTL's $readmemh loads (spec section 2): one
16-digit hex word per line, the activation memory split into its even and
odd word banks."""

from pathlib import Path

import numpy as np


def hex_words(words):
    return "".join(f"{int(w):016x}\n" for w in words)


def emit(out_dir, b):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    act = np.asarray(b.act, dtype="<u8")
    if len(act) % 2:
        act = np.append(act, np.zeros(1, dtype="<u8"))
    files = {"program.hex": b.program, "weights.hex": b.lowered.weights,
             "act_even.hex": act[0::2], "act_odd.hex": act[1::2]}
    for name, words in files.items():
        (out / name).write_text(hex_words(words))
    return {name: out / name for name in files}
