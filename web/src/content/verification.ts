import type { Command, Ladder, Layer, Limit, Suite } from "../verification/types";

export const LADDERS: Ladder[] = [
  {
    id: "cifar",
    title: "CIFAR-10 on the chip",
    rungs: [
      {
        id: "cifar-reference",
        name: "Integer reference",
        proves: "The specification of correct results: what every layer must produce, in integer arithmetic.",
        files: ["model/cifar_reference.py", "model/fixedpoint.py"],
        command: { text: "pytest model/test_cifar.py", file: "model/test_cifar.py" },
        bitExact: true,
      },
      {
        id: "cifar-golden",
        name: "Golden executor",
        proves: "The compiled program, run at command level, equals the reference for several mesh shapes. This proves the compiler.",
        files: ["compiler/golden.py", "compiler/check_cifar.py"],
        command: { text: "python compiler/check_cifar.py", file: "compiler/check_cifar.py" },
        bitExact: true,
      },
      {
        id: "cifar-rtl",
        name: "The RTL",
        proves: "The chip's final activation memory equals the golden executor's, and its logits equal the reference's. This proves the hardware.",
        files: ["rtl/accel.v", "tb/accel/test_accel.py"],
        command: { text: "make cifar (in tb/accel)", make: { dir: "tb/accel", target: "cifar" } },
        bitExact: true,
      },
    ],
  },
  {
    id: "lm",
    title: "The story model on the chip",
    rungs: [
      {
        id: "lm-float",
        name: "Float PyTorch model",
        proves: "An accuracy reference only: its validation loss shows what quantization costs. Nothing is claimed to be bit-exact against it.",
        files: ["model/lm_net.py", "model/lm_train.py"],
        bitExact: false,
      },
      {
        id: "lm-reference",
        name: "Integer reference",
        proves: "The specification of correct tokens, defined once in model/fixedpoint.py and compared with the float model by validation loss.",
        files: ["model/lm_reference.py", "model/fixedpoint.py"],
        command: { text: "pytest model/test_lm.py", file: "model/test_lm.py" },
        bitExact: false,
      },
      {
        id: "lm-golden",
        name: "Golden executor",
        proves: "The compiled program equals the reference on the token log and the final memory. This proves the compiler.",
        files: ["compiler/golden.py", "compiler/golden_vop.py", "compiler/check_lm.py"],
        command: { text: "python compiler/check_lm.py", file: "compiler/check_lm.py" },
        bitExact: true,
      },
      {
        id: "lm-rtl",
        name: "The RTL",
        proves: "The chip's memory and token log equal the golden executor's, and its tokens are also checked against the reference directly. This proves the hardware.",
        files: ["rtl/accel.v", "rtl/vpu.v", "tb/accel/test_accel.py"],
        command: { text: "make lm (in tb/accel)", make: { dir: "tb/accel", target: "lm" } },
        bitExact: true,
      },
    ],
  },
];

export const CLAIM = {
  text: "make lm writes lm.json, lm.md and lm_trace.json only if all four runs pass, so no number on this page can come from a failed run.",
  make: { dir: "tb/accel", target: "lm" },
};

export const LAYERS: Layer[] = ["PE and tile", "NoC and result path", "Front end", "Vector unit", "System"];

