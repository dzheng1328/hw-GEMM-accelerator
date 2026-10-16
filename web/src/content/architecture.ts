import type { Block, Stage } from "../architecture/types";

export const VIEWBOX = { w: 400, h: 518 };

/** The block selected when the page loads: the corner ties this section to "Where the cycles go". */
export const DEFAULT_BLOCK = "corner";

export const BLOCKS: Block[] = [
  {
    id: "cmd_seq",
    label: "Command proc.",
    name: "Command processor",
    kind: "control",
    role: "Runs the compiled program: ALU commands, loops four deep, and the BLOCK and VOP commands, with 32 registers. It reads ahead from program memory and drains the DMA and write-back before a WAIT or a VOP.",
    rtl: ["rtl/cmd_seq.v"],
    suites: [
      { dir: "tb/cmd_seq", targets: [] },
      { dir: "tb/accel", targets: ["error-check"] },
    ],
    number: {
      label: "Generic Yosys synthesis",
      value: "2181 cells, 539 flip-flops",
      source: { decision: { date: "2026-09-28", title: "Command processor: read-ahead fetch" }, contains: "2181 cells" },
    },
    links: ["dma_gather", "vpu"],
    box: { x: 10, y: 10, w: 180, h: 44 },
  },
  {
    id: "vpu",
    label: "Vector unit",
    name: "Vector unit",
    kind: "compute",
    role: "An integer-only unit beside the command processor that does everything the mesh does not: embedding, RMSNorm, RoPE, softmax, SwiGLU and sampling. It owns both memories while it runs.",
    rtl: ["rtl/vpu.v", "rtl/vpu_softmax.v", "rtl/vpu_rmsnorm.v", "rtl/vpu_rope.v", "rtl/vpu_silu.v", "rtl/vpu_sample.v", "rtl/vpu_embed.v", "rtl/vpu_lanes.v"],
    suites: [
      { dir: "tb/vpu", targets: ["fault-check"] },
      { dir: "tb/accel", targets: ["vpu-check", "reset-check"] },
    ],
    number: {
      label: "Busy cycles in the story-model run, the same on every mesh",
      value: "15,108,284 busy cycles",
      source: { perf: "lm.vpuCycles", format: "int" },
    },
    links: ["memory"],
    box: { x: 210, y: 10, w: 180, h: 44 },
  },
  {
    id: "dma_gather",
    label: "DMA gather",
    name: "DMA gather",
    kind: "movement",
    role: "Reads one BLOCK's operands out of the memories (im2col windows, strides, padding, bias slots) at one slot per cycle, and hands off at its last slot so BLOCKs stream with no refill gap.",
    rtl: ["rtl/dma_gather.v"],
    suites: [{ dir: "tb/dma_gather", targets: [] }],
    number: {
      label: "Other cycles per BLOCK after the hand-off fix",
      value: "0.045 cycles",
      source: { decision: { date: "2026-09-29", title: "The DMA hands off at its last slot" }, contains: "0.045" },
    },
    links: ["memory", "flit_pack"],
    box: { x: 10, y: 84, w: 180, h: 44 },
  },
  {
    id: "memory",
    label: "Memories",
    name: "A memory and activation banks",
    kind: "memory",
    role: "The A memory holds the weights and is written only by the vector unit. Four word-interleaved activation banks mean any three consecutive words sit in different banks, so every slot is one read.",
    rtl: ["rtl/sim_mem.v"],
    suites: [{ dir: "tb/accel", targets: [] }],
    number: {
      label: "The A memory",
      value: "64K words",
      source: { decision: { date: "2026-10-14", title: "4.3f: the command processor runs" }, contains: "The A memory is 64K words" },
    },
    links: ["writeback"],
    box: { x: 210, y: 84, w: 180, h: 44 },
  },
  {
    id: "flit_pack",
    label: "Flit packer",
    name: "Flit packer",
    kind: "movement",
    role: "Formats each slot as an OPERAND flit and the BLOCK's descriptor as a GO flit, before a skid buffer so the BLOCK's fields are free to change the moment it finishes.",
    rtl: ["rtl/flit_pack.v", "rtl/flit_buf.v"],
    suites: [{ dir: "tb/flit_pack", targets: [] }],
    number: {
      label: "A 64-slot BLOCK's flits",
      value: "65 flits in 65 cycles",
      source: { decision: { date: "2026-09-27", title: "DMA front end" }, contains: "65 consecutive cycles" },
    },
    links: ["corner"],
    box: { x: 10, y: 158, w: 180, h: 44 },
  },
  {
    id: "writeback",
    label: "Write-back",
    name: "Write-back",
    kind: "movement",
    role: "Takes RESULT flits back from node (0,0) and writes them into the activation banks, using an entry fixed when the BLOCK issued so a later ADD cannot move results still in flight.",
    rtl: ["rtl/writeback.v"],
    suites: [{ dir: "tb/writeback", targets: ["orphan-check", "mode-check", "rows-check"] }],
    number: {
      label: "Generic Yosys synthesis at 4x3",
      value: "3709 cells at 4x3",
      source: { decision: { date: "2026-09-28", title: "Command processor: read-ahead fetch" }, contains: "3709 cells (1074 flip-flops)" },
    },
    links: [],
    box: { x: 210, y: 158, w: 180, h: 44 },
  },
  {
    id: "corner",
    label: "Port (0,0)",
    name: "Injection port at node (0,0)",
    kind: "movement",
    role: "The only door into the mesh: every OPERAND and GO flit enters here, one per cycle, and every RESULT leaves here. One flit per cycle is one tile's peak rate, so this port sets the floor the performance section measures.",
    rtl: ["rtl/noc_node.v", "rtl/node_perf.v"],
    suites: [
      { dir: "tb/perf", targets: [] },
      { dir: "tb/accel", targets: ["stray-check"] },
    ],
    number: {
      label: "Corner busy, CIFAR-10 on 2x2",
      value: "97.1%",
      source: { perf: "cifar.meshes.2.cornerBusy", format: "percent1" },
    },
    links: ["noc", "writeback"],
    box: { x: 10, y: 232, w: 180, h: 44 },
  },
  {
    id: "noc",
    label: "NoC mesh",
    name: "Network on chip",
    kind: "movement",
    role: "A generate-based WxH mesh: a router per node with XY routing, a round-robin arbiter per output and a combinational crossbar, and a two-deep skid FIFO on every mesh-side input.",
    rtl: ["rtl/router.v", "rtl/flit_buf.v", "rtl/noc_node.v", "rtl/noc_mesh.v"],
    suites: [
      { dir: "tb/router", targets: [] },
      { dir: "tb/noc", targets: [] },
      { dir: "tb/mesh", targets: ["size-check"] },
    ],
    number: {
      label: "East link out of the corner, CIFAR-10 on 4x4",
      value: "72.1% busy",
      source: { perf: "cifar.meshes.4.links.east", format: "percent1" },
    },
    links: ["gemm_tile", "requant"],
    box: { x: 10, y: 306, w: 380, h: 44 },
  },
  {
    id: "gemm_tile",
    label: "GEMM tile",
    name: "GEMM tile",
    kind: "compute",
    role: "An operand memory, a sequencer and a skew feeder around the PE array. One GO runs a whole tiled matmul with no host in the loop.",
    rtl: ["rtl/gemm_tile.v", "rtl/gemm_sequencer.v", "rtl/operand_mem.v", "rtl/skew_feeder.v", "rtl/tile.v"],
    suites: [
      { dir: "tb/gemm", targets: [] },
      { dir: "tb/tile", targets: [] },
      { dir: "tb/operand_mem", targets: ["collision-check"] },
    ],
    number: {
      label: "sky130 area with the SRAM macro (synthesis estimate)",
      value: "501,749.68 um^2",
      source: { decision: { date: "2026-09-08", title: "Real area win from the SRAM macro" }, contains: "501,749.68" },
    },
    links: ["pe_array", "requant"],
    box: { x: 10, y: 380, w: 180, h: 44 },
  },
  {
    id: "requant",
    label: "Requantizer",
    name: "Requantizer",
    kind: "compute",
    role: "Requantizes in the tile's result path with a 16-bit multiplier, a shift and an optional ReLU, so a block comes back as 8 packed int8 rows instead of 64 int32 flits.",
    rtl: ["rtl/requant.v"],
    suites: [{ dir: "tb/requant", targets: ["q16"] }],
    number: {
      label: "int8 output against int32 output, at K=8",
      value: "1.9x-3.3x faster",
      source: { decision: { date: "2026-09-25", title: "Requantize on-chip in the result path" }, contains: "1.9x-3.3x" },
    },
    links: [],
    box: { x: 210, y: 380, w: 180, h: 44 },
  },
  {
    id: "pe_array",
    label: "PE array 8x8",
    name: "8x8 PE array",
    kind: "compute",
    role: "An 8x8 output-stationary systolic array of signed int8 multiply-accumulate processing elements, pipelined in two stages. It is the only part that has been through place and route.",
    rtl: ["rtl/pe.v", "rtl/systolic_array.v"],
    suites: [
      { dir: "tb", targets: [] },
      { dir: "tb/array", targets: [] },
    ],
    number: {
      label: "Worst-corner setup slack of the pipelined PE",
      value: "+0.4510 ns",
      source: { decision: { date: "2026-08-29", title: "Re-run OpenLane P&R on the pipelined" }, contains: "0.4510" },
    },
    links: [],
    box: { x: 10, y: 454, w: 180, h: 44 },
  },
  {
    id: "perf",
    label: "Perf counters",
    name: "Performance counters",
    kind: "control",
    role: "Synthesizable counters that split every cycle at node (0,0)'s injection port into six categories that sum to the run's cycles, plus per-tile feed and busy counts and the vector unit's busy time.",
    rtl: ["rtl/cmd_perf.v", "rtl/node_perf.v", "rtl/vpu_perf.v"],
    suites: [{ dir: "tb/perf", targets: [] }],
    number: {
      label: "Story model on 2x2: cycles the injection port stalled",
      value: "36.8%",
      source: { perf: "lm.meshes.1.port.shares.stall", format: "percent1" },
    },
    links: [],
    box: { x: 210, y: 454, w: 180, h: 44 },
  },
];

