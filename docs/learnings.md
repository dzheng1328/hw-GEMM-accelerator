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
