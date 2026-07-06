"""Evaluate the frozen quantized model's real accuracy on the full
10,000-image MNIST test set.

Replicates the exact int8 datapath already proven bit-exact against the
hardware tile in tb/mnist/test_mnist.py (same quantize/relu/requantize math
as model/quantize.py's quantize_tensor()), but over every test image instead
of the 8 frozen demo images. torch is used only for the downsample step,
matching train.py/quantize.py's own convention -- everything else is plain
NumPy/int64.
"""

from pathlib import Path

import numpy as np
import torch

from mnist_data import load_mnist
from train import downsample

DATA_PATH = Path(__file__).parent / "mnist_quantized.npz"


def main():
    data = np.load(DATA_PATH)
    W1 = data["W1_int8"].astype(np.int64)  # (64, 32)
    W2 = data["W2_int8"].astype(np.int64)  # (32, 16)
    s_input = float(data["s_input"])
    s_W1 = float(data["s_W1"])
    s_hidden = float(data["s_hidden"])
    M1 = (s_input * s_W1) / s_hidden

    _, _, test_images, test_labels = load_mnist()

    with torch.no_grad():
        pixels = downsample(torch.from_numpy(test_images)).numpy()  # (10000, 64) float32, [0,255]

    q_input = np.clip(np.round(pixels / s_input), -128, 127).astype(np.int64)

    # Layer 1: int64 matmul mirrors the int32 HW accumulator exactly (no
    # overflow risk at this scale -- see docs/decisions.md's associativity
    # argument). ReLU on the pre-quant accumulator, then requantize to int8.
    acc1 = q_input @ W1  # (10000, 32)
    h_int8 = np.clip(np.round(np.maximum(acc1, 0) * M1), 0, 127).astype(np.int64)

    # Layer 2: int64 matmul, argmax over the first 10 real (non-padding) columns.
    acc2 = h_int8 @ W2  # (10000, 16)
    preds = np.argmax(acc2[:, :10], axis=1)

    # Correctness gate: this from-scratch pipeline, restricted to the same 8
    # demo images quantize.py picked (first test-set occurrence of each digit
    # 0-7), must reproduce the float_model_preds already frozen in the npz --
    # ties this script back to the one path already proven bit-exact against
    # real hardware.
    demo_indices = np.array([int(np.where(test_labels == d)[0][0]) for d in range(8)])
    expected = data["float_model_preds"]
    demo_preds = preds[demo_indices]
    assert np.array_equal(demo_preds, expected), (
        f"quantized pipeline mismatch on frozen demo images: {demo_preds.tolist()} "
        f"vs {expected.tolist()}"
    )

    accuracy = float(np.mean(preds == test_labels))
    print(f"quantized model accuracy on full 10,000-image MNIST test set: {accuracy * 100:.2f}%")


if __name__ == "__main__":
    main()
