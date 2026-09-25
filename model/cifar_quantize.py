"""Quantize the trained CIFAR-10 network to the chip's int8 scheme (spec
section 1) and freeze model/cifar_quantized.npz, the input to the compiler
and the reference every later level must match.

- BatchNorm folded into each conv's weights and a bias.
- Conv weights: one symmetric scale per group of 8 output channels (one GO
  computes one group, so each group gets its own requant (m, sh)).
- fc weights: one per-tensor scale, since its logits come back raw and all
  groups must share units for the argmax.
- Activations: one symmetric per-tensor scale per layer, the 99.99th
  percentile of the float model's post-ReLU activations on calibration
  images (the input scale is exactly 1/128).
- Bias: carried by the GEMM in the bias slots, every K slot from the end
  of the taps to KS: the DMA emits the constant bias_val in each, and the
  weights carry one int8 bias row per slot, so the bias is bias_val times
  the rows' sum. The slots that pad K to a multiple of 8 come for free, and
  K grows by 8 only when they cannot hold the bias."""

import numpy as np
import torch

from cifar_data import load_cifar10
from cifar_net import INPUT_OFFSET, LAYERS, CifarNet, folded_layers, to_input
from cifar_reference import NPZ_PATH, predict
from cifar_train import CHECKPOINT_PATH, evaluate
from fixedpoint import quantize_multiplier

GROUP = 8
CALIB_IMAGES = 2000
CALIB_PERCENTILE = 99.99
N_FROZEN = 128
MAX_PRODUCT = 128 * 128  # worst-case |int8 x int8| per K slot


def group_weight_scales(W, per_group):
    """Per-output-channel scale (Cout,), constant within each 8-channel
    group (or across the tensor). A dead group borrows the largest scale
    in the tensor: its weights quantize to 0 either way, and its requant
    factor stays finite and positive."""
    absmax = np.abs(W).reshape(W.shape[0], -1).max(axis=1)
    if per_group:
        pad = (-len(absmax)) % GROUP
        g = np.pad(absmax, (0, pad)).reshape(-1, GROUP).max(axis=1)
        s = np.repeat(g, GROUP)[: len(absmax)] / 127.0
    else:
        s = np.full(len(absmax), absmax.max() / 127.0)
    if not s.max() > 0:
        raise ValueError("layer has no nonzero weights")
    return np.where(s > 0, s, s.max())


def activation_scale(acts, name):
    s = float(np.percentile(np.asarray(acts), CALIB_PERCENTILE)) / 127.0
    if not s > 0:
        raise ValueError(f"{name}: calibration activations are all zero")
    return s


def choose_bias(b_acc, n_free):
    """(bias_val, n_slots) for a bias of b_acc accumulator units: the fewest
    slots, starting from the n_free padding slots and growing by 8, whose
    smallest bias_val in [1, 127] holds every |round(b_acc / bias_val)| within
    127 * n_slots; the smallest bias_val is the most precise."""
    peak = float(np.abs(b_acc).max()) if b_acc.size else 0.0
    n_slots = n_free
    while peak > 127 * 127 * n_slots:
        n_slots += GROUP
    return max(1, int(np.ceil(peak / (127 * n_slots)))), n_slots


def split_bias(total, n_slots):
    """Split integer bias totals (Cout,) into n_slots int8 rows that sum to
    them exactly, as evenly as possible."""
    total = np.asarray(total, dtype=np.int64)
    base, extra = np.divmod(total, n_slots)
    rows = base[None, :] + (np.arange(n_slots)[:, None] < extra[None, :])
    assert np.abs(rows).max(initial=0) <= 127, "bias row outside int8"
    return rows.astype(np.int8)


def quantize_layer(W, b, s_in, s_out, per_group, cin_pad, cout_pad, name):
    """One layer's frozen tensors: int8 weights padded to (cout_pad, cin_pad,
    k, k), the int8 bias rows (n_slots, cout_pad) and their bias_val, and for
    requantized layers (s_out not None) the per-group (m, sh)."""
    s_w = group_weight_scales(W, per_group)
    wq = np.clip(np.round(W / s_w[:, None, None, None]), -127, 127)
    b_acc = b / (s_in * s_w)
    tap_slots = cin_pad * W.shape[2] * W.shape[3]
    bias_val, n_slots = choose_bias(b_acc, GROUP - tap_slots % GROUP)
    out = {
        "w": np.zeros((cout_pad, cin_pad) + W.shape[2:], dtype=np.int8),
        "bias": np.zeros((n_slots, cout_pad), dtype=np.int8),
        "bias_val": bias_val,
    }
    out["w"][: W.shape[0], : W.shape[1]] = wq
    out["bias"][:, : len(b)] = split_bias(np.round(b_acc / bias_val), n_slots)
    k_slots = tap_slots + n_slots
    assert k_slots * MAX_PRODUCT < 2**31, f"{name}: accumulator could overflow int32"
    if s_out is not None:
        s_pad = np.pad(s_w, (0, cout_pad - len(s_w)), constant_values=s_w.max())
        mults = [quantize_multiplier(s_in * s_pad[GROUP * g] / s_out) for g in range(cout_pad // GROUP)]
        out["m"] = np.array([m for m, _ in mults])
        out["sh"] = np.array([sh for _, sh in mults])
    return out


def main():
    model = CifarNet()
    model.load_state_dict(torch.load(CHECKPOINT_PATH))
    model.eval()
    train_x, _, test_x, test_y = load_cifar10()

    with torch.no_grad():
        feats = model.features(to_input(train_x[:CALIB_IMAGES]))
    s_act = [1.0 / INPUT_OFFSET] + [activation_scale(f.numpy(), l.name) for f, l in zip(feats[:-1], LAYERS)]

    frozen = {}
    for i, (layer, (W, b)) in enumerate(zip(LAYERS, folded_layers(model))):
        is_fc = layer.name == "fc"
        cin_pad = 1 << (layer.cin - 1).bit_length()
        cout_pad = -(-layer.cout // 16) * 16 if is_fc else layer.cout
        q = quantize_layer(W, b, s_act[i], None if is_fc else s_act[i + 1], not is_fc, cin_pad, cout_pad, layer.name)
        frozen.update({f"{layer.name}_{k}": v for k, v in q.items()})

    float_acc = evaluate(model, test_x, test_y, "cpu")
    with torch.no_grad():
        float_preds = model(to_input(test_x[:N_FROZEN])).argmax(1).numpy()
    frozen.update(
        s_act=np.array(s_act),
        test_images=test_x[:N_FROZEN],
        test_labels=test_y[:N_FROZEN].astype(np.int64),
        float_preds=float_preds.astype(np.int64),
        float_test_acc=float_acc,
    )
    frozen["int8_preds"] = predict(frozen, test_x[:N_FROZEN]).astype(np.int64)
    np.savez_compressed(NPZ_PATH, **frozen)
    print(f"saved {NPZ_PATH}; float test accuracy {float_acc * 100:.2f}%")
    for layer in LAYERS:
        L = layer.name
        print(f"{L}: bias_val={frozen[f'{L}_bias_val']} bias slots={len(frozen[f'{L}_bias'])}")


if __name__ == "__main__":
    main()
