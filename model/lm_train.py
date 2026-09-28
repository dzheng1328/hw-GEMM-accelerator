"""Train the float story model (spec section 1) with llama2.c's recipe for
stories260K (AdamW, lr 1e-3 with 1000 warmup iterations and cosine decay to
1e-4, beta2 0.99, weight decay 0.01 on matrices, gradient clip 1.0, batch
128) at our context of 256, on MPS when available. Writes
model/checkpoints/lm_float.pt and lm_train_log.json (gitignored).

    python lm_train.py --iters 200        # timing run
    python lm_train.py --iters 100000     # full run"""

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch

from lm_net import StoryNet
from tinystories_data import eval_windows, load_tokens, sample_windows

CHECKPOINT_PATH = Path(__file__).parent / "checkpoints" / "lm_float.pt"
LOG_PATH = CHECKPOINT_PATH.with_name("lm_train_log.json")
BATCH_SIZE = 128
LR, MIN_LR, WARMUP = 1e-3, 1e-4, 1000
WEIGHT_DECAY = 0.01
BETAS = (0.9, 0.99)
GRAD_CLIP = 1.0
EVAL_EVERY = 2000
VAL_WINDOWS = 100 * BATCH_SIZE  # llama2.c evaluates 100 batches
SEED = 0


def lr_at(it, total):
    if it < WARMUP:
        return LR * (it + 1) / WARMUP
    frac = (it - WARMUP) / max(1, total - WARMUP)
    return MIN_LR + 0.5 * (LR - MIN_LR) * (1 + math.cos(math.pi * min(1.0, frac)))


@torch.no_grad()
def val_loss(model, device, windows) -> float:
    model.eval()
    total = 0.0
    for i in range(0, len(windows), BATCH_SIZE):
        w = torch.from_numpy(windows[i : i + BATCH_SIZE]).to(device)
        total += float(model(w[:, :-1], w[:, 1:])[1]) * len(w)
    model.train()
    return total / len(windows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, required=True)
    args = ap.parse_args()
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    train, val = load_tokens("train"), eval_windows(VAL_WINDOWS)
    model = StoryNet().to(device)
    decay = [p for p in model.parameters() if p.dim() >= 2]
    no_decay = [p for p in model.parameters() if p.dim() < 2]
    opt = torch.optim.AdamW([{"params": decay, "weight_decay": WEIGHT_DECAY}, {"params": no_decay, "weight_decay": 0.0}],
                            lr=LR, betas=BETAS)
    log, t0 = [], time.time()
    for it in range(args.iters):
        for group in opt.param_groups:
            group["lr"] = lr_at(it, args.iters)
        w = torch.from_numpy(sample_windows(train, BATCH_SIZE, rng)).to(device)
        _, loss = model(w[:, :-1], w[:, 1:])
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
        opt.step()
        last = it == args.iters - 1
        if (it + 1) % EVAL_EVERY == 0 or last:
            ms = (time.time() - t0) * 1000 / (it + 1)
            entry = {"iter": it + 1, "train_loss": loss.item(), "val_loss": val_loss(model, device, val), "ms_per_iter": ms}
            log.append(entry)
            print(json.dumps(entry), flush=True)
            CHECKPOINT_PATH.parent.mkdir(exist_ok=True)
            torch.save(model.state_dict(), CHECKPOINT_PATH)
            LOG_PATH.write_text(json.dumps(log, indent=1))


if __name__ == "__main__":
    main()
