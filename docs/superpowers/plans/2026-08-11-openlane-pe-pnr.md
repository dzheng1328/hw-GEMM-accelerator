# OpenLane 2 Place & Route for `pe.v` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `rtl/pe.v` through OpenLane 2's full place-and-route flow (Docker-backed) against sky130hd,
producing real GDSII plus a real OpenSTA slack number, replacing the area-only estimate from the earlier
Yosys sky130 pass.

**Architecture:** A pinned `openlane` Python package (installed into the existing project `.venv`, same
convention as `cocotb`/`torch`) drives the flow, using its `--dockerized` mode so PDK tools (OpenROAD,
Magic, Netgen, KLayout) run inside containers rather than requiring a native Nix install. Config lives at
`openlane/pe/config.json`; run artifacts land in a gitignored `openlane/pe/runs/` (already covered by the
repo's existing generic `runs/` gitignore rule); only a small final report gets committed, mirroring
`synth/reports/`.

**Tech Stack:** OpenLane 2 (Python, Docker backend), sky130hd PDK (`sky130_fd_sc_hd`), Docker Desktop.

## Global Constraints

- Scope is `rtl/pe.v` only — do not attempt `gemm_tile` or `router` in this plan (future card).
- OpenLane 2 (not classic OpenLane), run via its Docker backend, not Nix.
- PDK/corner: sky130hd, `sky130_fd_sc_hd`, tt/25C/1.80V — same corner as the Yosys pass, for comparable
  numbers.
- Clock target: 100MHz / `CLOCK_PERIOD=10` (ns) — same as the Yosys pass.
- Pin exact versions (OpenLane package version, Docker image tag) — never float `latest`, for
  reproducibility.
- Follow existing repo conventions: gitignore run artifacts, commit only small text reports (pattern from
  `synth/reports/`), log decisions/learnings per the project's docs workflow, one branch/PR for the whole
  card (already on `feature/openlane-pe-pnr`, spec commit `2a79064` already there).
- Do not fabricate CLI flags/subcommands from memory where uncertain — Task 1 confirms the real installed
  CLI surface via `--help`/`--version` before it's relied on in later tasks.

---

### Task 1: Install OpenLane 2 and confirm its CLI surface

**Files:**
- Modify: `requirements.txt` (add pinned `openlane` package)

**Interfaces:**
- Produces: a working `openlane` CLI in `.venv`, and the exact confirmed invocation syntax (flags,
  subcommands) that Task 3 will use to actually run the flow. Nothing later depends on guessed syntax —
  Task 3 reads this task's confirmed output.

- [ ] **Step 1: Check current OpenLane 2 latest release version**

Run: `pip index versions openlane 2>&1 | head -5`
Note the latest version string (e.g. `2.x.y`) for pinning in Step 2. If this command is blocked/unclear,
fall back to checking `https://pypi.org/project/openlane/` for the latest version number.

- [ ] **Step 2: Add pinned dependency to requirements.txt**

Add this line under a new comment header, matching the file's existing style:

```
# Physical design (Phase 3 OpenLane place & route)
openlane==<version-from-step-1>
```

- [ ] **Step 3: Install into the existing venv**

Run: `source .venv/bin/activate && pip install -r requirements.txt`
Expected: `openlane` installs without error alongside the existing `cocotb`/`torch`/`numpy` deps.

- [ ] **Step 4: Confirm Docker Desktop is running**

Run: `docker info >/dev/null 2>&1 && echo "docker running" || echo "docker NOT running — start Docker Desktop first"`
Expected: `docker running`. If not, start Docker Desktop and re-check before continuing — every later
step that touches `openlane` needs this.

- [ ] **Step 5: Confirm the CLI's dockerized-run invocation**

Run: `source .venv/bin/activate && openlane --help 2>&1 | tee /tmp/openlane_help.txt`
Read the output for the flag/subcommand that runs a config through the Docker backend (as of recent
OpenLane 2 releases this is `openlane --dockerized <config>`, but confirm against this installed
version's actual `--help` text rather than assuming). Also run `openlane --version` and note it.
Write down the exact confirmed command form — Task 3 uses it verbatim.

- [ ] **Step 6: Commit**

```bash
git add requirements.txt
git commit -m "Add pinned openlane dependency for Phase 3 place & route"
```

---

### Task 2: Write the pe config and run wrapper, fix gitignore

**Files:**
- Create: `openlane/pe/config.json`
- Create: `openlane/run_pe.sh`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the confirmed CLI invocation form from Task 1, Step 5.
- Produces: `openlane/run_pe.sh`, the single entry point Task 3 runs to execute the flow.

- [ ] **Step 1: Check whether the existing gitignore would hide the new config file**

Run: `cd /Users/dzheng/Documents/hw-gemm-accelerator && git check-ignore -v openlane/pe/config.json 2>&1 || echo "not ignored"`
The repo's `.gitignore` has a generic `*.json` rule (with only `config/*.json` excepted), so this file
will currently be swallowed. Confirm that's what happens (path shown as ignored by the `*.json` rule).

- [ ] **Step 2: Add a gitignore exception for the OpenLane config**

In `.gitignore`, under the existing `# Yosys / OpenLane outputs` section, add:

```
!openlane/**/config.json
```

Re-run the Step 1 check — `openlane/pe/config.json` should now report "not ignored". Note `runs/` is
already covered by the existing generic `runs/` rule, so `openlane/pe/runs/` needs no new entry.

- [ ] **Step 3: Confirm the config schema against the installed version**

The JSON shape below (in particular the `"dir::"` prefix on `VERILOG_FILES`, meaning "relative to this
config file") is a recalled convention, not confirmed against the specific `openlane` version installed
in Task 1 — do not treat it as settled fact. Before writing the file, check it against the installed
package's own reference: run `python3 -c "import openlane, os; print(os.path.dirname(openlane.__file__))"`
and look for a bundled example config (commonly under an `examples/` or `test_data/` subdirectory of the
package, or in the package's own README/docs if installed alongside). If a bundled example is found,
match its exact key names and path-prefix convention. If genuinely nothing is available offline, the
JSON below is the fallback — but note in the report which case applied.

- [ ] **Step 4: Write the config**

Create `openlane/pe/config.json`:

```json
{
  "DESIGN_NAME": "pe",
  "VERILOG_FILES": "dir::../../rtl/pe.v",
  "CLOCK_PORT": "clk",
  "CLOCK_PERIOD": 10
}
```

`CLOCK_PERIOD` is in nanoseconds — 10ns matches the 100MHz target used in the Yosys sky130 pass. PDK
defaults to sky130hd/`sky130_fd_sc_hd` unless overridden, matching the spec. Adjust key names/prefix if
Step 3 found a difference in the installed version's actual schema.

- [ ] **Step 5: Write the run wrapper**

Create `openlane/run_pe.sh`:

```bash
#!/usr/bin/env bash
# Runs rtl/pe.v through OpenLane 2's full place-and-route flow via the
# Docker backend. Requires Docker Desktop running (see Task 1, Step 4).
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
openlane --dockerized openlane/pe/config.json
```

Replace `--dockerized openlane/pe/config.json` with whatever exact form Task 1 Step 5 confirmed, if it
differs from this guess.

- [ ] **Step 6: Make it executable**

Run: `chmod +x openlane/run_pe.sh`

- [ ] **Step 7: Commit**

```bash
git add openlane/pe/config.json openlane/run_pe.sh .gitignore
git commit -m "Add OpenLane 2 config and run wrapper for pe.v"
```

---

### Task 3: Run the flow and commit the report

**Files:**
- Create: `openlane/pe/reports/summary.md` (small, hand-curated from the run's output)

**Interfaces:**
- Consumes: `openlane/run_pe.sh` from Task 2.
- Produces: the real numbers (slack, DRC/LVS status, area) that Task 4's docs entries report.

- [ ] **Step 1: Run the flow**

Run: `./openlane/run_pe.sh 2>&1 | tee /tmp/openlane_pe_run.log`
This is expected to take minutes (per the spec's "likely minutes, not hours" estimate for a design this
small). Let it run to completion.

- [ ] **Step 2: Check the run succeeded**

Expected in the tail of `/tmp/openlane_pe_run.log`: the flow reaches GDS streamout without a fatal error.
If it fails partway, that's a real result to log in `docs/learnings.md` (Task 4), not something to paper
over — capture the actual error before deciding how to proceed.

- [ ] **Step 3: Find the DRC, LVS, and STA reports in the run directory**

Run: `find openlane/pe/runs -iname "*drc*" -o -iname "*lvs*" -o -iname "*sta*" 2>/dev/null | sort`
Open the most recent run's final DRC report, LVS report, and STA (timing) summary. Note: violation
counts (DRC/LVS), and the worst-case setup slack number at the 100MHz corner.

- [ ] **Step 4: Write the committed summary**

Create `openlane/pe/reports/summary.md`:

```markdown
# pe.v — OpenLane 2 place & route summary

Run date: <actual date>
OpenLane version: <from Task 1 Step 5>
PDK: sky130hd (sky130_fd_sc_hd), tt/25C/1.80V, 100MHz (10ns) target

- DRC violations: <actual count>
- LVS mismatches: <actual count>
- Worst setup slack: <actual number> ns
- Final area: <actual number> (compare against the Yosys pass's 6,209.7 um^2 standalone estimate)

Full run artifacts are gitignored (openlane/pe/runs/) — this file is the durable record.
```

Fill in every `<actual ...>` with the real value found in Step 3 — no placeholders in the committed file.

- [ ] **Step 5: Commit**

```bash
git add openlane/pe/reports/summary.md
git commit -m "Add OpenLane 2 pe.v place & route results"
```

---

### Task 4: Docs, decisions log, and Notion Task Board

**Files:**
- Modify: `docs/decisions.md`
- Modify: `docs/learnings.md` (only if Task 3 hit a real problem worth logging)
- Modify: `CLAUDE.md` (Project status section)

**Interfaces:**
- Consumes: the real numbers from Task 3's `openlane/pe/reports/summary.md`.

- [ ] **Step 1: Add a decisions.md entry**

Following the file's existing template (most-recent-first, below the entries marker), add an entry dated
today covering: OpenLane-2-over-classic-OpenLane and Docker-over-Nix choices (the "why" already captured
in the design spec at `docs/superpowers/specs/2026-08-11-openlane-pe-pnr-design.md`), plus the real
DRC/LVS/slack/area numbers from Task 3.

- [ ] **Step 2: Add a learnings.md entry if anything broke or surprised**

Only if Task 3 hit a real snag (a failed run, wrong CLI flag, unexpected DRC violation, etc.) — log
phase/problem/cause/fix/takeaway per the file's template. Skip this step entirely if the run was clean
end-to-end; don't invent a problem to fill the template.

- [ ] **Step 3: Update CLAUDE.md's Project status section**

Update the Phase 3 status paragraph to note the pe.v OpenLane run is done, with the real slack number
and a pointer to `openlane/pe/reports/summary.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions.md CLAUDE.md
# include docs/learnings.md too if it was modified in Step 2
git commit -m "Log OpenLane 2 pe.v P&R decision and results"
```

- [ ] **Step 5: Update the Notion Task Board**

Using the Notion MCP tools, move the "OpenLane place & route" card to "Done" (and "Timing closure pass"
too, if Task 3's slack number was clean/met) with a Notes update summarizing the real numbers — same
pattern as the existing sky130 Yosys card's notes.

---

### Task 5: Push and open the PR

**Files:** none (git/GitHub operations only)

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feature/openlane-pe-pnr`

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "OpenLane 2 place & route for pe.v" --body "$(cat <<'EOF'
## Summary
- First OpenLane run in the repo: pe.v through OpenLane 2 (Docker backend) against sky130hd
- Real OpenSTA slack replaces the Yosys pass's area-only estimate
- See docs/superpowers/specs/2026-08-11-openlane-pe-pnr-design.md for the design

## Test plan
- [ ] `openlane/run_pe.sh` completes with GDS streamout
- [ ] DRC/LVS/slack numbers recorded in openlane/pe/reports/summary.md
- [ ] docs/decisions.md entry added
EOF
)"
```

- [ ] **Step 3: Once checks pass, merge and delete the branch**

Per the repo's standing git workflow (CLAUDE.md): merge once tests/checks pass, without waiting for a
separate manual review step, then delete the branch.

```bash
gh pr merge --squash --delete-branch
```
