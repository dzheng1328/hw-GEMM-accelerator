"""Level 4 of the story-model ladder, reported (milestone 4.3g): tb/accel's four story runs (test_accel.py,
LM_RESULTS) combined into docs/perf/lm.json, rendered as docs/perf/lm.md, and exported as docs/perf/lm_trace.json
for the portfolio app.

    python lm_report.py combine docs/perf/lm.json 2x2_t0.json 2x2_t256.json 1x1_t256.json 4x4_t256.json
    python lm_report.py render docs/perf/lm.json > docs/perf/lm.md
    python lm_report.py trace docs/perf/lm.json > docs/perf/lm_trace.json

The runs are 2x2 at temperature 0 and 1.0 (the headline mesh) and 1x1 and 4x4 at 1.0 (the scaling table). Every
run has already passed its bit-exact checks inside the testbench; combine adds the cross-run checks."""

import json
import sys

import numpy as np

from cifar_report import check_split
from lm_perf import CATEGORIES, add, categories, check_categories
from scaling_report import MERMAID_INIT

REQUIRED = (("2x2", 0), ("2x2", 256), ("1x1", 256), ("4x4", 256))
HEADLINE = "2x2_t256"
BENCHMARK_LOSS = 1.297  # llama2.c's stories260K validation loss (spec 4.3 section 1)
BUCKET = 32  # steps per row of the cost-by-position table


def key(mesh, inv_temp):
    return f"{mesh}_t{inv_temp}"


def tiles(r):
    return len(r["mesh_perf"]["feed_cyc"])


def interval_sum(r):
    whole = r["tail"]
    for d in reversed(r["step_deltas"]):
        whole = add(d, whole)
    return whole


def check_run(r, where):
    check_split(r["counters"], where)
    if len(r["step_deltas"]) != r["steps"]:
        raise ValueError(f"{where}: {len(r['step_deltas'])} step intervals for {r['steps']} steps")
    for n, d in enumerate(r["step_deltas"]):
        check_categories(d, f"{where} step {n}")
    check_categories(r["tail"], f"{where} tail")
    whole = interval_sum(r)
    want = {"cmd": {**r["counters"], **r["attn"]}, "vpu": r["vpu"],
            "feed": r["mesh_perf"]["feed_cyc"], "busy": r["mesh_perf"]["busy_cyc"]}
    if whole != want:
        raise ValueError(f"{where}: the step intervals and the tail do not sum to the run's counters")
    if sum(r["mesh_perf"]["feed_cyc"]) != r["counters"]["slot_cyc"]:
        raise ValueError(f"{where}: tiles fed a different number of slots than the DMA sent")
    if any(len(s) != r["steps"] + 1 for s in r["tokens"]) or len(r["tokens"]) != 8:
        raise ValueError(f"{where}: the token log is not 8 stories of {r['steps'] + 1} tokens")


def combine(records):
    """The four runs keyed by `mesh_tinv_temp`, after checking each and the runs against one another."""
    runs = {key(r["mesh"], r["inv_temp"]): r for r in records}
    if len(runs) != len(records):
        raise ValueError("two records for the same mesh and temperature")
    missing = [key(*k) for k in REQUIRED if key(*k) not in runs]
    if missing or len(runs) != len(REQUIRED):
        raise ValueError(f"missing or extra runs: want {[key(*k) for k in REQUIRED]}, missing {missing}")
    if len({r["steps"] for r in runs.values()}) != 1:
        raise ValueError("the runs have different step counts")
    for k, r in runs.items():
        check_run(r, k)
    t0 = runs[key("2x2", 0)]["tokens"]
    if any(s != t0[0] for s in t0):
        raise ValueError("temperature 0: the 8 stories differ (same prompt, argmax ignores the seeds)")
    t1 = runs[HEADLINE]["tokens"]
    if all(s == t1[0] for s in t1):
        raise ValueError("temperature 1.0: all 8 stories are identical, so the per-story seeds are unused")
    for k in ("1x1_t256", "4x4_t256"):
        if runs[k]["tokens"] != t1:
            raise ValueError(f"{k}: the token log differs from 2x2's (the mesh must change the schedule, never the result)")
    return {"runs": runs}


def pct(x):
    return f"{100 * x:.1f}%"


def story_texts(pieces, tokens):
    from lm_tok import decode

    return [decode(pieces, s) for s in tokens]


def story_end(log):
    """The step that sampled the BOS ending a lane's story (row n of the token log is step n - 1's sample), or None.
    As model/lm_tok.py decodes it: the model, trained on llama2.c's BOS-delimited stories, ends a story with a BOS
    and never samples an EOS, which the decoder skips."""
    from lm_spec import BOS

    return next((n - 1 for n, t in enumerate(log) if n > 0 and t == BOS), None)


def quote(text):
    """A Markdown blockquote with one quoted paragraph per line of the story (a bare `>` line between them, as a
    single newline inside a quote would join the paragraphs), each without its trailing space."""
    return "\n>\n".join("> " + p.strip() for p in text.split("\n") if p.strip())