export const SUITES: Suite[] = [
  {
    dir: "tb",
    kind: "cocotb",
    dut: ["rtl/pe.v"],
    proves: "A single signed 8-bit multiply-accumulate processing element against NumPy, including its registered forwarding ports.",
    layer: "PE and tile",
    checks: [],
  },
  {
    dir: "tb/array",
    kind: "cocotb",
    dut: ["rtl/systolic_array.v"],
    proves: "The 8x8 output-stationary array on skewed, zero-padded inputs against NumPy.",
    layer: "PE and tile",
    checks: [],
  },
  {
    dir: "tb/tile",
    kind: "cocotb",
    dut: ["rtl/tile.v", "rtl/skew_feeder.v"],
    proves: "The tile with its skew feeder: unskewed operand blocks in, correct accumulators out.",
    layer: "PE and tile",
    checks: [],
  },
  {
    dir: "tb/operand_mem",
    kind: "cocotb",
    dut: ["rtl/operand_mem.v"],
    proves: "The operand buffer's write and read ports, and its no-write-during-read invariant.",
    layer: "PE and tile",
    checks: [
      { target: "collision-check", kind: "must-fail", says: "A write that collides with a real read must stop the run, on operand_mem's own check." },
    ],
  },
  {
    dir: "tb/gemm",
    kind: "cocotb",
    dut: ["rtl/gemm_tile.v", "rtl/gemm_sequencer.v"],
    proves: "Tiled GEMM at several K through the operand memory and the sequencer against NumPy, plus back-to-back N-blocks.",
    layer: "PE and tile",
    checks: [],
  },
  {
    dir: "tb/router",
    kind: "cocotb",
    dut: ["rtl/router.v"],
    proves: "One router: XY routing, round-robin arbitration and valid/ready backpressure.",
    layer: "NoC and result path",
    checks: [],
  },
  {
    dir: "tb/requant",
    kind: "cocotb",
    dut: ["rtl/requant.v"],
    proves: "The requantizer against model/fixedpoint.py, bit for bit.",
    layer: "NoC and result path",
    checks: [{ target: "q16", kind: "must-hold", says: "The 16-bit RESULT lane matches the reference requantizer." }],
  },
  {
    dir: "tb/noc",
    kind: "cocotb",
    dut: ["rtl/noc_pair.v"],
    proves: "Two nodes over one link: operands as routed packets, then GO and RESULT flits.",
    layer: "NoC and result path",
    checks: [],
  },
  {
    dir: "tb/mesh",
    kind: "cocotb",
    dut: ["rtl/noc_mesh.v"],
    proves: "The WxH mesh at 2x2 and 4x3: corner turns, cross-traffic and converging streams, with bit-exact matmuls on every tile.",
    layer: "NoC and result path",
    checks: [
      { target: "size-check", kind: "must-fail", says: "A mesh wider than its coordinates can address must stop the run instead of aliasing nodes." },
    ],
  },
  {
    dir: "tb/flit_pack",
    kind: "cocotb",
    dut: ["rtl/flit_pack.v"],
    proves: "Flit formatting, backpressure and one flit per cycle.",
    layer: "Front end",
    checks: [],
  },
  {
    dir: "tb/dma_gather",
    kind: "cocotb",
    dut: ["rtl/dma_gather.v"],
    proves: "The gather against the golden executor's operands on edge and random shapes, under Verilator and Icarus.",
    layer: "Front end",
    checks: [],
  },
  {
    dir: "tb/cmd_seq",
    kind: "cocotb",
    dut: ["rtl/cmd_seq.v"],
    proves: "The sequencer on the whole instruction set against the golden executor: all 32 registers, every BLOCK port and which opcodes are invalid.",
    layer: "Front end",
    checks: [],
  },
  {
    dir: "tb/writeback",
    kind: "cocotb",
    dut: ["rtl/writeback.v"],
    proves: "Write-back FIFO order, full and idle timing, and raw and int8 writes.",
    layer: "Front end",
    checks: [
      { target: "orphan-check", kind: "must-fail", says: "A RESULT flit with no pending write-back entry must stop the run." },
      { target: "mode-check", kind: "must-fail", says: "A flit of one mode for an entry of another, in all six ordered pairs, must stop the run." },
      { target: "rows-check", kind: "must-fail", says: "A block that returns more or fewer rows than its entry must stop the run." },
    ],
  },
  {
    dir: "tb/vpu",
    kind: "cocotb",
    dut: ["rtl/vpu.v"],
    proves: "Every vector sub-op bit-exact against compiler/golden_vop.py on whole memory images.",
    layer: "Vector unit",
    checks: [
      { target: "fault-check", kind: "must-fail", says: "Each illegal-operand probe must stop the run on its own message." },
    ],
  },
  {
    dir: "tb/accel",
    kind: "cocotb",
    dut: ["rtl/accel.v"],
    proves: "Whole programs from one start pulse, with memory word for word equal to the golden executor: conv stacks, CIFAR-10 and the story model, on 1x1, 2x2 and 4x3.",
    layer: "System",
    checks: [
      { target: "error-check", kind: "must-fail", says: "Each command-processor fault probe, such as a program compiled for the wrong mesh, must stop the run on its own message with the pc the golden executor gives." },
      { target: "stray-check", kind: "must-fail", says: "A RESULT delivered anywhere but node (0,0) must stop the run (Icarus only)." },
      { target: "vpu-check", kind: "must-fail", says: "A vector-unit memory-port violation must stop the run (Icarus only)." },
      { target: "reset-check", kind: "must-hold", says: "A reset during a VOP must leave the chip idle and runnable." },
    ],
  },
  {
    dir: "tb/mnist",
    kind: "cocotb",
    dut: ["rtl/systolic_array.v"],
    proves: "A batch of real MNIST test images through the hardware tile, bit-exact against NumPy, with accuracy against the labels and the float model.",
    layer: "System",
    checks: [],
  },
  {
    dir: "tb/perf",
    kind: "cocotb",
    dut: ["rtl/noc_mesh.v", "rtl/node_perf.v"],
    proves: "The performance counters against measured behaviour, and the committed baseline.",
    layer: "System",
    checks: [],
  },
  {
    dir: "model",
    kind: "pytest",
    dut: ["model/fixedpoint.py", "model/cifar_reference.py", "model/lm_reference.py"],
    proves: "The integer arithmetic every other level calls, and the CIFAR-10 and story-model references.",
    layer: "System",
    checks: [],
    paths: ["model/test_fixedpoint.py", "model/test_cifar.py", "model/test_lm.py"],
  },
  {
    dir: "compiler",
    kind: "pytest",
    dut: ["compiler/isa.py", "compiler/golden.py", "compiler/lower_lm.py"],
    proves: "Instruction encodings, lowering, scheduling and the golden executor against the direct references, including every ordering-rule fault.",
    layer: "System",
    checks: [],
    paths: ["compiler"],
  },
];

