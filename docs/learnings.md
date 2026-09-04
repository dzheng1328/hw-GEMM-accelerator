# Learnings log

A running log of real problems hit during this project and how they were
solved. Add an entry whenever something breaks, takes longer than expected,
or teaches you something you'd want to remember (or explain in an interview).

Keep entries short and specific. Quick scratch notes can live elsewhere
(e.g. Notion) and get distilled into an entry here once the problem is
actually resolved.

---

## Template

### [Date] — [short title]

**Phase:** Phase 1 / 2 / 3
**Problem:** What broke or went wrong.
**Cause:** What was actually causing it, once you found it.
**Fix:** What you changed.
**Takeaway:** One sentence — what would you tell someone hitting this next.

---

<!-- Entries below, most recent first -->

### 2026-09-02 -- A documented testbench gotcha didn't stop the same bug from recurring twice in one branch

**Phase:** Phase 3
**Problem:** Issue #32's new `tb/operand_mem/test_operand_mem.py` hit the exact same class of bug this
file already documented in its 2026-07-05 entry ("reading acc_out right after RisingEdge saw stale
values"), and it hit it twice, in two separate assertion blocks within the same new test function
(`test_read_latency_is_registered`), requiring two separate fix rounds during implementation (commits
`d5be170` and `9b46ae4`).
**Cause:** The root cause is the same one the 2026-07-05 entry already fully diagnosed: `await
RisingEdge(dut.clk)` resumes the test coroutine in the simulator's Active region, which fires before the
RTL's own non-blocking register updates settle in the NBA region for that same edge, so a signal read
immediately after `RisingEdge` (or immediately after a plain signal assignment, in the first block's case)
sees a stale value rather than the value that update actually produced.
The first occurrence (commit `d5be170`) was a same-cycle assertion right after driving `dut.rd_addr.value`
that passed vacuously against both the old combinational RTL and the new registered RTL, because neither
variant's output had a chance to respond to the new address before the assertion ran.
The second occurrence (commit `9b46ae4`) was a different assertion block in the same test function,
immediately after a second `await RisingEdge(dut.clk)`, that only started failing once Task 2 replaced the
combinational RTL with the real registered-read macro; against the old combinational RTL this race never
mattered, because a combinational read reflects a new address instantly regardless of the read-timing
race, so the latent bug sat unexercised until a genuinely registered `operand_mem.v` existed to expose it.
**Fix:** Both instances got the same fix already documented in the 2026-07-05 entry: insert `await
Timer(1, units="ns")` between the triggering event and the read, letting the NBA update settle before the
assertion runs.
**Takeaway:** Having a gotcha documented in this file did not, by itself, prevent the same mistake from
being written twice in the same branch.
The lesson isn't "read the docs again," it's that a documented pattern like this one needs to be actively
checked against every new `await RisingEdge` (or any driven-signal read) plus an immediate register read
while writing a testbench, not just remembered in the abstract and trusted to surface itself.
For the record, not fixed in this pass: the final whole-branch review found `test_operand_mem.py` still
has two more instances of this same pattern, un-settled reads after a double `await RisingEdge(dut.clk)`
with no `Timer` in between the second edge and the assertion, in the read loops inside
`test_write_then_read_all_slots` (current HEAD: lines 62-65) and `test_banks_are_independent` (current
HEAD: lines 108-111).
The review's own cited line numbers (88-89, 131-132) do not match the file as it stands at `15ac2d4`; the
content of the finding is confirmed real by inspection even though those specific line numbers are not.
Both loops happen to pass because the second `RisingEdge` lands a full clock period after the register
write that mattered already settled, not because the race was actually closed the way the two fixed
assertion blocks above were.
This is a known, deferred loose end, intentionally left untouched by this fix wave (out of scope) rather
than an oversight.

### 2026-09-02 -- A prior session's "next step" for the SRAM macro's LVS gap was a plausible-looking guess, not a verified diagnosis

**Phase:** Phase 3
**Problem:** The prior session's notes said KLayout's LVS "netlists don't match" was caused by
`NetlistSpiceReader` uppercasing the schematic's circuit/net names while the layout-extracted netlist
stayed lowercase, and that the next step was to make `sky130.lylvs` read the schematic case-sensitively.
That diagnosis was plausible (it correctly identified a real case fold) and came with real supporting
evidence (an exact count of uppercase occurrences), which made it easy to carry forward as settled and
start implementing the fix it implied.
**Cause:** The case fold was real, but it was never the cause of the actual failures.
Direct RBA API testing showed `circuit_by_name` lookups are case-insensitive, and the real `.lvs.report`
showed every single "could not be compared" entry correctly pairing the lowercase and uppercase versions
of the same circuit — pairing was never broken.
A second, more specific hypothesis (that `connect_global(SUB,"gnd")`'s hardcoded lowercase net names
were the real blocker, since they can only ever match the layout side) was also real and directly
verified with a `NetlistSpiceReaderDelegate` fix — but applying that fix and re-running the actual LVS
check end to end left the failure count completely unchanged, disproving it too.
The real cause (a body/bulk-tie terminal splitting into a separate net instead of merging into the
ground rail, isolated to 5 vendor-proprietary `sky130_fd_bd_sram__` cells) only surfaced by dumping the
extracted circuit's actual pins and device-terminal references via the RBA API and comparing schematic
vs. extracted port counts directly, not by reasoning about the report text.
**Fix:** Treated the inherited "next step" as a hypothesis to test, not a diagnosis to implement — the
first real test (a minimal Ruby repro reading the schematic and checking `circuit_by_name` case
sensitivity) took under a minute and immediately showed the plan's premise was wrong, before any time
was spent editing the real LVS script for the wrong reason.
**Takeaway:** A confident-sounding root-cause note from a previous session (even one full of real,
verified evidence, like an exact occurrence count) is still a hypothesis until the fix it implies is
actually tried and shown to change the outcome — cheap, targeted experiments against the real tool
(a 10-line RBA script, a 45-second LVS re-run) are faster than trusting the inherited narrative and
finding out three steps later.

### 2026-09-01 -- The operand_mem SRAM macro's Magic extraction wasn't failing on a bug, it was hitting Docker's memory ceiling

**Phase:** Phase 3
**Problem:** `openram/run_operand_sram.sh`'s Magic-based extraction/LVS step for the `operand_mem` SRAM
macro (issue #31) had never once completed. The clearest symptom was a `.ext.out` log that stopped
mid-stream at `Extracting sky130_sram_512b_1rw_64x64_bank into sky130_sram_512b_1rw_64x64_bank.ext:`,
right after Magic logged `Created database crash recovery file`. That message looks like a crash signal,
and it was tempting to chase it as one (e.g. by hand-patching the extraction script to pre-stage `.mag`
files the way the DRC script does).
**Cause:** Docker Desktop was allocated only 7.65GB of the host's 24GB (`docker info --format
'{{.MemTotal}}'`). This macro's largest intermediate extraction artifacts are genuinely huge --
`sky130_sram_512b_1rw_64x64_sky130_bitcell_array.ext` alone hit 140MB on disk, with the live in-memory
Magic database around it larger still -- because OpenRAM's own generator (`compiler/verify/magic.py`)
unconditionally sets `gds flatten true` for a macro this size. `"Created database crash recovery file"`
is actually just Magic's routine periodic autosave checkpoint (confirmed live: the container was still at
99% CPU and only 300MB of a 15.6GB limit when that exact message reappeared on the successful run), not a
crash indicator by itself -- the real signal was the extraction simply never reaching `Finished extract`.
**Fix:** Bumped Docker Desktop's memory limit to 15.6GB via its GUI (Settings -> Resources -> Memory; no
safe CLI or config-file path was found for this in the installed Docker Desktop version). Re-ran the same,
unmodified, OpenRAM-generated `run_ext.sh`. It reached the same "start of bitcell_array extraction"
milestone in ~9 minutes instead of the ~45-60 minutes the old, memory-constrained run took to reach the
same point (per file mtimes) before eventually stalling, then sailed through `bank` (the exact cell that
had killed every prior attempt) and finished cleanly: exit code 0, first successful full extraction of
this macro ever produced.
**Takeaway:** When a long-running EDA/simulation tool's log just stops mid-operation with no explicit
error, check the container/VM memory ceiling before treating any nearby log message as the root cause --
an innocuous-looking checkpoint/autosave message right before the log goes silent is exactly what memory
pressure or an OOM kill looks like from the tool's side, and it's easy to mistake it for the actual
failure.

### 2026-08-12 -- A negative timing slack wasn't fixed by guessing SDC knobs -- it took reading the actual critical path

**Phase:** Phase 3
**Problem:** `pe.v` failed setup timing (-3.20ns worst-case) at the pessimistic `max_ss_100C_1v60`
sign-off corner. It would have been easy to try random OpenLane config knobs (`IO_DELAY_CONSTRAINT`,
`PL_RESIZER_*`, `SYNTH_STRATEGY`, etc.) until a metric looked better -- exactly the "Connect-4
trial-and-error" pattern the Task Board card explicitly warned against repeating.
**Cause:** Reading `openlane/pe/runs/.../54-openroad-stapostpnr/max_ss_100C_1v60/max.rpt` (the actual
OpenSTA critical-path report, not just the aggregate `metrics.json` slack number) showed every violating
path starts at `b_in` (specifically bits 1 and 3) and runs through ~25 combinational standard-cell stages
-- the PE's multiply-accumulate logic itself, not routing or placement. That immediately ruled out an
entire class of P&R-level fixes (placement tuning, routing congestion relief) and pointed at two specific,
testable causes: the SDC's generic input-delay assumption, and the RTL's single-cycle datapath length.
**Fix:** Tested each cause as an isolated, single-variable hypothesis rather than changing several things
at once. Halving `IO_DELAY_CONSTRAINT` (20% -> 10%) recovered slack by almost exactly the 1ns of margin
that change should mathematically free up (-3.20ns -> -2.21ns, 0.99ns actually recovered) -- close enough
to confirm it wasn't a coincidence. Pushing that same knob to its logical extreme (0%) only recovered to
-1.38ns and was still a violation, which is what proved the remaining gap is a real RTL/microarchitecture
limit (the unpipelined MAC), not something any SDC tuning could hide.
**Takeaway:** When a metric is bad, read the tool's own root-cause report (the critical path, the actual
error, the actual log line) before touching any config -- it usually tells you which category of fix even
applies. Then test config hypotheses one variable at a time and push to a boundary case when unsure: a
boundary test that still fails is often the cleanest possible proof that further tuning is a dead end and
the real fix is elsewhere (here, in the RTL, not the flow).

### 2026-08-12 — First OpenLane run: two real environment/tooling failures before a clean flow

**Phase:** Phase 3
**Problem:** Two separate failures before `./openlane/run_pe.sh` completed. (1) After installing
`openlane`, the project's `.venv` was silently missing `cocotb` -- the entire existing test suite
(`./test.sh`) was broken. (2) The first two attempts to actually run the flow died with no error in the
log at all -- processes just vanished partway through a Docker image pull.
**Cause:** (1) The only Python available via Homebrew on this machine was 3.14; `cocotb` (pinned
`cocotb>=1.8,<2.0`) can't build its C extension on Python 3.14, so `pip install -r requirements.txt`
silently left it uninstalled while `openlane`/`torch`/`numpy` installed fine -- nothing errored, so the
gap was easy to miss. (2) Both dead runs were launched from inside a dispatched subagent's own background
shell; when that subagent's session ended (its own "no progress" watchdog fired once, after it had armed
a Monitor and returned control), the harness tore down its whole process group -- silently killing the
detached `docker pull`/`openlane` processes it had spawned, with no error surfaced anywhere. Separately,
once run directly (not through a subagent), a *third* failure surfaced: OpenLane's `--dockerized` mode
defaults `docker_tty=True`, passing `-t` to `docker run`, which fails immediately ("the input device is
not a TTY") when there's no controlling terminal -- true for any background/`nohup` run -- so the earlier
subagent-launched attempts may have died for this reason too, independent of the process-teardown issue.
**Fix:** (1) Installed `python@3.12` via Homebrew and recreated `.venv` on it -- both `cocotb` (1.9.2) and
`openlane` (2.3.10) install cleanly with prebuilt wheels, no from-source workarounds needed. (2) Launched
the actual flow directly from the controlling session's own `run_in_background` Bash call instead of
through a subagent, so it isn't tied to a subagent's lifecycle. (3) Added `--docker-no-tty` before
`--dockerized` in `openlane/run_pe.sh` (confirmed via `openlane/__main__.py` source: the flag must precede
`--dockerized` and controls exactly this).
**Takeaway:** A `pip install` that "succeeds" can still silently drop a package that fails to build on the
active Python version -- always verify every expected import after a dependency install, not just the new
one. And any long-running process you need to outlive a single turn belongs in the controlling session's
own background job, not inside a dispatched subagent whose own lifecycle (and watchdog) you don't control.

### 2026-07-19 — A Verilog parameter default silently diverged from the cocotb testbench (router all-routed-to-LOCAL)

**Phase:** Phase 2
**Problem:** The new `router.v` tests failed with every flit routing to the wrong port — first everything to
LOCAL, then to WEST — even though a standalone Icarus probe of the exact same scenario routed correctly.
Confusingly, one of the three tests *passed*, for the wrong reason.
**Cause:** Two compounding issues, both about values that live in the RTL defaults, not the testbench. (1)
`MY_X`/`MY_Y` were Verilog *parameters* defaulting to 0; the cocotb Makefile flow has no clean way to
override a parameter, so the DUT sat at coordinate (0,0) while the testbench assumed (1,1). (2) After
converting those to input ports, the flit width still diverged: `router.v`'s `PW` (payload width) defaults
to **64**, but the testbench hard-coded `PW=32`, so `FW = PW+2*AW` was 68 in RTL vs 36 in Python — every
`in_flit[port*FW +: FW]` slice was misaligned, and `dst_x` read as 0. The standalone probe worked only
because it explicitly instantiated the router with `PW=32`, masking the mismatch. `abc6` in the flit dump
sitting at the wrong bit offset (144 vs the RTL's 272) was the tell.
**Fix:** Made `my_x`/`my_y` input ports the testbench drives (also more realistic — a mesh ties off
per-instance coords), and aligned the testbench's `PW` to the RTL default (64). Both `router.v` and
`test_router.py` now carry a "must match" comment on the width.
**Takeaway:** Any RTL parameter that a cocotb testbench also encodes as a Python constant is a silent
divergence waiting to happen — the Makefile flow won't override it, so the default wins in simulation. Keep
such values in exactly one place (drive them as ports, or pass `-P`/`COMPILE_ARGS` explicitly) and comment
the coupling. When a DUT behaves impossibly, dump its *inputs as the DUT sees them* early — the misplaced
`abc6` offset pointed straight at the width mismatch.

### 2026-07-19 — The skew shift-register's delay lined up "for free" because of non-blocking semantics

**Phase:** Phase 2
**Problem:** Building `rtl/skew_feeder.v`, I expected an off-by-one fight: lane 0 is a combinational
pass-through (delay 0) while lane i>=1 is an i-deep shift register, and the array samples `a_west`/`b_north`
on the same clock edge the feeder's own registers update on. It seemed like mixing a combinational lane
with registered lanes should shift the diagonal by a cycle and corrupt `A@B`. I budgeted time to
trial-and-error the alignment.
**Cause:** No fight — the timing is exact by construction. Both the feeder's shift-register stages and the
downstream PE input registers update with non-blocking assignments (`<=`) on the same `posedge`. Under
Verilog NBA semantics the PE reads the *old* (pre-edge) value of the feeder's last stage, so a depth-i
shift register presents, at the edge ending step t, the value fed at step (t-i) — exactly the old
`a_lanes[i] = A[i][t-i]` convention. Lane 0 combinational (delay 0) and lane i registered (delay i) compose
into precisely the right diagonal with zero base-latency offset.
**Fix:** Nothing to fix — `tb/tile/test_tile.py` passed on the first run (identity + 20 random full-matrix
trials, all 64 cells bit-exact vs NumPy `A@B`).
**Takeaway:** When a producer register and a consumer register share a clock edge and both use `<=`, the
consumer sees the producer's pre-edge value — so a depth-N shift register is exactly N cycles of delay at
the consumer, and combinational + registered lanes compose cleanly. Reason it through with NBA old-value
semantics before assuming an off-by-one.

### 2026-07-05 — `make -C` broke the Makefiles that `cd && make` had proven working

**Phase:** Phase 1
**Problem:** Rewrote `test.sh` to run both `tb/` and `tb/array/` suites via `make -C tb "$@"` /
`make -C tb/array "$@"` for brevity. Failed immediately: `No rule to make target
'.../../sim/sim_build/results.xml'` — a path resolved one directory too high, even though the exact same
Makefile worked fine moments earlier via plain `cd tb && make`.
**Cause:** Both `tb/Makefile` and `tb/array/Makefile` build their `SIM_BUILD`/`VERILOG_SOURCES` paths off
`$(PWD)`, expecting the shell to have already `cd`'d into that directory before invoking `make` (so
`$(PWD)` reflects the Makefile's own directory). `make -C <dir>` changes directory internally *after*
already inheriting `PWD` from the invoking shell's environment (the repo root in this case) — on this
system's `make` (`/Library/Developer/CommandLineTools/usr/bin/make`), `$(PWD)` inside the Makefile still
resolved to the original caller's directory, not the `-C` target, so every `$(PWD)/../...` path was off
by one level.
**Fix:** Replaced `make -C <dir>` with explicit `cd "<dir>" && make` in `test.sh`, matching the exact
invocation style already proven to work.
**Takeaway:** Don't assume `make -C <dir>` is interchangeable with `cd <dir> && make` when a Makefile
relies on `$(PWD)` (as cocotb's own `Makefile.sim` convention does) — verify with the same `cd`-based
invocation the Makefile was already tested under, especially across different `make` implementations
(BSD/macOS vs GNU).

### 2026-07-05 — reading acc_out right after RisingEdge saw stale values

**Phase:** Phase 1
**Problem:** New MAC-correctness tests (checking `acc_out` against real products, not just 0) all failed
with `acc_out=0` no matter what `a_in`/`b_in` were driven — looked exactly like the accumulate branch
was never taken, even though the RTL looked correct.
**Cause:** `await RisingEdge(dut.clk)` resumes the test coroutine in the simulator's Active region, which
fires *before* the RTL's own `always @(posedge clk) acc_out <= ...` non-blocking assignment settles in
the NBA region for that same edge — so a read immediately after `RisingEdge` sees the pre-edge value.
The original reset-only smoke test never caught this because `0` was the correct answer either way.
First attempted fix, `await ReadOnly()` after `RisingEdge`, correctly fixed the stale-read problem but
then broke every test that wrote a new signal value afterward (e.g. `dut.valid_in.value = 0`), raising
`Exception: Write to object valid_in was scheduled during a read-only sync phase` — the read-only phase
forbids scheduling any new writes, by VPI design (the simulator has already locked that timestep's
values).
**Fix:** Replaced `await ReadOnly()` with `await Timer(1, units="ns")` (well under the 10ns clock
period) after every `RisingEdge` that precedes a register read. Advancing real simulation time — not
just the phase within the same timestep — settles the NBA update *and* leaves writes allowed again
afterward.
**Takeaway:** For synchronous designs, don't sample a `reg` immediately after `await RisingEdge(clk)`;
either wait past the edge with a small `Timer`, or use `ReadOnly()` only when nothing needs writing
again within that same test step.
