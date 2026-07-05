"""Post-training quantization: load the trained float MLP, calibrate scales,
quantize weights to int8, and freeze a small test batch + reference
predictions into model/mnist_quantized.npz for the cocotb testbench.

Quantization is symmetric, per-tensor, zero-point-0 -- not a simplicity
choice but forced by the hardware: rtl/pe.v is a pure signed int8 x int8 ->
int32 MAC with no zero-point/bias-add datapath, so asymmetric affine
quantization literally cannot be represented in this design. See
docs/decisions.md for the full quantization math and the associativity
argument for why the untiled reference matmul is bit-exact to the hardware's
chunked/tiled computation.
"""

from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from mnist_data import load_mnist
from train import CHECKPOINT_PATH, MnistMLP, downsample

OUTPUT_PATH = Path(__file__).parent / "mnist_quantized.npz"

NUM_DEMO_IMAGES = 8
PADDED_OUTPUT_DIM = 16  # 2 N-blocks of 8; only the first 10 columns are real


def quantize_tensor(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Symmetric per-tensor int8 quantization: q = clip(round(x/s), -128, 127),
    s = max(|x|) / 127."""
    scale = float(np.max(np.abs(x))) / 127.0
    q = np.clip(np.round(x / scale), -128, 127).astype(np.int8)
    return q, scale


def main():
    model = MnistMLP()
    model.load_state_dict(torch.load(CHECKPOINT_PATH))
    model.eval()

    W1 = model.fc1.weight.detach().numpy().T  # (64, 32): torch stores (out, in)
    W2_real = model.fc2.weight.detach().numpy().T  # (32, 10)

    # Calibrate s_hidden: max-abs of the float model's own post-ReLU hidden
    # activations over the training set (standard static PTQ calibration).
    train_images, _, test_images, test_labels = load_mnist()
    with torch.no_grad():
        train_x = downsample(torch.from_numpy(train_images))
        hidden_float = F.relu(model.fc1(train_x)).numpy()
    s_hidden = float(np.max(np.abs(hidden_float))) / 127.0

    s_input = 255.0 / 127.0  # fixed constant: known dataset pixel range
    W1_int8, s_W1 = quantize_tensor(W1)
    W2_real_int8, s_W2 = quantize_tensor(W2_real)

    # Zero-pad W2 from (32, 10) to (32, 16) -- the 6 padding columns are
    # always-zero weights, so those PEs' accumulators are exactly zero
    # regardless of activations, safe to compute and discard.
    W2_int8 = np.zeros((W2_real_int8.shape[0], PADDED_OUTPUT_DIM), dtype=np.int8)
    W2_int8[:, : W2_real_int8.shape[1]] = W2_real_int8

    # Pick one test image per digit 0-7 for a demo that spans multiple
    # classes, rather than just the first 8 (arbitrary) test images.
    demo_indices = []
    for digit in range(NUM_DEMO_IMAGES):
        idx = int(np.where(test_labels == digit)[0][0])
        demo_indices.append(idx)
    demo_indices = np.array(demo_indices)

    demo_images_u8 = test_images[demo_indices]
    demo_labels = test_labels[demo_indices].astype(np.int64)

    with torch.no_grad():
        demo_x = downsample(torch.from_numpy(demo_images_u8))
        float_logits = model(demo_x)
        float_preds = float_logits.argmax(dim=1).numpy().astype(np.int64)
        demo_pixels = demo_x.numpy()  # (8, 64) float32 in [0, 255]

    test_images_int8 = np.clip(
        np.round(demo_pixels / s_input), -128, 127
    ).astype(np.int8)

    np.savez(
        OUTPUT_PATH,
        W1_int8=W1_int8,
        W2_int8=W2_int8,
        s_input=s_input,
        s_W1=s_W1,
        s_hidden=s_hidden,
        s_W2=s_W2,
        test_images_int8=test_images_int8,
        test_labels=demo_labels,
        float_model_preds=float_preds,
    )
    print(f"saved quantized data to {OUTPUT_PATH}")
    print(f"demo labels: {demo_labels.tolist()}")
    print(f"float model predictions: {float_preds.tolist()}")
    print(f"s_input={s_input:.4f} s_W1={s_W1:.4f} s_hidden={s_hidden:.4f} s_W2={s_W2:.4f}")


if __name__ == "__main__":
    main()
