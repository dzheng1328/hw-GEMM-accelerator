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
### 2026-10-15 -- ALU commands do not wait for the DMA, so a perf tag needs a WAIT before it clears

**Phase:** Phase 4.3 (4.3g)
**Problem:** Planning the attention perf tag, the obvious program was "set r31, run the attention BLOCKs, clear r31". `cmd_seq` executes `step` commands (ADD, ALU, LOOP, ENDLOOP) as soon as the previous BLOCK's handoff is done, but a BLOCK's last flits are still being injected at node (0,0) after the handoff (the DMA carries them down its own pipeline), so a bare clear would count that tail as untagged.
**Cause:** `drain` applies only to WAIT, END and VOP; the register-stability contract ends at the handoff, not at the last injected flit.
**Fix:** The lowering emits a WAIT before every tag clear. The mutation without the WAIT was detected on 2x2 and 4x3 via the GO equality (`attn_go_cyc == attn_blocks`, 3430 vs 3520 with the WAIT removed), and NOT detected on 1x1; the static WAIT-before-clear test in `compiler/test_lower_lm.py` is the 1x1 guard. The testbench also checks `attn_slot_cyc == Tracer.tagged_slots`, which catches it only on some meshes, so the GO equality is the dynamic detector.
**Takeaway:** Any counter or flag keyed on a register that a BLOCK's flits outlive needs a drain before it changes; a test that compares attributed counts with the golden's own attribution is what catches it, and a mesh where the mutation is invisible needs a static test.

### 2026-10-15 -- The model ends a story with BOS and never samples EOS

