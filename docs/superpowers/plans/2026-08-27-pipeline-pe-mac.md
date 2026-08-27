# Pipeline pe.v's MAC Datapath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline `rtl/pe.v`'s multiply-accumulate into 2 cycles (register the multiply, add on the
next cycle) to close the OpenLane timing violation at the `max_ss_100C_1v60` corner, without touching
`rtl/systolic_array.v` or `rtl/skew_feeder.v`.

**Architecture:** `pe.v` gets one new internal pipeline register between multiply and accumulate. The
new accumulate latency (`ACC_LATENCY = 2`, up from 1) is threaded as a parameter
(`PE_ACC_LATENCY`) into `rtl/gemm_sequencer.v`'s drain-window sizing and wired explicitly at
`rtl/gemm_tile.v`'s instantiation. `rtl/systolic_array.v` and `rtl/skew_feeder.v` need zero changes —
neighbor-forwarding (`a_out`/`b_out`) is a separate, already-registered always-block, structurally
independent of the accumulate path. Everything downstream of `gemm_sequencer.v`'s `done` handshake
(`tb/gemm/`, `tb/mnist/`, the NoC layer) is unaffected because it waits for `done`, not a fixed cycle
count.

**Tech Stack:** Verilog (Icarus Verilog), cocotb, Python 3 / NumPy for testbench references.

**Spec:** `docs/superpowers/specs/2026-08-27-pipeline-pe-mac-design.md`

## Global Constraints

- New accumulate latency is exactly `ACC_LATENCY = 2` cycles (from a `valid_in=1` cycle to that
  cycle's product landing in `acc_out`), per the spec's chosen Approach A. Do not deviate from 2
  stages in this plan — a deeper pipeline (Approach B) is explicitly out of scope and deferred to a
  follow-up once issue #30's real OpenLane numbers are in.
- No changes to `rtl/systolic_array.v` or `rtl/skew_feeder.v` — the spec's whole point is that they
  don't need to change. If a task in this plan seems to require touching either file, stop and
  re-check the spec/design before proceeding.
- No changes to `tb/gemm/`, `tb/mnist/`, `tb/router/`, `tb/noc/`, `tb/mesh/` — they either wait on the
  `done` handshake (gemm/mnist) or don't touch `pe.v`'s timing at all (router/noc/mesh). If any of
  these break, that's a signal the drain-window sizing in Task 2 is wrong, not something to patch in
  the testbench.
- Every task ends with `./test.sh` (or the specific `make` target) passing before moving to the next
  task. Never leave the tree in a red state between tasks.
- Work lands on a feature branch (`feature/pipeline-pe-mac`), not directly on `main`, per this repo's
  git workflow in `CLAUDE.md`.

---

### Task 1: Pipeline `pe.v`'s MAC datapath and update its cocotb suite

**Files:**
- Modify: `rtl/pe.v`
- Modify: `tb/test_pe.py`

**Interfaces:**
- Produces: `pe.v`'s external ports are unchanged (`clk`, `reset`, `valid_in`, `a_in`, `b_in`,
  `acc_out`, `a_out`, `b_out`). Only the internal timing contract changes: `acc_out` now reflects a
  given `valid_in=1` cycle's product 2 cycles later, not 1. This 2-cycle constant is what Task 2
  consumes as `PE_ACC_LATENCY`.

- [ ] **Step 1: Create the feature branch off `main`**

```bash
git checkout main
git pull
git checkout -b feature/pipeline-pe-mac
```

- [ ] **Step 2: Confirm the current suite passes before touching anything**

Run: `./test.sh` from the repo root (or `cd tb && make` for just the PE suite)
Expected: all existing suites PASS (this is the baseline before any RTL change).

- [ ] **Step 3: Modify `rtl/pe.v` to pipeline the accumulate**

Replace the current single always-block:

```verilog
    always @(posedge clk) begin
        if (reset) begin
            acc_out <= 32'sd0;
            a_out   <= 8'sd0;
            b_out   <= 8'sd0;
        end else begin
            a_out <= a_in;
            b_out <= b_in;
            if (valid_in) begin
                acc_out <= acc_out + (a_in * b_in);
            end
        end
    end
```

with:

