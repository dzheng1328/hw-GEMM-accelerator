"""Quantize the trained float story model to the chip's integer scheme (spec
section 1) and freeze model/lm_quantized.npz, the input to the compiler and
the data lm_reference.py runs on.

- Weights: symmetric int8, one scale per group of 8 output channels (one GO
  computes one group, so each group gets its own requant (m, sh)).
- RMSNorm gains are folded into the columns of the next matmul, so the
  normalized activation is quantized before its gain. The final norm's gain
  is folded into a separate classifier matrix: the int8 model stores the
  embedding table and the classifier as two tables.
- Activations: static per-tensor scales calibrated on held-out stories (int8
  tensors at a percentile of |a|, int16 tensors at their absolute maximum).
- The residual stream is int16 with one scale for the whole network, so the
  o-proj and down-proj outputs add into it directly; attention scores and
  logits are int16 too.

Gate: the integer model's teacher-forced validation loss within GATE of the
float model's, on the same windows."""

import sys

import numpy as np
import sentencepiece as spm
import torch

import lm_reference as ref
from fixedpoint import quantize_multiplier, rope_table, silu_table
from lm_net import Probe, StoryNet
from lm_spec import BATCH, BOS, CTX, GROUP, HEAD_DIM, N_LAYERS, NORM_EPS, PROMPT, ROPE_THETA, VOCAB
from lm_train import CHECKPOINT_PATH
from tinystories_data import TOKENIZER_PATH, eval_windows, load_tokens, sample_windows

CALIB_WINDOWS = 64
CALIB_SEED = 4321  # distinct from tinystories_data.EVAL_SEED
CALIB_PERCENTILE = 99.99
EVAL_WINDOWS = 128
GATE = 0.10
LOG2E_Q16 = 1.4426950408889634 * 65536
SEED = 0


def group_scales(W):
    """Per-row scale (rows,), constant within each group of 8 rows. A dead
    group borrows the largest scale: its weights quantize to 0 either way,
    and its requant factor stays finite and positive."""
    absmax = np.abs(W).max(axis=1)
    g = absmax.reshape(-1, GROUP).max(axis=1)
    s = np.repeat(g, GROUP) / 127.0
    if not s.max() > 0:
        raise ValueError("matrix has no nonzero weights")
    return np.where(s > 0, s, s.max())


