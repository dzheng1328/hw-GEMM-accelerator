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
(`tb/`, `tb/array/`, `tb/tile/`, `tb/operand_mem/`, `tb/gemm/`, `tb/router/`, `tb/noc/`, `tb/mesh/`,
`tb/mnist/`) with:

```
./test.sh
```

(equivalent to running `make` in each of those nine directories, but works from any directory/shell
state — see the `make -C` vs `cd && make` gotcha in `docs/learnings.md` if modifying it).
As of issue #32 (2026-09-02), `tb/gemm/`, `tb/noc/`, and `tb/mesh/` are *expected* to fail - this is not a
regression.
`operand_mem.v`'s read is now registered (real SRAM macro timing), and `gemm_sequencer.v` has not yet
been updated to compensate for the added latency; that ripple is issue #33's job.

`sim/` (simulation build artifacts, gitignored) is created automatically on first `make` run.
`model/checkpoints/` and `model/.mnist_cache/` are also gitignored (only the frozen `.npz` is committed).

**Phase 2 is complete (2026-07-19); Phase 3 is in progress (Phase 3.1 -- pipeline `pe.v`'s MAC datapath --
is complete as of 2026-08-29: OpenLane 2 P&R confirms full timing closure on the pipelined design, and
Yosys area numbers are re-synthesized and up to date. Phase 3.2 -- SRAM-macro `operand_mem` -- closed
2026-09-02 (issue #31): a real macro is generated with a documented DRC/LVS gap, see below. Issue #32
(wiring that macro's real, synchronous read timing behind `operand_mem`'s existing port interface) is
also closed as of 2026-09-02: `rtl/operand_mem.v` now instantiates `sky130_sram_512b_1rw_64x64` (real
macro for synthesis, `tb/operand_mem/sram_macro_behavioral.v` stand-in for simulation), with a registered
one-cycle read (`RD_LATENCY`) in place of the old combinational read. `gemm_sequencer.v` has not yet been
updated for the new latency (issue #33), so `tb/gemm/`, `tb/noc/`, and `tb/mesh/` are expected to fail
until #33 lands -- see the note above `./test.sh`. `gemm_tile`/`router` P&R are still to come).**
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
  Yosys pass. Clean DRC (0) and LVS (0 mismatches), timing MET at the target corner with +3.11ns of real
  setup margin. A timing-closure pass (2026-08-12) root-caused the worst-case sign-off corner's negative
  slack to `pe.v`'s single-cycle, unpipelined multiply-accumulate datapath (confirmed via the actual
  critical-path report, not guessed) and recovered slack from -3.20ns to -2.21ns at the pessimistic
  `max_ss_100C_1v60` corner by correcting an unrealistically conservative default SDC I/O-delay
  assumption (`IO_DELAY_CONSTRAINT: 10`) — full closure at that corner would require pipelining `pe.v`'s
  MAC datapath, a separate future architecture card, not a P&R tuning fix. Real numbers, the diagnosis,
  and the two tooling snags hit along the way are in `openlane/pe/reports/summary.md`,
  `docs/decisions.md`, and `docs/learnings.md`. `gemm_tile`/`router` P&R stays a separate future card.
- *MAC pipelining (2026-08-27, done):* `pe.v`'s multiply-accumulate datapath is now pipelined
  (`ACC_LATENCY=2`) to address the closure gap above, with `PE_ACC_LATENCY` threaded into
  `gemm_sequencer.v`'s drain-window sizing; all cocotb suites (`tb/`, `tb/array/`, `tb/tile/`, `tb/gemm/`,
  `tb/router/`, `tb/noc/`, `tb/mesh/`, `tb/mnist/`) pass.
- *OpenLane re-verification on the pipelined `pe.v` (2026-08-29, done -- issue #30):*
  re-ran the same OpenLane 2 flow against the pipelined RTL. Full multi-corner PVT sign-off sweep now
  closes with positive setup slack everywhere -- the previously-violating `max_ss_100C_1v60` corner
  recovered from -2.21ns to +0.4510ns, and the target tt/25C/1.80V corner improved from +3.11ns to
  +4.8612ns. DRC/LVS/antenna clean (0/0/0), the 3 prior max-fanout violations are gone, and post-P&R area
  shrank (6,865.33/14,313.7/18,523.1 um^2 instance/core/die, down from 10,312.4/21,620.7/26,787 um^2) since
  the pipeline needs far less resizer timing-repair buffering. Real numbers in
  `openlane/pe/reports/summary.md` and `docs/decisions.md` (2026-08-29 entry).
- *Yosys re-synth on the pipelined `pe.v` (2026-08-29, done -- closes Phase 3.1/issue #29):* re-ran
  `synth/synth_pe.ys` and `synth/synth_sky130_pe.ys` against the pipelined RTL. Sky130-mapped chip area
  went *down* despite the added pipeline registers: 6,209.7 um^2 (pre-pipeline) -> 4,996.0 um^2
  (pipelined), a 19.5% decrease, because the shorter per-stage combinational depth lets `abc`'s
  delay-driven mapping pick smaller/slower cells instead of paying an area premium to close a single
  deep multiply-accumulate cone -- same effect the OpenLane pass above found post-P&R, now confirmed
  pre-P&R too. Real numbers in `synth/reports/pe_synth.log`, `synth/reports/pe_sky130.log`, and
  `docs/decisions.md` (2026-08-29 entry). This closes out Phase 3.1 end to end.
- *SRAM macro for `operand_mem` (2026-09-02, done -- closes Phase 3.2/issue #31):* generated a real
  512b/1RW/64x64 sky130 SRAM macro with OpenRAM (`openram/config_operand_bank.py` +
  `openram/run_operand_sram.sh`, `words_per_row=2` to route around an OpenRAM v1.2.48 no-mux router bug,
  pinned to OpenRAM `stable`@`b2b069c` to pick up three real upstream fixes). Real GDS/LEF/Verilog/
  Liberty/datasheet outputs exist for the first time (`openram/runs/sky130_sram_512b_1rw_64x64/`,
  gitignored). DRC and LVS were both run to real completion via two independent open-source toolchains
  (Magic/netgen and KLayout, native via Homebrew) -- neither is clean, but both concentrate their real
  findings in the same narrow, vendor-supplied `sky130_fd_bd_sram` primitive-cell family that uses
  foundry-internal GDS layers the open sky130 PDK doesn't publish, not in this project's own config, RTL,
  or scripts. Closed as a documented, cross-tool-confirmed upstream open-source-PDK limitation rather than
  a clean pass -- see `docs/decisions.md`, 2026-09-01 and 2026-09-02 entries, and `docs/learnings.md`,
  2026-09-02 entry (a plausible-looking case-sensitivity diagnosis from an earlier session, disproven by
  direct experiment rather than trusted). Issue #32 (wrap the macro behind `operand_mem`'s existing
  write/load + `rd_addr` read port, including the real synchronous-read latency adaptation) is next.

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

**Phase 3.1-3.4 execution** (pipeline `pe.v`, SRAM-macro `operand_mem`, `gemm_tile`/`router` P&R, Tiny
Tapeout) is tracked separately as [GitHub milestones](https://github.com/dzheng1328/hw-GEMM-accelerator/milestones)
+ issues, surfaced on the [Phase 3 Roadmap project board](https://github.com/users/dzheng1328/projects/2) —
set up 2026-08-26 once the timing-closure and SRAM-macro findings became concrete, PR-sized next steps
rather than open-ended Notion cards. Notion stays the source of truth for Phase 1/2 history and
day-to-day quick notes; this GitHub-native tracker is specifically for the milestone-shaped work ahead.

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
