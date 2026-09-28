"""The direct NumPy integer story model: level 2 of the 4.3 verification
ladder (spec section 5), the definition of correct tokens that the
compiler's golden executor and then the RTL must equal bit-exactly.

Only model/fixedpoint.py operations on int64 arrays; floats appear only in
val_loss_int, which dequantizes logits to report a loss. One code path,
block_q over positions pos0 .. pos0 + T - 1 with a KV cache, serves both
teacher-forced sequences (T = CTX from an empty cache) and one-token decode
steps (T = 1), so the loss gate measures the model that generates."""

from pathlib import Path

import numpy as np

from fixedpoint import (quantize_multiplier, requant, requant16, rmsnorm_q, rope_q, sample_q, silu_mul_q,
                        silu_table, softmax_q)
from lm_spec import BATCH, CTX, DIM, GROUP, HEAD_DIM, HIDDEN, KV_DIM, N_HEADS, N_KV_HEADS, N_LAYERS, VOCAB

NPZ_PATH = Path(__file__).parent / "lm_quantized.npz"
REP = N_HEADS // N_KV_HEADS
MATRICES = {"wq": (DIM, DIM), "wk": (KV_DIM, DIM), "wv": (KV_DIM, DIM), "wo": (DIM, DIM),
            "w1": (HIDDEN, DIM), "w3": (HIDDEN, DIM), "w2": (DIM, HIDDEN)}


def check_int32(acc, name):
    if acc.size and (acc.max() >= 2**31 or acc.min() < -(2**31)):
        raise ValueError(f"{name}: accumulator outside int32")
    return acc


def matmul_q(q, name, x, out16=False):
    """x (..., K) int8 times q[name] (N, K) int8, requantized per 8-row group."""
    acc = check_int32(np.asarray(x, dtype=np.int64) @ q[name].astype(np.int64).T, name)
    m, sh = np.repeat(q[f"{name}_m"], GROUP), np.repeat(q[f"{name}_sh"], GROUP)
    return requant16(acc, m, sh) if out16 else requant(acc, m, sh, relu=False)


def scalar(q, name):
    return int(q[f"{name}_m"]), int(q[f"{name}_sh"])


def new_cache(batch):
    return {"k": np.zeros((N_LAYERS, batch, CTX, N_KV_HEADS, HEAD_DIM), dtype=np.int64),
            "v": np.zeros((N_LAYERS, batch, CTX, N_KV_HEADS, HEAD_DIM), dtype=np.int64)}


def embed_q(q, tokens):
    return requant16(q["emb"][np.asarray(tokens)].astype(np.int64), *scalar(q, "emb"))


def block_q(q, l, x, pos0, cache):
    """One transformer layer on residual x (B, T, DIM) int16 at positions
    pos0 .. pos0 + T - 1, writing their K and V into the cache."""
    L = f"l{l}_"
    B, T, _ = x.shape
    pos = np.arange(pos0, pos0 + T)
    cos, sin = q["rope_cos"][pos][None, :, None, :], q["rope_sin"][pos][None, :, None, :]
    h = rmsnorm_q(x, int(q["eps_q"]), *scalar(q, L + "norm1"))
    qh = rope_q(matmul_q(q, L + "wq", h).reshape(B, T, N_HEADS, HEAD_DIM), cos, sin)
    cache["k"][l, :, pos] = rope_q(matmul_q(q, L + "wk", h).reshape(B, T, N_KV_HEADS, HEAD_DIM), cos, sin).transpose(1, 0, 2, 3)
    cache["v"][l, :, pos] = matmul_q(q, L + "wv", h).reshape(B, T, N_KV_HEADS, HEAD_DIM).transpose(1, 0, 2, 3)
    P = pos0 + T
    K = np.repeat(cache["k"][l, :, :P], REP, axis=2)
    V = np.repeat(cache["v"][l, :, :P], REP, axis=2)
    acc = check_int32(np.einsum("bthd,bphd->bhtp", qh, K), L + "score")
    scores = requant16(acc, *scalar(q, L + "score"))
    valid = pos[:, None] >= np.arange(P)[None, :]
    p = softmax_q(scores, valid[None, None], *scalar(q, L + "exp"))
    att = requant(check_int32(np.einsum("bhtp,bphd->bthd", p, V), L + "att"), *scalar(q, L + "att"), relu=False)
    x = np.clip(x + matmul_q(q, L + "wo", att.reshape(B, T, DIM), out16=True), -32768, 32767)
    h = rmsnorm_q(x, int(q["eps_q"]), *scalar(q, L + "norm2"))
    hh = silu_mul_q(matmul_q(q, L + "w1", h), matmul_q(q, L + "w3", h), q[L + "silu_table"], *scalar(q, L + "silu"))
    return np.clip(x + matmul_q(q, L + "w2", hh, out16=True), -32768, 32767)