```verilog
    // ACC_LATENCY = 2: a valid_in=1 cycle's product lands in acc_out 2 cycles
    // later (1 cycle to register the multiply, 1 more to add it in). Forwarding
    // (a_out/b_out) stays a separate, unconditional 1-cycle passthrough --
    // independent of accumulate latency, so the array's skew geometry is
    // unaffected by this change. See docs/superpowers/specs/2026-08-27-pipeline-pe-mac-design.md.
    reg signed [15:0] prod_reg;
    reg               pipe_valid;

    always @(posedge clk) begin
        if (reset) begin
            a_out <= 8'sd0;
            b_out <= 8'sd0;
        end else begin
            a_out <= a_in;
            b_out <= b_in;
        end
    end

    always @(posedge clk) begin
        if (reset) begin
            prod_reg   <= 16'sd0;
            pipe_valid <= 1'b0;
        end else begin
            prod_reg   <= a_in * b_in;
            pipe_valid <= valid_in;
        end
    end

    always @(posedge clk) begin
        if (reset) begin
            acc_out <= 32'sd0;
        end else if (pipe_valid) begin
            acc_out <= acc_out + prod_reg;
        end
    end
```

- [ ] **Step 4: Update `tb/test_pe.py`'s directed-product and random-product tests for the 2-cycle latency**

These tests currently assert `valid_in=1` for one cycle, wait one `RisingEdge`, then read `acc_out`.
Add a second `RisingEdge` before reading, keeping the existing `dut.valid_in.value = 0` placement (right
after the first edge) so the product isn't double-counted. In `test_mac_directed_products`, replace:

```python
        await reset_dut(dut)
        dut.valid_in.value = 1
        dut.a_in.value = a
        dut.b_in.value = b
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")  # settle past the NBA update, still allows writes after
        dut.valid_in.value = 0

        expected = a * b
```

with:

```python
        await reset_dut(dut)
        dut.valid_in.value = 1
        dut.a_in.value = a
        dut.b_in.value = b
        await RisingEdge(dut.clk)          # pipe_valid<=1, prod_reg<=a*b
        await Timer(1, units="ns")
        dut.valid_in.value = 0
        await RisingEdge(dut.clk)          # acc_out <= acc_out + prod_reg (ACC_LATENCY=2)
        await Timer(1, units="ns")

        expected = a * b
```

Apply the identical change to `test_mac_random_products` (same pattern, same insertion point, right
before its own `expected = a * b`).

- [ ] **Step 5: Update `test_mac_running_accumulation` for the 2-cycle pipeline lag**

Replace the whole test body with a version that records the observed `acc_out` after every cycle
(including `ACC_LATENCY` drain cycles at the end), then compares the recorded sequence against
`expected_running` offset by `ACC_LATENCY`:

```python
@cocotb.test()
async def test_mac_running_accumulation(dut):
    """Drive a sequence of terms over consecutive cycles (no reset between
    them) and check the running acc_out, offset by the pipeline's 2-cycle
    ACC_LATENCY, against a NumPy reference model."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)

    expected_running = numpy_mac_reference(ACCUMULATION_TERMS)
    observed = []

    dut.valid_in.value = 1
    for a, b in ACCUMULATION_TERMS:
        dut.a_in.value = a
        dut.b_in.value = b
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
        observed.append(dut.acc_out.value.signed_integer)

    dut.valid_in.value = 0
    for _ in range(ACC_LATENCY):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
        observed.append(dut.acc_out.value.signed_integer)

    # acc_out reflects term k only ACC_LATENCY cycles after it's fed.
    for k, expected in enumerate(expected_running):
        got = observed[k + ACC_LATENCY]
        assert got == expected, (
            f"after term {k} (lagged by ACC_LATENCY={ACC_LATENCY} cycles): "
            f"acc_out={got}, expected {expected} (running total diverged mid-sequence)"
        )
```

Add `ACC_LATENCY = 2` near the top of `tb/test_pe.py`, alongside `RANDOM_SEED`/`RANDOM_ITERATIONS`.

- [ ] **Step 6: Update `test_valid_in_gates_accumulation` for the 2-cycle settle**

Replace:

```python
    dut.valid_in.value = 1
    dut.a_in.value = 6
    dut.b_in.value = 7
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")  # settle past the NBA update, still allows writes after
    held_value = dut.acc_out.value.signed_integer
    assert held_value == 42, f"setup MAC failed: got {held_value}"

    dut.valid_in.value = 0
```

with:

