# Select and Generate the sky130 SRAM Macro for `operand_mem` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a real sky130A single-port SRAM macro (via OpenRAM, Docker-backed) sized exactly to
`operand_mem`'s 64-word x 64-bit bank geometry, and document the real generated numbers and the
generation-path decision.

**Architecture:** OpenRAM runs entirely inside the official `vlsida/openram-ubuntu` Docker image (no
native/Nix install), driven by one checked-in config (`openram/config_operand_bank.py`) and one wrapper
script (`openram/run_operand_sram.sh`), mirroring the `openlane/run_pe.sh` pattern already in this repo.
One macro geometry is generated once; `operand_mem.v`'s two banks (`a_ram`, `b_ram`) will each get their
own instance of it in issue #32 — not this plan's job.

**Tech Stack:** OpenRAM (SRAM compiler), Docker (`vlsida/openram-ubuntu:latest`), sky130A PDK.

**Spec:** `docs/superpowers/specs/2026-08-29-operand-mem-sram-macro-design.md`

## Global Constraints

- Macro geometry: `word_size = 64`, `num_words = 64`, `num_rw_ports = 1`, `num_r_ports = 0`,
  `num_w_ports = 0` — matches `operand_mem`'s real per-bank shape (`N=8, KMAX=8` → `DEPTH=64` words of
  `8*N=64` bits). One config, one generation run — not two.
- Technology/corner: `sky130A`, single `TT` process corner, `1.8` supply voltage — matches this repo's
  existing tt/25C/1.80V convention (see `synth/synth_sky130_pe.ys`, `openlane/pe/config.json`). No
  multi-corner sweep in this plan — that's issue #35/#36 scope if `gemm_tile` P&R sign-off needs it.
- Docker only, no native OpenRAM/magic/klayout/ngspice install on the host — mirrors why
  `openlane/run_pe.sh` uses OpenLane's Docker backend (`docs/learnings.md` already documents real native
  install pain for physical-design tools).
- Do not fabricate the OpenRAM CLI invocation or environment variables from memory. Task 1 confirms the
  real values from the actual running container before Task 1's own config/wrapper files are written.
