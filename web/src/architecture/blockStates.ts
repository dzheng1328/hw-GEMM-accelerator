import { formatInt, formatPercent } from "../format";
import { PACE_SECONDS } from "../live/playback/usePlayback";
import type { Counts } from "../live/trace/activity";
import { performance } from "../performance/data";

/** A block is lit when it was active in the last LIT_WINDOW cycles (more on a fast or long run, see litWindow). */
export const LIT_WINDOW = 64;
/** At these speeds the point is single transfers, so a block is lit only for the cycle it works in, as in the 3D scene. */
export const SLOW_LIT_WINDOW = 1;
export const SLOW_SPEED = 0.05;

const FRAME_HZ = 60;

/**
 * The window never falls short of the cycles one frame advances (7,000 cycles a second at 1x on a 2x2 run is about 117
 * a frame, 16x about 1,900), or a burst that falls between two commits is never drawn and a bursty block strobes.
 */
export function litWindow(speed: number, total: number): number {
  if (speed <= SLOW_SPEED) return SLOW_LIT_WINDOW;
  return Math.max(LIT_WINDOW, Math.ceil(((total / PACE_SECONDS) * speed) / FRAME_HZ));
}

export interface BlockLive {
  lit: boolean;
  /** the short counter drawn inside the block */
  text: string;
  /** the sentence in the detail panel's "In this run" row */
  detail: string;
}

export interface BlockStateInput {
  /** totals over [0, cycle) */
  now: Counts;
  /** totals at the start of the lit window */
  before: Counts;
  cycle: number;
  total: number;
  playing: boolean;
  /** program address at the last completed cycle */
  pc: number;
  /** one past the last program address */
  programEnd: number;
  nodes: number;
}

/** The memories have no signal of their own in the trace: their cycles are the DMA's and the write-back's. */
const memoryState = (state: BlockLive): BlockLive => ({
  ...state,
  detail: `${state.detail.replace(/\.$/, "")}, the cycles that move data into and out of the memories. The trace has no per-memory read or write signal.`,
});

const share = (n: number, of: number): string => formatPercent(of > 0 ? n / of : 0, 1);

/** Which blocks are working at a cycle of a run, and what each has counted so far. One entry per block of the diagram. */
export function blockStates({ now, before, cycle, total, playing, pc, programEnd, nodes }: BlockStateInput): Record<string, BlockLive> {
  const moved = (pick: (c: Counts) => number): boolean => pick(now) - pick(before) > 0;
  const elapsed = formatInt(cycle);

  /** a block known only by how many cycles it was busy */
  const busy = (pick: (c: Counts) => number, subject: string): BlockLive => {
    const n = pick(now);
    return {
      lit: moved(pick),
      text: `${formatInt(n)} busy`,
      detail: `${subject} in ${formatInt(n)} of the ${elapsed} cycles so far (${share(n, cycle)}).`,
    };
  };
  /** a block known by how many flits or transfers passed it */
  const counted = (pick: (c: Counts) => number, noun: string, says: (n: string) => string): BlockLive => {
    const n = pick(now);
    return { lit: moved(pick), text: `${formatInt(n)} ${noun}`, detail: says(formatInt(n)) };
  };

  const tileCycles = cycle * nodes;
  const tiles = (note: string): BlockLive => ({
    lit: moved((c) => c.busy),
    text: `${formatPercent(tileCycles > 0 ? now.busy / tileCycles : 0, 0)} busy`,
    detail: `The tiles were busy in ${formatInt(now.busy)} of the ${formatInt(tileCycles)} tile-cycles so far (${share(now.busy, tileCycles)}).${note}`,
  });

  const sequencer = busy((c) => c.sequencer, "The command processor was busy");

  return {
    cmd_seq: {
      ...sequencer,
      text: `pc ${formatInt(pc)}/${formatInt(programEnd)}`,
      detail: `${sequencer.detail} The program address is ${formatInt(pc)} of ${formatInt(programEnd)}.`,
    },
    vpu: {
      lit: false,
      text: "not used",
      detail: `The compiled program for this run has no vector commands, so the vector unit stays idle. The story model uses it: ${formatInt(performance.lm.vpuCycles)} busy cycles on every mesh.`,
    },
    dma_gather: busy((c) => c.dma, "The DMA gather was busy"),
    memory: memoryState(busy((c) => c.memory, "The DMA gather or the write-back was active")),
    flit_pack: counted((c) => c.inject, "flits", (n) => `${n} flits were packed and injected so far.`),
    writeback: busy((c) => c.writeback, "Write-back had results outstanding"),
    corner: counted((c) => c.inject + c.results, "flits", (n) => `${n} flits have crossed this port so far, going in and coming out.`),
    noc: counted((c) => c.links, "transfers", (n) => `${n} flit transfers have crossed mesh links so far.`),
    gemm_tile: tiles(""),
    requant: counted(
      (c) => c.results,
      "results",
      (n) => `${n} RESULT flits have come back from the tiles so far, counted where they arrive at the command processor's port, not inside the requantizer.`,
    ),
    pe_array: tiles(" This is the tile's busy signal; the recorded trace does not separate the PE array."),
    perf: {
      lit: playing,
      text: `cycle ${formatInt(cycle)}`,
      detail: `The replay is at cycle ${elapsed} of ${formatInt(total)}, the cycles the performance counters count.`,
    },
  };
}