```python
    dut.valid_in.value = 1
    dut.a_in.value = 6
    dut.b_in.value = 7
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")
    dut.valid_in.value = 0
    for _ in range(ACC_LATENCY - 1):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
    held_value = dut.acc_out.value.signed_integer
    assert held_value == 42, f"setup MAC failed: got {held_value}"
```

(One `RisingEdge` already happened before `dut.valid_in.value = 0`; the loop adds the remaining
`ACC_LATENCY - 1 = 1` cycle needed for the product to fully land, keeping the total at `ACC_LATENCY`
cycles since the valid assertion.)

- [ ] **Step 7: Run the PE-level suite and confirm it passes**

Run: `cd tb && make`
Expected: `PASS=5 FAIL=0` (all 5 tests: reset, directed products, running accumulation, valid_in gating,
random fuzz).

- [ ] **Step 8: Commit**

```bash
git add rtl/pe.v tb/test_pe.py
git commit -m "Pipeline pe.v's MAC datapath into 2 cycles (mult reg -> accumulate reg)"
```

---

### Task 2: Thread `PE_ACC_LATENCY` through `gemm_sequencer.v` and `gemm_tile.v`

**Files:**
- Modify: `rtl/gemm_sequencer.v`
- Modify: `rtl/gemm_tile.v`

