"""The direct NumPy int8 CIFAR-10 network: level 1 of the verification
ladder (spec section 4), the definition of correct results that the
compiler's golden executor and then the RTL must equal bit-exactly.

Every layer: int64 conv of int8 activations with int8 weights, plus the
bias row times the layer's bias_val (the bias slot the DMA emits), then for
conv layers per-group requant + ReLU to int8 (model/fixedpoint.py), and
for fc raw int32 logits. No floats and no PyTorch anywhere.

Run as a script to report int8 vs float accuracy on all 10,000 test
images."""

from pathlib import Path

import numpy as np

from cifar_spec import INPUT_OFFSET, LAYERS
from fixedpoint import requant

NPZ_PATH = Path(__file__).parent / "cifar_quantized.npz"
GROUP = 8
N_CLASSES = 10


def conv_int(x, w, stride, pad):
    """int64 convolution, x (N, C, H, W), w (Co, C, k, k), zero padding."""
    x = np.asarray(x, dtype=np.int64)
    w = np.asarray(w, dtype=np.int64)
    _, _, h, wd = x.shape
    k = w.shape[2]
    ho, wo = (h + 2 * pad - k) // stride + 1, (wd + 2 * pad - k) // stride + 1
    xp = np.pad(x, ((0, 0), (0, 0), (pad, pad), (pad, pad)))
    out = np.zeros((x.shape[0], w.shape[0], ho, wo), dtype=np.int64)
    for ky in range(k):
        for kx in range(k):
            patch = xp[:, :, ky : ky + stride * (ho - 1) + 1 : stride, kx : kx + stride * (wo - 1) + 1 : stride]
            out += np.einsum("oc,nchw->nohw", w[:, :, ky, kx], patch)
    return out


def quantize_input(images_uint8):
    """(N, 3, 32, 32) uint8 -> (N, 4, 32, 32) int64: pixel - 128, plus the
    zero channel that makes conv1's Cin a power of two."""
    q = np.asarray(images_uint8, dtype=np.int64) - INPUT_OFFSET
    return np.concatenate([q, np.zeros_like(q[:, :1])], axis=1)


def check_int32(acc, name):
    if acc.size and (acc.max() >= 2**31 or acc.min() < -(2**31)):
        raise ValueError(f"{name}: accumulator outside int32")
    return acc


def run_int8(q, images_uint8):
    """Int8 activations of every conv layer (int64 arrays), then the int32
    logits (N, 16)."""
    x = quantize_input(images_uint8)
    outs = []
    for layer in LAYERS:
        L = layer.name
        acc = conv_int(x, q[f"{L}_w"], layer.stride, layer.pad)
        acc += (q[f"{L}_bias"].astype(np.int64) * int(q[f"{L}_bias_val"]))[None, :, None, None]
        check_int32(acc, L)
        if L == "fc":
            outs.append(acc.reshape(len(x), -1))
            break
        y = np.empty_like(acc)
        for g, (m, sh) in enumerate(zip(q[f"{L}_m"], q[f"{L}_sh"])):
            y[:, GROUP * g : GROUP * g + GROUP] = requant(acc[:, GROUP * g : GROUP * g + GROUP], int(m), int(sh), relu=True)
        outs.append(y)
        x = y
    return outs


def predict(q, images_uint8):
    """Class predictions: argmax over the 10 real logits."""
    return np.argmax(run_int8(q, images_uint8)[-1][:, :N_CLASSES], axis=1)


def main():
    from cifar_data import load_cifar10

    q = np.load(NPZ_PATH)
    _, _, test_x, test_y = load_cifar10()
    preds = np.concatenate([predict(q, test_x[i : i + 500]) for i in range(0, len(test_x), 500)])
    acc = float(np.mean(preds == test_y))
    print(f"int8 accuracy on 10,000 test images: {acc * 100:.2f}% "
          f"(float: {float(q['float_test_acc']) * 100:.2f}%)")


if __name__ == "__main__":
    main()