**Phase:** Phase 4.3 (4.3g)
**Problem:** The spec and the first report code keyed a story's end on EOS, and no story in the 256-step runs ever sampled one, so the end marker never fired.
**Cause:** The model learned to start the next story with BOS and to stop the previous one there; EOS (token 2) is never the sampled token.
**Fix:** A story ends at the step that sampled the next BOS, and the trace field is `end_step` (the spec's "step it emitted EOS" is amended).
**Takeaway:** Check what the trained model actually emits before wiring a report to a token the spec says exists.

### 2026-10-15 -- The hang budget needed a squared term: decode cost grows with the position

**Phase:** Phase 4.3 (4.3g)
**Problem:** The 256-step 4x4 run the old `lm_extra_cycles` budget was only 1.49x the real length of the 256-step 4x4 run, under the 1.5x margin the budget test requires (a thin margin, not an overrun).
**Cause:** Each step costs more than the one before (about 1,400 cycles more per step on 2x2, since attention and SOFTMAX grow with the context), so the total grows as steps squared, and the budget was linear in steps.
**Fix:** `lm_extra_cycles` gained a `150*steps*steps` term; the measured runs are pinned in `test_cases.LM_MEASURED` (the budget is 1.65 to 2.8 times the real cycles).
**Takeaway:** A budget for a decode loop must grow quadratically with its length; check it against the longest real run, not the short cases.

### 2026-10-15 -- Wall-clock time of a long simulation is not simulation speed

**Phase:** Phase 4.3 (4.3g)
**Problem:** The four long runs' wall times were inflated and uneven because the laptop slept during them.
**Cause:** Wall clock keeps running through sleep; the simulator does not.
**Fix:** `lm.md` and the PR report cycles only, not wall time.
**Takeaway:** Do not publish the wall time of a long run as a speed number.

### 2026-10-14 -- A restored mutant can leave a build that still tests the mutant

**Phase:** Phase 4 (4.3f)
**Problem:** After a mutation check (delete a guard, build, see the probe fail as intended, restore the file), `make vpu-check` kept failing: the probe ran but the guard was not in the build, and the whole `./test.sh` stopped at that step.
**Cause:** The mutated Icarus build finished in the same second the file was restored; `sim.vvp` and `rtl/accel.v` showed the same modification time to the second, so `make` judged the mutated build current and never rebuilt it.
**Fix:** Delete the simulator's build directory (or touch the file and wait out the second) after every restore; the 4.3f plan's mutation protocol says so.
**Takeaway:** A test that passes after a mutation run proves nothing until the build is known to come from the restored source; this one failed loudly, which is the lucky direction.

### 2026-10-14 -- 4.3f first end-to-end numbers: a story step is 28% VPU wait on 2x2, at short context

**Phase:** Phase 4 (4.3f)
**Problem:** 4.3g needs a first picture of where a decode step goes before it adds the per-category counters, and the spec's estimates had never run on the full chip.
**Cause:** Nothing broke; this is the first run of the integrated pipeline (random weights, the real 5-layer shape, T = 0 to 11 only, so SOFTMAX is at its cheapest).
**Fix:** Measured from `cmd_perf` on `lm_t0` (10 steps, 8,960 BLOCKs): 2x2 699,392 cycles (70K a step: 54% OPERAND slots, 29% `wait_cyc`, 11% injection stalls, 5% other), 1x1 1,175,582, 4x3 682,782.
`wait_cyc` is where a VOP's drain and run land, and `vpu_perf` says the VPU's own busy cycles are most of it; the rest is the drain in front of every VOP (48 per step), where the mesh sits idle.
**Takeaway:** 4x3 is only 2% faster than 2x2, the same corner-injection limit as CIFAR-10 (4.2f), and the serialization the spec predicted is already a third of the step at short context; SOFTMAX grows with T (2n + 10 cycles per nest), so 4.3g's breakdown at T = 127 to 255 is the number that matters, not these.

### 2026-10-14 -- 4.3e measured cycles against the spec's estimates

**Phase:** Phase 4 (4.3e)
**Problem:** The spec's cycle estimates came from port traffic alone (the busier port bounds each sub-op), and 4.3g needs to know which of them hold.
**Cause:** Estimates that count reads and writes miss serialization inside a sub-op: ROPE issues a rotation pair every 3 cycles so a pair's even word cannot overwrite x0 before y1 has used it, and waits for each q group's 64-word drain.
**Fix:** The numbers below are measured on the RTL, busy cycles from `run_op`.
Spec estimate against measured: ADD 260 and 260, EMBED 130 and 153, RMSNORM 270 and 271, SILU_MUL 450 and 453, KVWRITE 330 and 332, ROPE 290 and 416, SAMPLE 3.1K and 3091, TRANSPOSE 8 per block and 8 per block plus 12.
SOFTMAX costs 2n + 10 cycles per nest, 835 at T = 0 and 16707 at T = 255.
**Takeaway:** At an average position of 127 (n = 128) SOFTMAX is about 8.5K cycles per layer and 42.6K per step over 5 layers, twice the 20.5K write-bound floor of 32 words per position, so it is the VPU cost to watch in 4.3g's breakdown; the port-shaped estimates are good to a few cycles except ROPE.

### 2026-10-14 -- A golden comparison that touches nothing passes forever

**Phase:** Phase 4 (4.3e)
**Problem:** The first ADD saturation test passed while testing nothing: it built two images, ran the command, and compared the RTL's memories with the golden's, and neither had changed.
**Cause:** The comparison asked only whether RTL equals golden, so an input that misses the operation (a wrong address, a count of 0) agrees with itself.
**Fix:** `vpulib.check` asserts that the golden changed a memory, and a command that legitimately changes none (a zero-count TRANSPOSE, a prompt-copy SAMPLE) must say `expect_change=False`.
**Takeaway:** Any test that compares two outputs of the same input needs a check that the input did something, or it passes when both sides do nothing.

### 2026-10-12 -- The spec's matmul mapping had never met the DMA's channel counter

**Phase:** Phase 4 (4.3d)
**Problem:** The approved 4.3 spec maps every weight matmul to "a 1x1 convolution with Cin = input features", but the down projection has 192 inputs.
**Cause:** The DMA's channel counter wraps at `(1 << cin_log2) - 1` and `isa.check_shape` requires a power-of-two Cin; nobody had run the spec's table through those rules, because the compiler for the model did not exist yet.
The same pass found the spec's `LOOP 5` over layers impossible (per-BLOCK (m, sh) immediates differ per layer), a probability scratch four times larger than its memory table, and a golden ordering rule that VOP draining makes unviolable.
**Fix:** Three K = 64 chunks accumulated on one tile; layers unrolled; the corrections are in the spec and the 4.3d decision entry.
**Takeaway:** Before approving a spec that targets existing hardware, push each tensor shape through the real address and shape rules, not just the table; a throwaway prototype of the compiler found all of these in an afternoon.


### 2026-10-13 -- Two sources for one row count need an in-order index check, not a bound check

**Phase:** Phase 4 (4.3c review)
**Problem:** The GO's row limit (`rtl/noc_node.v`) and the write-back entry's `rows_m1` (`rtl/cmd_seq.v`) are separate fields, and `writeback.v` only checked the flit's mode, so a block returning more or fewer rows than its entry landed silently.
**Cause:** The reviewer's suggested `r_idx > last` fatal looked sufficient but is not: an entry pops on the flit with `idx == last`, so an extra flit is judged against the next entry, and a short block never pops at all.
**Fix:** A simulation-only per-tile expected-index counter (reset on each pop) makes both overrun and underrun fatal, proved by `make rows-check` in `tb/writeback/`; a mesh test queues nine GOs of mixed row limits and modes behind one tile's stream, and fails when the GO backpressure is removed.
**Takeaway:** When a check guards a protocol with a start, a length, and an end, write the negative probe for each way the length can be wrong, in both directions, before choosing the condition.

### 2026-10-12 -- A new GO field whose reset value is not its zero value breaks every producer that predates it

**Phase:** Phase 4 (4.3c)
**Problem:** With the GO row limit in the node (`rows_m1` in bits 45:43) and nothing else changed, the `accel` suite stopped with "no done within 35168 cycles".
**Cause:** `flit_pack` builds the GO payload with zeros above bit 41, so every GO arrived with `rows_m1 = 0`: one row per block, and the rest of every CIFAR-10 block never returned.
The node's own reset value (7, all rows) never applies, because every GO overwrites it.
Two more producers were missing from the plan's file list: `tb/dma_gather/dma_gather_tb.v` copies `accel.v`'s tag layout and instantiates `flit_pack` (a lint failure on the new port), and the perf harness, `tb/perf/host.py`, builds GO flits by hand (it timed out at 8 of 64 flits per block).
**Fix:** `flit_pack` takes the new fields as inputs, the tag layout carries them from `accel.v` (tied to RESULT8-or-raw, 8 rows), the testbench copy of the layout got the same two fields, and the perf host's `go_flit` sets `rows_m1 = 7`.
**Takeaway:** When a descriptor gains a field, check every producer of that descriptor, including testbenches that copy a layout, and give each an explicit value; a reset default on the consumer never sees the old producers.


### 2026-09-29 -- Two counters at different interfaces around a skid buffer do not partition cycles

**Phase:** Phase 4 (4.3a follow-up)
**Problem:** 4.3a's scaling report showed "Other" at 0.04 cycles per BLOCK, and its text called the command processor's cycle breakdown a partition.
The final review measured one CIFAR-10 image on 2x2 cycle by cycle: about 2,081 cycles were counted in two categories and about 2,185 in none, so "Other" was near zero only because the two errors cancelled.
**Cause:** OPERAND slots and GO beats were counted where the DMA hands beats to `rtl/flit_pack.v` (`beat_valid && beat_ready`), but the injection stall was counted at `flit_pack`'s output, after its `rtl/flit_buf.v` skid buffer.
The skid's `in_ready` is `count < 2`, which does not depend on `out_ready`, so a beat can be accepted in a cycle the port is stalled (counted twice), and the port can inject a buffered flit in a cycle the DMA offers nothing (counted by neither).
The 4.3a masking (count WAIT/END and credit stalls only when neither interface was busy) could not fix that, because the overlap was between the two flit counters themselves.
**Fix:** `rtl/cmd_perf.v` counts every category at one interface, node (0,0)'s injection port: an OPERAND or GO flit injected (by its type field), a flit stalled, or, with no flit at the port, a WAIT/END stall, else a credit stall, else an explicit `other_cyc`.
`tb/accel` asserts the six categories sum exactly to `run_cyc` on every case, and the report scripts refuse records that do not.
The totals barely moved (over a whole run every flit and every stall is counted once at either interface): on 2x2, `wait_cyc` fell 1.9% and Other went from 0.042 to 0.045 cycles per BLOCK, but now each cycle is attributed once and Other is measured, not a remainder.
**Takeaway:** a breakdown is a partition only if every category is decided at the same interface in the same cycle; assert the exact sum, because a non-negative remainder can hide errors that cancel.

### 2026-09-29 -- A git worktree has no `.venv`, so `./test.sh` fails at its first line

**Phase:** Phase 4 (4.3a)
**Problem:** `./test.sh` in a second worktree (used so a training run could keep reading the main checkout) failed immediately on `source .venv/bin/activate`.
**Cause:** `.venv` is gitignored, so `git worktree add` does not create it, and `test.sh` activates the repo-local one.
**Fix:** symlink the main checkout's `.venv` into the worktree (`ln -s <main>/.venv .venv`), and never stage the symlink (`git add` explicit paths).
**Takeaway:** a new worktree gets tracked files only; link or recreate every gitignored tool directory before running the suite.

### 2026-09-29 -- The 4.3a plan merged the PR before the whole-branch review

**Phase:** Phase 4 (4.3a)
**Problem:** the final whole-branch review of 4.3a found two Important issues (no test above the DMA guarded the zero gap, and the perf breakdown was not a partition) after PR #89 had already merged, so the fixes needed a follow-up PR.
**Cause:** the plan's last task said to merge once `./test.sh` passed, and the final review was scheduled after the last task, so it ran on `main`.
**Fix:** the fixes landed in a follow-up PR, which merges only after its own review.
**Takeaway:** a plan's merge step belongs after the final whole-branch review; a passing test suite is not a review.

### 2026-09-28 -- A cocotb Clock dominates Verilator run time on long simulations

**Phase:** Phase 4 (4.2e)
**Problem:** one CIFAR-10 image (146K cycles) took 4.16 s in `tb/accel`, which put 128 images at about 9 minutes.
**Cause:** cocotb 1.9's `Clock` runs a Python callback on every clock edge, and the test's `run()` added a `FallingEdge` await every cycle. Removing the loop saved only about 16%; the clock was the rest.
**Fix:** `tb/accel/accel_tb.v` generates the clock with `always #5` (Verilator `--timing`), and `run()` awaits `First(RisingEdge(done), RisingEdge(error), Timer(...))`: 0.85 s per image, the same cycle counts, both simulators.
**Takeaway:** for runs past about 100K cycles, generate the clock in Verilog and keep Python off the per-cycle path.

### 2026-09-28 -- cocotb's Force on an internal net is a silent no-op under Verilator

**Phase:** Phase 4 (4.2d)
**Problem:** proving `accel.v`'s "RESULT delivered away from (0,0)" `$fatal` needs a RESULT at a node the command processor never addresses, so the negative test forces that node's `res_valid`. Under Verilator, cocotb only logged `vpi_put_value used with vpiForceFlag on non-forceable signal` and the test passed.
**Cause:** Verilator forces only signals marked forceable (a `forceable` line in a `.vlt` file or a `/*verilator forceable*/` comment). Adding a `.vlt` by overriding `COMPILE_ARGS` on the make command line also drops cocotb's own Verilator flags, and the build fails with `Vtop.mk: No such file`.
**Fix:** `make stray-check` in `tb/accel/` runs that probe under Icarus, where Force works, and passes only if the run dies with the check's message.
**Takeaway:** a negative test must assert the specific failure message, not just a failure. Under Verilator, a Force needs the forceable marking or it does nothing.

### 2026-09-25 -- The CIFAR-10 quantizer was committed before it ever ran on a trained checkpoint

**Phase:** Phase 4
**Problem:** Checking int8 against float accuracy after training finished, `model/cifar_quantize.py` failed outright: "conv2: bias needs bias_val 132 > 127".
Its unit tests passed, and it had been committed while the network was still training.
**Cause:** The one-slot bias encoding caps a bias at 127 * 127 accumulator units, and real folded BatchNorm biases go past it (conv4 needs 2.35x the cap).
The code raised where the spec said to saturate, so the spec and code disagreed; saturating would have silently cost 9.6 points of accuracy (77.56% against 87.24% float).
Synthetic unit-test weights never produce biases that large.
**Fix:** Spread the bias over every trailing K slot (see `docs/decisions.md`, same date); int8 is now 87.06%.
**Takeaway:** Run a model pipeline stage end to end on the real trained weights before committing it; synthetic tests do not exercise real value ranges.

### 2026-09-24 -- Per-node buses cannot be driven field by field from cocotb, and a comment starting with "Verilator" is a pragma

**Phase:** Phase 4
**Problem:** Moving to `rtl/noc_mesh.v` put every node's injection and start inputs on flat packed buses, which several concurrent cocotb injector coroutines must drive at once. Separately, the first lint of the new module failed with `BADVLTPRAGMA` on an ordinary comment.
**Cause:** cocotb cannot write one field of a packed vector (no bit handles under Icarus or Verilator), and a read-modify-write of the whole bus from two coroutines in the same timestep loses one of the writes: both read the old value and the last write wins. The lint error came from a `//` comment line whose first word was "Verilator's", which Verilator parses as a `// verilator ...` directive.
**Fix:** `tb/mesh/test_mesh.py`'s `MeshIO` keeps every node's input state in Python and rewrites each whole bus after any change, so the last write in a timestep always carries every coroutine's update. The comment was reworded. `tb/mesh/` also moved to drive-on-rising, sample-on-falling, closing the gap the previous entry noted.
**Takeaway:** Give shared packed input buses a single Python owner, and never start a comment with the word "Verilator".

### 2026-09-24 -- A cocotb monitor that samples just after the rising edge can count a transfer that never happens

**Phase:** Phase 4
**Problem:** The new perf host driver saw "duplicate" RESULT flits: the same accumulator cell arrived twice, identically under Verilator and Icarus, but only when two result streams converged on the host port.
**Cause:** Not the RTL. The collector sampled `res00_valid` at rising edge + 1 ns and returned; in that same timestep the next wave's injector raised `inj00_valid`, which changed the host router's LOCAL-output grant before the next clock edge. The sampled flit was not delivered that cycle, so it was delivered (and counted) again a cycle later. Sampling right after a rising edge is not final while other coroutines still drive inputs in the same timestep. The same effect made a counter snapshot read right after a rising edge miss that edge's increments.
**Fix:** In `tb/perf/`, inputs are driven only right after a rising edge (`inject()` aligns itself first), and every handshake and counter snapshot is sampled at the falling edge. `measure()` also checks flit conservation per region, which is what caught the snapshot bug.
**Takeaway:** Drive on the rising edge, sample on the falling edge. `tb/mesh/`'s collectors still sample at rising edge + 1 ns and currently pass only because nothing drives in the same timestep they sample.

### 2026-09-24 -- cocotb 1.9's Makefile flow exits 0 when tests fail

**Phase:** Phase 4
**Problem:** A deliberately failing cocotb test still let `make` exit 0, so `./test.sh` had never actually failed on a failing test.
**Cause:** cocotb 1.9's `check_for_results_file` only checks that `results.xml` exists, not what it records.
**Fix:** `tb/check_results.py` parses `results.xml` and fails on any `<failure>`/`<error>` or on zero test cases. `tb/common.mk` runs it via an `override define check_for_results_file` (recipes expand at run time, and `override` beats the plain define in cocotb's `Makefile.inc`, which is included later). Proven by a sabotaged test that now fails the run.
**Takeaway:** Prove a gate by making it fail once. A test runner that has never been seen to fail may not be able to.

### 2026-09-24 -- Under Icarus, a $error in the RTL does not fail a cocotb test

**Phase:** Phase 4
**Problem:** While moving to Verilator (issue #53), a deliberate `operand_mem` write/read collision showed the issue #44 check behaving differently per simulator: Verilator stopped the run, while Icarus printed the error and cocotb reported the test as PASS.
**Cause:** `$error` is a non-fatal severity task. Icarus logs it and keeps simulating, and cocotb only looks at Python-side test outcomes, so nothing turned the message into a failure. Verilator happens to `$stop` on the first `$error` by default.
**Fix:** The check now uses `$fatal(1, ...)`, and `make collision-check` in `tb/operand_mem/` runs a negative test that passes only if the probe run dies on that exact message. Mutating the check back to `$error` makes the Icarus collision-check fail, so the guard is proven.
**Takeaway:** An RTL assertion that should fail a test must be `$fatal`, and it needs a negative test that proves it actually kills the run in every simulator you support.

### 2026-09-24 -- Verilator config-file and cocotb Makefile gotchas

**Phase:** Phase 4
**Problem:** Wiring Verilator into the cocotb flow hit four separate snags: `.vlt` waivers that silently did not match, a `.vlt` file that failed to parse, `WAVES=1` doing nothing under Verilator, and an FST build failing with `'lz4.h' file not found`.
**Cause:**
(1) `lint_off -match` uses wildcards where `[` and `]` are special, and `-file` is matched against the path exactly as given (cocotb passes absolute paths, sometimes with `../` segments).
(2) A `.vlt` file is run through the preprocessor, so a backtick or `*/` inside a `//` comment breaks parsing.
(3) cocotb 1.9's Verilator makefile only knows `VERILATOR_TRACE=1` (VCD), and it passes `EXTRA_ARGS` to the built binary at run time as well as to Verilator.
(4) Homebrew's Verilator 5.050 links its FST writer against lz4 but does not add Homebrew's include dir to the C++ flags.
**Fix:** Waiver patterns use `?` for brackets and a leading `*/` on paths. No backticks in `.vlt` comments. `tb/common.mk` uses `COMPILE_ARGS` rather than `EXTRA_ARGS`, maps `WAVES=1` to `--trace-fst` in a separate `sim/verilator-waves/` tree, and adds `brew --prefix` include/lib dirs for traced builds.
**Takeaway:** After adding a Verilator waiver, confirm the warning really disappears, and after adding a build knob, confirm the output file really appears. Both of these can fail without an error.

### 2026-09-24 -- An "unenforced traffic assumption" hid two more bugs at the same port

**Phase:** Phase 3
**Problem:** Issue #44 described one hazard (an OPERAND write stealing `operand_mem`'s shared port from an in-flight read), but the E2E reproduction in the 2x2 mesh timed out with only 64 of 128 result flits.
**Cause:** `noc_node`'s LOCAL port accepted every flit unconditionally, so a GO arriving mid-run pulsed `start` into a busy `gemm_sequencer`, which ignores it - the GO vanished with no error.
The same missing interlock also let a GO restart the tile while the result-return engine was still streaming, which would clear the accumulators mid-stream.
**Fix:** Type-aware backpressure on the LOCAL output (`r_out_ready[LOCAL]`): OPERAND flits wait out the run, GO flits also wait for the result stream, and `wr_en`/`go_deliver` now also require the handshake to complete.
**Takeaway:** When a sink ties `ready` high, check every flit type it consumes, not only the one the bug report names.
Reproducing through the full mesh (not a unit test of `operand_mem`) is what surfaced the dropped GO.

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
