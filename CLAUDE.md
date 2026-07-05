# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The cocotb + Icarus Verilog sim environment is up and running: `rtl/pe.v` (a placeholder MAC processing
element), `tb/test_pe.py` (a cocotb reset-to-zero testbench), and `tb/Makefile` now exist and pass. Run
the test suite with:

```
cd tb && make
```

`model/` and `sim/` (simulation build artifacts, gitignored) don't exist yet — `sim/` is created
automatically on first `make` run. Once the real 8x8 systolic tile and PyTorch training/quantization
scripts land, this section should be updated again.

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

## Docs workflow

Two logs in `docs/` are part of the working process, not just reference material:

- `docs/decisions.md` — log architectural decisions as they're made (context, options considered,
  decision, why). Add an entry whenever a non-trivial design choice is made.
- `docs/learnings.md` — log real problems hit and how they were solved (phase, problem, cause, fix,
  takeaway). Add an entry whenever something breaks or takes longer than expected. Quick scratch notes
  can live elsewhere and get distilled into an entry here once the problem is actually resolved.

Both files use a template at the top and add new entries most-recent-first below the `<!-- Entries
below, most recent first -->` marker.
