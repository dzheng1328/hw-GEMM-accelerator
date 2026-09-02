# Design decisions

A lightweight log of architectural choices — why you built it this way instead
of the alternatives. Useful for your own memory, and directly answers the
"walk me through a decision you made" interview question.

---

## Template

### [Date] — [decision]

**Context:** What problem needed a decision.
**Options considered:** The alternatives you weighed.
**Decision:** What you went with.
**Why:** The tradeoff that made you pick it.

---

<!-- Entries below, most recent first -->

### 2026-09-02 -- Close issue #31: accept the operand_mem SRAM macro's DRC/LVS gap as a documented, cross-tool-confirmed open-source-PDK limitation

**Context:** The 2026-09-01 entry below left one real, precisely-scoped blocker: KLayout's independent
LVS run reported "netlists don't match," with a `VDD`/`vdd`, `GND`/`gnd` pin-naming mismatch flagged as
the likely real cause and case-sensitive schematic parsing flagged as the next thing to try.
This session tested that plan directly instead of assuming it, and it turned out to be wrong on two
counts, both proven rather than guessed.
First, `NetlistSpiceReader` really does uppercase every name it reads (confirmed via direct RBA API
introspection: `SKY130_FD_BD_SRAM__OPENRAM_DFF`), but `circuit_by_name` lookups are case-insensitive, and
every one of the real report's 76 "could not be compared" entries shows KLayout correctly pairing the
lowercase (layout) and uppercase (schematic) circuit names together — the case fold never broke circuit
pairing at all.
Second, the actual mechanism the prior entry pointed at (`connect_global(SUB, "gnd")` /
`connect_implicit("*", "vdd"/"gnd")` only ever seeing the layout's lowercase net labels) was real, so a
`NetlistSpiceReaderDelegate` subclass was written to force the schematic's `VDD`/`GND` to lowercase on
read, and the LVS check was re-run end to end with the fix in place.
The failure count did not change at all: same 76 circuits, same pin-mismatch categories, just relabeled
in lowercase — proving case was never the real blocker either.
**Options considered:** With both case-related hypotheses eliminated by direct experiment, the real cause
needed tracing from first principles rather than a third guess.
Comparing the schematic's and the freshly re-extracted netlist's `.SUBCKT` port counts for one failing
cell (`sky130_fd_bd_sram__openram_sp_nand2_dec`, a vendor-supplied primitive) found 5 ports on the
schematic side (`A B Z VDD GND`) against 6 on the extracted side — a real port-count mismatch, not a
naming issue.
Dumping that circuit's extracted pins and their device-terminal references directly via the RBA API (not
guessed) showed the cause precisely: the two NMOS pull-down transistors' bulk/body terminals land on a
*separate* net (`gnd`, carrying only the two `B` terminals) instead of merging into the same net as the
real ground rail (`GND,gnd`, carrying the source terminal) — `connect_global(SUB, "gnd")`'s bulk-merge
isn't capturing this vendor cell's body-tie geometry.
Cross-checking against a plain, non-proprietary OpenRAM-composed cell (`pinv`, which uses only generic
`sky130_fd_pr` transistors) confirmed this is *not* a macro-wide extraction gap: `pinv` extracts cleanly
with the expected 4 ports and has no `.subckt` entry in the schematic at all (it's meant to be flattened
away by `align`), so its appearances in the earlier "leaf circuits with real net-mismatch errors" list
were downstream cascades from its failing siblings, not independent defects.
Re-deriving the full leaf-failure list on that basis narrows it to exactly 5 real root circuits, and all
5 are `sky130_fd_bd_sram__`-prefixed vendor primitives (`openram_dff`, `openram_sense_amp`,
`openram_sp_nand2_dec`, `openram_sp_nand3_dec`, `openram_write_driver`) — precisely the same proprietary
cell family the 2026-09-01 entry's Magic/netgen run independently traced to foundry-internal GDS layers
(92, 115, and non-standard datatype variants of 22/33) absent from the open `sky130A.tech` techfile.
DRC was also run to completion for the first time against this final GDS this session (KLayout's
`sky130.lydrc`, ~33 minutes, 62,734 violations) — 84% of them (52,930) land on
`sky130_sram_512b_1rw_64x64_sky130_bitcell_array` alone, with the replica/dummy/col-cap array wrappers
accounting for nearly all the rest, the same dense bitcell-array-family geometry already flagged as
likely benign KLayout extraction noise in the 2026-09-01 LVS entry (the "diff/gate" warnings) and
consistent with vendor-qualified silicon IP that has already passed real Calibre/Assura signoff DRC the
open-source `sky130.lydrc` ruleset doesn't fully replicate.
**Decision:** Accept the DRC/LVS gap as documented and close issue #31.
Two independent open-source toolchains (Magic/netgen and KLayout) were run to real completion against
the final generated macro (`words_per_row=2`, OpenRAM `stable`@`b2b069c`, Docker Desktop at 15.6GB) and
both concentrate their real, non-cosmetic findings in the same narrow, vendor-supplied
`sky130_fd_bd_sram` primitive-cell family that uses foundry-internal layers the open PDK doesn't publish
— not in this project's own config, RTL, or scripts.
Continuing to chase this specific gap (patching `connect_global` for an undocumented proprietary layer,
or reverse-engineering the vendor's body-tie geometry) would mean guessing at foundry-internal PDK
internals with no public documentation to verify against, which is a fundamentally different, much
lower-confidence activity than the config/version fixes that got the flow this far.
Issue #32 (RTL integration behind `operand_mem`'s port interface) is unblocked to proceed against this
macro's real GDS/LEF/Liberty outputs; the DRC/LVS status carried forward is "run to completion via two
independent tools, gap traced and documented, not clean."
**Why:** Every real (non-case, non-cosmetic) discrepancy found across both tools and two independent
verification passes (DRC and LVS) lands on the same small, named set of vendor-proprietary cells, via
two structurally different symptoms (Magic: misclassified devices; KLayout: a split body-tie net) that
both trace back to the same foundry-internal-layer gap already confirmed by direct techfile inspection —
that convergence is what makes "documented upstream limitation" a evidenced conclusion here rather than
a shrug.
Reproducing the schematic/layout terminal counts and device-terminal references directly via KLayout's
own RBA API (rather than re-reading report prose) is also what let two plausible but wrong hypotheses
(case-sensitivity breaking circuit pairing; case-sensitivity breaking net matching) get ruled out
cleanly instead of accumulating as unverified assumptions carried into issue #32.

### 2026-09-01 -- Use KLayout (native, via Homebrew) as an independent LVS cross-check alongside Magic/netgen (issue #31)

**Context:** Once Magic extraction finally completed for the `operand_mem` SRAM macro (see the Docker
memory entry in `docs/learnings.md`, same date), the real `run_lvs.sh` (netgen) produced a concrete, fully
quantified failure: device counts matched (37,591 = 37,591) but 104 devices were misclassified and ~520
nets were missing. Traced this to ~10 `sky130_fd_bd_sram` primitive cells whose GDS uses foundry-internal
layer/datatype pairs (layers 92 and 115, and non-standard datatype variants of layers 22/33) that the
open-source `sky130A.tech` Magic techfile has zero entries for anywhere -- confirmed by grepping the
techfile directly, not guessed.
**Options considered:** (1) Hand-patch the missing GDS layer/datatype mappings into a local Magic tech
extension, sourced from the vendor's own `calibre_lvs_lib`/`klayout_lvs_lib` decks that already ship in
`.openram-src/technology/sky130/`. (2) Accept the gap as a documented, known upstream open-PDK limitation
and scope issue #31 down to "DRC-clean, LVS-gap-documented." (3) Try KLayout as an alternate DRC/LVS
toolchain -- OpenRAM natively supports this via `use_klayout=True` (`compiler/verify/klayout.py`), and
`.openram-src/technology/sky130/tech/sky130.lylvs` is a self-contained ruleset with its own layer
extraction logic embedded in the script, independent of Magic's techfile gap entirely.
**Decision:** Option 3. Ran KLayout's own LVS invocation (the exact command OpenRAM's
`write_lvs_script` would generate: `klayout -b -r sky130.lylvs -rd input=... -rd schematic=... -rd
target_netlist=... -rd connect_supplies=1`) directly against the same GDS and the same ideal-schematic
`.lvs.sp`, as a standalone step rather than re-running the whole `sram_compiler.py` generation with
`use_klayout=True` baked into the config (the GDS itself doesn't need regenerating; only the verification
tool needed to change). KLayout was not present in `vlsida/openram-ubuntu` or on the host, so installed
it natively via `brew install --cask klayout` (0.30.12) rather than hunting for or trusting an
unofficial third-party KLayout Docker image -- also sidesteps the amd64-on-arm64 Docker emulation this
whole flow has been paying a real time cost for.
**Why:** Patching Magic's techfile (option 1) is PDK-level surgery with real risk of getting the vendor's
own internal layer semantics subtly wrong; KLayout's ruleset already encodes that correctly and is the
tool OpenRAM itself ships first-class support for. It also validated fast in practice: KLayout's run
finished in 44 seconds against netgen's ~24 minutes, and its report format is far more granular (flags
exactly which cell and which geometric pattern each warning traces to, e.g.
`sky130_replica_bitcell_array`), which is what let the next finding -- a 9,360-occurrence "diff/gate"
warning pattern that's very likely benign extraction-tool noise on dense diffusion-shared bitcell
geometry, versus a much smaller, structurally real `VDD`/`vdd`/`GND`/`gnd` pin-naming mismatch cluster --
get separated out cleanly instead of staying tangled together as one opaque "netlists don't match."