**Interfaces:**
- Consumes: the `ACC_LATENCY = 2` constant from Task 1 (`rtl/pe.v`'s new real accumulate latency).
- Produces: `gemm_sequencer.v` gains a `PE_ACC_LATENCY` parameter (default `2`) used in its
  `DRAIN_CYCLES` localparam. `gemm_tile.v` passes it explicitly at the `seq` instantiation so the
  dependency between `pe.v`'s real latency and the sequencer's drain window is visible in the code.

- [ ] **Step 1: Modify `rtl/gemm_sequencer.v`'s module parameters and `DRAIN_CYCLES`**

In the parameter list, change:

```verilog
module gemm_sequencer #(
    parameter N    = 8,
    parameter KMAX = 8   // max K-chunks the operand memory can hold (layer 1 needs 8)
) (
```

to:

```verilog
module gemm_sequencer #(
    parameter N              = 8,
    parameter KMAX           = 8,   // max K-chunks the operand memory can hold (layer 1 needs 8)
    parameter PE_ACC_LATENCY = 2    // must match pe.v's real accumulate latency (rtl/pe.v)
) (
```

Then change the `DRAIN_CYCLES` localparam from:

```verilog
    localparam DRAIN_CYCLES = 2*N;      // slack for the final wave to flush feeder+array
```

to:

```verilog
    // Provable minimum is (N-1) + PE_ACC_LATENCY (max skew depth + accumulate
    // latency); +N on top keeps the same generous slack the original 2*N had.
    localparam DRAIN_CYCLES = 2*N + PE_ACC_LATENCY;
```

- [ ] **Step 2: Wire the parameter through `rtl/gemm_tile.v`**

Change the `gemm_tile` module's own parameter list from:

```verilog
module gemm_tile #(
    parameter N    = 8,
    parameter KMAX = 8
) (
```

to:

```verilog
module gemm_tile #(
    parameter N              = 8,
    parameter KMAX           = 8,
    parameter PE_ACC_LATENCY = 2   // must match pe.v's real accumulate latency (rtl/pe.v)
) (
```

Then change the `seq` instantiation from:

```verilog
    gemm_sequencer #(.N(N), .KMAX(KMAX)) seq (
```

to:

```verilog
    gemm_sequencer #(.N(N), .KMAX(KMAX), .PE_ACC_LATENCY(PE_ACC_LATENCY)) seq (
```

- [ ] **Step 3: Run the full suite to confirm nothing downstream broke**

Run: `./test.sh` from the repo root.
Expected: every suite (`tb/`, `tb/array/`, `tb/tile/`, `tb/gemm/`, `tb/router/`, `tb/noc/`,
`tb/mesh/`, `tb/mnist/`) passes. `tb/array/` and `tb/tile/` are expected to FAIL at this point (they
drive `pe.v`/`systolic_array.v`/`tile.v` directly and haven't been updated yet — Tasks 3 and 4). If
`tb/gemm/`, `tb/mnist/`, `tb/router/`, `tb/noc/`, or `tb/mesh/` fail, stop: that means the
`DRAIN_CYCLES` sizing in Step 1 is wrong, not something to patch around.

- [ ] **Step 4: Commit**

```bash
git add rtl/gemm_sequencer.v rtl/gemm_tile.v
git commit -m "Thread PE_ACC_LATENCY through gemm_sequencer's drain-window sizing"
```

---

### Task 3: Update `tb/array/test_systolic_array.py` for the deeper pipeline

**Files:**
- Modify: `tb/array/test_systolic_array.py`

**Interfaces:**
- Consumes: `ACC_LATENCY = 2` (same constant as Task 1, redefined locally per this file's existing
  convention of not cross-importing small helpers between `tb/` directories).

- [ ] **Step 1: Add the `ACC_LATENCY` constant**

Near the top of the file, alongside `TOTAL_CYCLES = 3 * N - 2`, add:

```python
ACC_LATENCY = 2  # matches rtl/pe.v's pipelined accumulate latency
```

- [ ] **Step 2: Add drain padding to `test_identity_times_matrix`**

Replace:

```python
    dut.valid_in.value = 1
    for t in range(TOTAL_CYCLES):
        a_lanes = [A[i][t - i] if i <= t < i + N else 0 for i in range(N)]
        b_lanes = [B[t - j][j] if j <= t < j + N else 0 for j in range(N)]
        dut.a_west.value = pack_lanes(a_lanes)
        dut.b_north.value = pack_lanes(b_lanes)
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
    dut.valid_in.value = 0
```

with:

```python
    dut.valid_in.value = 1
    for t in range(TOTAL_CYCLES):
        a_lanes = [A[i][t - i] if i <= t < i + N else 0 for i in range(N)]
        b_lanes = [B[t - j][j] if j <= t < j + N else 0 for j in range(N)]
        dut.a_west.value = pack_lanes(a_lanes)
        dut.b_north.value = pack_lanes(b_lanes)
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
    # Drain: every PE needs ACC_LATENCY cycles after its last real input
    # before its final product has landed in acc_out.
    for _ in range(ACC_LATENCY - 1):
        dut.a_west.value = 0
        dut.b_north.value = 0
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
    dut.valid_in.value = 0
```

- [ ] **Step 3: Apply the identical drain-padding change to `test_random_matrices_vs_numpy`**

Same insertion (the `for _ in range(ACC_LATENCY - 1): ...` block) between the existing feed loop and
`dut.valid_in.value = 0`, inside the `for trial in range(ARRAY_RANDOM_TRIALS):` loop.

- [ ] **Step 4: Run the array suite and confirm it passes**

Run: `cd tb/array && make`
Expected: `PASS=3 FAIL=0` (reset, identity matrix, 20 random trials vs NumPy).

- [ ] **Step 5: Commit**

```bash
git add tb/array/test_systolic_array.py
git commit -m "tb/array: drain ACC_LATENCY-1 extra cycles for pe.v's pipelined MAC"
```

---

### Task 4: Update `tb/tile/test_tile.py`'s drain margin

**Files:**
- Modify: `tb/tile/test_tile.py`

**Interfaces:**
- Consumes: `ACC_LATENCY = 2`.

- [ ] **Step 1: Add the constant and extend `TOTAL_CYCLES`**

Replace:

```python
N = 8
# Feed N real columns/rows, then drain long enough for the deepest lane
# (delay N-1) plus the array's own 3N-2 latency to fully settle. Generous on
# purpose -- the accumulators are stationary, so reading late never hurts.
FEED_CYCLES = N
TOTAL_CYCLES = 4 * N
```

with:

```python
N = 8
ACC_LATENCY = 2  # matches rtl/pe.v's pipelined accumulate latency
# Feed N real columns/rows, then drain long enough for the deepest lane
# (delay N-1) plus the array's own 3N-2 latency plus pe.v's ACC_LATENCY to
# fully settle. Generous on purpose -- the accumulators are stationary, so
# reading late never hurts.
FEED_CYCLES = N
TOTAL_CYCLES = 4 * N + (ACC_LATENCY - 1)
```

(The existing `4*N` margin already has slack over the old minimum, but per the design's "provably
sufficient, not coincidentally" principle, `TOTAL_CYCLES` should account for `ACC_LATENCY` explicitly
rather than relying on incidental headroom.)

- [ ] **Step 2: Run the tile suite and confirm it passes**

Run: `cd tb/tile && make`
Expected: `PASS=2 FAIL=0` (identity matrix, 20 random trials vs NumPy).

- [ ] **Step 3: Commit**

```bash
git add tb/tile/test_tile.py
git commit -m "tb/tile: extend drain margin by ACC_LATENCY-1 for pe.v's pipelined MAC"
```

---

### Task 5: Full regression, docs update, and PR

**Files:**
- Modify: `docs/decisions.md`
- Modify: `CLAUDE.md` (status section)

**Interfaces:**
- Consumes: nothing new — this task verifies Tasks 1-4 together and documents the result.

- [ ] **Step 1: Run the full test suite from the repo root**

Run: `./test.sh`
Expected: every suite passes — `tb/`, `tb/array/`, `tb/tile/`, `tb/gemm/`, `tb/router/`, `tb/noc/`,
`tb/mesh/`, `tb/mnist/`. This is the proof that `tb/gemm/` and `tb/mnist/` needed zero changes (they
wait on `gemm_sequencer.v`'s `done` handshake, not a fixed cycle count) and that `tb/router/`,
`tb/noc/`, `tb/mesh/` are unaffected (they don't depend on `pe.v`'s accumulate timing).

- [ ] **Step 2: Add a `docs/decisions.md` entry**

Add a new entry at the top of the entries section (most-recent-first) following the file's existing
template (Context/Options considered/Decision/Why), summarizing: the 2-stage pipeline chosen (Approach
A over B/C from the spec), the `ACC_LATENCY`/`PE_ACC_LATENCY` contract, that `systolic_array.v`/
`skew_feeder.v` needed no changes, and that `tb/gemm/`/`tb/mnist/` passing unchanged is the proof the
drain-window sizing is correct. Reference `docs/superpowers/specs/2026-08-27-pipeline-pe-mac-design.md`
and issue #25.

- [ ] **Step 3: Update `CLAUDE.md`'s Phase 3 status paragraph**

Add a sentence noting `pe.v`'s MAC datapath is now pipelined (`ACC_LATENCY=2`), all cocotb suites pass,
and real OpenLane re-verification of the timing closure is tracked separately as issue #30 (not part of
this change).

- [ ] **Step 4: Commit the docs**

```bash
git add docs/decisions.md CLAUDE.md
git commit -m "Document the pe.v MAC pipelining decision and update Phase 3 status"
```

- [ ] **Step 5: Push the branch and open a PR**

```bash
git push -u origin feature/pipeline-pe-mac
gh pr create --title "Pipeline pe.v's MAC datapath (closes issues #25, #26, #28)" --body "$(cat <<'EOF'
## Summary
- Pipelines rtl/pe.v's multiply-accumulate into 2 cycles (mult register -> accumulate register) to
  close the OpenLane timing violation at the max_ss_100C_1v60 corner (docs/decisions.md, 2026-08-12).
- Threads the new ACC_LATENCY=2 as a PE_ACC_LATENCY parameter into gemm_sequencer.v's drain-window
  sizing and gemm_tile.v's instantiation.
- No changes to systolic_array.v or skew_feeder.v -- neighbor-forwarding timing is structurally
  independent of accumulate latency (see the design spec).
- tb/gemm/, tb/mnist/, tb/router/, tb/noc/, tb/mesh/ needed zero changes, confirming the drain-window
  sizing and the "no array-level ripple" claim in the spec were correct.

Design: docs/superpowers/specs/2026-08-27-pipeline-pe-mac-design.md
Closes #25, #26, #28.

## Test plan
- [x] ./test.sh passes end to end (all 8 suites)
- [x] tb/test_pe.py: 5/5 (reset, directed products, running accumulation, valid_in gating, random fuzz)
- [x] tb/array/: 3/3 (reset, identity, 20 random trials vs NumPy)
- [x] tb/tile/: 2/2 (identity, 20 random trials vs NumPy)
- [x] tb/gemm/, tb/mnist/, tb/router/, tb/noc/, tb/mesh/: unchanged, all passing

Real OpenLane re-verification of the timing closure (before/after slack numbers) is separate follow-on
work tracked as issue #30 -- not part of this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Report the PR URL and stop — do not merge**

Per this repo's git workflow, PRs are normally merged once tests pass without waiting for manual
review, but hold this one for the user to look over given it changes a core, widely-depended-on RTL
timing contract. State the PR URL and wait for explicit go-ahead to merge.
