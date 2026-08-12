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
(`tb/`, `tb/array/`, `tb/tile/`, `tb/gemm/`, `tb/router/`, `tb/noc/`, `tb/mesh/`, `tb/mnist/`) with:

```
./test.sh
```

(equivalent to running `make` in each of those eight directories, but works from any directory/shell
state — see the `make -C` vs `cd && make` gotcha in `docs/learnings.md` if modifying it).

`sim/` (simulation build artifacts, gitignored) is created automatically on first `make` run.
`model/checkpoints/` and `model/.mnist_cache/` are also gitignored (only the frozen `.npz` is committed).

**Phase 2 is complete (2026-07-19); Phase 3 is in progress (sky130 Yosys synthesis done, OpenLane 2
P&R for `pe.v` done, `gemm_tile`/`router` P&R still to come).**
Phase 2's three strands, all landed:

- *Yosys synthesis (done, first pass):* `synth/synth.ys` / `synth/synth_pe.ys` synthesize
  `pe.v`/`systolic_array.v` to generic gates with zero errors; gate counts in `synth/reports/`. Real
  PDK-based area/timing stays Phase 3 scope (see `docs/decisions.md`, 2026-07-15 entry).
- *Self-feeding tile (2026-07-19):* the tile now runs a full tiled matmul with no Python orchestration.
  `rtl/skew_feeder.v` is the RTL "edge memory" replacing `feed_wave()` — a triangular bank of shift
  registers that skews/zero-pads an UNSKEWED operand block (A column-by-column, B row-by-row), wired to
  the array in `rtl/tile.v` (`tb/tile/`). `rtl/gemm_sequencer.v` is the control FSM replacing
  `compute_nblock()` — one `start` pulse computes one N-block (reset → `k_chunks` back-to-back 22-cycle
  waves, no reset between → `done`). `rtl/operand_mem.v` is the tile's operand buffer: a write/load port
  (addressed `chunk*N+col` slots, each an A-column + B-row) and a combinational read port the sequencer
  addresses via `rd_addr`. `rtl/gemm_tile.v` ties memory + FSM + tile together, so a tile now
  loads→computes→reads a full tiled GEMM through realistic ports (`tb/gemm/`: tiled GEMM for K=1,2,3,4,8 vs
  NumPy loaded through the write port, plus a back-to-back-N-block reset test). Still caller-side / out of
  scope: requantization (no datapath in `pe.v`). See `docs/decisions.md`, the three 2026-07-19 entries.
- *NoC (complete, 2026-07-19):* `rtl/router.v` is a single 2D-mesh router — 5 ports (Local/N/E/S/W), XY
  dimension-order routing, per-output round-robin arbitration, valid/ready backpressure, combinational
  single-cycle crossbar (`tb/router/`). Coordinates are input ports (`my_x`/`my_y`), not parameters — see
  the parameter-vs-cocotb gotcha in `docs/learnings.md`. Multi-tile integration: `rtl/flit_buf.v` (2-deep
  registered skid FIFO per mesh-side router input — breaks the combinational cycles a raw crossbar mesh
  would form), `rtl/noc_node.v` (router + buffers + `gemm_tile`, LOCAL port delivering flit payloads
  straight into `operand_mem`'s write port), `rtl/noc_pair.v` (two nodes over one east-west link,
  `tb/noc/`), and `rtl/noc_mesh2x2.v` (the full deliverable: four tiles in a 2x2 mesh, `tb/mesh/` —
  X-then-Y corner turns, concurrent cross-traffic from two corner injectors, converging-stream arbitration
  at a shared LOCAL port, all proven by bit-exact matmuls on every tile). Fully packetized: flits carry a
  2-bit type (OPERAND / GO / RESULT) — a GO descriptor (`{ret_y, ret_x, k_chunks}`) self-starts the tile,
  and a result-return engine in `noc_node` streams all 64 accumulator cells back to the GO's return
  address as RESULT flits (host-side `res00_*` ports on the mesh). The whole load→compute→collect loop
  runs with zero direct control wires (`tb/mesh/test_fully_packetized_load_go_result`); the direct
  start/`done`/`acc_out` ports remain functional alongside. See `docs/decisions.md`, 2026-07-19.

Phase 3's first physical-design strands, both landed:

- *sky130 Yosys synthesis (2026-07-19):* area-only real numbers for `pe`, `gemm_tile`, and `router`
  against the sky130hd standard-cell library — see `synth/reports/`, `docs/decisions.md`.
- *OpenLane 2 place & route for `pe.v` (2026-08-12, done):* the first real GDSII and real OpenSTA slack
  number in the repo. `openlane/pe/config.json` + `openlane/run_pe.sh` drive OpenLane 2.3.10 via its
  Docker backend against sky130A/`sky130_fd_sc_hd`, same tt/25C/1.80V corner and 100MHz/10ns target as the
  Yosys pass. Clean DRC (0) and LVS (0 mismatches), timing MET at the target corner (worst-case setup
  slack -3.20ns only at the deliberately pessimistic `max_ss_100C_1v60` sign-off corner). Real numbers and
  the two tooling snags hit along the way are in `openlane/pe/reports/summary.md`, `docs/decisions.md`,
  and `docs/learnings.md`. `gemm_tile`/`router` P&R stays a separate future card.

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
