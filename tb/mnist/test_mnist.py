"""cocotb testbench for rtl/systolic_array.v -- runs a real, trained,
quantized MNIST MLP end-to-end on the 8x8 hardware tile.

The tile only computes one 8x8x8 matrix multiply per "wave"; a real
classifier needs bigger matmuls. This testbench tiles each layer's matmul
into repeated waves through the same hardware (blocked/tiled GEMM),
orchestrated here in Python, accumulating K-dimension chunks back-to-back
without resetting between them (see docs/decisions.md for the proof that
this can't cross-contaminate between chunks) and resetting only between
N-blocks (independent output-column groups).

Model: 8x8-downsampled MNIST (64 inputs) -> 32 hidden (ReLU) -> 10 classes
(padded to 16 lanes). Batch of 8 real MNIST test images fills the array's
8 rows exactly, needing no batch-dimension tiling at all. Weights, scales,
and the frozen demo batch come from model/mnist_quantized.npz (produced by
model/train.py + model/quantize.py) -- this testbench only ever imports
numpy, never torch, to keep cocotb test startup lightweight.
"""

import os

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

N = 8
TOTAL_CYCLES = 3 * N - 2  # 22 -- see docs/decisions.md for the derivation


def to_signed32(value: int) -> int:
    """Wrap a Python int into the RTL accumulator's 32-bit two's-complement
    range. Kept as a small local copy (not a cross-module import) per the
    project's established per-directory cocotb MODULE convention."""
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def pack_lanes(values):
    """Pack N int8 lane values into a single flattened bus int, matching the
    RTL's `a_west[8*i +: 8]` / `b_north[8*j +: 8]` bit ordering."""
    packed = 0
    for lane, v in enumerate(values):
        packed |= (int(v) & 0xFF) << (8 * lane)
    return packed


def unpack_acc(raw: int, i: int, j: int) -> int:
    """Extract PE(i,j)'s signed 32-bit accumulator from the flattened
    acc_out bus."""
    field = (raw >> (32 * (i * N + j))) & 0xFFFFFFFF
    return to_signed32(field)


async def reset_dut(dut, cycles=2):
    dut.reset.value = 1
    dut.valid_in.value = 0
    dut.a_west.value = 0
    dut.b_north.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.reset.value = 0


async def feed_wave(dut, A_block, B_block):
    """One 22-cycle skewed 8x8x8 wave. Caller controls reset/valid_in -- this
    never resets, so back-to-back calls correctly accumulate across
    K-chunks."""
    for t in range(TOTAL_CYCLES):
        a_lanes = [A_block[i][t - i] if i <= t < i + N else 0 for i in range(N)]
        b_lanes = [B_block[t - j][j] if j <= t < j + N else 0 for j in range(N)]
        dut.a_west.value = pack_lanes(a_lanes)
        dut.b_north.value = pack_lanes(b_lanes)
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")


async def compute_nblock(dut, A_full, B_full, k_chunks):
    """Fresh reset, then k_chunks back-to-back K-dimension chunk waves (no
    reset between them), then read back this N-block's 8x8 int32 result."""
    await reset_dut(dut)
    dut.valid_in.value = 1
    for k in range(k_chunks):
        A_chunk = A_full[:, 8 * k : 8 * k + 8]
        B_chunk = B_full[8 * k : 8 * k + 8, :]
        await feed_wave(dut, A_chunk, B_chunk)
    dut.valid_in.value = 0
    raw = dut.acc_out.value.integer
    return np.array([[unpack_acc(raw, i, j) for j in range(N)] for i in range(N)])


def load_frozen_data():
    here = os.path.dirname(__file__)
    path = os.path.join(here, "..", "..", "model", "mnist_quantized.npz")
    return np.load(path)


@cocotb.test()
async def test_mnist_two_layer_pipeline(dut):
    """Drives a real, trained, quantized 2-layer MLP through the hardware
    tile (tiled across both layers), checking hardware output against an
    untiled NumPy reference at each N-block (the real correctness check),
    and reporting (not asserting) final classification accuracy against
    both true labels and the original float model's own predictions."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())

    data = load_frozen_data()
    W1 = data["W1_int8"].astype(np.int64)  # (64, 32)
    W2 = data["W2_int8"].astype(np.int64)  # (32, 16), 6 zero-weight padding columns
    s_input = float(data["s_input"])
    s_W1 = float(data["s_W1"])
    s_hidden = float(data["s_hidden"])
    A0 = data["test_images_int8"].astype(np.int64)  # (8, 64)
    labels = data["test_labels"]
    float_preds = data["float_model_preds"]

    M1 = (s_input * s_W1) / s_hidden

    # ---- Layer 1: 64 -> 32, 4 N-blocks x 8 K-chunks ----
    H_pre = np.zeros((8, 32), dtype=np.int64)
    ref_full_l1 = A0 @ W1  # untiled reference; bit-exact to the chunked sum (associativity)
    for n in range(4):
        B_block = W1[:, 8 * n : 8 * n + 8]
        got = await compute_nblock(dut, A0, B_block, k_chunks=8)
        expected = ref_full_l1[:, 8 * n : 8 * n + 8]
        assert np.array_equal(got, expected), f"layer1 N-block {n} mismatch:\n{got}\nvs\n{expected}"
        H_pre[:, 8 * n : 8 * n + 8] = got

    # ReLU applied directly on the int32 accumulator, then requantized to
    # int8 for layer 2 -- exact, since M1 > 0 so ReLU commutes with the
    # positive scale multiply.
    H_int8 = np.clip(np.round(np.maximum(H_pre, 0) * M1), 0, 127).astype(np.int64)

    # ---- Layer 2: 32 -> 16 (10 real + 6 padding), 2 N-blocks x 4 K-chunks ----
    logits_raw = np.zeros((8, 16), dtype=np.int64)
    ref_full_l2 = H_int8 @ W2
    for n in range(2):
        B_block = W2[:, 8 * n : 8 * n + 8]
        got = await compute_nblock(dut, H_int8, B_block, k_chunks=4)
        expected = ref_full_l2[:, 8 * n : 8 * n + 8]
        assert np.array_equal(got, expected), f"layer2 N-block {n} mismatch:\n{got}\nvs\n{expected}"
        logits_raw[:, 8 * n : 8 * n + 8] = got

    # Layer 2 needs no requantization: dequant(logit) = acc_int32 *
    # (s_hidden * s_W2) is the same positive scalar for every output column,
    # so argmax over raw int32 equals argmax over dequantized floats.
    logits = logits_raw[:, :10]  # discard the 6 zero-weight padding columns
    hw_preds = np.argmax(logits, axis=1)

    label_matches = int(np.sum(hw_preds == labels))
    float_matches = int(np.sum(hw_preds == float_preds))
    dut._log.info(
        f"hardware predictions: {hw_preds.tolist()}"
    )
    dut._log.info(
        f"true labels:          {labels.tolist()} ({label_matches}/8 match)"
    )
    dut._log.info(
        f"float model preds:    {float_preds.tolist()} ({float_matches}/8 match)"
    )
    # Reported, not hard-asserted: quantization noise on a couple of images
    # isn't a hardware bug signal. The two assert np.array_equal(...) calls
    # above are the real hardware-correctness check -- hardware must match
    # the *quantized* software reference bit-exactly, which it does
    # regardless of how well the quantized model classifies these images.