export const LIMITS: Limit[] = [
  {
    id: "simulation-only",
    text: "Everything here is simulated. Verilator is the default simulator and Icarus is the cross-check.",
    source: { decision: { date: "2026-09-24", title: "Verilator is the default simulator" }, contains: "Icarus" },
  },
  {
    id: "pnr-pe-only",
    text: "Place and route has been run for the processing element only. gemm_tile place and route is paused.",
    source: { decision: { date: "2026-09-24", title: "Phase 4 direction" }, contains: "gemm_tile P&R (#36)" },
  },
  {
    id: "sram-macro-gap",
    text: "The generated SRAM macro has a DRC and LVS gap, which the repository documents as an upstream open-PDK limitation, not as a clean result.",
    source: { decision: { date: "2026-09-08", title: "Real area win from the SRAM macro" }, contains: "documented upstream limitation" },
  },
  {
    id: "no-tapeout",
    text: "There is no tapeout: Tiny Tapeout is paused until after this work.",
    source: { decision: { date: "2026-09-24", title: "Phase 4 direction" }, contains: "Tiny Tapeout (#37) are paused" },
  },
  {
    id: "val-loss-caveat",
    text: "The story model's validation loss is compared with llama2.c's stories260K only with a caveat: the context length and FFN width differ, so it is not a like-for-like match.",
    source: { file: "docs/specs/2026-09-28-tiny-lm-vector-unit-design.md", contains: "like-for-like match" },
  },
  {
    id: "cause-hedged",
    text: "The story model's scaling stops far below the tile count. The serial vector unit and injection back-pressure inside attention are consistent with that, but the committed counters do not prove a single cause.",
    source: { decision: { date: "2026-10-15", title: "4.3g: a perf tag register" }, contains: "does not prove the cause" },
  },
];

export const REPRODUCE: { command: Command; says: string }[] = [
  { command: { text: "./test.sh", file: "test.sh" }, says: "runs every testbench, every negative check and pytest, on Verilator" },
  { command: { text: "SIM=icarus ./test.sh", file: "test.sh" }, says: "the same suites on Icarus, as the cross-check" },
  { command: { text: "make cifar", make: { dir: "tb/accel", target: "cifar" } }, says: "in tb/accel: all 128 CIFAR-10 images, writes docs/perf/cifar.json and cifar.md" },
  { command: { text: "make scaling", make: { dir: "tb/accel", target: "scaling" } }, says: "in tb/accel: the same images on 1x1 to 4x4, writes docs/perf/scaling.json and scaling.md" },
  { command: { text: "make lm", make: { dir: "tb/accel", target: "lm" } }, says: "in tb/accel: the story model, writes docs/perf/lm.json, lm.md and lm_trace.json only if every run passes" },
];
