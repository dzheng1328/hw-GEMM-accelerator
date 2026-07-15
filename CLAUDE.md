# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Phase 1 is functionally complete.** Two RTL modules exist, both fully tested: `rtl/pe.v` (a single
signed 8-bit MAC processing element, with registered `a_out`/`b_out` forwarding ports) and
`rtl/systolic_array.v` (an 8x8 output-stationary systolic array built from `pe.v`, using a flattened-bus
port scheme and a skewed/zero-padded input convention — see `docs/decisions.md` for the dataflow and
port-representation reasoning). `model/` now has a real, trained, quantized MNIST MLP
(`model/train.py` + `model/quantize.py` → the frozen, committed `model/mnist_quantized.npz`), and
`tb/mnist/test_mnist.py` drives a batch of 8 real MNIST test images through the hardware tile end-to-end
— tiling each layer's matmul into repeated 8x8x8 waves (see `docs/decisions.md` for the tiling/
quantization scheme), checking hardware output against a NumPy reference bit-exactly, and reporting
classification accuracy against both true labels and the original float model. Run the full test suite
(`tb/`, `tb/array/`, `tb/mnist/`) with:

```
./test.sh
```

(equivalent to running `make` in each of those three directories, but works from any directory/shell
state — see the `make -C` vs `cd && make` gotcha in `docs/learnings.md` if modifying it).

`sim/` (simulation build artifacts, gitignored) is created automatically on first `make` run.
`model/checkpoints/` and `model/.mnist_cache/` are also gitignored (only the frozen `.npz` is committed).

**Phase 2 has started (2026-07-15), two tracks in parallel:** generic Yosys synthesis of the existing
Phase 1 tile is done — `synth/synth.ys` / `synth/synth_pe.ys` synthesize `pe.v`/`systolic_array.v` to
generic gates with zero errors; real gate-count numbers are in `synth/reports/`, real PDK-based
area/timing stays Phase 3 scope (see `docs/decisions.md`, 2026-07-15 entry). The multi-tile NoC track
(topology, arbitration/routing logic, and replacing the testbench's Python `feed_wave`/`compute_nblock`
orchestration with a real RTL controller) is still at the design-decision stage — not started yet.

## What this is

A systolic-array-based hardware accelerator (Verilog, verified via cocotb simulation) that classifies
MNIST digits using a real trained neural network. It's a portfolio project for RTL/logic design
internship recruiting — the goal is a working, verifiable hardware design, not a production product.

## Planned repo layout

```
rtl/          Verilog source
tb/           cocotb testbenches
model/        PyTorch training + quantization scripts
sim/          simulation build artifacts (gitignored)
docs/         learnings log, design decisions
```

## Toolchain

| Tool | Role |
|---|---|
| Verilog | hardware description language — the design itself |
| Icarus Verilog / Verilator | simulate the design |
| cocotb | Python-based testbenches |
| GTKWave | waveform viewing / debugging |
| PyTorch | train + quantize the reference model |
| Yosys | synthesis to gate-level netlist |
| OpenLane | physical design / layout (Phase 3) |

## Phases

- **Phase 1 — core deliverable**: a single verified 8x8 systolic array tile, running real MNIST
  classification, with a cocotb testbench.
- **Phase 2 — scale up**: multiple tiles connected by a simple network-on-chip (NoC), plus Yosys
  synthesis for real area/timing numbers.
- **Phase 3 — stretch goal**: full OpenLane physical design flow, possible Tiny Tapeout submission.

Know which phase current work belongs to — Phase 1 work should stay scoped to a single tile plus its
testbench, not anticipate NoC or synthesis concerns.

## Progress tracking

Task/todo tracking for this project lives in Notion, not in this repo:

- [Project Command Center](https://app.notion.com/p/394babf197c281faac5bf1a34edafdfd) — phase roadmap,
  current status, and "the one thing to do next."
- [Task Board](https://app.notion.com/p/922728572a194814b639f3c5de984c41) — the live task tracker
  (Backlog → In progress → Verified → Done), embedded at the bottom of the Command Center page.

Quick/messy notes get captured in Notion first; resolved, polished versions get written into
`docs/learnings.md` and `docs/decisions.md` in this repo.

## Git workflow

Work lands via feature branches + PRs, not direct commits to `main` — adopted 2026-07-05 once the
project moved past initial scaffolding, to keep the git history reviewable (a real portfolio signal,
not just process for its own sake).

- **Granularity**: roughly one branch/PR per Notion Task Board card (or other self-contained chunk of
  work) — matches the size of commits made so far (e.g. the whole "Build 8x8 systolic array" card was
  one PR-sized change), not one PR per tiny edit.
- **Branch naming**: short, descriptive, kebab-case (e.g. `feature/systolic-array`, `fix/valid-in-gating`).
- **Flow**: branch off `main` → implement + commit → push the branch → open a PR (`gh pr create`) with a
  summary and test plan, same format as any other PR → once the test suite passes, merge it (`gh pr
  merge`) and delete the branch. Claude Code merges PRs itself once tests pass, without waiting for a
  separate manual review step each time — the user reviews plans/diffs before implementation happens,
  not the PR after the fact. Say so explicitly if a specific PR should be held for manual review instead.
- Docs updates (`docs/decisions.md`, `docs/learnings.md`, `CLAUDE.md` status) ride along in the same
  branch/PR as the change they document, same as before.

## Docs workflow

Two logs in `docs/` are part of the working process, not just reference material:

- `docs/decisions.md` — log architectural decisions as they're made (context, options considered,
  decision, why). Add an entry whenever a non-trivial design choice is made.
- `docs/learnings.md` — log real problems hit and how they were solved (phase, problem, cause, fix,
  takeaway). Add an entry whenever something breaks or takes longer than expected. Quick scratch notes
  can live elsewhere and get distilled into an entry here once the problem is actually resolved.

Both files use a template at the top and add new entries most-recent-first below the `<!-- Entries
below, most recent first -->` marker.
