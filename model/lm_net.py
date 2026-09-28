"""The float 4.3 story model (spec section 1): a llama2.c-style
transformer. RMSNorm, RoPE on adjacent pairs, grouped-query attention (query
head h reads KV head h // 2), SwiGLU, no biases, output tied to the token
embedding. `probe` records activations for calibration (lm_quantize.py);
with a probe the attention is computed explicitly so scores are visible,
otherwise by scaled_dot_product_attention."""

import math

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from lm_spec import CTX, DIM, HEAD_DIM, HIDDEN, N_HEADS, N_KV_HEADS, N_LAYERS, NORM_EPS, ROPE_THETA, VOCAB

PROBE_SAMPLES = 1_000_000


class Probe:
    """|activation| samples by name, deterministic subsampling."""

    def __init__(self):
        self.samples = {}

    def __call__(self, name, t):
        a = t.detach().abs().flatten().float().cpu().numpy()
        if a.size > PROBE_SAMPLES:
            a = a[:: a.size // PROBE_SAMPLES]
        self.samples.setdefault(name, []).append(a)

    def absmax(self, name) -> float:
        return float(max(a.max() for a in self.samples[name]))

    def percentile(self, name, pct) -> float:
        return float(np.percentile(np.concatenate(self.samples[name]), pct))


def rope_cos_sin(ctx):
    freqs = 1.0 / ROPE_THETA ** (torch.arange(0, HEAD_DIM, 2, dtype=torch.float64) / HEAD_DIM)
    ang = torch.arange(ctx, dtype=torch.float64)[:, None] * freqs[None, :]
    return torch.cos(ang).float(), torch.sin(ang).float()


def apply_rope(x, cos, sin):
    x0, x1 = x[..., 0::2], x[..., 1::2]
    return torch.stack((x0 * cos - x1 * sin, x0 * sin + x1 * cos), dim=-1).flatten(-2)


class RMSNorm(nn.Module):
    def __init__(self):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(DIM))

    def forward(self, x, probe=None, name=None):
        z = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + NORM_EPS)
        if probe is not None:
            probe(name, z)
        return z * self.weight


class Attention(nn.Module):
    def __init__(self):
        super().__init__()
        self.wq = nn.Linear(DIM, N_HEADS * HEAD_DIM, bias=False)
        self.wk = nn.Linear(DIM, N_KV_HEADS * HEAD_DIM, bias=False)
        self.wv = nn.Linear(DIM, N_KV_HEADS * HEAD_DIM, bias=False)
        self.wo = nn.Linear(N_HEADS * HEAD_DIM, DIM, bias=False)

    def forward(self, x, cos, sin, probe=None, name=None):
        B, T, _ = x.shape
        q = apply_rope(self.wq(x).view(B, T, N_HEADS, HEAD_DIM), cos, sin)
        k = apply_rope(self.wk(x).view(B, T, N_KV_HEADS, HEAD_DIM), cos, sin)
        v = self.wv(x).view(B, T, N_KV_HEADS, HEAD_DIM)
        rep = N_HEADS // N_KV_HEADS
        q, k, v = q.transpose(1, 2), k.repeat_interleave(rep, 2).transpose(1, 2), v.repeat_interleave(rep, 2).transpose(1, 2)
        if probe is None:
            att = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        else:
            for n, t in (("q", q), ("k", k), ("v", v)):
                probe(f"{name}.{n}", t)
            s = q @ k.transpose(-2, -1) / math.sqrt(HEAD_DIM)
            probe(f"{name}.score", s.masked_select(torch.ones(T, T, dtype=torch.bool, device=x.device).tril()))
            s = s.masked_fill(~torch.ones(T, T, dtype=torch.bool, device=x.device).tril(), float("-inf"))
            att = F.softmax(s, dim=-1) @ v
        att = att.transpose(1, 2).reshape(B, T, DIM)
        if probe is not None:
            probe(f"{name}.att", att)
        return self.wo(att)


class FeedForward(nn.Module):
    def __init__(self):
        super().__init__()
        self.w1 = nn.Linear(DIM, HIDDEN, bias=False)
        self.w2 = nn.Linear(HIDDEN, DIM, bias=False)
        self.w3 = nn.Linear(DIM, HIDDEN, bias=False)

    def forward(self, x, probe=None, name=None):
        g, u = self.w1(x), self.w3(x)
        h = F.silu(g) * u
        if probe is not None:
            probe(f"{name}.g", g)
            probe(f"{name}.u", u)
            probe(f"{name}.h", h)
        return self.w2(h)


class Block(nn.Module):
    def __init__(self):
        super().__init__()
        self.attention_norm, self.attention = RMSNorm(), Attention()
        self.ffn_norm, self.feed_forward = RMSNorm(), FeedForward()

    def forward(self, x, cos, sin, probe=None, name=None):
        x = x + self.attention(self.attention_norm(x, probe, f"{name}.norm1"), cos, sin, probe, name)
        if probe is not None:
            probe("resid", x)
        x = x + self.feed_forward(self.ffn_norm(x, probe, f"{name}.norm2"), probe, name)
        if probe is not None:
            probe("resid", x)
        return x


class StoryNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.tok_embeddings = nn.Embedding(VOCAB, DIM)
        self.layers = nn.ModuleList(Block() for _ in range(N_LAYERS))
        self.norm = RMSNorm()
        self.output = nn.Linear(DIM, VOCAB, bias=False)
        self.output.weight = self.tok_embeddings.weight
        cos, sin = rope_cos_sin(CTX)
        self.register_buffer("cos", cos, persistent=False)
        self.register_buffer("sin", sin, persistent=False)
        self.apply(self._init)
        for name, p in self.named_parameters():  # llama2.c's scaled residual-projection init
            if name.endswith(("w3.weight", "wo.weight")):
                nn.init.normal_(p, 0.0, 0.02 / math.sqrt(2 * N_LAYERS))

    @staticmethod
    def _init(mod):
        if isinstance(mod, (nn.Linear, nn.Embedding)):
            nn.init.normal_(mod.weight, 0.0, 0.02)

    def forward(self, tokens, targets=None, probe=None):
        T = tokens.shape[1]
        cos, sin = self.cos[None, :T, None, :], self.sin[None, :T, None, :]
        x = self.tok_embeddings(tokens)
        if probe is not None:
            probe("resid", x)
        for i, layer in enumerate(self.layers):
            x = layer(x, cos, sin, probe, f"l{i}")
        logits = self.output(self.norm(x, probe, "normf"))
        if probe is not None:
            probe("logits", logits)
        loss = None if targets is None else F.cross_entropy(logits.reshape(-1, VOCAB), targets.reshape(-1))
        return logits, loss


@torch.no_grad()
def generate(model, prompt_ids, n_new, temperature, seed):
    """Float sampling for eyeballing stories (not bit-exact to anything)."""
    g = torch.Generator().manual_seed(seed)
    ids = list(prompt_ids)
    for _ in range(n_new):
        logits = model(torch.tensor([ids[-CTX:]]))[0][0, -1]
        if temperature == 0:
            nxt = int(logits.argmax())
        else:
            nxt = int(torch.multinomial(F.softmax(logits / temperature, -1), 1, generator=g))
        ids.append(nxt)
    return ids
