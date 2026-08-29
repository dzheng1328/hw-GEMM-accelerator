# Select and generate the sky130 SRAM macro for `operand_mem` — design

Issue: [#31](https://github.com/dzheng1328/hw-GEMM-accelerator/issues/31) (Phase 3.2 milestone).

## Context

The 2026-07-19 sky130 Yosys pass (`docs/decisions.md`) found that `operand_mem` — today a flop-based
register file, two banks (`a_ram`, `b_ram`), each `DEPTH = N*KMAX = 64` words of `8*N = 64` bits —
costs 309,457 um^2, 42.5% of `gemm_tile`'s area, almost as much as all 64 PEs combined (405,028 um^2,
55.6%). `rtl/operand_mem.v`'s own header comment already anticipated this: "a synchronous SRAM is a
drop-in for synthesis later." Issue #31 is the first concrete step: pick a real SRAM generation path
and produce an actual macro, sized and documented as a real architecture decision rather than a
mechanical swap.

This is scoped to *generating* the macro only. Wiring it into `operand_mem.v`'s port interface (#32),
adapting `gemm_sequencer`/`skew_feeder` timing for its registered read latency (#33), a cocotb
behavioral model (#34), and blackbox-instantiating it in Yosys/OpenLane to measure the real area win
(#35) are separate issues in the same Phase 3.2 milestone and are explicitly out of scope here.

## Sizing math

`operand_mem` at its current, only-ever-used configuration (`N=8, KMAX=8`):

- `DEPTH = N * KMAX = 64` words per bank
- word width per bank = `8*N = 64` bits
- two identical banks (`a_ram`, `b_ram`) → `64 * 64 * 2 = 8,192` bits total, matching the
  "8,192 enable-DFFs" figure already in `docs/decisions.md`.

Both banks are the same shape, so one macro geometry, instantiated twice, covers the whole module —
no need to generate two different configs.

## Options considered

**Generation path:**
- **(chosen) Run OpenRAM locally, targeting sky130A, to generate a macro sized exactly to `operand_mem`'s
  real 64x64 geometry.** Gives honest sizing math and a macro that matches the design instead of one
  padded to fit a stock part. OpenRAM isn't installed in this environment, but it has an official Docker
  image (`vlsida/openram-ubuntu:latest`, from `VLSIDA/openram-docker-image`) bundling OpenRAM plus the
  magic/klayout/ngspice dependencies it needs for characterization — the same shape of problem this repo
  already solved for OpenLane (`openlane/run_pe.sh`, and the native-install pain documented in
  `docs/learnings.md` that motivated using Docker there in the first place).
- **Reuse a pre-built sky130 SRAM macro** (e.g. the OpenRAM-generated macros in
  `efabless/sky130_sram_macros`, used by Caravel/efabless projects). Confirmed by inspecting a real
  example (`sky130_sram_2kbyte_1rw1r_32x512_8`): these are OpenRAM output committed to a repo, sized in
  the kilobyte-plus range (32x512 words = 2KB, vs. our ~1KB total need across two banks) — using one
  here would mean oversizing/padding rather than an exact fit, and would misrepresent the "real
  numbers, not guessed" standard this repo holds itself to (`docs/decisions.md` repeatedly emphasizes
  measured over assumed numbers). Rejected.
- **Nix-based OpenRAM install** (`nix develop`, mentioned in OpenRAM's own docs). Nix isn't installed
  in this environment either, and adding a second heavy toolchain manager alongside Docker (already
  used for OpenLane) is unnecessary — Docker alone covers this. Rejected in favor of the Docker image.

**Bank layout:**
- **(chosen) Two identical 64-word x 64-bit macro instances**, one per bank (A, B). Matches
  `operand_mem`'s existing structure exactly; only one macro geometry needs generating/characterizing.
- **One combined 64x128 macro** holding both A-column and B-row per slot in one word. Fewer instances,
  but bakes the A+B pairing into the memory itself and reshapes `operand_mem`'s port structure more than
  this stage needs. Rejected — no benefit that offsets the extra design surface.

**Port configuration:**
- **(chosen) Single-port (1RW).** `operand_mem`'s actual usage is strictly phase-separated: operands
  load fully (writes) before a compute run starts (reads) — confirmed by reading `rtl/gemm_tile.v` and
  `rtl/noc_node.v`, where `wr_en` only ever fires from the OPERAND-flit delivery path and `start`/`done`
  gate the read-driving sequencer, with no code path that drives `wr_addr` and `rd_addr` in the same
  cycle. A 1RW macro matches this exactly, is the simplest OpenRAM config, and gives the smallest/fastest
  macro.
- **Dual-port (1RW1R).** Would leave room for future write/read overlap (e.g. streaming the next
  N-block's operands in while the current one computes), but nothing in the repo does this today or has
  a concrete plan to. Larger area and characterization cost for a capability with no current consumer.
  Rejected — YAGNI; if overlapped load/compute becomes a real feature, that's a new architecture card
  (and likely a new macro generation) at that point.

**Corner coverage:**
- **(chosen) Single TT / 25C / 1.8V corner for this issue.** Matches this repo's established discipline
  of measuring only what the current stage needs (the 2026-07-19 sky130 Yosys pass explicitly reported
  "area only, honestly" and deferred timing to the OpenLane stage). Full multi-corner characterization,
  if `gemm_tile` P&R sign-off (issue #36) needs it, is that issue's scope, not this one's.

## Design

### 1. OpenRAM config

`openram/config_operand_bank.py`, verified against real OpenRAM example configs (parameter names
confirmed via VLSIDA/OpenRAM examples, not guessed):

```python
word_size = 64
num_words = 64
num_rw_ports = 1
num_r_ports = 0
num_w_ports = 0
tech_name = "sky130A"
process_corners = ["TT"]
supply_voltages = [1.8]
output_name = "sky130_sram_512b_1rw_64x64"
output_path = "openram/runs/sky130_sram_512b_1rw_64x64"
```

### 2. Docker wrapper

`openram/run_operand_sram.sh`, mirroring `openlane/run_pe.sh`'s shape: pulls
`vlsida/openram-ubuntu:latest`, mounts the repo, sets `OPENRAM_HOME`/`OPENRAM_TECH`, and invokes
OpenRAM's CLI entry point against `openram/config_operand_bank.py`. The exact CLI invocation gets
pinned down against OpenRAM's real interface during implementation (its docs are thin on this point;
verify by reading the tool's own `--help` inside the container rather than guessing the flags).

### 3. Output handling

`openram/runs/sky130_sram_512b_1rw_64x64/` (the full OpenRAM output — `.gds`, `.lef`,
`.lib` at the TT corner, `.v` behavioral model, `.sp`/`.lvs.sp` netlists, logs — confirmed against a
real example macro's file listing) is gitignored, same treatment as `openlane/pe/runs/`: a deterministic
regeneration from the checked-in config, not something to carry in git.

Committed:
- `openram/config_operand_bank.py`, `openram/run_operand_sram.sh` — the reproducible recipe
- `openram/reports/summary.md` — real generated numbers (macro area in um^2, word/port config, corner),
  same pattern as `openlane/pe/reports/summary.md`
- A `docs/decisions.md` entry logging the sizing math, the options above, and the real area number

### 4. What "done" looks like

- `openram/run_operand_sram.sh` runs to completion against a fresh checkout (Docker pull + OpenRAM run)
  and produces `.gds`/`.lef`/`.lib`/`.v` for a 64x64 1RW sky130A macro
- `openram/reports/summary.md` states the real generated area, matched against the sizing math above
- `docs/decisions.md` gets an entry: context, options considered (as above), decision, and the real
  number, following this repo's existing decision-log format
- `CLAUDE.md`'s Phase 3 status line reflects issue #31 as done, Phase 3.2 in progress

## Out of scope (deferred to their own issues)

- Wiring the macro into `operand_mem.v`'s actual read/write ports, including muxing `wr_addr`/`rd_addr`
  onto the macro's single shared address bus (a real consequence of the 1RW choice above) — issue #32.
- Adapting `gemm_sequencer.v`/`skew_feeder.v` timing for the macro's registered (1-cycle-latency) read
  instead of today's combinational read — issue #33.
- A cocotb behavioral sim model / testbench updates — issue #34. Note: OpenRAM's own `.v` output *is* a
  behavioral model, so #34 may end up thinner than its title implies, but that's #34's call, not #31's.
- Blackbox-instantiating the macro in Yosys/OpenLane and measuring the real `gemm_tile` area win, and
  any multi-corner characterization that P&R sign-off turns out to need — issue #35/#36.