def quantize_matrix(W, s_in, s_out):
    """int8 weights (rows, cols) and the per-group (m, sh) mapping an int32
    accumulator in units of s_in * s_w to an output in units of s_out."""
    s_w = group_scales(W)
    wq = np.clip(np.round(W / s_w[:, None]), -127, 127).astype(np.int8)
    ms = [quantize_multiplier(s_in * s_w[GROUP * g] / s_out) for g in range(len(W) // GROUP)]
    return wq, np.array([m for m, _ in ms], dtype=np.int64), np.array([sh for _, sh in ms], dtype=np.int64)


def int8_scale(probe, name, pct):
    s = probe.percentile(name, pct) / 127.0
    if not s > 0:
        raise ValueError(f"{name}: calibration activations are all zero")
    return s


def int16_scale(probe, name):
    s = probe.absmax(name) / 32767.0
    if not s > 0:
        raise ValueError(f"{name}: calibration activations are all zero")
    return s


def scalar_mul(frozen, name, M):
    frozen[f"{name}_m"], frozen[f"{name}_sh"] = quantize_multiplier(M)


def quantize_model(model, probe, pct=CALIB_PERCENTILE) -> dict:
    """The frozen tensors for `model`, calibrated by `probe` (a Probe that
    has seen the float model run on held-out windows)."""
    sd = {k: v.detach().double().numpy() for k, v in model.state_dict().items()}
    s_r = int16_scale(probe, "resid")
    q = {}
    emb = sd["tok_embeddings.weight"]
    s_e = np.abs(emb).max() / 127.0
    q["emb"] = np.clip(np.round(emb / s_e), -127, 127).astype(np.int8)
    scalar_mul(q, "emb", s_e / s_r)
    q["eps_q"] = max(1, round(NORM_EPS / s_r**2))

    for l in range(N_LAYERS):
        L, P = f"l{l}_", f"layers.{l}."
        s_n1, s_n2 = int8_scale(probe, f"l{l}.norm1", pct), int8_scale(probe, f"l{l}.norm2", pct)
        s_q, s_k, s_v = (int8_scale(probe, f"l{l}.{n}", pct) for n in "qkv")
        s_score, s_att = int16_scale(probe, f"l{l}.score"), int8_scale(probe, f"l{l}.att", pct)
        s_g, s_u, s_h = (int8_scale(probe, f"l{l}.{n}", pct) for n in "guh")
        g1, g2 = sd[P + "attention_norm.weight"], sd[P + "ffn_norm.weight"]
        scalar_mul(q, L + "norm1", 1 / s_n1)
        scalar_mul(q, L + "norm2", 1 / s_n2)
        for name, key, gain, s_in, s_out in (
            ("wq", "attention.wq", g1, s_n1, s_q), ("wk", "attention.wk", g1, s_n1, s_k),
            ("wv", "attention.wv", g1, s_n1, s_v), ("wo", "attention.wo", None, s_att, s_r),
            ("w1", "feed_forward.w1", g2, s_n2, s_g), ("w3", "feed_forward.w3", g2, s_n2, s_u),
        ):
            W = sd[P + key + ".weight"]
            W = W if gain is None else W * gain[None, :]
            q[L + name], q[L + name + "_m"], q[L + name + "_sh"] = quantize_matrix(W, s_in, s_out)
        scalar_mul(q, L + "score", s_q * s_k / np.sqrt(HEAD_DIM) / s_score)
        scalar_mul(q, L + "exp", s_score * LOG2E_Q16)
        scalar_mul(q, L + "att", s_v / 127.0 / s_att)
        grid = np.arange(-128, 128) * s_g
        s_t = float(np.abs(grid / (1 + np.exp(-grid))).max()) / 32767.0
        q[L + "silu_table"] = silu_table(s_g, s_t)
        scalar_mul(q, L + "silu", s_t * s_u / s_h)
        q[L + "w2"], q[L + "w2_m"], q[L + "w2_sh"] = quantize_matrix(sd[P + "feed_forward.w2.weight"], s_h, s_r)

    s_nf, s_logit = int8_scale(probe, "normf", pct), int16_scale(probe, "logits")
    scalar_mul(q, "normf", 1 / s_nf)
    q["cls"], q["cls_m"], q["cls_sh"] = quantize_matrix(emb * sd["norm.weight"][None, :], s_nf, s_logit)
    scalar_mul(q, "logit_exp", s_logit * LOG2E_Q16)
    q["rope_cos"], q["rope_sin"] = rope_table(CTX, HEAD_DIM, ROPE_THETA)
    q["s_logit"] = s_logit
    return q


def float_val_loss(model, windows, chunk=32) -> float:
    total = 0.0
    with torch.no_grad():
        for i in range(0, len(windows), chunk):
            w = torch.as_tensor(windows[i : i + chunk])
            total += model(w[:, :-1], w[:, 1:])[1].item() * len(w)
    return total / len(windows)


def calibrate(model, windows, chunk=16) -> Probe:
    probe = Probe()
    with torch.no_grad():
        for i in range(0, len(windows), chunk):
            model(torch.as_tensor(windows[i : i + chunk, :-1]), probe=probe)
    return probe


def load_float_model(path=CHECKPOINT_PATH) -> StoryNet:
    model = StoryNet()
    sd = torch.load(path, map_location="cpu", weights_only=False)
    model.load_state_dict(sd.get("model", sd))
    return model.eval()


def main(pct=CALIB_PERCENTILE, freeze=True):
    model = load_float_model()
    val = load_tokens("val")
    calib = sample_windows(val, CALIB_WINDOWS, np.random.default_rng(CALIB_SEED))
    windows = eval_windows(EVAL_WINDOWS)
    q = quantize_model(model, calibrate(model, calib), pct)
    f_loss, i_loss = float_val_loss(model, windows), ref.val_loss_int(q, windows)
    print(f"percentile {pct}: float val loss {f_loss:.4f}, int val loss {i_loss:.4f}, gap {i_loss - f_loss:+.4f} (gate {GATE})")
    if not freeze:
        return f_loss, i_loss
    if i_loss - f_loss > GATE:
        sys.exit("gate missed; not freezing")
    sp = spm.SentencePieceProcessor(model_file=str(TOKENIZER_PATH))
    frozen = dict(q)
    frozen.update(
        vocab=np.array([sp.id_to_piece(i) for i in range(VOCAB)]),
        prompt_ids=np.array([BOS] + sp.encode(PROMPT), dtype=np.int64),
        seeds=np.random.default_rng(SEED).integers(1, 2**32, BATCH, dtype=np.int64),
        float_val_loss=f_loss, int_val_loss=i_loss,
    )
    np.savez_compressed(ref.NPZ_PATH, **frozen)
    print(f"saved {ref.NPZ_PATH}")


if __name__ == "__main__":
    main(*(float(a) for a in sys.argv[1:2]))