export const STAGES: Stage[] = [
  {
    block: "cmd_seq",
    title: "Fetch a command",
    text: "The command processor reads ahead from program memory, so a BLOCK is issued while the next command is already fetched.",
  },
  {
    block: "dma_gather",
    title: "Gather operands",
    text: "The DMA reads the BLOCK's A columns and B windows out of the memories, one slot per cycle.",
  },
  {
    block: "flit_pack",
    title: "Pack flits",
    text: "Each slot becomes an OPERAND flit and the descriptor becomes a GO flit: a 64-slot BLOCK is 65 flits in 65 consecutive cycles.",
  },
  {
    block: "corner",
    title: "Inject at the corner",
    text: "Every flit enters the mesh through node (0,0)'s single injection port, one per cycle.",
  },
  {
    block: "noc",
    title: "Route to the tile",
    text: "XY routing carries each flit to its target node, with a skid FIFO on every mesh-side link.",
  },
  {
    block: "gemm_tile",
    title: "Compute",
    text: "The GO starts the tile: its sequencer streams the operand memory through the skew feeder into the PE array.",
  },
  {
    block: "requant",
    title: "Requantize and return",
    text: "The result path requantizes the accumulators and returns them to the corner as RESULT flits, 8 packed rows instead of 64 int32 flits.",
  },
  {
    block: "writeback",
    title: "Write back",
    text: "The write-back drains the RESULT flits into the activation banks at the addresses fixed when the BLOCK issued.",
  },
];

export const VOP_NOTE =
  "A VOP takes a different path: the command processor drains the DMA and the write-back, then the vector unit owns both memories until it is done. " +
  "The memory mux selects on that ownership, not on the DMA's read enables, because the DMA holds its enables high every cycle even when idle.";