def whole_categories(r):
    return categories(interval_sum(r))


def render(combined, q):
    from isa import VOP_NAMES

    runs = combined["runs"]
    head, cold = runs[HEADLINE], runs[key("2x2", 0)]
    steps = head["steps"]
    texts = story_texts(q["vocab"], head["tokens"])
    cats = whole_categories(head)
    run = head["cycles"]
    floss, iloss = float(q["float_val_loss"]), float(q["int_val_loss"])
    by_tiles = sorted(runs.values(), key=lambda r: (tiles(r), r["mesh"]))
    one = next(r for r in by_tiles if r["mesh"] == "1x1")
    lines = [
        "# Stories on the chip",
        "",
        "Generated by `make lm` in `tb/accel/` (`tb/accel/lm_report.py`); do not edit by hand.",
        "",
        f"The frozen story model ran on `rtl/accel.v` for {steps} steps from one `start` pulse: 8 stories decoded in parallel, one per B lane, the same prompt in every lane.",
        "Every run's final memories are bit-exact against `compiler/golden.py`, and its token log and K/V caches are bit-exact against `model/lm_reference.py` (the ladder's levels 3 and 2).",
        "The four runs: 2x2 at temperature 0 and 1.0, and 1x1 and 4x4 at 1.0.",
        "",
        "## Results (2x2, temperature 1.0)",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Decode steps | {steps} |",
        f"| Cycles | {run:,} |",
        f"| Cycles per step (8 tokens, one per story) | {run / steps:,.0f} |",
        f"| Cycles per token (per story) | {run / (8 * steps):,.0f} |",
        f"| OPERAND slot utilization | {pct(head['slot_utilization'])} |",
        f"| MAC utilization per tile | {pct(sum(head['mesh_perf']['feed_cyc']) / (tiles(head) * run))} |",
        f"| Cycles at temperature 0 (same mesh) | {cold['cycles']:,} |",
        "",
        "## Stories (temperature 1.0)",
        "",
        "Each story is one B lane's token log, decoded by `model/lm_tok.py`; a story ends at the next BOS, after which the lane starts a new one (not shown).",
        "A story with no BOS stops where the run does, after its last step, often mid-word.",
        "The prompt is the same in every lane; the per-lane seeds make the stories differ.",
        "",
    ]
    for n, text in enumerate(texts):
        end = story_end(head["tokens"][n])
        lines += [f"**Story {n}**" + (f" (ends at step {end})" if end is not None else ""), "", quote(text), ""]
    cold_text = story_texts(q["vocab"], cold["tokens"])[0]
    cold_end = story_end(cold["tokens"][0])
    lines += [
        "## Temperature 0",
        "",
        "At temperature 0 the sampler is argmax and ignores the per-lane seeds, so with one prompt the 8 stories are identical by construction.",
        "That run is a bit-exactness check (the token log equals the reference's), not 8 samples.",
        "The one story" + (f" (ends at step {cold_end}):" if cold_end is not None else ":"),
        "",
        quote(cold_text),
        "",
        "## Where the cycles go (2x2, temperature 1.0)",
        "",
        "Run cycles by category, from `rtl/cmd_perf.v` and `rtl/vpu_perf.v` (every category counted at node (0,0)'s injection port or at the VPU's busy line; the rows sum to 100%).",
        "*Attention* is every cycle inside the program's attention loops (the QK^T and AV BLOCKs, their bookkeeping and the WAIT that drains them); *VPU* is the VPU's busy cycles; *weight matmuls* are the other cycles with a flit at the injection port or stalled; *other* is the rest (the command processor's ALU and loop commands, drains, credit stalls).",
        "",
        "| Category | Cycles | Share |",
        "|---|---:|---:|",
    ]
    lines += [f"| {c} | {cats[c]:,} | {pct(cats[c] / run)} |" for c in CATEGORIES]
    lines += ["", "VPU busy cycles by sub-op:", "", "| Sub-op | Cycles | Share of run |", "|---|---:|---:|"]
    lines += [f"| {VOP_NAMES[i]} | {head['vpu'][i]:,} | {pct(head['vpu'][i] / run)} |" for i in range(1, 10)]
    lines += ["", f"Cost by position ({BUCKET}-step buckets; attention grows with the context, the weight matmuls do not):", "",
              "| Steps | Cycles per step | " + " | ".join(CATEGORIES) + " |", "|---|---:|" + "---:|" * len(CATEGORIES)]
    series = []
    for lo in range(0, steps, BUCKET):
        hi = min(lo + BUCKET, steps)
        total = {c: 0 for c in CATEGORIES}
        cyc = 0
        for d in head["step_deltas"][lo:hi]:
            cat = categories(d)
            cyc += d["cmd"]["run_cyc"]
            for c in CATEGORIES:
                total[c] += cat[c]
        series.append(cyc / (hi - lo))
        lines.append(f"| {lo}-{hi - 1} | {cyc / (hi - lo):,.0f} | " + " | ".join(pct(total[c] / cyc) for c in CATEGORIES) + " |")
    labels = [f"{lo}" for lo in range(0, steps, BUCKET)]
    lines += ["", "Cycles per step by position (mean over each bucket):", "", "```mermaid", MERMAID_INIT, "xychart-beta",
              '    title "Cycles per decode step"',
              f'    x-axis "First step of the {BUCKET}-step bucket" [' + ", ".join(f'"{x}"' for x in labels) + "]",
              f'    y-axis "Cycles per step" 0 --> {int(-(-max(series) * 1.1 // 10_000) * 10_000)}',
              "    line [" + ", ".join(f"{v:.0f}" for v in series) + "]", "```", "",
              "## Scaling (temperature 1.0)", "",
              "| Mesh | Tiles | Cycles | Cycles per step | Cycles per token | Speedup vs 1x1 | MAC utilization per tile | Corner injection busy |",
              "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for r in (r for r in by_tiles if r["inv_temp"] == 256):
        corner = r["mesh_perf"]["corner"]
        lines.append(f"| {r['mesh']} | {tiles(r)} | {r['cycles']:,} | {r['cycles'] / steps:,.0f} | {r['cycles'] / (8 * steps):,.0f} | "
                     f"{one['cycles'] / r['cycles']:.2f}x | {pct(sum(r['mesh_perf']['feed_cyc']) / (tiles(r) * r['cycles']))} | "
                     f"{pct(corner['lcl_in_xfer'] / r['cycles'])} |")
    lines += [
        "",
        "## Model quality",
        "",
        f"Teacher-forced validation loss: float {floss:.3f}, int8 reference {iloss:.3f} (gap {iloss - floss:.2f}, gate 0.10).",
        f"For context, llama2.c's `stories260K` publishes {BENCHMARK_LOSS}; ours is not a like-for-like match (context 256 against 512, FFN width 192 against 172, our own training run), so it is an outside benchmark of the same kind, not a claim of equality.",
        "",
        "The model, the quantization and the reference are `model/`; the machine-readable trace for the portfolio app is `docs/perf/lm_trace.json`.",
    ]
    return "\n".join(lines) + "\n"


def trace(combined, q):
    """The portfolio app's input: config, stories, per-step cycles and breakdown and per-tile busy cycles from the
    headline run's counter snapshots, and story 0's attention probabilities from model/lm_reference.py (bit-exact
    with the RTL by the ladder)."""
    import lm_reference
    from lm_tok import decode

    head = combined["runs"][HEADLINE]
    steps = head["steps"]
    prompt, seeds = np.asarray(q["prompt_ids"]), np.asarray(q["seeds"])
    log, probs = lm_reference.generate(q, prompt, steps, head["inv_temp"], seeds, return_probs=True)
    if not np.array_equal(log, np.array(head["tokens"]).T):
        raise ValueError("model/lm_reference.py's tokens differ from the chip's")
    stories = [{"tokens": s, "text": decode(q["vocab"], s), "end_step": story_end(s)} for s in head["tokens"]]
    return {
        "config": {"mesh": head["mesh"], "inv_temp": head["inv_temp"], "steps": steps,
                   "prompt_ids": [int(x) for x in prompt], "seeds": [int(x) for x in seeds],
                   "float_val_loss": float(q["float_val_loss"]), "int_val_loss": float(q["int_val_loss"])},
        "stories": stories,
        "steps": [{"step": n, "cycles": d["cmd"]["run_cyc"], "categories": categories(d), "tile_busy": d["busy"]}
                  for n, d in enumerate(head["step_deltas"])],
        "meshes": {k: {"cycles": r["cycles"], "cycles_per_step": r["cycles"] / steps} for k, r in combined["runs"].items()},
        "attention": {"source": "model/lm_reference.py (bit-exact with the RTL by the verification ladder)",
                      "story": 0, "units": "integers 0..127, 1/127 each",
                      "layout": "probs[step][layer][head] is a list over positions 0..step",
                      "probs": [[layer.tolist() for layer in step_probs] for step_probs in probs]},
    }


def load_q():
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "model"))
    from lm_reference import NPZ_PATH

    return dict(np.load(NPZ_PATH))


if __name__ == "__main__":
    if sys.argv[1] == "combine":
        recs = []
        for p in sys.argv[3:]:
            with open(p) as f:
                recs.append(json.load(f))
        with open(sys.argv[2], "w") as f:
            json.dump(combine(recs), f, separators=(",", ":"))
    elif sys.argv[1] == "render":
        with open(sys.argv[2]) as f:
            sys.stdout.write(render(json.load(f), load_q()))
    elif sys.argv[1] == "trace":
        with open(sys.argv[2]) as f:
            sys.stdout.write(json.dumps(trace(json.load(f), load_q()), separators=(",", ":")))
    else:
        sys.exit(__doc__)
