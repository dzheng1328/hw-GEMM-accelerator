import { FLAG_DMA, FLAG_SEQUENCER, FLAG_WRITEBACK, PORT_INJECT, type Trace } from "./trace";

/** Cumulative counts are stored every this many cycles; a lookup scans at most one stride less one. */
export const CHECKPOINT_STRIDE = 64;

/** Totals over the cycles [0, cycle), the cycles completed at that point of a run. */
export interface Counts {
  /** cycles with the sequencer-busy flag */
  sequencer: number;
  /** cycles with the DMA-busy flag */
  dma: number;
  /** cycles with the write-back-not-idle flag */
  writeback: number;
  /** cycles with the DMA or the write-back flag, each cycle once */
  memory: number;
  /** flits injected at node 0's local port */
  inject: number;
  /** RESULT flits delivered, summed over nodes (only node 0 receives them) */
  results: number;
  /** flit transfers on the N, E, S and W output links, summed over nodes */
  links: number;
  /** tile-busy node-cycles: the busy mask's set bits, summed over cycles */
  busy: number;
}

const SEQUENCER = 0;
const DMA = 1;
const WRITEBACK = 2;
const MEMORY = 3;
const INJECT = 4;
const RESULTS = 5;
const LINKS = 6;
const BUSY = 7;
const SERIES = 8;

/** Set bits of a 4-bit value. */
const POP4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
const RESULT_BIT = 5;

/** Adds cycle `c` to `acc`. The index build and the lookup tail both use this, so they cannot disagree. */
function addCycle(trace: Trace, c: number, acc: Float64Array): void {
  const flags = trace.flags(c);
  if (flags & FLAG_SEQUENCER) acc[SEQUENCER]!++;
  if (flags & FLAG_DMA) acc[DMA]!++;
  if (flags & FLAG_WRITEBACK) acc[WRITEBACK]!++;
  if (flags & (FLAG_DMA | FLAG_WRITEBACK)) acc[MEMORY]!++;
  const mask = trace.busyMask(c);
  acc[BUSY]! += POP4[mask & 15]! + POP4[(mask >> 4) & 15]! + POP4[(mask >> 8) & 15]! + POP4[(mask >> 12) & 15]!;
  for (let n = 0; n < trace.nodes; n++) {
    const word = trace.nodeWord(c, n);
    acc[LINKS]! += POP4[word & 15]!;
    if ((word >> RESULT_BIT) & 1) acc[RESULTS]!++;
    if (n === 0 && (word >> PORT_INJECT) & 1) acc[INJECT]!++;
  }
}

/**
 * Cumulative counts of a recorded run at any cycle, from checkpoints every CHECKPOINT_STRIDE cycles.
 * Built once per run; a lookup is a pure function of the cycle, so playing, seeking and replaying need no special case.
 */
export class Activity {
  private readonly checkpoints: Float64Array;

  constructor(readonly trace: Trace) {
    this.checkpoints = new Float64Array((Math.floor(trace.cycles / CHECKPOINT_STRIDE) + 1) * SERIES);
    const acc = new Float64Array(SERIES);
    for (let c = 0; c <= trace.cycles; c++) {
      if (c % CHECKPOINT_STRIDE === 0) this.checkpoints.set(acc, (c / CHECKPOINT_STRIDE) * SERIES);
      if (c < trace.cycles) addCycle(trace, c, acc);
    }
  }

  countsAt(cycle: number): Counts {
    const at = Math.max(0, Math.min(this.trace.cycles, Math.floor(cycle)));
    const slot = Math.floor(at / CHECKPOINT_STRIDE);
    const acc = this.checkpoints.slice(slot * SERIES, (slot + 1) * SERIES);
    for (let c = slot * CHECKPOINT_STRIDE; c < at; c++) addCycle(this.trace, c, acc);
    return {
      sequencer: acc[SEQUENCER]!,
      dma: acc[DMA]!,
      writeback: acc[WRITEBACK]!,
      memory: acc[MEMORY]!,
      inject: acc[INJECT]!,
      results: acc[RESULTS]!,
      links: acc[LINKS]!,
      busy: acc[BUSY]!,
    };
  }
}
