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
