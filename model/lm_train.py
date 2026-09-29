"""Train the float story model (spec section 1) with llama2.c's recipe for
stories260K (AdamW, lr 1e-3 with 1000 warmup iterations and cosine decay to
1e-4, beta2 0.99, weight decay 0.01 on matrices, gradient clip 1.0, effective
batch 128) at our context of 256, on MPS when available.

The effective batch of 128 windows is split into MICRO_BATCH-sized forward/
backward passes (accumulate_grads) so peak activation memory stays low; the
optimizer still steps once per 128-window batch. Training tokens are read
from a memmap (tinystories_data.load_tokens), never fully loaded into RAM.

Training can be paused on command: SIGINT/SIGTERM set a flag the loop checks
after every completed optimizer step, at which point it atomically saves a
full resume state (model, optimizer, RNGs, log) to out_dir/lm_train_state.pt
and exits. `--resume` restores that state -- including both RNG streams --
and continues from the saved iteration, bit-identical to an uninterrupted
run. Every eval also writes the model-only out_dir/lm_float.pt (the file
lm_quantize.py loads) and out_dir/lm_train_log.json.

    python lm_train.py --iters 200                     # timing run
    python lm_train.py --iters 100000                  # full run
    kill -TERM <pid>                                    # pause (no lost work)
    python lm_train.py --iters 100000 --resume          # continue"""

import argparse
import json
import math
import os
import resource
import signal
import time
from pathlib import Path

import numpy as np
import torch

from lm_net import StoryNet
from tinystories_data import eval_windows, load_tokens, sample_windows

CHECKPOINT_PATH = Path(__file__).parent / "checkpoints" / "lm_float.pt"
BATCH_SIZE = 128
MICRO_BATCH = 64
LR, MIN_LR, WARMUP = 1e-3, 1e-4, 1000
WEIGHT_DECAY = 0.01
BETAS = (0.9, 0.99)
GRAD_CLIP = 1.0
EVAL_EVERY = 2000
VAL_WINDOWS = 100 * BATCH_SIZE  # llama2.c evaluates 100 batches
SEED = 0

_STOP = False


def _request_stop(signum, frame):
    global _STOP
    _STOP = True


def _atomic_save(obj, path: Path):
    part = path.with_name(path.name + ".part")
    torch.save(obj, part)
    os.replace(part, path)


def _atomic_write_text(text: str, path: Path):
    part = path.with_name(path.name + ".part")
    part.write_text(text)
    os.replace(part, path)


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


def accumulate_grads(model, windows) -> float:
    """Backward the BATCH_SIZE `windows` as BATCH_SIZE / MICRO_BATCH
    micro-batches, each loss scaled by MICRO_BATCH / BATCH_SIZE before its
    own backward, so accumulated .grad equals one full-batch backward.
    Returns the mean loss over the full batch."""
    scale = MICRO_BATCH / BATCH_SIZE
    total = 0.0
    for i in range(0, len(windows), MICRO_BATCH):
        micro = windows[i : i + MICRO_BATCH]
        _, loss = model(micro[:, :-1], micro[:, 1:])
        (loss * scale).backward()
        total += loss.item() * len(micro)
    return total / len(windows)


def _save_checkpoint(out_dir, model, opt, it, total_iters, rng, log, *, write_log):
    model_state = model.state_dict()
    state = {
        "model": model_state,
        "opt": opt.state_dict(),
        "iter": it,
        "total_iters": total_iters,
        "np_rng": rng.bit_generator.state,
        "torch_rng": torch.get_rng_state(),
        "log": log,
    }
    _atomic_save(state, out_dir / "lm_train_state.pt")
    _atomic_save(model_state, out_dir / "lm_float.pt")
    if write_log:
        _atomic_write_text(json.dumps(log, indent=1), out_dir / "lm_train_log.json")


def train(total_iters, *, device, train_tokens, val_windows, out_dir, eval_every=EVAL_EVERY, resume=False) -> list[dict]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    state_path = out_dir / "lm_train_state.pt"

    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    model = StoryNet().to(device)
    decay = [p for p in model.parameters() if p.dim() >= 2]
    no_decay = [p for p in model.parameters() if p.dim() < 2]
    opt = torch.optim.AdamW(
        [{"params": decay, "weight_decay": WEIGHT_DECAY}, {"params": no_decay, "weight_decay": 0.0}],
        lr=LR, betas=BETAS,
    )

    start_iter, log = 0, []
    if resume:
        state = torch.load(state_path, map_location=device, weights_only=False)
        if state["total_iters"] != total_iters:
            raise SystemExit(
                f"--resume: saved run has total_iters={state['total_iters']}, but --iters {total_iters} "
                "was given -- the cosine schedule depends on total_iters"
            )
        model.load_state_dict(state["model"])
        opt.load_state_dict(state["opt"])
        rng.bit_generator.state = state["np_rng"]
        # torch.load(..., map_location=device) above moves every tensor in the
        # saved state onto that device, including this CPU-only RNG state
        # (torch.get_rng_state() always returns a CPU ByteTensor); set_rng_state
        # rejects anything else, so pull it back to CPU before restoring it.
        torch.set_rng_state(state["torch_rng"].cpu())
        start_iter, log = state["iter"], state["log"]

    step_time, step_count = 0.0, 0
    for it in range(start_iter, total_iters):
        for group in opt.param_groups:
            group["lr"] = lr_at(it, total_iters)

        t0 = time.perf_counter()
        w = torch.from_numpy(sample_windows(train_tokens, BATCH_SIZE, rng)).to(device)
        opt.zero_grad(set_to_none=True)
        mean_loss = accumulate_grads(model, w)
        torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
        opt.step()
        step_time += time.perf_counter() - t0
        step_count += 1

        last = it == total_iters - 1
        if (it + 1) % eval_every == 0 or last:
            entry = {
                "iter": it + 1,
                "train_loss": mean_loss,
                "val_loss": val_loss(model, device, val_windows),
                "ms_per_iter": step_time / step_count * 1000,
                "rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20,
            }
            if device == "mps":
                entry["mps_driver_mb"] = torch.mps.driver_allocated_memory() / 2**20
            log.append(entry)
            print(json.dumps(entry), flush=True)
            _save_checkpoint(out_dir, model, opt, it + 1, total_iters, rng, log, write_log=True)
            step_time, step_count = 0.0, 0

        if _STOP:
            _save_checkpoint(out_dir, model, opt, it + 1, total_iters, rng, log, write_log=False)
            print(json.dumps({"paused_at": it + 1}), flush=True)
            return log

    return log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, required=True)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--out-dir", type=Path, default=CHECKPOINT_PATH.parent)
    args = ap.parse_args()

    global _STOP
    _STOP = False
    signal.signal(signal.SIGINT, _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    train_tokens = load_tokens("train")
    val_windows = eval_windows(VAL_WINDOWS)
    train(args.iters, device=device, train_tokens=train_tokens, val_windows=val_windows,
          out_dir=args.out_dir, resume=args.resume)


if __name__ == "__main__":
    main()
