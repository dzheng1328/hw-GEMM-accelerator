# Milestone 4.3 design: a tiny story model and a vector unit

Status: approved 2026-09-28; sub-issues #81-#87.
Tracking issue: #60.
Builds on milestone 4.2 (issues #59, #68-#73): the command processor, strided DMA, write-back, compiler, and golden executor that run CIFAR-10 on the chip.

## Goal

The chip generates short stories end to end in simulation: the testbench loads memory images, pulses `start`, and turns the token IDs the chip writes into text.
Everything else, from the embedding lookup through sampling the next token and feeding it back, runs on the chip.

## Decisions taken in the design conversation

- Target quality: coherent TinyStories English, from a small Llama-style transformer we train ourselves.
- Architecture: RMSNorm, RoPE, SwiGLU, grouped-query attention, shaped like llama2.c's published `stories260K` so its validation loss is an outside benchmark.
- Batch: 8 stories decode in parallel, one per B lane, so every weight flit feeds 8 stories.
- Decoding: sampling with a temperature register; temperature 0 means argmax; no top-p.
- Architecture 1: the mesh performs every matmul, attention included; a vector unit (VPU) beside the command processor performs everything else.
  Rejected: VPU MAC lanes for attention (a second compute engine that gains nothing, since attention is bandwidth-bound on the same memories) and vector ops in every tile's result path (row-wide ops would need cross-tile reductions over the NoC).
- The VPU is integer-only, I-BERT style, defined once in `model/fixedpoint.py`; no floating point in the RTL.
- The prompt runs through the same one-token decode path; there is no prefill mode.
- The testbench detokenizes, as a printer would; it performs no compute.
- The corner-bandwidth levers from the 4.2f scaling study (weight residency, multicast, more edge ports) stay deferred: at about 100K cycles per decode step the model simulates in minutes without them.
  The cheap lever, overlapping the DMA's refill across BLOCK boundaries, moves into 4.3 (4.3a) because attention's QK^T BLOCKs have only 8 slots, so the 3-cycle refill costs attention about 25%.
- The portfolio app is the milestone after 4.3; 4.3 exports a machine-readable trace for it (section 6).

## 1. Model, tokenizer, quantization

### Tokenizer and data

A 512-token SentencePiece BPE vocabulary trained on TinyStories, the recipe of llama2.c's `tok512`.
The tokenizer model file is committed; the dataset downloads into a gitignored cache (`model/.tinystories_cache/`).
Token 1 is BOS and token 2 is EOS, as in llama2.c.

### Network (`model/lm_net.py`)

| Parameter | Value | Note |
|---|---|---|
| dim | 64 | |
| layers | 5 | |
| query heads / KV heads | 8 / 4 | head_dim 8, so one head is one 8-wide tile dimension |
| FFN | SwiGLU, hidden 192 | `stories260K` uses 172; 192 is a multiple of 8, so no group is ragged |
| Norm | RMSNorm | gains folded into the following weights at quantization |
| Positions | RoPE on adjacent pairs (2i, 2i+1), 4 frequencies per head | llama2.c's convention |
| Output | tied to the token embedding in the float model | |
| Context | 256 tokens | `stories260K` uses 512; 512 would need 1.3 MB of KV cache for 8 stories |

About 280K parameters: 245,760 in the 5 layers and 32,768 in the embedding.
Because the context and FFN width differ, our validation loss is compared to `stories260K`'s published 1.297 with that caveat stated, not claimed as a like-for-like match.

### Training (`model/lm_train.py`)

PyTorch on MPS on the development Mac; a short timing run precedes the full run, which runs in the background.
The checkpoint is gitignored, as for CIFAR-10.

### Quantization (`model/lm_quantize.py`)

- Weights: symmetric int8 with one scale per group of 8 output channels, which maps onto BLOCK's per-GO (m, sh) with no tile change.
- RMSNorm gains are folded into the next matmul's weights.
  The final norm's gain is folded into a separate int8 classifier matrix, so the int8 model stores the embedding table and the classifier as two tables.
- Activations: static per-tensor scales calibrated on held-out stories.
- The residual stream is int16; every matmul input is int8; attention scores, logits, and the o-proj and down-proj outputs return as int16 (RESULT16, section 2).
- Post-training quantization first.
  Gate: the int8 reference's teacher-forced validation loss is within 0.10 of the float model's.
  If post-training quantization misses the gate, a quantization-aware fine-tune runs the same integer ops in its forward pass.
- Frozen output: `model/lm_quantized.npz` (int8 weights, scales and (m, sh), SiLU and RoPE tables, the tokenizer's vocabulary, the prompt, seeds), committed like `cifar_quantized.npz`.
- Every stage runs end to end on the real trained checkpoint before anything is committed (the guard from the CIFAR-10 bias incident).

### Reference (`model/lm_reference.py`)

The direct NumPy integer model built only from `model/fixedpoint.py` operations, including the sampler.
It is the specification of correct tokens: it produces the golden token sequences and the quantized validation loss.

## 2. Data layouts and ISA additions

### Principle

A BLOCK computes one 8x8 output tile as the sum over slots k of A column k times B row k, with A from a word of weight memory and B from the activation gather.
The DMA and the gather do not change.
Every new layout is produced by a VPU command writing its output in the shape the next BLOCK reads.

### Layouts

| Tensor | Memory | Layout |
|---|---|---|
| Matmul inputs and RESULT8 outputs | activation | one word per feature; byte s is story s |
| Residual stream and RESULT16 outputs (int16) | activation | two words per feature; lanes 0-3, then 4-7 |
| K cache, transposed (per layer, story, KV head) | activation | word (dim d, position block j >> 3); byte j & 7 |
| V cache (per layer, story, KV head) | activation | one word per position; byte d |
| Rotated q (per story, KV head) | A scratch | word per dim d; byte i is query head 2h + i, bytes 2-7 zero |
| Attention probabilities (per story, KV head) | A scratch | word per position; byte i is query head 2h + i, bytes 2-7 zero |
| Token log | activation | one step per two words; 8 int16 token IDs |

"Weight memory" is renamed A memory: it holds the weights and tables as before, plus a scratch region the VPU writes.

### How each matmul maps onto BLOCK

- Weight matmuls (q, k, v, o, gate, up, down, classifier): a 1x1 convolution over an 8-pixel row whose pixels are the 8 stories (Cin = input features, H = 1, W = 8, KSIZE = 1).
  This is today's BLOCK, unchanged.
- QK^T, per story and KV head, 8 positions per BLOCK: A word for slot d is the rotated-q word; the B row is the K^T word (d, j >> 3) through the gather (the K^T region is a Cin = 8, H = 1, W = 256 tensor).
  Output rows are the 2 query heads, lanes the 8 positions, returned as RESULT16 with a row limit of 2.
- AV, per story and KV head: A word for slot j is the probabilities word; the B row is the V word of position j (a Cin = 256, H = 1, W = 8 tensor).
  K slots = 8 * ceil((t + 1) / 8), in rounds of 64 with acc_keep beyond 64; probabilities past t are 0.
  Output rows are the 2 query heads, lanes the 8 dims, returned as RESULT8 with a row limit of 2; TRANSPOSE then makes them feature-major for o-proj.
- Attention uses 2 of the 8 array rows, inherent to 2 query heads per KV head; the counters report it as measured.

### RTL changes outside the VPU

1. A memory: a VPU write port; default depth 64K words (512 KB, up from 256 KB).
2. Result engine (`noc_node`): RESULT16, a requant mode that saturates to int16 and packs 4 values per flit (2 flits per row); and a GO row limit (1-8 rows) so a block returns only its useful rows.
   The GO payload has free bits for both.
   Write-back decodes RESULT16 rows into two words each.
3. `cmd_seq`: the register file grows to 32 (section 2, Registers); LOOP can take its count from a register; the loop stack is 4 deep; BLOCK gains a register form that takes its round, row limit, and result mode from registers, for blocks whose size grows with t.
4. VPU commands (section 3) drain like WAIT before they start (every outstanding block written back), then own the DMA's read ports and write-back's write ports through a mux in `accel.v`; the next command starts when the VPU finishes.
   The VPU never overlaps the mesh; the counters show that serialization.

### Registers

The 16 existing registers keep their indices and meaning.
New hardware-defined registers:

| Index | Name | Meaning |
|---:|---|---|
| 16 | T | Current position (0-255) |
| 17 | PLEN | Prompt length in tokens |
| 18 | INV_TEMP | Inverse temperature, Q8.8; 0 selects argmax |
| 19 | ROUND | BLOCK register form: round |
| 20 | ROWS | BLOCK register form: row limit minus 1 |
| 21 | RMODE | BLOCK register form: result mode (raw, RESULT8, RESULT16) |
| 22-31 | - | Free (VOP operand pointers, loop counters) |

### Commands

| Opcode | Command | Effect |
|---:|---|---|
| 1 | ADD | Unchanged (r0-r15) |
| 2 | BLOCK | Unchanged, plus a register-form flag (above) |
| 3-6 | WAIT, LOOP, ENDLOOP, END | Unchanged; LOOP nests 4 deep |
| 7 | ALU | dst = src op (src2 or imm), op in {add, sub, shr, and}; 5-bit register fields |
| 8 | LOOPR | LOOP whose count is a register; a count of 0 skips the body |
| 9 | VOP | One vector command (section 3): sub-op field plus up to three 5-bit operand registers |

Exact bit positions are fixed in `compiler/isa.py`, the single source for the compiler, golden executor, and disassembler.
New errors (sticky `error`, `error_pc`, `$fatal` in simulation): an invalid VOP sub-op, a fifth nested loop, a register-form ROWS or RMODE out of range.

## 3. The vector unit

### Integer definitions (`model/fixedpoint.py`; `rtl/vpu*.v` bit-exact to them)

- rsqrt and reciprocal: normalize by leading-zero count to an even exponent, 32-entry table seed, one Newton step; result is a Q1.15 mantissa and an exponent.
- exp, for x <= 0: z = x * scale_log2e in fixed point, split into integer part n and fraction f; 2^-f from a second-order integer polynomial (I-BERT); the result shifted right by n, in Q0.16.
- Rounding everywhere is `fixedpoint.requant`'s: add half, arithmetic shift right (round half up), then saturate to the output width.

### Commands (VOP sub-ops)

| Sub-op | Reads | Writes | Definition |
|---|---|---|---|
| EMBED | token log at T, embedding table (A memory) | residual | Each story's embedding row, scaled to the residual's int16 scale |
| RMSNORM | residual | int8 feature words | Sum of squares over 64 int16 features in 40 bits, shift right by 6, rsqrt, requant(x * r) to int8 |
| ROPE | q and k feature words, RoPE table (A memory) | q to A scratch; k in place | y0 = rs(x0*c - x1*s, 14), y1 = rs(x0*s + x1*c, 14), saturated int8; c and s are Q1.14 at position T |
| KVWRITE | rotated k, v feature words | K^T cache (byte read-modify-write), V cache (whole words) | Position T of every story, layer, KV head |
| SOFTMAX | scores (RESULT16) | probabilities to A scratch | Max over positions 0..T, exp, sum, reciprocal; p in 0..127; positions past T written 0 |
| SILU_MUL | gate and up words, the layer's SiLU table | int8 feature words | requant(silu_table[g] * u); the table maps each int8 input to an int16 output |
| ADD | residual, a RESULT16 buffer | residual | residual + requant(x), saturated int16 |
| TRANSPOSE | 8 words at a stride | 8 words at a stride | 8x8 byte transpose |
| SAMPLE | logits (RESULT16), INV_TEMP, token log | token log at T + 1 | See below |

SAMPLE, per story: while T + 1 < PLEN it copies the prompt token already in the log and draws nothing.
Otherwise, with INV_TEMP = 0 it takes the argmax (lowest index wins ties).
With INV_TEMP > 0 it scales the logits by INV_TEMP, computes exp values e_i and their sum S, draws r16 from the story's xorshift32 generator, sets u = (r16 * S) >> 16, and picks the first token whose running sum of e_i exceeds u: an exact integer inverse CDF with no division.
Each story's generator is seeded by the compiler and advances once per sampled token.

The SiLU tables (one per layer, 256 int16 entries, since the gate input scale is fixed per layer) and the RoPE table (256 positions x 4 frequencies x cos and sin, int16) are built by the compiler from `fixedpoint.py`'s definitions and stored in A memory.
SILU_MUL loads its layer's table into the VPU first (64 words, 64 cycles).

### Datapath and RTL structure

Eight lanes wide: one word read and one word written per cycle, the 8 stories in lockstep (8 int8 lanes or 4 int16 lanes per word), with max, sum, and sum-of-squares accumulators for reductions.
SAMPLE reads the vocabulary three times (max; exp and sum; running-sum walk) over 2 words per vocabulary entry: about 3K cycles per step for all 8 stories.

| File | Role |
|---|---|
| `rtl/vpu.v` | Sub-op decode, per-pass address generation, memory port requests |
| `rtl/vpu_lanes.v` | 8-lane multiply, rounding shift, saturate |
| `rtl/vpu_exp.v` | exp |
| `rtl/vpu_rsqrt.v` | rsqrt and reciprocal |
| `rtl/vpu_rng.v` | 8 xorshift32 generators |
| `rtl/vpu_perf.v` | Busy cycles per sub-op, in the `node_perf` style |

## 4. Compiler and golden executor

- `compiler/isa.py`: the new opcodes, register form, VOP sub-ops, register map, and shape constraints.
- `compiler/lower_lm.py` (new): the transformer to BLOCKs and VOPs; memory allocation; weight, table, and prompt packing.
- `compiler/schedule.py`: weight matmuls spread their groups across tiles in waves of W * H, as for CIFAR-10; attention pins story s to tile s mod (W * H), with the story loop unrolled because the tile field is an immediate.
- `compiler/emit.py`: hex images for program, A memory, and the four activation banks.
- `compiler/golden.py`: executes the new commands at command level (VOPs call `fixedpoint.py`), models RESULT16, the row limit, A-memory writes, and the K^T read-modify-writes, and faults on the new errors plus these ordering rules: a BLOCK must not read A scratch after a later VOP rewrote it without a WAIT between; T must stay below the context.
- `compiler/check_lm.py` (new): golden's token log and final memory equal `lm_reference.py`'s, at temperature 0 and 1.0, for several mesh shapes.
  A full 256-step golden run is about 1M BLOCKs in Python, so pytest uses 16-step runs and `check_lm.py` runs the full length on demand.

Program shape (about 1K commands, within the 4K program memory):

```
LOOP n_steps
  VOP EMBED
  LOOP 5                                   ; per-layer bases advance by fixed strides (ALU)
    VOP RMSNORM; q/k/v BLOCKs; WAIT; VOP ROPE; VOP KVWRITE
    32 story x KV-head nests: ALU setup; LOOPR nblk { QK^T BLOCK; ALU pointers += 1 word }
    WAIT; VOP SOFTMAX
    32 nests: ALU setup; LOOPR rounds { AV BLOCK (register form, acc_keep); ALU ROUND += 1 }
    WAIT; VOP TRANSPOSE
    o-proj BLOCKs; WAIT; VOP ADD
    VOP RMSNORM; gate/up BLOCKs; WAIT; VOP SILU_MUL; down BLOCKs; WAIT; VOP ADD
  ENDLOOP
  VOP RMSNORM; classifier BLOCKs; WAIT; VOP SAMPLE; ALU T += 1
ENDLOOP
END
```

Memory map:

| A memory | Size |
|---|---:|
| Layer weights (norm gains folded) | 240 KB |
| Classifier (final norm gain folded) | 32 KB |
| Embedding table | 32 KB |
| RoPE table | 4 KB |
| SiLU tables | 2.5 KB |
| q and probability scratch, seeds | under 16 KB |

| Activation memory | Size |
|---|---:|
| K^T and V caches (8 stories x 5 layers x 4 KV heads x 256 positions x 8 bytes x 2) | 640 KB |
| Residual, feature buffers, scores | under 64 KB |
| Logits (512 x 8 x int16) | 8 KB |
| Token log (257 steps x 16 bytes) | about 4 KB |

## 5. Verification

### Ladder (each level bit-exact against the level above, on the token log and final memory, at temperature 0 and 1.0)

1. The float PyTorch model: accuracy reference only (validation loss).
2. `model/lm_reference.py`: the specification of correct tokens.
3. `compiler/golden.py` on the compiled program: proves the compiler.
4. The RTL: proves the hardware; its tokens are also checked against level 2 directly.

### Tests

- pytest: `model/test_fixedpoint.py` for every new integer op (including edge cases below); `compiler/test_*.py` for every new encoding, lowering of small transformers, golden against the direct reference, and every new ordering-rule fault.
- `tb/vpu/` (new): every sub-op on random inputs and edge cases (all logits equal, a single valid position, maximum-magnitude residuals, INV_TEMP = 0, prompt copy), bit-exact against `fixedpoint.py`.
- `tb/mesh/` and `tb/writeback/`: RESULT16 and the row limit.
- `tb/cmd_seq/`: ALU, LOOPR (including count 0), 4-deep loops, the register form, and every new fault's `error_pc`.
- `tb/accel/`: random small transformers (1-2 layers, 8-16 steps) compiled and run end to end on 1x1, 2x2, and 4x3, one case per simulator run; every new `$fatal` proven by a negative test.
- `./test.sh` gains `tb/vpu/` and an 8-step run of the real model on 2x2; `make lm` in `tb/accel/` runs the full 256 steps.

### Exit criteria

- One `start` generates 8 stories of 256 tokens on the chip, bit-exact at every level of the ladder, at temperature 0 and 1.0.
- The float validation loss is reported against `stories260K`'s 1.297 with the context caveat, and the int8 loss is within 0.10 of float.
- `docs/perf/lm.md` (generated by `make lm`) holds the 8 stories as text, cycles per token, the per-step breakdown (weight matmuls, attention, VPU, other), utilization, and cycles per token on 1x1, 2x2, and 4x4.
- `docs/perf/lm_trace.json` exists (section 6).

## 6. Trace export

`make lm` writes `docs/perf/lm_trace.json` next to `docs/perf/lm.md`; both are generated and marked "do not edit".

- Configuration: model shape, mesh, prompt, temperature, seeds.
- Per story: token IDs, decoded text, the step it emitted EOS (if any).
- Per step: total cycles and the breakdown by category, from counter snapshots taken at each SAMPLE (`cmd_perf` gains attention-BLOCK and VPU-busy counters, so the categories are measured, not estimated), plus per-tile busy cycles from `node_perf`.
- Attention probabilities for every head of story 0, per step and layer, taken from `lm_reference.py`; the trace names that source, which is bit-exact with the RTL by the ladder.

256 snapshots per run cost 256 Python callbacks, not the per-cycle callbacks that 4.2e removed.

## 7. Delivery (sub-issues of #60, in dependency order)

| Issue | Delivers | Depends on | Done when |
|---|---|---|---|
| 4.3a | DMA refill overlapped across BLOCK boundaries | - | CIFAR-10 still bit-exact; `make cifar` and `make scaling` show the 3-cycle per-BLOCK refill gone from the "Other" column |
| 4.3b | Tokenizer, training, quantization, new `fixedpoint.py` ops, `lm_reference.py` | - | Loss gate met; sample stories from the int8 reference read coherently |
| 4.3c | RESULT16, row limit, A-memory write port and depth | - | `tb/mesh/` and `tb/writeback/` pass with the new modes |
| 4.3d | ISA additions, `lower_lm.py`, golden executor, `check_lm.py` | b | Golden equals `lm_reference.py` for several meshes |
| 4.3e | `rtl/vpu*.v`, `tb/vpu/` | b | Every sub-op bit-exact on random and edge inputs |
| 4.3f | `cmd_seq` extensions, `accel` integration | c, d, e | Random small transformers pass end to end on 1x1, 2x2, 4x3 |
| 4.3g | Stories on the chip: `make lm`, `docs/perf/lm.md`, the trace, the scaling table | f | Exit criteria above |

4.3a, 4.3b, and 4.3c can proceed in parallel.
Each sub-issue is one PR with its `docs/decisions.md` and `docs/learnings.md` entries.

## Out of scope for 4.3

Prefill as a batched GEMM, top-p sampling, overlapping VPU work with mesh work, weight residency, multicast, more edge memory ports, dynamic tile scheduling, contexts beyond 256, and the portfolio app (the milestone after 4.3).