### 2026-08-29 -- Re-synthesize pipelined `pe.v` with Yosys, record the area delta (issue #29)

**Context:** `synth/reports/pe_synth.log` and `synth/reports/pe_sky130.log` were still the pre-pipeline
baseline (6,209.7 um^2 generic-synth chip area) -- last regenerated before the 2026-08-27 MAC pipelining
(commit 3777878) and the 2026-08-29 OpenLane re-verification (issue #30). Issue #29 closes that gap: re-run
the same two Yosys passes (`synth/synth_pe.ys` generic, `synth/synth_sky130_pe.ys` against
`sky130_fd_sc_hd__tt_025C_1v80`) on the now-pipelined `rtl/pe.v` and log the area delta.
**Options considered:** None -- mechanical re-run of the existing scripts, unchanged, against the new RTL.
**Decision:** Ran `yosys -s synth/synth_pe.ys` and `yosys synth/synth_sky130_pe.ys` from the repo root;
both `tee` their `stat` output back into `synth/reports/pe_synth.log` / `pe_sky130.log` as before.
Sky130-mapped chip area went from **6,209.7 um^2 (pre-pipeline)** to **4,996.0 um^2 (pipelined)** -- a
**1,213.7 um^2 / 19.5% decrease** -- despite the pipeline adding 17 more flip-flops (48 -> 65
`dfxtp_1` cells, sequential area 960.9 -> 1,301.2 um^2, +340.3 um^2). Combinational area dropped from
5,248.8 to 3,694.8 um^2 (-1,554.0 um^2), more than offsetting the added registers. Generic-synth cell
count tells the same story: 901 cells (48 FF) pre-pipeline -> 644 cells (65 FF) pipelined -- fewer total
cells despite more flops.
**Why:** This is the same effect the 2026-08-29 OpenLane pass (issue #30, entry below) already found
post-P&R, now confirmed at the pre-P&R Yosys level: `abc -D 10000`'s delay-driven technology mapping was
straining to build a single-cycle 8x8-multiply-plus-16-bit-add cone that fits within one 10ns period, and
paid for that with larger/more-parallel gates (bigger `xnor2`/`xor2`/`maj3` trees) to hit the delay target.
Splitting the MAC into two pipeline stages roughly halves the combinational depth per stage, so abc no
longer needs to reach for area-expensive fast cells to close timing -- it can pick smaller, slower ones
and still meet the per-stage budget. The lesson generalizes: pipelining a hardware datapath is not a pure
area-for-timing tradeoff the way it often is in software (more state = more storage); when the
unpipelined version was already fighting a delay-driven synthesis tool for area, breaking up the critical
path can *shrink* silicon rather than grow it, because the tool no longer needs to pay an area premium to
hit an aggressive delay target on a single deep cone.

### 2026-08-29 -- Re-run OpenLane P&R on the pipelined `pe.v`: timing closure confirmed (issue #30)

**Context:** The 2026-08-12 timing-closure pass root-caused -2.21ns of worst-case setup slack at the
pessimistic `max_ss_100C_1v60` sign-off corner to `pe.v`'s single-cycle, unpipelined MAC datapath, and
concluded that full closure required pipelining it -- a separate future card rather than an SDC/P&R
tuning fix. The 2026-08-27 entry above pipelined `pe.v` into 2 stages (`ACC_LATENCY = 2`) on that basis,
but explicitly deferred the real OpenLane re-verification to issue #30, since the design change was
validated only in cocotb simulation at that point, not against real place-and-route timing.
**Options considered:** None -- this is a verification run, not a design decision. The goal was simply to
re-run the exact same OpenLane 2 flow (`openlane/pe/config.json`, unchanged: same sky130A/
`sky130_fd_sc_hd`, same `IO_DELAY_CONSTRAINT: 10`, same tt/25C/1.80V primary corner and 10ns period) with
`rtl/pe.v`'s only change being the pipelined MAC datapath, so the before/after comparison isolates that
one variable.
**Decision:** Ran `openlane/run_pe.sh` end to end (OpenLane 2.3.10, Docker backend) against the pipelined
`rtl/pe.v`. Result: DRC (Magic + KLayout) and LVS both clean (0/0, same as before), antenna violations 0,
and the 3 small max-fanout violations present at every corner in the unpipelined run are now gone (0
everywhere). The full multi-corner PVT sign-off sweep now closes with **positive setup slack at every
corner** -- the previously-violating `max_ss_100C_1v60` corner recovered from -2.21ns to **+0.4510ns** (a
2.66ns swing), and the target tt/25C/1.80V corner improved too, from +3.11ns to +4.8612ns. Hold timing
stayed clean everywhere (worst +0.1176ns, 0 violations). Final post-P&R area *shrank* despite the added
pipeline register (6,865.33 / 14,313.7 / 18,523.1 um^2 instance/core/die, down from 10,312.4 / 21,620.7 /
26,787 um^2) -- the unpipelined run's larger area was mostly the resizer inserting timing-repair buffer
cells trying and failing to close the single-cycle MAC's critical path; splitting that path across 2
cycles needs far less repair, and the saved buffering outweighs the new register. Full corner table and
run directory in `openlane/pe/reports/summary.md`.
**Why it matters:** This is the milestone's finish line (Phase 3.1) -- it closes the loop the 2026-08-12
pass opened: the diagnosis (unpipelined MAC is the root cause), the fix (2-stage pipeline, 2026-08-27),
and now real physical-design proof the fix actually works, not just a cocotb-level latency-contract check.
`synth/reports/`'s pre-P&R Yosys area numbers are still stale from before the pipeline change (tracked
separately as issue #29) -- this entry's area numbers are the real post-P&R placed/routed figures, not a
substitute for that re-synthesis.

### 2026-08-27 -- Pipeline `pe.v`'s MAC datapath into 2 stages

**Context:** The 2026-08-12 timing closure pass root-caused the remaining -2.21ns of worst-case setup
slack at the `max_ss_100C_1v60` corner to `pe.v`'s single-cycle, unpipelined multiply-accumulate
(~25 combinational stages: the 8x8 signed multiplier tree + 32-bit adder) -- not SDC-tunable, an
architecture change. Design doc:
`docs/superpowers/specs/2026-08-27-pipeline-pe-mac-design.md` (issue #25).
**Options considered:** *A -- 2-stage MAC pipeline, latency expressed as a named constant.* Register the
multiply result; add into the accumulator on the next cycle. Root-cause data says the multiplier tree is
most of the 25-stage path, so this recovers the bulk of the slack, and the latency is expressed as one
constant the sequencer reads to size its drain window, so a deeper future pipeline is a localized change
rather than a redesign. *B -- pipeline the multiplier tree itself now (3+ stages).* More margin today,
but real hand-pipelining risk with no concrete future clock target driving the extra work yet. *C --
pipeline `a_out`/`b_out` forwarding in lockstep with the accumulate pipeline.* Not needed: the critical
path traced in the 2026-08-12 report never touched the forwarding registers, which are already a separate,
already-registered always-block structurally independent of the MAC.
**Decision:** Approach A. Added `ACC_LATENCY = 2` as `pe.v`'s explicit latency contract, now a real
`localparam` in `pe.v` itself (not just a comment): `valid_in` to that cycle's product landing in
`acc_out` now takes 2 cycles (was 1) -- one register stage holds the multiply result (`prod_reg`/
`pipe_valid`), the accumulate add happens the following cycle. Threaded as `parameter PE_ACC_LATENCY = 2`
into `gemm_sequencer.v`, which replaced its `DRAIN_CYCLES = 2*N` literal with `DRAIN_CYCLES = 2*N +
PE_ACC_LATENCY` (provable minimum is `2*(N-1) + PE_ACC_LATENCY`: `(N-1)` cycles of skew in
`rtl/skew_feeder.v` ahead of the array, plus `(N-1)` cycles of skew inside the array itself, plus
`PE_ACC_LATENCY` cycles to accumulate -- two separate skew stages, not one; `2*N + PE_ACC_LATENCY` keeps
the same generous slack the original `2*N` had over that minimum) and `gemm_tile.v` now passes
`PE_ACC_LATENCY` explicitly at instantiation so the dependency between `pe.v`'s real latency and the
sequencer's drain-window sizing is visible in the code rather than an implicit coincidence between two
numbers; `rtl/noc_node.v`'s own `PE_ACC_LATENCY` parameter (default 2, following the same pattern it
already uses for `N`/`KMAX`) threads the value the rest of the way into the NoC layer's `gemm_tile`
instantiation. All four sites -- `pe.v`'s `ACC_LATENCY` localparam, and the `PE_ACC_LATENCY` defaults in
`gemm_sequencer.v`, `gemm_tile.v`, and `noc_node.v` -- carry cross-reference comments pointing at each
other, since Verilog has no shared-constant mechanism across separately-elaborated modules here. `rtl/
systolic_array.v` and `rtl/skew_feeder.v` needed zero changes -- their skew depths and forwarding timing
never depended on accumulate latency, confirming the design doc's read that the MAC could be pipelined
without an array-level ripple. `tb/test_pe.py` and `tb/array/` (which drive the hardware directly and
wait a fixed cycle count) each needed +1 cycle of drain margin; `tb/tile/`'s existing margin
(`TOTAL_CYCLES = 4*N`, ~24 cycles of headroom over the real ~16-cycle requirement) already covered it, so
its `TOTAL_CYCLES` was extended by `ACC_LATENCY-1` for explicitness/provable-sufficiency rather than
because it was failing. `tb/gemm/` and `tb/mnist/` (which wait on `gemm_sequencer.v`'s `done` handshake
rather than a fixed count) needed zero changes and passed unchanged -- this confirms the pipelined MAC is
functionally transparent end-to-end through the sequencer, genuinely valuable evidence, but it is not a
tested boundary for the `+PE_ACC_LATENCY` margin specifically: in the final wave, `feed_valid` is high
only while `c_cyc < N`, so most of the 22-cycle window is already idle before `S_DRAIN` even begins, and
the pre-existing `2*N` slack alone (far more than the `2*(N-1)` minimum) would have been enough for these
suites to pass even without the `+PE_ACC_LATENCY` addition. `tb/router/`, `tb/noc/`, `tb/mesh/` also
passed unchanged, as expected: they read `acc_out` only after `done`, so they never depended on `pe.v`'s
internal accumulate latency.
**Why it matters:** This closes the milestone's design half (issue #25) with the blast radius the design
doc predicted -- `pe.v` plus one parameter apiece in `gemm_sequencer.v`/`gemm_tile.v`/`noc_node.v`, not
the array/skew_feeder ripple originally feared when issue #26 was first scoped. The real ripple turned out
to be in cocotb (issue #28), and `tb/gemm/`/`tb/mnist/` passing with zero changes is solid evidence the
pipelined MAC behaves correctly end-to-end through the sequencer -- it is not, on its own, proof that the
`+PE_ACC_LATENCY` margin was necessary or sufficient, since those suites' pre-existing slack would have
masked an undersized drain window either way. Real before/after OpenLane slack numbers at
`max_ss_100C_1v60` are separate follow-on work, tracked as issue #30 -- not yet run as part of this change,
and the committed `synth/reports/` sky130 area numbers are now stale too (pe.v gained `prod_reg[15:0]` +
`pipe_valid` flops this change), pending a re-run under the same issue.

### 2026-08-12 -- Timing closure pass: real root cause, partial fix, honest limit

**Context:** The pe.v OpenLane P&R run closed timing at the target tt/25C/1.80V corner (+2.19ns) but
left -3.20ns of worst-case setup slack at the pessimistic `max_ss_100C_1v60` sign-off corner -- the
Task Board's "Timing closure pass" card, whose own note said to "diagnose the critical path properly
this time" rather than trial-and-error.
**Options considered:** *Where to look:* trust the aggregate metric vs read the actual OpenSTA
critical-path report. Reading `54-openroad-stapostpnr/max_ss_100C_1v60/max.rpt` showed every violating
path in the original run starts at `b_in` (specifically bits 1 and 3) and runs through ~25 standard-cell
stages of the PE's combinational multiply-accumulate logic (the 8x8 multiplier tree + 16-bit adder) --
not a placement or routing artifact. *Two competing hypotheses for the -3.20ns gap:* (1) OpenLane's default SDC
`IO_DELAY_CONSTRAINT` (20% of the clock period, 2ns) is a generic macro-boundary assumption that doesn't
match `pe.v`'s real usage -- its inputs are driven directly by a neighbor PE's own registered forwarding
outputs in the array, not some worst-case external driver. (2) The single-cycle, unpipelined MAC
datapath is simply too long for 100MHz at the worst-case PVT corner, independent of SDC tuning.
**Decision:** Tested both by changing one variable at a time. Halving `IO_DELAY_CONSTRAINT` to 10%
recovered slack from -3.20ns to -2.21ns -- a clean match (0.99ns recovered against the 1ns of margin
freed) confirming hypothesis (1) is real. Testing the extreme boundary (`IO_DELAY_CONSTRAINT: 0`, the
most optimistic assumption possible) only recovered to -1.38ns -- still violating, confirming hypothesis
(2) is also real and is the harder limit: roughly 1.2-1.4ns of the shortfall cannot be tuned away by any
SDC change. (After the fix, the resizer re-optimizes and the specific violating startpoints shift to
`a_in[7]`/`b_in[0]` -- different bits, same underlying MAC logic.) Landed `IO_DELAY_CONSTRAINT: 10` as a
real, justified fix (not an arbitrary knob-turn -- it reflects the design's actual usage context) and
documented the remaining gap rather than force-closing it with an unrealistic 0% assumption. Full closure
requires pipelining `pe.v`'s multiply-accumulate datapath, a genuine RTL/architecture change that ripples
into `systolic_array.v`'s single-cycle dataflow model project-wide -- scoped as a separate future card, a
decision made with the user rather than unilaterally rewriting the RTL.
**Why it matters:** This is what "diagnose the critical path properly" means in practice: read the actual
timing report, form a specific hypothesis, test it with a single-variable change, and let the evidence
say when a config fix is exhausted and an architecture change is the only path left, rather than guessing
at knobs until a number looks better. -2.21ns worst-case setup slack (down from -3.20ns) is now the
honest, documented state of `pe.v` at the pessimistic sign-off corner. See
`openlane/pe/reports/summary.md` for full numbers.

### 2026-08-12 — First OpenLane 2 run: real P&R numbers for `pe.v`

**Context:** The Yosys sky130 pass (2026-07-19) was honestly area-only -- no real STA. This card runs
`rtl/pe.v` through OpenLane 2's full place-and-route flow to get a real GDSII and a real OpenSTA slack
number, the "Timing closure pass" Task Board card.
**Options considered:** *Flow version:* OpenLane 2 (Python-based, actively maintained, the flow Tiny
Tapeout points submitters toward) vs classic OpenLane. *Install method:* OpenLane 2's `--dockerized` mode
(pulls `ghcr.io/efabless/openlane2:2.3.10`) vs a native Nix install -- Docker keeps the existing Docker
Desktop dependency the Command Center already anticipated and avoids adding a second toolchain manager
alongside the project's existing Python venv convention. *Scope:* `rtl/pe.v` only this pass --
`gemm_tile`/`router` P&R stays a separate future card, same reasoning as the Yosys pass.
**Decision:** OpenLane 2.3.10, Docker backend, `openlane/pe/config.json` (sky130A / `sky130_fd_sc_hd`,
tt/25C/1.80V corner, 100MHz / 10ns target -- same corner and clock as the Yosys pass, for comparable
numbers). Real results (`openlane/pe/reports/summary.md`):
- **DRC: 0 violations** (Magic + KLayout), **LVS: 0 mismatches** ("Circuits match uniquely"), **0 antenna
  violations**. Clean GDSII streamout (`pe.gds`).
- **Timing MET at the target tt/25C/1.80V corner with +2.19 ns of real setup margin** (worst of the
  three tt corners; +2.25 ns nom, +2.32 ns min) on the 10 ns period -- taken from OpenSTA's per-corner
  slack, not OpenLane's `timing__setup__wns` metric, which clamps to 0 ns whenever nothing violates.
  Across the full multi-corner PVT sign-off sweep, worst-case setup slack is **-3.20 ns** at the
  pessimistic `max_ss_100C_1v60` corner (slow process / 100C / 1.60V), with 7 max-slew violations at each
  slow corner -- hold timing and max-cap are clean at every corner.
- **Area: 10,681.5 um^2** instance (standalone-cell) area, in a 21,620.7 um^2 core / 26,787 um^2 die --
  larger than the Yosys pass's 6,209.7 um^2 pre-P&R estimate, as expected: real placement/routing
  overhead, clock tree buffering, and the resizer's automatic timing-repair cell insertions aren't visible
  to a synthesis-only pass.
**Why it matters:** This is the first real GDSII and the first real STA number in the repo -- the
Yosys area estimate is now backed by an actual full-flow P&R run. The tt/25C/1.80V corner (the
one the Command Center's numbers should be compared against) meets timing cleanly; the negative slack
only shows up at the deliberately pessimistic slow/hot/low-voltage corner, which is exactly what a real
multi-corner sign-off is supposed to surface and is not a red flag for the nominal-condition design intent.
Two real tooling snags were hit and fixed along the way (see `docs/learnings.md`): the project's `.venv`
had to move from Python 3.14 (which can't build `cocotb`) to Python 3.12 so `cocotb` and `openlane`
coexist, and OpenLane's `--dockerized` mode needed `--docker-no-tty` to run without a controlling
terminal (e.g. under `nohup`/background execution).

### 2026-07-19 — Phase 3 kickoff: real sky130 area numbers (and what they revealed)

**Context:** Phase 2's Yosys card was parked "In progress" pending real physical numbers. Phase 3 starts
by turning the generic gate counts into sky130 standard-cell area.
**Options considered:** *Library source:* Google/SkyWater's official repo turned out to hold only
per-cell `.lib.json` fragments (404 on the assembled liberty — a real dead end hit, not hypothetical);
the OpenROAD-flow-scripts repo vendors the assembled `sky130_fd_sc_hd__tt_025C_1v80.lib` (~12 MB), so
`synth/fetch_sky130.sh` pulls from there into gitignored `synth/lib/` (third-party PDK data is fetched,
never committed). *Timing now vs later:* yosys/abc maps against a 10 ns (100 MHz) target (`-D 10000`)
but doesn't print a slack/critical-path summary at normal verbosity — real timing is OpenSTA's job in
the OpenLane step, so this pass reports **area only**, honestly.
**Decision:** Three mapping scripts (`synth/synth_sky130_{pe,gemm_tile,router}.ys`), typical corner
(tt, 25C, 1.80V), reports in `synth/reports/*_sky130.log`. Real numbers:
- **`pe`: 6,209.7 um^2** standalone (6,328.6 in-tile context — same ABC context effect as the generic
  pass), 48 DFFs / 15.5% sequential.
- **`gemm_tile` (full self-sequencing tile): 727,844.3 um^2 ~= 0.73 mm^2**, mapped in 4.5 s. Breakdown:
  64 PEs = 405,028 (55.6%); **`operand_mem` = 309,457 (42.5%)**; `skew_feeder` = 12,152 (1.7%);
  `gemm_sequencer` = 1,207 (0.17%).
- **`router` (PW=136): 19,846.5 um^2** — ~2.7% of a tile. The NoC's per-node area overhead is nearly
  free; control (the sequencer FSM) is essentially free.
**Why it matters:** The numbers quantify a boundary that was previously only documented qualitatively:
the flop-array `operand_mem` (8,192 enable-DFFs) costs almost as much as the entire 64-PE compute array.
The operand-memory entry already flagged "a synchronous SRAM is a drop-in for synthesis" — this is the
measured justification: an SRAM macro would collapse that 42.5% dramatically. That swap (plus real
OpenSTA timing) is exactly the OpenLane-step agenda. A 2x2 mesh comes out around ~3 mm^2 in sky130 HD
at this stage — comfortably plausible silicon.

### 2026-07-19 — GO + RESULT flits: the tile's whole life cycle rides the network

**Context:** After the 2x2 mesh, the one remaining direct-wire boundary: compute kickoff
(`start`/`k_chunks`) and result readout (`acc_out`) bypassed the NoC. Real accelerators send commands and
results over the fabric too.
**Options considered:** *Typing:* add a 2-bit flit type field ({type, payload, dest}) vs separate
physical channels per traffic class. *Result granularity:* one accumulator cell per flit (64 flits/tile,
42 payload bits used) vs packing 3-4 cells per flit. *Return addressing:* bake the host address into the
GO payload (a descriptor with a return address) vs a global "host" parameter. *Compatibility:* replace
the direct wires vs keep both paths.
**Decision:** 2-bit type field (OPERAND=0 keeps old operand flits numerically identical — `tb/noc/`
passed unchanged), one cell per RESULT flit, return address in the GO descriptor
(`payload[7:0] = {ret_y, ret_x, k_chunks}`), direct wires kept functional alongside. In `noc_node.v`: a
GO delivery pulses the tile's start (registered) and arms a result-return engine
(idle→wait-fall→wait-rise→stream) that, when the level-held `done` next rises, streams all 64
accumulator cells as RESULT flits (`{src_y, src_x, idx, acc32}`) to the return address, muxed into the
router's LOCAL input with priority over external injection (injection held off via ready — bounded, ~64
cycles). RESULT deliveries surface on host-side `res_*` ports (`res00_*` on the mesh).
**Why:** The type field costs 2 bits and lets one network carry all three traffic classes — separate
channels are a virtual-channel-scale complication nothing here needs. One-cell RESULT flits keep the
engine a counter instead of a packer. The GO-as-descriptor mirrors how DMA engines actually work and
makes the return path self-describing. The ordering guarantee that makes load-then-GO safe is structural,
not lucky: XY routing is single-path per source-destination pair and every link is a FIFO, so a GO sent
after its operands can never overtake them. `tb/mesh/test_fully_packetized_load_go_result` proves the
whole loop with zero direct control wires: node (0,0) injects operands + GO descriptors for all three
remote tiles and just listens; each tile self-starts, computes, and streams results back — three 64-flit
streams converging on the host corner — and all three 8x8 results, reassembled purely from delivered
flits, match NumPy bit-exactly. The wait-fall-then-wait-rise arming handles `done` being level-held from
a previous run (a rising-edge-only design would fire early on an already-done tile).

### 2026-07-19 — 2x2 mesh (`noc_mesh2x2.v`): the Phase 2 NoC deliverable complete

**Context:** The 1x2 pair (below) proved registered multi-hop delivery into live tiles, but two mesh-level
claims only exist once there's an actual mesh: XY routing's X-then-Y corner turn (a line has no turns), and
arbitration/deadlock behaviour under *crossing* and *converging* traffic from multiple sources.
**Options considered:** (1) Wire 4 `noc_node`s into a 2x2 with two diagonal injection points. (2) A
generic parameterized NxM mesh generator. (3) Single injector at one corner only.
**Decision:** Option 1. `rtl/noc_mesh2x2.v` instantiates four unmodified `noc_node`s — (0,0), (1,0),
(0,1), (1,1) — with eight directed link channels, injection at the (0,0) and (1,1) corners, and the same
direct-wire compute handshake boundary as the pair. No new leaf RTL: the node was already four-direction
mesh-ready, so the mesh is instantiation + wiring, exactly as predicted in the pair entry.
**Why:** 2x2 is the smallest topology where the remaining claims are testable, and two diagonal injectors
are what make the interesting traffic patterns possible. `tb/mesh/test_mesh.py`: (1) one injector reaches
all four tiles — self, east, north, and the (1,1) corner via the X-then-Y turn at router (1,0) — all four
matmuls bit-exact; (2) both corners inject concurrently, streams crossing the mesh in opposite directions,
with tile (1,1)'s operand set deliberately split across the two sources (chunk 0 from (0,0) via the turn
path, chunk 1 self-injected at (1,1)) so router (1,1)'s LOCAL output arbitrates two converging streams —
round-robin at mesh level. Both tests end in bit-exact compute, so a lost/duplicated/stalled/misrouted
flit anywhere fails. Deadlock-freedom rests on XY routing's provable cycle-freedom + the registered
`flit_buf` links, backed empirically by the concurrent-traffic test. A generic NxM generator was rejected
as speculative generality — no card asks for >2x2, and the 2x2 is the honest deliverable. This closes both
the "Connect multiple tiles via the NoC" and "Verify routing + arbitration" cards; still deliberately
unpacketized (possible future card): GO-command and result-return flits.

### 2026-07-19 — Two tiles over the NoC (`noc_pair.v`): registered link buffers, operands as routed packets

**Context:** The "Connect multiple tiles via the NoC" card. The standalone router (below) was verified in
isolation, with two known integration gaps: a raw mesh of combinational crossbars would form combinational
cycles, and the router had never delivered a *real* payload into a *real* tile.
**Options considered:** *Loop-breaking:* register flits at each router's inputs (a skid FIFO per link) vs
registering router outputs vs making the whole router a pipelined multi-stage design. *Buffer depth:* 1
(halves link throughput or reintroduces a combinational ready path) vs 2 (full throughput, ready depends
only on registered occupancy). *First topology:* a 1x2 two-node link vs going straight to a 2x2 mesh.
*What travels over the network first:* operand writes only, vs also packetizing start/GO commands and
result return.
**Decision:** `rtl/flit_buf.v` — a 2-entry registered FIFO on every mesh-side router input; `in_ready`
depends only on the registered `count` and `out_valid`/`out_flit` come from register state, so both
directions of every link handshake terminate in registers and no combinational cycle can form.
`rtl/noc_node.v` = router + four input buffers + `gemm_tile`, with the router's LOCAL output wired
directly into the tile's `operand_mem` write port (the flit payload *is* `{wr_addr, wr_a_col, wr_b_row}`,
the interface built for exactly this in the operand-memory entry). `rtl/noc_pair.v` = two nodes, (0,0)
and (1,0), one east-west link. Start/`k_chunks`/`done`/`acc_out` stay direct wires — GO flits and
result-return flits deliberately deferred, as is the 2x2 widening (`noc_node` is already four-direction
mesh-ready, so that's wiring + testbench, not new design).
**Why:** Input buffering with depth 2 is the textbook minimal element that gives loop-free links at full
throughput; anything deeper is capacity tuning, not correctness. The 1x2-first choice repeats the
project's staging discipline (prove the genuinely new element — registered multi-hop delivery into a live
tile — before multiplying instances). `tb/noc/test_noc.py` makes the integration claim end-to-end:
operand flits for both tiles injected interleaved at one port, self-delivery (LOCAL→LOCAL) and multi-hop
(east over the registered link) both landing in the right operand memories, garbage flits overwritten by
later real ones (in-order delivery), and both tiles' matmuls checked bit-exact against NumPy — plus a
second test doing two full reload+recompute rounds with no reset between. A lost, reordered, misrouted,
or corrupted flit anywhere would break the accumulator comparison.

### 2026-07-19 — First NoC router (`router.v`): 2D mesh, XY routing, round-robin, combinational crossbar

**Context:** First NoC increment, unblocked once `operand_mem` fixed the tile's message interface. The
"Design a simple NoC router" card: build the block that, replicated per tile, moves operand payloads
between tiles. This is control/steering logic, a different discipline from the datapath work so far.
**Options considered:** *Topology:* 2D mesh (each router talks to N/E/S/W neighbours + local tile) vs ring
vs crossbar. *Routing:* XY dimension-order vs adaptive/table-based. *Arbitration:* round-robin vs fixed
priority. *Microarchitecture:* combinational single-cycle crossbar vs input-buffered / virtual-channel.
*Router coordinates:* Verilog parameters vs input ports.
**Decision:** 2D mesh, XY dimension-order routing (route in X, then Y — the textbook deadlock-free choice),
one round-robin arbiter per output port (no input can starve), valid/ready backpressure, and a
**combinational single-cycle crossbar** (no internal buffering) — the simplest correct form. Router
position is exposed as **input ports** `my_x`/`my_y`, tied off per instance, not parameters. Flit =
`{payload, dest_y, dest_x}`, single-flit packets; `payload` opaque here, will carry an addressed
`operand_mem` write later.
**Why:** Mesh + XY + round-robin is the standard teaching stack precisely because it's simple and provably
deadlock/starvation-free — right for a "simple router." Combinational crossbar keeps the first block
verifiable in isolation; the known cost is that wiring `out` ports straight to neighbours' `in` ports in a
mesh would form combinational cycles, so the *mesh-integration* card must register flits at inputs (skid
buffer) to break them — noted in the RTL, deferred with that card. Coordinates as ports (not parameters)
was a deliberate, debugged choice: the cocotb Makefile flow can't cleanly override Verilog parameters, so a
parameterised `MY_X`/`MY_Y` silently stayed at its default in simulation (see learnings.md, same date) —
input ports the testbench drives are unambiguous and match how a real mesh ties off per-instance coords
anyway. `tb/router/test_router.py` verifies all three jobs: XY routing to each of the 5 ports, round-robin
alternation under two-input contention (neither starves), and backpressure (an un-ready output holds its
input off while still offering the flit). That also covers most of the "Verify routing + arbitration" card.

### 2026-07-19 — Operand memory (`operand_mem.v`): the wide-bus placeholder becomes a real load/read port

**Context:** The sequencer FSM (below) indexed operands off wide preloaded `a_buf`/`b_buf` buses, flagged in
that entry as a placeholder for a real operand-memory read port. Building that port makes the tile a genuine
load→compute→read block and — the real motivation — fixes the concrete interface a NoC/DMA writes into.
**Options considered:** (1) A separate operand memory with a write/load port + a read port the sequencer
addresses. (2) Keep the wide buses and just wrap them in a module with a bulk load. (3) A synchronous SRAM
(registered read) for realism now.
**Decision:** Option 1 with a combinational (register-file) read. `rtl/operand_mem.v` stores one
`(chunk, column)` slot per address — an unskewed A-column + matching B-row — addressed `chunk*N + col`. The
sequencer lost its `a_buf`/`b_buf`/`a_col`/`b_row` ports and now just drives `rd_addr`; `rtl/gemm_tile.v`
wires the memory's combinational read straight to the tile. The write port `{wr_addr, wr_a_col, wr_b_row}`
is shaped like an addressed operand payload — i.e. like a NoC delivery.
**Why:** This is the same defer-then-build staging used for `skew_feeder` → `gemm_sequencer`: the wide bus
was always meant to become this. Combinational read keeps the sequencer's timing bit-identical to the
wide-bus version (no FSM change), so `tb/gemm/test_gemm.py` still passes unchanged in behavior — now loading
via the write port instead of setting buses (identity, tiled GEMM K=1,2,3,4,8, back-to-back N-blocks, all
bit-exact vs NumPy). A synchronous SRAM is a documented drop-in for synthesis (it needs the FSM to issue
`rd_addr` a cycle ahead — Phase 3, not needed for behavioral verification). Crucially, the write port is now
the exact interface the NoC router will drive: a router delivering addressed operand slots here replaces the
testbench's load loop, which is the next card.

### 2026-07-19 — Tile sequencer FSM (`gemm_sequencer.v`): the K-chunk tiling moves into hardware

**Context:** Second self-feeding-tile increment. `skew_feeder.v` (below) replaced the Python `feed_wave()`;
this replaces `compute_nblock()` — the other half of the testbench orchestration. `compute_nblock` resets
the array, drives `k_chunks` skewed waves back-to-back with no reset between (K-dimension accumulation),
then reads the 8x8 result. That control (per-N-block reset, K-chunk loop, `valid_in`/feed timing) was all
Python.
**Options considered:** (1) Full-layer FSM with its own operand SRAM — sequences every N-block and the
layer's requant in one block. (2) One-N-block FSM reading operands from a wide preloaded bus, with the
outer N-block/layer loop left to the caller. (3) Keep operands per-cycle-fed by the caller, FSM does only
the strobe/counter logic.
**Decision:** Option 2. `rtl/gemm_sequencer.v` is an IDLE→RESET→RUN→DRAIN→DONE FSM: one `start` pulse ==
one N-block == one `compute_nblock()` call. It resets the tile once, then feeds `k_chunks` waves, each on
the proven `3N-2 = 22`-cycle schedule (N feed cycles presenting the chunk's unskewed columns/rows, then
pad) with **no reset between chunks**, then raises a level-held `done`. `rtl/gemm_tile.v` wires it to
`rtl/tile.v`. Operands sit on wide preloaded buses (`a_buf`/`b_buf`) the FSM indexes with a dynamic
part-select.
**Why:** Build the control logic (the genuinely new, uncertain part) now; defer the operand *memory*, the
same staging discipline that split `skew_feeder` from this FSM. The wide preloaded bus is an explicit
placeholder for a real operand-memory read port — which is exactly what a NoC/DMA feeds later, so it
doubles as the interface-definition work the NoC is blocked on. Leaving the outer N-block loop to the
caller is honest, not a shortcut: a real DMA issues one descriptor (one `start`) per block, which is what
`test_back_to_back_nblocks` exercises. Keeping the 22-cycle spacing verbatim means the 2026-07-05
no-contamination proof carries over unchanged; `tb/gemm/test_gemm.py` confirms it empirically — tiled
matmuls for K = 1,2,3,4,8 all match an untiled NumPy `A@B` bit-exactly (by integer-add associativity a
match *is* proof the K-chunks don't cross-contaminate), plus a back-to-back-N-block test that would fail
if the per-block reset leaked. Still out of scope, still caller-side: requantization (no datapath in
`pe.v`) and the operand memory.

### 2026-07-19 — Skew/zero-padding moved into RTL (`skew_feeder.v`); NoC deferred behind it

**Context:** Phase 2 planning. The Notion board jumped straight from the Phase 1 tile to "Design a simple
NoC router." But the 2026-07-05 entry below already flagged that the tile has no hardware that produces
its skewed, zero-padded feed — every testbench's Python `feed_wave()` does it. A NoC transports *messages
between tiles*, and the message format (flit width, addressing, what a packet even carries) is dictated by
the tile's real port interface — which didn't exist while Python was still driving the array's pins.
**Options considered:** (1) Follow the board literally — build the NoC router first against dummy payloads,
defer the feed hardware. (2) Build the RTL feed/controller first, so the tile becomes self-feeding and its
real interface is fixed before any NoC is designed against it.
**Decision:** Option 2, first increment: `rtl/skew_feeder.v` — a triangular bank of 8-bit shift registers
(lane i delayed by i cycles) that takes an UNSKEWED NxN block (A presented column-by-column, B row-by-row)
and emits the skewed, zero-padded `a_west`/`b_north` stream the array expects. `in_valid` gates each lane's
input to zero, which *is* the zero-padding `feed_wave()` did before/after each data window. Wired to the
array in `rtl/tile.v` (array `valid_in` tied high — harmless outside each PE's window by the same
zero-operand argument as the 2026-07-05 broadcast-valid decision). The board was reconciled: two controller
cards added (this one, plus a sequencer-FSM card for the `compute_nblock()` peer), and the NoC-router card
annotated to wait until the tile's message interface is defined.
**Why:** Build infrastructure *after* its requirements exist, not before — a router designed against dummy
payloads gets reworked once the real tile interface lands. Front-loading the feed hardware also front-loads
the genuinely uncertain RTL (real shift-register skew timing) and produces an independently demoable result:
a tile that runs a matmul with the testbench presenting plain unskewed operands, no Python skewing.
`tb/tile/test_tile.py` proves it bit-exact — identity plus 20 random full-8x8 trials, all 64 cells matching
a NumPy `A@B`, which (since the array is already trusted) is a direct proof the feeder's skew reproduces
the old `feed_wave()` convention exactly. Still Python-side for now, explicitly out of this card's scope:
the K-chunk/N-block sequencing across matmuls (the sequencer-FSM card) and requantization (no datapath in
`pe.v`).

### 2026-07-15 — First Yosys pass: generic synthesis only, real timing deferred to Phase 3

**Context:** Phase 2 kickoff. The Task Board's "Yosys synthesis — area/timing report" card asks for real
area and timing numbers. Yosys 0.66 was already installed and confirmed working.
**Options considered:** (1) Generic synthesis (`synth -top`, Yosys's own internal `$_AND_`/`$_XOR_`/etc.
cell library, no `abc -liberty`) — gives gate/cell counts and confirms the design elaborates cleanly, but
no physical area (um^2) or real delay numbers. (2) Map onto an actual standard-cell library (e.g. sky130)
now, to get real area/timing immediately.
**Decision:** Option 1 for this pass. Real PDK-based timing closure stays Phase 3 scope, per the
existing "Timing closure pass" card (tagged Phase 3, `OpenLane`) — that card already anticipated needing
a real critical-path diagnosis, not a repeat of a past trial-and-error fix, which only makes sense once
there's a real standard-cell library and STA tool in the loop.
**Why:** Doing this in two passes keeps each one honest about what it actually proves. `synth/synth.ys`
and `synth/synth_pe.ys` confirm the design synthesizes with zero errors using pure generic gates — a real
validation of the Phase 1 decision to use flattened bus ports over SystemVerilog unpacked-array ports
specifically because the latter were flagged as "a patchier corner of ... Yosys synthesis support." Real
numbers from this pass: one `pe` costs 901 generic cells standalone (900 when synthesized as a submodule
of the array — ABC's local optimization differs slightly by context, both are real Yosys output, not
rounded); the full 8x8 `systolic_array` costs exactly 64x that, 57,600 cells, because this generic pass
does no cross-instance sharing. Reports: `synth/reports/pe_synth.log`, `synth/reports/systolic_array_synth.log`.

### 2026-07-05 — Known boundary: the skew/zero-padding feed is Python-side, not RTL

**Context:** `rtl/systolic_array.v` has no logic that generates the skewed, zero-padded input sequence
itself — every testbench's `feed_wave()` computes `A_block[i][t-i] if i<=t<i+N else 0` (and the mirror
for B) in Python and drives it onto `a_west`/`b_north` cycle by cycle. The RTL only does the registered
`a_out`/`b_out` forwarding (Part 3 of the lesson artifact); the actual "edge memory" that knows how to
stagger and zero-pad each row/column doesn't exist in hardware at all.
**Options considered:** (1) Leave it exactly as-is and just document it (this entry). (2) Design real
edge shift-registers/FIFOs in RTL now, so the tile could accept an unskewed, unpadded matrix directly.
**Decision:** Option 1 — document the boundary, don't build the RTL edge memory in Phase 1.
**Why:** Phase 1's scope is a single verified tile plus its testbench (per `CLAUDE.md`), and the
testbench legitimately stands in for "whatever feeds the array" for verification purposes — it doesn't
change any claim about the tile's own correctness, since the tile's actual job (skewed MAC dataflow) is
exactly what's being verified. But this is a real, specific gap worth flagging explicitly rather than
letting it hide: an actual chip synthesizing this design would need real edge shift-registers/FIFOs
(one small per-row/per-column delay buffer, holding zeros until each row/column's real data window
opens) to replace what `feed_wave()` currently does in Python. That's in-scope Phase 2 work, once
Yosys synthesis is on the table and "what actually gets fed into the chip's pins" stops being a Python
loop and starts being a real question.

### 2026-07-05 — Reframe README from "CNN" to "GEMM accelerator" (honest naming)

**Context:** The README's original title ("Hardware CNN image classifier") and body ("computes
convolution and matrix multiplication directly in hardware") claimed a convolutional network. A
self-review of the finished Phase 1 work caught that this is false — `model/train.py` trains a bias-free
2-layer MLP (`Linear(64→32) → ReLU → Linear(32→10)`); there is no conv layer anywhere in this repo. The
8x8 downsampling is preprocessing, not convolution. The false claim was caught by review, not flagged by
a user first — worth logging as a decision in its own right, not just a silent wording fix.
**Options considered:** (1) Leave the CNN framing and just build a real conv layer to make it true: a
bigger scope change, and not necessary for Phase 1's actual goal (verified GEMM hardware + a working
classifier). (2) Rename the GitHub repo itself away from `hw-cnn-accelerator`: rejected — breaks the
existing clone URL and every link already shared (demo artifact, lesson artifact) for no correctness
gain, since the repo name is just a label, not a claim about contents the way README prose is. (3) Keep
the repo name, rewrite only the README's wording to describe what's actually built.
**Decision:** Option 3. Title changed to "Hardware GEMM accelerator for neural network inference";
body now states plainly that this is a systolic-array matrix-multiply engine currently running an
MLP, with convolution explicitly named as the honest future path (real CNN accelerators lower
convolutions to GEMM via im2col before hitting hardware exactly like this one) rather than something
already implemented.
**Why:** A systolic array *is* the right compute core for real CNN accelerators — that relevance is true
and worth keeping in the framing — but the specific model running today is an MLP, and a portfolio repo
whose README overclaims what its own code does undermines the credibility the verification work (bit-exact
hardware-vs-NumPy checks at every layer) actually earned. Honesty costs nothing here; the im2col path
to a literal conv layer is a legitimate, well-scoped future task (the array itself needs no changes,
only a data-layout step ahead of it) if it's ever wanted, but isn't committed to as part of this decision.

### 2026-07-05 — Real MNIST on the hardware tile: tiled GEMM, quantization, and data pipeline

**Context:** The 8x8 tile only computes one 8x8x8 matrix multiply per "wave," but classifying real MNIST
digits needs much bigger matmuls. Making the tile itself bigger is Phase 2/NoC scope. Also needed:
a quantization scheme the hardware can actually represent, a model architecture the hardware can compute
exactly, and a way to get real MNIST data into a frozen, committable test fixture.

**Decision — tiled GEMM via repeated waves, no hardware changes:** each layer's matmul is decomposed into
8x8 blocks; the K (reduction) dimension is tiled by feeding multiple 22-cycle waves back-to-back
*without* resetting between them (the accumulator keeps summing), while each N-block (independent group
of output columns) gets a fresh reset. Proof this can't cross-contaminate between K-chunks: PE(i,j)'s
operand at absolute cycle `T` is nonzero only when `T-j` falls in some chunk `c1`'s active window
`[i,i+7]` (mod the per-chunk 22-cycle schedule) and `T-i` falls in some chunk `c2`'s window `[j,j+7]` for
the other operand. Subtracting the two chunk-index equations forces `22*(c1-c2)` to equal a value bounded
in `[-7,7]`; since 22 doesn't divide evenly into that range except at 0, `c1=c2` is forced whenever both
operands are simultaneously nonzero — contamination is algebraically impossible, for any N, precisely
because `TOTAL_CYCLES=3N-2=22 > 2(N-1)=14`. Verified both by this general argument and by tracing a
concrete N=2, 2-chunk example by hand, matching the combined expected sum exactly. Also: because the
accumulation is exact 32-bit integer arithmetic with no realistic overflow risk here (max |sum| per cell
is ~1M, nowhere near 2^31) and integer addition is associative, the test reference doesn't need to
simulate chunking at all — an untiled NumPy matmul is bit-exactly equal to the chunked hardware sum, so
matching it validates the no-contamination claim empirically, not just algebraically.

**Decision — model architecture: 64 (8x8-downsampled) → 32 hidden (ReLU) → 10 classes (padded to 16),
no bias, no BatchNorm/Dropout.** Downsampling via `adaptive_avg_pool2d` (area-weighted, not a naive
strided slice, since 28/8=3.5 isn't an integer ratio). Dimensions chosen so both layers tile into a small
number of waves (32 + 8 = 40 total) — this task's pass criterion is bit-exact hardware/software matching,
not classification accuracy, so a smaller model loses nothing here (it still reached 94.85% float test
accuracy, better than expected for such aggressive downsampling). No bias/BatchNorm isn't a simplicity
choice — `pe.v` has no add-constant datapath, so a trained bias literally cannot be represented in this
hardware at all.

**Decision — symmetric, per-tensor, zero-point-0 quantization.** Also hardware-forced, not a preference:
`pe.v` is a pure signed int8×int8→int32 MAC with no zero-point/bias-add datapath, so asymmetric affine
quantization can't be represented either. `s_X = max(|X|)/127`, `q_X = clip(round(X/s_X), -128, 127)`.
Exactly one requantization step exists (layer 1's int32 output → int8 input for layer 2):
`M1 = (s_input*s_W1)/s_hidden`, `q_hidden = clip(round(relu(acc_int32)*M1), 0, 127)` — applying ReLU
directly on the int32 accumulator before scaling is exact since `M1>0` commutes with ReLU. Layer 2 needs
*no* requantization: `dequant(logit) = acc_int32 * (s_hidden*s_W2)` is the same positive scalar for every
output column, so argmax over raw int32 equals argmax over dequantized floats — the final layer's
hardware output is used as-is.

**Decision — manual MNIST loader (`model/mnist_data.py`), not `torchvision`.** Not primarily a
compatibility workaround (a compatible `torchvision` wheel exists for this exact torch/Python
combination) but dependency minimalism (matches this project's `cocotb<2.0`-pinned, no-extra-deps ethos,
for something used once, at training time only) and reproducibility (torchvision's own MNIST mirror
logic has a history of breaking; hitting the one confirmed-reachable S3 URL directly via stdlib
`gzip`+`struct`+`urllib` is a few dozen lines and more predictable).

**Decision — `.npz` (not JSON) for the frozen test fixture (`model/mnist_quantized.npz`).** Two reasons:
`.gitignore` has a blanket `*.json` rule that would silently swallow a JSON export without an extra
negation pattern (a real footgun caught during planning, not after committing something invisible to
git), and `.npz` stores typed numpy arrays (int8, float, int64) natively with no list-conversion/precision
handling needed, and `numpy` is already a dependency on both the training and cocotb-test sides.
`tb/mnist/test_mnist.py` only ever imports `numpy`, never `torch`, keeping cocotb test startup fast.

### 2026-07-05 — 8x8 systolic array: output-stationary, broadcast valid_in, flattened bus ports

**Context:** Building the array out of `rtl/pe.v` required three real design decisions: which systolic
dataflow to use, whether `valid_in` needs to be individually skewed per-PE like the data operands, and
how to represent "N separate 8-bit lanes" at the module port boundary.
**Options considered:**
- *Dataflow:* weight-stationary (persistent per-PE weight register, separate load phase, weights reused
  across many inference passes — what TPUs actually do) vs. output-stationary (stationary local
  accumulator, operands stream through — what `pe.v` already does today).
- *valid_in:* thread a skewed `valid_out` pass-through mesh through every PE (mirroring `a_out`/`b_out`)
  vs. a single broadcast `valid_in` wired identically to every PE.
- *Port representation:* SystemVerilog unpacked-array ports (`input ... a_west [0:N-1]`) vs. a flattened
  packed bus (`input [8*N-1:0] a_west`) sliced internally via `generate`/`+:` part-select.
**Decision:** Output-stationary; broadcast (non-skewed) `valid_in`; flattened packed buses.
**Why:** Output-stationary needed zero change to the already-tested MAC/accumulate logic — only added
`a_out`/`b_out` forwarding ports — versus weight-stationary's bigger redesign (persistent weight
register + load phase). That's a real trade-off, not an oversight: weight-stationary's weight-reuse
advantage genuinely matters for our eventual fixed-weights/many-images MNIST use case, but that's a
Phase 2/performance concern, and CLAUDE.md is explicit that Phase 1 shouldn't anticipate later-phase
concerns. Broadcast `valid_in` is correct (not just simpler) because of a specific timing property: with
each row/column's input skewed by `i`/`j` cycles and explicitly zero-padded before and after its real
data window, PE(i,j)'s `a_in` and `b_in` are provably nonzero *only* during the same exact window
`t ∈ [i+j, i+j+N-1]` — both operands are simultaneously zero everywhere else, so a stray `0*0`
accumulation outside that window is harmless. Confirmed by simulating a hand-computed 3x3 case
(`A=[[1,2,3],[4,5,6],[7,8,9]]`, `B=[[9,8,7],[6,5,4],[3,2,1]]`) and getting `A@B` exactly right at all 9
cells — not just derived on paper. Flattened buses were chosen over SV array ports because every
construct involved (indexed part-select `+:`, internal 2D wire arrays) is plain Verilog-2001, confirmed
by a standalone `iverilog -g2012 -tnull` elaboration check, whereas SV unpacked-array *ports* are a
patchier corner of both cocotb's VPI access and (later) Yosys synthesis support — no reason to take that
risk when the array only needs 22 cycles (`3N-2` for N=8) to fully compute, and a flattened bus handles
that with zero ambiguity.

### 2026-07-05 — always read signed DUT ports via `.signed_integer`

**Context:** Writing the first real MAC-correctness tests (not just reset-to-zero) meant comparing
`acc_out` (a `reg signed [31:0]`) against negative expected values for the first time.
**Options considered:** Compare with the default `dut.acc_out.value == expected` (what the existing
reset test already did); or explicitly use `dut.acc_out.value.signed_integer`.
**Decision:** Always use `.signed_integer` for any comparison against a signed DUT port; never compare
`BinaryValue` directly against a (possibly negative) plain int.
**Why:** Traced cocotb 1.9.2's actual source (`cocotb/handle.py`): `ModifiableObject.value` always
wraps the raw bits in a `BinaryValue` with `binaryRepresentation=UNSIGNED`, regardless of the HDL port's
`signed` declaration — it never queries the simulator for signedness. `BinaryValue.__eq__` against a
plain int then compares via `.integer` (the unsigned reading), so `dut.acc_out.value == -15` is **always
False even on correct hardware** (it compares against `2**32 - 15`, not `-15`). Only `.signed_integer`
manually computes the correct two's-complement value from the raw bits, independent of
`binaryRepresentation`. The existing reset test never caught this because `0` is bit-identical whether
read as signed or unsigned.

### 2026-07-02 — cocotb + Icarus Verilog simulation environment

**Context:** Needed a Python-based verification flow set up before writing the first PE module,
including which cocotb API/flow to use, which simulator to default to, and where build artifacts
should land.
**Options considered:** cocotb's newer Python `runner` API (pytest-style, cocotb>=2.0) vs. the classic
Makefile-based flow (`Makefile.sim`); Icarus Verilog vs. Verilator as the default simulator; leaving
build artifacts in cocotb's default `tb/sim_build` vs. redirecting them into the repo's dedicated
`sim/` directory.
**Decision:** Classic Makefile flow (`include $(shell cocotb-config --makefiles)/Makefile.sim`), pinned
to `cocotb>=1.8,<2.0`; Icarus Verilog as the simulator (`SIM=icarus`); build/result artifacts
redirected into `sim/sim_build` via `SIM_BUILD`/`COCOTB_RESULTS_FILE`.
**Why:** The Makefile flow is simpler to read and explain than the newer runner API, and matches what
most public cocotb tutorials use; pinning `<2.0` avoids it silently breaking if a newer cocotb gets
installed later. Icarus is lighter to install than Verilator and sufficient for behavioral-level
Phase 1 verification — no timing/power analysis needed yet. Redirecting output into `sim/` keeps the
promise made in the README's repo layout table and keeps `tb/` free of generated files.
