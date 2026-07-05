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
