"""Emit the frozen quantized model (model/mnist_quantized.npz) as a JSON blob
for embedding in demo/draw_demo.html.

The demo replicates, in JavaScript, the exact int8 datapath already proven
bit-exact against the hardware tile (tb/mnist/test_mnist.py) and replicated in
model/evaluate_quantized.py. Everything the JS needs -- int8 weights, scales,
and the 8 frozen demo images + reference predictions for an in-browser
self-test -- comes from the .npz, so the demo can never silently drift from
what the hardware actually ran.

Usage: python model/export_demo_weights.py
Prints the JSON to stdout; demo/draw_demo.html embeds it between its
`/*WEIGHTS_START*/` ... `/*WEIGHTS_END*/` markers (a one-time bake -- the .npz
is frozen and committed, so this only needs rerunning if the model is ever
retrained).
"""

import json
from pathlib import Path

import numpy as np

DATA_PATH = Path(__file__).parent / "mnist_quantized.npz"


def main():
    data = np.load(DATA_PATH)
    blob = {
        "W1": data["W1_int8"].astype(int).tolist(),          # (64, 32)
        "W2": data["W2_int8"].astype(int).tolist(),          # (32, 16)
        "s_input": float(data["s_input"]),
        "s_W1": float(data["s_W1"]),
        "s_hidden": float(data["s_hidden"]),
        "s_W2": float(data["s_W2"]),
        "demo_images_int8": data["test_images_int8"].astype(int).tolist(),  # (8, 64)
        "demo_labels": data["test_labels"].astype(int).tolist(),
        "float_model_preds": data["float_model_preds"].astype(int).tolist(),
    }
    print(json.dumps(blob, separators=(",", ":")))


if __name__ == "__main__":
    main()
