export const FLIT_OPERAND = 0;
export const FLIT_GO = 1;
export const FLIT_RESULT = 2;
export const FLIT_RESULT8 = 3;
export const NO_TYPE = 255;

/** Output links of a node, then its local injection port. */
export const PORT_N = 0;
export const PORT_E = 1;
export const PORT_S = 2;
export const PORT_W = 3;
export const PORT_INJECT = 4;
const PORTS = 5;
const MESH_PORTS = 4;

export const FLAG_DMA = 1;
export const FLAG_WRITEBACK = 2;
export const FLAG_SEQUENCER = 4;

const HEADER_BYTES = 6;

/** The per-cycle records of web/sim-build/harness.py, decoded on demand. */
export class Trace {
  readonly recordBytes: number;
  readonly cycles: number;
  private readonly view: DataView;

  constructor(
    readonly bytes: Uint8Array,
    readonly nodes: number,
  ) {
    this.recordBytes = HEADER_BYTES + 2 * nodes;
    if (bytes.length % this.recordBytes !== 0) {
      throw new Error(`${bytes.length} trace bytes are not whole records of ${this.recordBytes}`);
    }
    this.cycles = bytes.length / this.recordBytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  busyMask(c: number): number {
    return this.view.getUint16(c * this.recordBytes, true);
  }
  pc(c: number): number {
    return this.view.getUint16(c * this.recordBytes + 2, true);
  }
  flags(c: number): number {
    return this.view.getUint8(c * this.recordBytes + 4);
  }
  nodeWord(c: number, node: number): number {
    return this.view.getUint16(c * this.recordBytes + HEADER_BYTES + 2 * node, true);
  }
  transfer(c: number, node: number, port: number): boolean {
    return ((this.nodeWord(c, node) >> port) & 1) === 1;
  }
  flitType(c: number, node: number, port: number): number {
    return (this.nodeWord(c, node) >> (6 + 2 * port)) & 3;
  }
  resultDelivered(c: number, node: number): boolean {
    return ((this.nodeWord(c, node) >> 5) & 1) === 1;
  }
}

export interface WindowSummary {
  /** the half-open cycle range actually summarised, after clamping */
  from: number;
  to: number;
  /** busy fraction per node */
  tiles: Float32Array;
  /** fraction of cycles with a flit on the output link, index node * 4 + port (N, E, S, W) */
  links: Float32Array;
  /** dominant flit type on each link in the window, NO_TYPE when none */
  linkType: Uint8Array;
  /** the same for each node's local injection port */
  inject: Float32Array;
  injectType: Uint8Array;
  /** RESULT flits delivered at each node */
  results: Float32Array;
  dma: number;
  writeback: number;
  sequencer: number;
  /** program read address at the last cycle of the window */
  pc: number;
}

export function newSummary(nodes: number): WindowSummary {
  return {
    from: 0,
    to: 0,
    tiles: new Float32Array(nodes),
    links: new Float32Array(nodes * MESH_PORTS),
    linkType: new Uint8Array(nodes * MESH_PORTS).fill(NO_TYPE),
    inject: new Float32Array(nodes),
    injectType: new Uint8Array(nodes).fill(NO_TYPE),
    results: new Float32Array(nodes),
    dma: 0,
    writeback: 0,
    sequencer: 0,
    pc: 0,
  };
}

function dominant(counts: Uint32Array, at: number): number {
  let best = NO_TYPE;
  let bestCount = 0;
  for (let t = 0; t < 4; t++) {
    const n = counts[at * 4 + t]!;
    if (n > bestCount) {
      best = t;
      bestCount = n;
    }
  }
  return best;
}

/** Activity over the cycles [from, to): busy and transfer fractions, dominant flit types, the program address. */
export function summarize(trace: Trace, from: number, to: number, out: WindowSummary = newSummary(trace.nodes)): WindowSummary {
  const { nodes, cycles } = trace;
  out.tiles.fill(0);
  out.links.fill(0);
  out.linkType.fill(NO_TYPE);
  out.inject.fill(0);
  out.injectType.fill(NO_TYPE);
  out.results.fill(0);
  out.dma = out.writeback = out.sequencer = out.pc = 0;
  if (cycles === 0) {
    out.from = out.to = 0;
    return out;
  }
  let a = Math.max(0, Math.min(Math.floor(from), cycles));
  let b = Math.max(0, Math.min(Math.floor(to), cycles));
  if (b <= a) b = a + 1;
  if (b > cycles) {
    b = cycles;
    a = cycles - 1;
  }
  out.from = a;
  out.to = b;

  const typeCounts = new Uint32Array(nodes * PORTS * 4);
  const xferCounts = new Uint32Array(nodes * PORTS);
  const busy = new Uint32Array(nodes);
  const results = new Uint32Array(nodes);
  let dma = 0;
  let writeback = 0;
  let sequencer = 0;
  for (let c = a; c < b; c++) {
    const mask = trace.busyMask(c);
    const flags = trace.flags(c);
    if (flags & FLAG_DMA) dma++;
    if (flags & FLAG_WRITEBACK) writeback++;
    if (flags & FLAG_SEQUENCER) sequencer++;
    for (let n = 0; n < nodes; n++) {
      if ((mask >> n) & 1) busy[n]!++;
      const w = trace.nodeWord(c, n);
      if ((w >> 5) & 1) results[n]!++;
      for (let p = 0; p < PORTS; p++) {
        if ((w >> p) & 1) {
          xferCounts[n * PORTS + p]!++;
          typeCounts[(n * PORTS + p) * 4 + ((w >> (6 + 2 * p)) & 3)]!++;
        }
      }
    }
  }
  const length = b - a;
  for (let n = 0; n < nodes; n++) {
    out.tiles[n] = busy[n]! / length;
    out.results[n] = results[n]! / length;
    for (let p = 0; p < MESH_PORTS; p++) {
      out.links[n * MESH_PORTS + p] = xferCounts[n * PORTS + p]! / length;
      out.linkType[n * MESH_PORTS + p] = dominant(typeCounts, n * PORTS + p);
    }
    out.inject[n] = xferCounts[n * PORTS + PORT_INJECT]! / length;
    out.injectType[n] = dominant(typeCounts, n * PORTS + PORT_INJECT);
  }
  out.dma = dma / length;
  out.writeback = writeback / length;
  out.sequencer = sequencer / length;
  out.pc = trace.pc(b - 1);
  return out;
}
