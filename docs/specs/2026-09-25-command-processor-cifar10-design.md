# Milestone 4.2 design: on-chip command processor and compiler for CIFAR-10

Status: approved 2026-09-25; 4.2a (model side) landed in PR #74, 4.2b (compiler and golden executor) in `compiler/`.
Tracking issue: #59.
Builds on milestone 4.1 (issues #53-#58): WxH mesh, on-chip requant with packed int8 results, back-to-back K streaming, keep-accumulating GO flags.

## Goal

A whole CIFAR-10 CNN runs on the chip with no software in the loop: the testbench only loads memory images and pulses `start`.
Exit criteria (from #59): 128 CIFAR-10 test images bit-exact against NumPy, with accuracy reported against the labels and the float model, and a scaling study across mesh sizes that shows where the memory corner becomes the bottleneck.

## Decisions taken in the design conversation

- The command processor is a fixed-function descriptor engine, not an embedded CPU.
- The network is a compact all-convolutional net (about 7.5M MACs per image, float accuracy target at least 80%).
- Architecture A: the command processor and memories sit at mesh node (0,0), a strided DMA performs im2col while packing OPERAND flits, and RESULT8 rows are written back as the next layer's input.
- The mesh and its OPERAND/GO/RESULT protocol are unchanged.
- Tile scheduling is static and done by the compiler; the hardware only enforces ordering.

## 1. Workload and mapping

### Network

| Layer | Input (C x H x W) | Output (C x H x W) | Kernel | Stride | Pad | K slots (taps x Cin, then bias slots up to a multiple of 8) |
|---|---|---|---|---:|---:|---:|
| conv1 | 4 x 32 x 32 (RGB + zero channel) | 16 x 32 x 32 | 3x3 | 1 | 1 | 40 |
| conv2 | 16 x 32 x 32 | 32 x 16 x 16 | 3x3 | 2 | 1 | 152 |
| conv3 | 32 x 16 x 16 | 32 x 16 x 16 | 3x3 | 1 | 1 | 296 |
| conv4 | 32 x 16 x 16 | 64 x 8 x 8 | 3x3 | 2 | 1 | 296 |
| conv5 | 64 x 8 x 8 | 64 x 8 x 8 | 3x3 | 1 | 1 | 584 |
| fc | 64 x 8 x 8 | 16 x 1 x 1 (10 real classes) | 8x8 | 1 | 0 | 4104 |

Every conv layer is followed by requantize + ReLU to int8; the fc layer returns raw int32 logits.
Stride-2 convolutions replace pooling, so every layer is a GEMM followed by the existing requant path.
If the float model lands below 80%, channel widths grow before any hardware assumption changes.

### Quantization

- Train with BatchNorm, then fold each BatchNorm into the preceding conv's weights and a per-channel bias.
- Weights use one symmetric scale per group of 8 output channels.
  One GO computes exactly one group, so the group's requant factor becomes that GO's (m, sh) via `model/fixedpoint.py`.
- Activations use one symmetric per-tensor scale per layer, calibrated on training data; the input image uses a fixed scale from the known normalized pixel range.
- The bias is a GEMM term spread over the bias slots, every K slot from taps * Cin up to KS.
  The DMA emits a constant int8 value `bias_val` (chosen per layer by the compiler) in each bias slot, and the weights carry one int8 bias row per slot; the rows sum exactly to `round(b / (s_in * s_w * bias_val))`, split as evenly as possible.
  One slot tops out near 127 * 127 accumulator units, which the trained network exceeds (conv4 needs about 38,000); the slots that pad K to a multiple of 8 hold it at no cost, and K grows by 8 only if they cannot.
  The compiler picks the smallest `bias_val` that fits the rows in int8, the smallest rounding error, and the NumPy reference uses the same quantized bias, so bit-exactness is unaffected.

### Mapping one conv onto 8x8 tile blocks

- An output block is 8 output channels (the tile's A rows, from weights) by 8 consecutive output pixels in row-major order (the tile's B columns, from the im2col gather).
- A RESULT8 row is then one output channel's 8 consecutive pixels, which in CHW layout is one aligned 64-bit word.
- K is ordered (tap, channel) with channel innermost: slot k = (ky * KSIZE + kx) * Cin + c for k < taps * Cin, then bias slots up to KS, a multiple of 8.
- K runs as rounds of at most 64 slots using `acc_keep` / `no_ret` (issue #58); round r covers slots [64r, min(64r + 64, KS)).
- Blocks per layer: groups = Cout / 8, pixel blocks = max(1, Hout * Wout / 8).

### Shape constraints (guaranteed by the compiler, documented in `compiler/isa.py`)

- Cin, H, W, and Wout are powers of two; Wout is at least 8 or exactly 1, and Wout = 1 requires Hout = 1 (only lane 0 is valid).
- H * W and W are multiples of 8 bytes, so every channel plane and row starts word-aligned.
- KSIZE is at most 8; Cout is a multiple of 8 and at most 512 (64 groups).
- A layer's weights fit the weight memory and its activations fit the activation memory.

## 2. Memory model and command set

### Memories

All three are behavioral in simulation and loaded by `$readmemh` from compiler-emitted hex files.

| Memory | Word | Default depth | Ports | Contents |
|---|---|---|---|---|
| Program | 64 bits | 4K words | 1 read (fetch) | Commands |
| Weights | 64 bits | 32K words (256 KB) | 1 read (DMA A words) | Per group, per slot: one word = 8 output channels' int8 weights |
| Activations | 64 bits, four word-interleaved banks (bank = word mod 4) | 128K words (1 MB) | per bank 1 read (DMA gather) + 1 write (write-back) | Input images, per-layer activation buffers (CHW, int8), logits (int64 words) |

Splitting weights from activations lets the DMA fetch one A word and one B window of up to three consecutive words every cycle with no arbitration, while write-back uses its own write port.

Activation memory map (compiler-chosen): every image's input from word 0, then one buffer per intermediate layer (reused by every image), then every image's final output.
Word byte order is little-endian: byte j of a word is bits [8j+7:8j], so lane j of a RESULT8 row and byte j of an A word land on byte j.

### Registers

Sixteen 32-bit registers; r0 reads as zero.
Hardware-defined indices (the rest are free for the program):

| Index | Name | Meaning |
|---:|---|---|
| 0 | ZERO | Always 0 |
| 1 | IN_BASE | Byte address of the layer's input tensor in activation memory |
| 2 | OUT_BASE | Word address of the layer's output tensor |
| 3 | W_BASE | Word address of the layer's weights in weight memory |
| 4 | CIN_LOG2 | log2(Cin) |
| 5 | H_LOG2 | log2(input H) |
| 6 | W_LOG2 | log2(input W) |
| 7 | WOUT_LOG2 | log2(output W) |
| 8 | STRIDE | 1 or 2 |
| 9 | PAD | 0 or 1 |
| 10 | KSIZE | Kernel size (3, or 8 for fc) |
| 11 | KS | Total K slots (multiple of 8) |
| 12 | BIAS | [15:0] first bias slot index (taps * Cin), [23:16] bias_val (int8) |
| 13 | OSTRIDE | Words per output channel plane (max(1, Hout * Wout / 8)) |
| 14-15 | - | Free (the compiler uses them as per-image input and logit pointers) |

### Commands (64-bit words, opcode in [63:60]; opcode 0 is invalid so zeroed memory faults)

| Opcode | Command | Fields | Effect |
|---:|---|---|---|
| 1 | ADD | [59:56] dst, [55:52] src, [31:0] imm | dst = src + imm (covers set, copy, and increment) |
| 2 | BLOCK | [59:57] tile_x, [56:54] tile_y, [53:48] group, [47:40] pixel_block, [39:33] round, [32:30] ky0, [29:27] kx0, [26:23] flags, [22:17] sh, [15:0] m | One round of one output block (below) |
| 3 | WAIT | - | Stall until every requested result has been written back |
| 4 | LOOP | [15:0] count | Push (pc + 1, count); one level deep |
| 5 | ENDLOOP | - | Decrement; jump back while nonzero |
| 6 | END | - | Raise `done` once every requested result has been written back |

BLOCK flags: [26] acc_keep, [25] no_ret, [24] requant (RESULT8), [23] relu.
(ky0, kx0) is the tap of the round's first slot, supplied by the compiler so the DMA never divides by KSIZE; the starting channel is (64 * round) mod Cin, a mask.
The tap advances each time the channel wraps to 0.
A round that starts at or past the first bias slot carries (ky0, kx0) = (0, 0), since the DMA ignores the tap there (the fc layer's round 64 would otherwise need ky0 = 8).

BLOCK executes as:

1. For each slot k in the round, the DMA sends one OPERAND flit to the tile at slot address (k - 64 * round): A column = weight word W_BASE + group * KS + k; B row = the 8-lane gather below.
2. Then a GO with k_chunks = slots / 8, return address (0, 0), the flags, and (m, sh).
3. Unless no_ret is set, it pushes a write-back entry for the tile.

### Gather semantics (the contract `dma_gather.v` and `compiler/golden.py` both implement)

For slot k < taps * Cin with tap = k >> CIN_LOG2, c = k & (Cin - 1), ky = tap / KSIZE, kx = tap % KSIZE, and output pixel p = 8 * pixel_block + l for lane l = 0..7:

- oy = p >> WOUT_LOG2, ox = p & (Wout - 1), iy = oy * STRIDE + ky - PAD, ix = ox * STRIDE + kx - PAD.
- Lane l = input[c][iy][ix] if the lane is valid (Wout > 1, or l = 0 when Wout = 1) and 0 <= iy < H and 0 <= ix < W; otherwise 0.
- A bias slot (first bias slot <= k < KS) gives bias_val on valid lanes and 0 elsewhere.

Because a block's 8 pixels lie in one output row (Wout >= 8) or in a single lane (Wout = 1), a slot's valid lanes read bytes ix0, ix0 + STRIDE, ... of one input row: at most 15 bytes, which span at most three consecutive words.
Four word-interleaved banks put any three consecutive words in three different banks, so one cycle delivers every slot.
Two even/odd banks, the first design, cannot: at stride 2 the first and third of three words share a bank, and 47 of conv2's 282 live (pixel block, tap) pairs span three words.

### Write-back

- Each returning GO pushes {output word address, raw/int8} onto that tile's write-back FIFO (depth 2); issuing a returning BLOCK to a tile whose FIFO is full stalls.
- RESULT8 row i of a block for group g and pixel block pb writes one word to OUT_BASE + (8g + i) * OSTRIDE + pb.
- A raw RESULT cell (i, j) writes the sign-extended int32 as one word to OUT_BASE + ((8g + i) * OSTRIDE + pb) * 8 + j; the fc logit for class c is at word OUT_BASE + 8c.
- An entry pops when its block's last flit is written (8 RESULT8 flits or 64 RESULT flits); tiles return blocks in order, so the head entry always matches.
- An outstanding-block counter (incremented at a returning GO, decremented at pop) is what WAIT and END wait on.

### Ordering rules

The hardware relies on these and does not check them; `compiler/golden.py` faults on any violation.

- A BLOCK finishes reading registers and memory before the next command executes, so later ADDs cannot disturb it.
- A BLOCK must not read an activation word that an outstanding returning BLOCK (one not yet covered by a WAIT or END) writes.
- Two outstanding BLOCKs must not write the same activation word (different tiles return in no fixed order).
- A BLOCK's (ky0, kx0) is its round's first tap, (64 * round >> CIN_LOG2) as (ky, kx) with both below KSIZE, or (0, 0) for a round that starts at or past the first bias slot; the DMA loads them into separate ky/kx counters.
- A slot's valid lanes lie within three consecutive activation words (the shape rules guarantee it).

### Errors

An invalid opcode, a tile outside the mesh, a LOOP while a loop is active, a LOOP with count 0, or an ENDLOOP with no active loop sets a sticky `error` output and `error_pc`, stops fetch, and in simulation calls `$fatal`.
A RESULT flit delivered anywhere but node (0,0) is a simulation `$fatal`.

## 3. RTL structure

- `rtl/accel.v`: top level.
  `noc_mesh #(W, H)`, the three memories, and the command processor on node (0,0)'s injection and RESULT ports; the other nodes' injection ports are tied off.
  Ports: `clk`, `rst`, `start`, `done`, `error`, `error_pc`.
- `rtl/cmd_seq.v`: fetch, decode, registers, loop stack, WAIT/END, error detection; hands one BLOCK at a time to the DMA and waits for write-back credit.
- `rtl/dma_gather.v`: slot counters (tap, channel, bias), address generation, registered memory reads, byte shift and stride select, lane and row masks; one slot per cycle, stallable.
- `rtl/flit_pack.v`: builds OPERAND and GO flits from the gathered slot and BLOCK fields, drives node (0,0)'s injection port, and holds the pipeline on `inj_ready` low through a skid buffer.
- `rtl/writeback.v`: per-tile write-back FIFOs, RESULT/RESULT8 decoding, activation memory writes, the outstanding-block counter.
- `rtl/cmd_perf.v`: free-running counters in the `node_perf` style: total cycles, DMA slot cycles, injection stall cycles, WAIT stall cycles, write-back words.
- Memories: `rtl/sim_mem.v`, a parameterized behavioral 1R1W memory with `$readmemh`, instantiated for program, weights, and the four activation banks.

## 4. Compiler and verification

### Model (`model/`)

- `cifar_train.py`: trains the float network with BatchNorm (checkpoint gitignored).
- `cifar_quantize.py`: folds BatchNorm, quantizes per 8-channel group, calibrates activation scales, derives bias rows and per-group (m, sh); freezes `model/cifar_quantized.npz` (int8 weights, bias rows, scales, 128 test images, labels, float predictions).
- `cifar_reference.py`: the direct NumPy int8 network (int64 conv summed tap by tap, `fixedpoint.requant`), reporting int8 and float accuracy over all 10,000 test images.

### Compiler (`compiler/`, pure Python, on the testbench PYTHONPATH)

- `isa.py`: command encoding, register map, shape constraints; the single source for the compiler, the golden executor, and the testbench disassembler.
- `lower.py`: layers to groups x pixel blocks x rounds, memory allocation, weight packing (A words, bias rows, Cin padding), register values.
- `schedule.py`: static round-robin tile assignment for a given WxH in waves of W * H blocks, each wave emitted round-major (all of a block's rounds on one tile, nothing else on that tile in between), a WAIT after every layer but the last, the whole network in one LOOP over images.
- `emit.py`: program, weight, and activation hex images (one per activation bank).
- `golden.py`: an ISA-level executor that runs the emitted program on the memory image with the gather, requant, and write-back semantics above, and faults on the errors and ordering-rule violations above.
- `build.py` ties lowering, scheduling, and input packing together; `check_cifar.py` runs level 2 below on all 128 frozen images for several mesh shapes.

### Verification ladder (each level bit-exact against the level above)

1. `cifar_reference.py`: the specification of correct results.
2. `golden.py` on the compiled program equals (1), for several mesh shapes: proves the compiler.
3. The RTL's final activation memory (every layer's buffer and the logits) equals (2)'s: proves the hardware.

### Tests

- pytest: `compiler/test_*.py` (encoding round trips, lowering of small layers, golden vs direct reference on random small nets and on CIFAR).
- cocotb unit suites: `tb/dma_gather/` (random shapes, strides, pads, edges, bias slots, stalls), `tb/writeback/` (FIFO order, credit stall, raw and int8 writes), `tb/cmd_seq/` (decode, ADD, LOOP, WAIT, END, errors, plus a `make error-check` negative test that the error path stops the run).
- `tb/accel/`: random small conv stacks compiled and run end to end on 2x2 and 4x3, memory equal to golden; an 8-image CIFAR run in `./test.sh`; `make cifar` runs all 128 images and records accuracy in `docs/perf/`.

## 5. Scaling study

`make scaling` recompiles the 128-image program for 1x1, 2x1, 2x2, 3x3, and 4x4 meshes and records cycles per image, speedup, MAC utilization, the command processor's cycle breakdown, and node (0,0)'s port occupancy.
`docs/perf/scaling.md` holds the table, a chart, and the explanation of where and why the corner saturates.

## 6. Delivery (sub-issues of #59, in dependency order)

| Issue | Delivers | Done when |
|---|---|---|
| 4.2a | CIFAR-10 model, quantization, NumPy int8 reference | Float accuracy at least 80%; int8 accuracy on 10,000 images reported |
| 4.2b | ISA, compiler, golden executor | Golden equals the direct reference bit-exactly on 128 images for several WxH |
| 4.2c | `dma_gather.v`, `flit_pack.v` | Bit-exact against the golden gather on random shapes; one slot per cycle without backpressure |
| 4.2d | `cmd_seq.v`, `writeback.v`, `cmd_perf.v`, `sim_mem.v`, `accel.v` | Random conv stacks pass end to end on 2x2 and 4x3; error path proven fatal |
| 4.2e | CIFAR-10 on the chip | 128 images bit-exact at every layer; accuracy vs labels and float recorded |
| 4.2f | Scaling study | 1x1 through 4x4 measured; corner saturation identified and explained |

4.2a and 4.2c can proceed in parallel: the gather contract above is fixed.

## Out of scope for 4.2

Double-buffered operand memory, multiple memory ports on the mesh edge, dynamic tile scheduling, weight residency across images, and an embedded CPU.
The scaling study decides which of these 4.3 or later needs first.