def logits_q(q, x):
    return matmul_q(q, "cls", rmsnorm_q(x, int(q["eps_q"]), *scalar(q, "normf")), out16=True)


def forward_seq(q, tokens):
    tokens = np.asarray(tokens)
    cache = new_cache(tokens.shape[0])
    x = embed_q(q, tokens)
    for l in range(N_LAYERS):
        x = block_q(q, l, x, 0, cache)
    return logits_q(q, x)


def generate(q, prompt_ids, n_steps, inv_temp, seeds):
    """Token log (n_steps + 1, B): row 0 is the prompt's first token; at step
    t the model reads row t and row t + 1 is the prompt's next token while
    the prompt lasts, otherwise a sample (spec section 3, SAMPLE)."""
    prompt_ids, state = np.asarray(prompt_ids), np.asarray(seeds, dtype=np.int64)
    B = len(state)
    log = np.zeros((n_steps + 1, B), dtype=np.int64)
    log[0] = prompt_ids[0]
    cache = new_cache(B)
    for t in range(n_steps):
        x = embed_q(q, log[t][:, None])
        for l in range(N_LAYERS):
            x = block_q(q, l, x, t, cache)
        if t + 1 < len(prompt_ids):
            log[t + 1] = prompt_ids[t + 1]
        else:
            log[t + 1], state = sample_q(logits_q(q, x)[:, 0], inv_temp, *scalar(q, "logit_exp"), state)
    return log


def val_loss_int(q, windows, chunk=8) -> float:
    """Teacher-forced cross-entropy of the integer model's dequantized logits."""
    total = 0.0
    for i in range(0, len(windows), chunk):
        w = windows[i : i + chunk]
        z = forward_seq(q, w[:, :-1]) * float(q["s_logit"])
        z -= z.max(-1, keepdims=True)
        logp = z - np.log(np.exp(z).sum(-1, keepdims=True))
        total -= np.take_along_axis(logp, w[:, 1:, None], -1).sum()
    return total / (len(windows) * (windows.shape[1] - 1))


def random_quantized(seed) -> dict:
    """A synthetic dict with the frozen npz's keys and plausible ranges, for
    tests that must not depend on the trained model."""
    rng = np.random.default_rng(seed)
    q = {}
    mul = lambda M: quantize_multiplier(M)  # noqa: E731
    for l in range(N_LAYERS):
        for name, (n, k) in MATRICES.items():
            q[f"l{l}_{name}"] = rng.integers(-127, 128, (n, k))
            ms = [mul(rng.uniform(0.5, 2) / (k * 16)) for _ in range(n // GROUP)]
            q[f"l{l}_{name}_m"], q[f"l{l}_{name}_sh"] = np.array([m for m, _ in ms]), np.array([s for _, s in ms])
        for name, M in (("norm1", 32.0), ("norm2", 32.0), ("score", 1 / 64), ("exp", 0.02 * 1.4427 * 65536),
                        ("att", 1 / 127), ("silu", 1 / 256)):
            q[f"l{l}_{name}_m"], q[f"l{l}_{name}_sh"] = mul(M)
        q[f"l{l}_silu_table"] = silu_table(0.05, 6.4 / 32767)
    q["emb"], q["cls"] = rng.integers(-127, 128, (VOCAB, DIM)), rng.integers(-127, 128, (VOCAB, DIM))
    q["emb_m"], q["emb_sh"] = mul(64.0)
    ms = [mul(1 / 64) for _ in range(VOCAB // GROUP)]
    q["cls_m"], q["cls_sh"] = np.array([m for m, _ in ms]), np.array([s for _, s in ms])
    q["normf_m"], q["normf_sh"] = mul(32.0)
    q["logit_exp_m"], q["logit_exp_sh"] = mul(0.01 * 1.4427 * 65536)
    q["eps_q"] = 1
    from fixedpoint import rope_table

    q["rope_cos"], q["rope_sin"] = rope_table(CTX, HEAD_DIM, 10000.0)
    q["s_logit"] = 0.01
    return q
