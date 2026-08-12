# OpenLane 2 place & route for `pe.v` — design

## Context

Phase 3 kicked off with real sky130 area numbers from Yosys (`synth/synth_sky130_*.ys`, PR #22), but that
pass is honestly area-only — `abc` maps against a 100MHz target but prints no slack/critical-path summary.
Real timing closure needs a real STA tool, which is OpenLane's job (the Task Board's "Timing closure pass"
card was scoped for exactly this from the start). The Command Center's "next" note already flags this as
the immediate next step, blocked only on Docker Desktop running.

This is the first-ever OpenLane run in this repo, so the goal here is to get the flow itself working and
trustworthy on the smallest design (`pe.v`, 6,209.7 um^2 standalone per the Yosys pass) before scaling to
`gemm_tile` or `router` in a later card.

## Decisions

- **Target**: `rtl/pe.v` only, this pass. `gemm_tile`/`router` P&R stays a separate future Task Board card.
- **Flow**: OpenLane 2 (Python-based), not classic OpenLane — OpenLane 2 is the actively-maintained flow
  and the one Tiny Tapeout (the eventual Phase 3 stretch goal) now points submitters toward.
- **Install/run method**: Docker. OpenLane 2 ships a `efabless/openlane` Docker image; this keeps the
  existing Docker Desktop dependency the Command Center note already anticipated, avoids adding a new
  Nix toolchain entry, and is the most reproducible option (pinned image tag, not `:latest`).
- **PDK**: sky130hd (`sky130_fd_sc_hd`), same corner already used for the Yosys pass
  (tt, 25C, 1.80V) and same 100MHz / 10ns clock target, so the two passes' numbers are comparable.
  Note this is a *separate* PDK fetch from `synth/fetch_sky130.sh` (that script grabs the raw liberty file
  for Yosys; OpenLane 2 manages its own PDK volume via `openlane --pdk-root`).

## Layout

Mirrors the existing `synth/` convention: source/config committed, generated run artifacts gitignored.

```
openlane/
  pe/
    config.json     # DESIGN_NAME=pe, VERILOG_FILES=../../rtl/pe.v, CLOCK_PORT=clk, CLOCK_PERIOD=10
    reports/         # committed: final STA summary, DRC/LVS pass/fail, area — small text, like synth/reports/
  run_pe.sh          # thin wrapper: docker run ... openlane openlane/pe/config.json
```

`openlane/pe/runs/` (OpenLane's own timestamped run directory: GDS, DEF, full logs) is gitignored,
same treatment as `sim/` and `synth/lib/`.

## Execution

1. `docker pull efabless/openlane:<pinned-tag>` (pin a specific tag, not `:latest`, for reproducibility).
2. `./openlane/run_pe.sh` — runs the Docker container with the repo mounted, executing
   synth → floorplan → placement → CTS → routing → STA → DRC/LVS → GDS streamout in one shot against
   `openlane/pe/config.json`.
3. Requires Docker Desktop running locally first (already known blocker, per Command Center).

## Success criteria

- GDSII produced for `pe`.
- 0 DRC violations, 0 LVS mismatches.
- A real OpenSTA slack number at the 100MHz target — positive slack (met) or negative slack (a real,
  worth-logging result) both count as a successful run; the point is a real number replaces the
  area-only estimate.

## Docs / tracking

- `docs/decisions.md`: log the OpenLane-2-over-classic and Docker-over-Nix choices, with the "why" above.
- `docs/learnings.md`: log anything that breaks or surprises along the way, per the project's standing
  process (only once actually resolved).
- Notion Task Board: move "OpenLane place & route" (and "Timing closure pass" if the STA number lands
  clean) to Done with the real numbers, same pattern as the sky130 Yosys entries.
- After this lands: produce a Google-Docs-pastable notes writeup for the OpenLane step, in the exact
  format/style of the existing project notes doc (per-module code + `receives/does/hand off/why` bullet
  breakdown) — requested separately, not part of this implementation plan.

## Out of scope (this pass)

- `gemm_tile` and `router` P&R (future cards).
- Tiny Tapeout submission (separate Task Board card, depends on this).
- Yosys notes writeup (requested for later, separately from the OpenLane notes writeup).
