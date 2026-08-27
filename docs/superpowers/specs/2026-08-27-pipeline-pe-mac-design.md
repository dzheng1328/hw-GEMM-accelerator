# Pipeline `pe.v`'s MAC datapath — design

Issue: [#25](https://github.com/dzheng1328/hw-GEMM-accelerator/issues/25) (Phase 3.1 milestone).

## Context

The OpenLane timing-closure pass (`docs/decisions.md`, 2026-08-12) traced every worst-case-corner
setup violation to `pe.v`'s single-cycle, unpipelined multiply-accumulate: roughly 25 combinational
standard-cell stages (the 8x8 signed multiplier tree + 32-bit adder) in one clock period. After the
`IO_DELAY_CONSTRAINT` fix, ~1.2-1.4ns of the -2.21ns worst-case slack at the `max_ss_100C_1v60` corner
is architectural, not SDC-tunable — it requires pipelining the datapath.

Goal for this design, per the user: close the current violation, and do it in a way that's cheap to
extend if a future, more complex version of the chip needs a higher clock.

## Key finding

`pe.v`'s critical path is entirely inside `acc_out <= acc_out + (a_in * b_in)`. The `a_out`/`b_out`
neighbor-forwarding registers — the ones that create the systolic array's skew geometry — are a
separate always-block, already registered, and structurally independent of the multiply-accumulate
logic. This means the MAC can be pipelined internally without touching the array's forwarding timing
at all, which keeps the blast radius to `pe.v` plus one parameter in `gemm_sequencer.v` — not the
array/skew_feeder ripple originally assumed when issue #26 was scoped.

## Approaches considered

- **A (chosen) — 2-stage MAC pipeline, latency expressed as a named constant.** Register the multiply
  result, add into the accumulator on the next cycle. Root-cause data says the multiplier tree is most
  of the 25-stage path, so this recovers the bulk of the slack. Latency is expressed as one constant
  (`ACC_LATENCY` / `PE_ACC_LATENCY`) that `gemm_sequencer.v` reads to size its drain window — a future,
  deeper pipeline (Approach B) is then a localized change to that constant plus `pe.v`'s internals,
  not a redesign of the sequencer or array.
- **B — pipeline the multiplier tree itself now (3+ stages).** More margin today, but real
  design/verification risk (hand-pipelining partial products/compression), with no concrete future
  clock target driving the extra work yet. Deferred until A's real numbers (issue #30) show it's
  needed.
- **C — pipeline `a_out`/`b_out` forwarding in lockstep with the accumulate pipeline.** Not needed: the
  critical path never touched forwarding. Only relevant if array-level hop propagation itself ever
  becomes the bottleneck at some future much-higher clock.

## Design

### 1. Latency contract

Define `ACC_LATENCY = 2`: the number of cycles from a `valid_in` assertion to that cycle's product
landing in `acc_out` (today it's 1). This is the single fact the rest of the design hangs off, and the
one thing a future deeper pipeline would change.

### 2. `rtl/pe.v`

Add one pipeline register stage between multiply and accumulate:

```verilog
reg signed [15:0] prod_reg;
reg                pipe_valid;

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
    if (reset) acc_out <= 32'sd0;
    else if (pipe_valid) acc_out <= acc_out + prod_reg;
end
```

`a_out`/`b_out` forwarding logic is unchanged — still an unconditional 1-cycle passthrough, independent
of `valid_in` and of the new pipeline stage.

### 3. `rtl/gemm_sequencer.v`

Add `parameter PE_ACC_LATENCY = 2` (matching `pe.v`'s real latency) and replace the current
`localparam DRAIN_CYCLES = 2*N` literal with an expression that keeps today's full margin and adds the
new latency on top, rather than a literal that's only coincidentally sufficient:

```verilog
localparam DRAIN_CYCLES = 2*N + PE_ACC_LATENCY;  // was 2*N; +PE_ACC_LATENCY covers the pipelined MAC
```

The provable minimum is `(N - 1) + PE_ACC_LATENCY` (max skew depth + accumulate latency); `2*N +
PE_ACC_LATENCY` keeps the same generous slack the original `2*N` had over that minimum.

`rtl/gemm_tile.v` passes `PE_ACC_LATENCY` explicitly at instantiation so the dependency between
`pe.v`'s real latency and the sequencer's drain window is visible in the code, not an implicit
coincidence between two numbers. No change to `P` (the 3N-2 wave-spacing localparam), `RST_CYCLES`, or
the chunk-stepping logic in `S_RUN` — K-chunks stay back-to-back with no reset between them, because
the pipeline delays the accumulate stream uniformly across all 64 PEs; it doesn't reorder or stall it.

### 4. Unaffected: `rtl/systolic_array.v`, `rtl/skew_feeder.v`

No RTL changes to either. Skew depths and forwarding timing never depended on accumulate latency, so
they don't need to change when accumulate latency does.

### 5. Testing impact

This reshapes what issue #26 in the milestone actually is: not an array/skew_feeder RTL ripple (there
isn't one), but sizing one sequencer parameter. The real ripple is in cocotb, and lands mostly in
issue #28 (cocotb updates), not #26:

- `tb/`, `tb/array/`, `tb/tile/` drive `pe.v`/`systolic_array.v`/`tile.v` directly and wait a fixed
  cycle count before reading `acc_out` — each needs +1 cycle of wait to match the new
  `ACC_LATENCY`.
- `tb/gemm/` and `tb/mnist/` go through `gemm_sequencer.v`'s `done` signal and its auto-sized drain
  window, so they should need no timing changes if `DRAIN_CYCLES` is sized correctly — they're the
  regression check that the sequencer's math is actually right.

### 6. Verification that closes the milestone

Issue #30 (re-run OpenLane on the pipelined `pe.v`) is the actual proof this design worked — real
before/after slack numbers at `max_ss_100C_1v60`. If 2 stages don't fully close it, that's new data
for a follow-up (Approach B), not a failure of this design.

## Out of scope

- Splitting the multiplier tree into more pipeline stages (Approach B) — deferred pending issue #30's
  real numbers.
- Any change to `rtl/router.v`, `rtl/noc_node.v`, or other NoC-level modules — they read `acc_out`
  only after `gemm_sequencer.v`'s `done`, so they're unaffected by this change.
