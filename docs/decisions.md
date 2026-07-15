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
