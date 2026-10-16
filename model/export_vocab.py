"""Write the story model's vocabulary pieces to docs/perf/lm_vocab.json.

The portfolio app decodes a story's token ids with these pieces (the same rules as
model/lm_tok.py: '▁' is a space, '<0xNN>' pieces are raw bytes, BOS ends a story), so it
needs no sentencepiece and no simulator re-run. The output is committed, like the other
docs/perf files; run `python model/export_vocab.py` after retraining the tokenizer.
"""

import json
import sys
from pathlib import Path

import numpy as np

import lm_spec

ROOT = Path(__file__).resolve().parent.parent
NPZ = ROOT / "model" / "lm_quantized.npz"
OUT = ROOT / "docs" / "perf" / "lm_vocab.json"


def export(npz_path, out_path) -> None:
    pieces = [str(p) for p in np.load(npz_path)["vocab"]]
    if len(pieces) != lm_spec.VOCAB:
        raise ValueError(f"expected {lm_spec.VOCAB} vocabulary pieces, found {len(pieces)}")
    data = {
        "_generated": {
            "source": "model/lm_quantized.npz (key: vocab)",
            "regenerate": "python model/export_vocab.py",
            "note": "generated, do not edit by hand",
        },
        "bos": lm_spec.BOS,
        "eos": lm_spec.EOS,
        "pieces": pieces,
    }
    Path(out_path).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main() -> int:
    export(NPZ, OUT)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