- Full DRC/LVS must run clean on the generated macro (don't pass `-n` to skip them) — an SRAM with
  known DRC/LVS violations isn't a real, usable macro, and this repo's other physical-design cards
  (`pe.v`'s OpenLane runs) hold DRC=0/LVS=0 as the bar for "done."
- Follow repo conventions: gitignore the raw generation output (`openram/runs/` — already covered by the
  existing generic `runs/` gitignore rule, confirm rather than assume), commit only the config, wrapper
  script, and a small hand-written `summary.md` (pattern from `openlane/pe/reports/summary.md`), log the
  decision in `docs/decisions.md`, one branch/PR for the whole card (continue on the existing
  `docs/operand-mem-sram-macro-spec` branch, which already carries the approved spec commit).
- This plan closes issue #31 only. Do not touch `rtl/operand_mem.v` or any other RTL/testbench file —
  wiring the macro in is issue #32.

---

### Task 1: Confirm the OpenRAM Docker image's environment/CLI, write the config and wrapper script

**Files:**
- Create: `openram/config_operand_bank.py`
- Create: `openram/run_operand_sram.sh`

**Interfaces:**
- Produces: `openram/run_operand_sram.sh`, the single entry point Task 2 runs to actually generate the
  macro. Also produces the confirmed real values (tech directory name, `sram_compiler.py` path, CLI
  flags) that this task's own Step 5/6 use — nothing later depends on a guessed invocation.

- [ ] **Step 1: Pull the image**

Run: `docker pull vlsida/openram-ubuntu:latest`
Expected: image pulls successfully. If Docker Desktop isn't running, start it first —
`docker info >/dev/null 2>&1 && echo "docker running" || echo "docker NOT running"` confirms.

- [ ] **Step 2: Inspect the container's OpenRAM environment variables**

Run:
```bash
docker run --rm vlsida/openram-ubuntu:latest bash -lc \
  'echo "OPENRAM_HOME=$OPENRAM_HOME"; echo "OPENRAM_TECH=$OPENRAM_TECH"; python3 --version'
```
Expected: both variables print a real path (OpenRAM's own docs show `$HOME/openram/compiler` and
`$HOME/openram/technology` as an example, but this image's maintainers may have chosen different paths
— record whatever actually prints). If either variable is empty, note that Task 1 Step 6's wrapper will
need to `export` them explicitly before invoking the compiler.

- [ ] **Step 3: Confirm the sky130 technology directory's real name**

Run:
```bash
docker run --rm vlsida/openram-ubuntu:latest bash -lc 'ls "$OPENRAM_TECH"'
```
Expected: a directory listing containing an sky130 entry — record its exact name (e.g. `sky130` vs
`sky130A`) since `tech_name` in the config (Step 5) must match this exactly, not the design spec's
placeholder guess of `"sky130A"`.

- [ ] **Step 4: Confirm `sram_compiler.py`'s location and real CLI flags**

Run:
```bash
docker run --rm vlsida/openram-ubuntu:latest bash -lc \
  'ls "$(dirname "$OPENRAM_HOME")" && python3 "$OPENRAM_HOME/../sram_compiler.py" -h'
```
Expected: `sram_compiler.py` is found at `$OPENRAM_HOME/..` (per OpenRAM's own basic_usage docs) and
`-h` prints the real flag set. Record the exact confirmed invocation form (e.g. whether flags precede or
follow the config path argument) — Step 6 uses it verbatim. If `sram_compiler.py` isn't where expected,
`find / -iname sram_compiler.py 2>/dev/null` inside the same `bash -lc` string to locate it.

- [ ] **Step 5: Write the OpenRAM config**

Create `openram/config_operand_bank.py`, substituting Step 3's real `tech_name` value for the
`"sky130A"` placeholder below if it differs:

```python
# openram/config_operand_bank.py -- OpenRAM config for operand_mem's per-bank
# SRAM macro: one 64-word x 64-bit single-port (1RW) sky130 bank. Generated
# once here (issue #31); rtl/operand_mem.v's two identical banks (a_ram,
# b_ram) each get their own instance of this macro in issue #32, since both
# banks share this exact geometry.
#
# Sizing: operand_mem's real, only-ever-used config is N=8, KMAX=8, giving
# DEPTH = N*KMAX = 64 words per bank, each 8*N = 64 bits wide. See
# docs/superpowers/specs/2026-08-29-operand-mem-sram-macro-design.md for the
# full sizing math and the generation-path/bank-layout/port-config decisions.

word_size = 64
num_words = 64
num_rw_ports = 1
num_r_ports = 0
num_w_ports = 0

tech_name = "sky130A"  # confirmed against the real container tech dir name (Task 1 Step 3)
process_corners = ["TT"]
supply_voltages = [1.8]

output_name = "sky130_sram_512b_1rw_64x64"
output_path = "runs/sky130_sram_512b_1rw_64x64"
```

- [ ] **Step 6: Write the run wrapper**

Create `openram/run_operand_sram.sh`, replacing the final `bash -lc` command with Step 4's confirmed
real invocation form if it differs from the guess below:

```bash
#!/usr/bin/env bash
# Runs OpenRAM (Docker-backed, vlsida/openram-ubuntu) to generate the sky130A
# single-port 64x64 SRAM macro used for operand_mem's a_ram/b_ram banks.
# Requires Docker Desktop running. See
# docs/superpowers/specs/2026-08-29-operand-mem-sram-macro-design.md.
set -euo pipefail
cd "$(dirname "$0")"

docker pull vlsida/openram-ubuntu:latest

docker run --rm \
  -e LOCAL_USER="$USER" \
  -e LOCAL_HOME="$HOME" \
  -v "$(pwd)":/workspace \
  -w /workspace \
  vlsida/openram-ubuntu:latest \
  bash -lc 'python3 "$OPENRAM_HOME/../sram_compiler.py" -v config_operand_bank.py'
```

- [ ] **Step 7: Make it executable**

Run: `chmod +x openram/run_operand_sram.sh`

- [ ] **Step 8: Confirm `openram/runs/` is already gitignored**

Run: `git check-ignore -v openram/runs/anything 2>&1 || echo "not ignored"`
Expected: reports it's ignored by the existing generic `runs/` rule in `.gitignore` (line 24) — the
same rule that already covers `openlane/pe/runs/`. If it reports "not ignored", add `runs/` isn't
matching for some reason (e.g. a `.gitignore` change since this plan was written) — add an
`openram/runs/` entry to `.gitignore` in that case, and note the discrepancy.

- [ ] **Step 9: Commit**

```bash
git add openram/config_operand_bank.py openram/run_operand_sram.sh
git commit -m "Add OpenRAM config and Docker wrapper for operand_mem's SRAM macro"
```

---

### Task 2: Run the generation flow and commit the real numbers

**Files:**
- Create: `openram/reports/summary.md`

**Interfaces:**
- Consumes: `openram/run_operand_sram.sh` from Task 1.
- Produces: the real macro area/config numbers that Task 3's `docs/decisions.md` entry reports.

- [ ] **Step 1: Run the flow**

Run: `./openram/run_operand_sram.sh 2>&1 | tee /tmp/openram_run.log`
This runs full DRC/LVS on a real (if small) SRAM macro, so expect it to take a real amount of wall-clock
time — let it run to completion rather than assuming a timeout means failure. If it fails, capture the
actual error from `/tmp/openram_run.log` — that's real data for `docs/learnings.md` in Task 3, not
something to paper over.

- [ ] **Step 2: Confirm the run succeeded and find the output files**

Run:
```bash
find openram/runs -maxdepth 2 \( -iname "*.gds" -o -iname "*.lef" -o -iname "*.lib" -o -iname "*.v" -o -iname "*.html" \) 2>/dev/null | sort
```
Expected: one each of `.gds`, `.lef`, at least one `.lib` (for the TT corner), `.v`, and `.html`
(datasheet) under `openram/runs/sky130_sram_512b_1rw_64x64/`. If DRC or LVS reported violations in
`/tmp/openram_run.log`, that's a real, reportable problem — do not proceed to Step 3 as if it succeeded;
log it in Task 3's `docs/learnings.md` instead and treat the macro as not yet clean.

- [ ] **Step 3: Extract the real macro area**

Run:
```bash
grep -A2 "^SIZE" openram/runs/sky130_sram_512b_1rw_64x64/*.lef
```
The LEF `SIZE <width> BY <height> ;` line gives the macro's real footprint in microns — compute
`area_um2 = width * height`. This is the actual generated number for `summary.md`, not an estimate.

- [ ] **Step 4: Write the committed summary**

Create `openram/reports/summary.md`, filling in every `<actual ...>` with the real value found above —
no placeholders in the committed file:

```markdown
# operand_mem SRAM macro — OpenRAM generation summary

Run date: <actual date>
OpenRAM invocation: `<actual command from Task 1 Step 6, as run>`
Config: word_size=64, num_words=64, num_rw_ports=1 (sky130A, TT/25C/1.80V)

- DRC violations: <actual count>
- LVS mismatches: <actual count>
- Macro footprint (LEF SIZE): <actual width> um x <actual height> um = <actual area> um^2

This one macro geometry gets instantiated twice in `rtl/operand_mem.v` (a_ram, b_ram) — issue #32.
Combined estimated SRAM-backed operand_mem area: ~<2x actual area> um^2, vs. the current flop-array's
309,457 um^2 (docs/decisions.md, 2026-07-19) — issue #35 measures the real `gemm_tile`-level win once
the macro is actually wired in.

Full run artifacts (GDS, spice netlists, logs) are gitignored (`openram/runs/`) — this file plus
`openram/config_operand_bank.py` is the durable, reproducible record.
```

- [ ] **Step 5: Commit**

```bash
git add openram/reports/summary.md
git commit -m "Add OpenRAM-generated operand_mem SRAM macro results"
```

---

### Task 3: Docs and decisions log

**Files:**
- Modify: `docs/decisions.md`
- Modify: `docs/learnings.md` (only if Task 2 hit a real problem worth logging)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the real numbers from Task 2's `openram/reports/summary.md`.

- [ ] **Step 1: Add a `docs/decisions.md` entry**

Following the file's existing template (most-recent-first, below the entries marker), add an entry
dated today. Cover: the sizing math and the three options-considered sections already written in
`docs/superpowers/specs/2026-08-29-operand-mem-sram-macro-design.md` (generation path, bank layout,
port configuration), the decision, and the real DRC/LVS/area numbers from Task 2.

- [ ] **Step 2: Add a `docs/learnings.md` entry if anything broke or surprised**

Only if Task 1 or Task 2 hit a real snag (wrong CLI flag guessed, DRC/LVS violation, unexpected
environment variable, long characterization time, etc.) — log phase/problem/cause/fix/takeaway per the
file's template. Skip this step entirely if generation was clean end-to-end; don't invent a problem to
fill the template.

- [ ] **Step 3: Update `CLAUDE.md`'s Project status section**

Update the Phase 3 status paragraph/bullets to note issue #31 is done: the real macro area from Task 2,
a pointer to `openram/reports/summary.md`, and that Phase 3.2 is now in progress with #32 (wiring the
macro into `operand_mem.v`) next.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions.md CLAUDE.md
# include docs/learnings.md too if it was modified in Step 2
git commit -m "Log operand_mem SRAM macro generation decision and results (closes #31)"
```

---

### Task 4: Push and open the PR

**Files:** none (git/GitHub operations only)

- [ ] **Step 1: Push the branch**

Run: `git push -u origin docs/operand-mem-sram-macro-spec`

- [ ] **Step 2: Open the PR**

```bash
gh pr create --repo dzheng1328/hw-GEMM-accelerator --title "Select and generate the sky130 SRAM macro for operand_mem" --body "$(cat <<'EOF'
## Summary
- Generated a real sky130A single-port (1RW) 64x64 SRAM macro via OpenRAM (Docker-backed), sized exactly to operand_mem's real per-bank geometry (N=8, KMAX=8 -> DEPTH=64 words of 8*N=64 bits).
- Design decision (generation path, bank layout, port config) and real generated numbers documented in docs/superpowers/specs/2026-08-29-operand-mem-sram-macro-design.md and docs/decisions.md.
- Wiring the macro into rtl/operand_mem.v's actual ports is issue #32, not this PR.

Closes #31.

## Test plan
- [ ] openram/run_operand_sram.sh completes with clean DRC (0) and LVS (0)
- [ ] Real macro area recorded in openram/reports/summary.md
- [ ] docs/decisions.md entry added
- [ ] No RTL/testbench changes in this PR, so ./test.sh is unaffected
EOF
)"
```

- [ ] **Step 3: Once checks pass, merge and delete the branch**

Per the repo's standing git workflow (`CLAUDE.md`): merge once tests/checks pass, without waiting for a
separate manual review step, then delete the branch. This repo currently has no CI configured (confirmed
via `gh pr checks` on the prior PR #41), so merge once the PR's own test-plan checklist is satisfied.

```bash
gh pr merge --merge --delete-branch
```
