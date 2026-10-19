import { describe, expect, it } from "vitest";
import { Activity, CHECKPOINT_STRIDE, type Counts } from "./activity";
import { FLAG_DMA, FLAG_SEQUENCER, FLAG_WRITEBACK, PORT_E, PORT_INJECT, PORT_N, PORT_W, Trace } from "./trace";

/** A small deterministic generator, so the random-looking trace is the same on every run. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomTrace(nodes: number, cycles: number, seed = 7): Trace {
  const next = lcg(seed);
  const rb = 6 + 2 * nodes;
  const bytes = new Uint8Array(cycles * rb);
  const view = new DataView(bytes.buffer);
  for (let c = 0; c < cycles; c++) {
    view.setUint16(c * rb, Math.floor(next() * 2 ** nodes), true);
    view.setUint16(c * rb + 2, c, true);
    view.setUint8(c * rb + 4, Math.floor(next() * 8));
    for (let n = 0; n < nodes; n++) view.setUint16(c * rb + 6 + 2 * n, Math.floor(next() * 2 ** 16), true);
  }
  return new Trace(bytes, nodes);
}

/** Counts [0, cycle) the slow way, with the Trace accessors and no shared code with Activity. */
function naive(trace: Trace, cycle: number): Counts {
  const out: Counts = { sequencer: 0, dma: 0, writeback: 0, memory: 0, inject: 0, results: 0, links: 0, busy: 0 };
  for (let c = 0; c < cycle; c++) {
    const flags = trace.flags(c);
    if (flags & FLAG_SEQUENCER) out.sequencer++;
    if (flags & FLAG_DMA) out.dma++;
    if (flags & FLAG_WRITEBACK) out.writeback++;
    if (flags & (FLAG_DMA | FLAG_WRITEBACK)) out.memory++;
    for (let n = 0; n < trace.nodes; n++) {
      if ((trace.busyMask(c) >> n) & 1) out.busy++;
      if (trace.resultDelivered(c, n)) out.results++;
      for (let p = PORT_N; p <= PORT_W; p++) if (trace.transfer(c, n, p)) out.links++;
    }
    if (trace.transfer(c, 0, PORT_INJECT)) out.inject++;
  }
  return out;
}

describe("Activity", () => {
  const trace = randomTrace(4, 300);
  const activity = new Activity(trace);

  it("agrees with a slow count at every kind of cycle: 0, either side of a checkpoint, and the end", () => {
    const stride = CHECKPOINT_STRIDE;
    const cycles = [0, 1, stride - 1, stride, stride + 1, 2 * stride, 2 * stride + 17, 299, 300];
    for (const cycle of cycles) expect(activity.countsAt(cycle), `cycle ${cycle}`).toEqual(naive(trace, cycle));
  });

  it("agrees with a slow count at many random cycles", () => {
    const next = lcg(99);
    for (let i = 0; i < 60; i++) {
      const cycle = Math.floor(next() * 301);
      expect(activity.countsAt(cycle), `cycle ${cycle}`).toEqual(naive(trace, cycle));
    }
  });

  it("clamps a cycle past the end or before the start, and floors a fraction", () => {
    expect(activity.countsAt(10_000)).toEqual(naive(trace, 300));
    expect(activity.countsAt(-5)).toEqual(naive(trace, 0));
    expect(activity.countsAt(70.9)).toEqual(naive(trace, 70));
  });

  it("never counts a cycle with both the DMA and the write-back flag twice in memory", () => {
    const rb = 6 + 2;
    const bytes = new Uint8Array(3 * rb);
    const view = new DataView(bytes.buffer);
    view.setUint8(4, FLAG_DMA | FLAG_WRITEBACK);
    view.setUint8(rb + 4, FLAG_DMA);
    view.setUint8(2 * rb + 4, FLAG_WRITEBACK);
    const counts = new Activity(new Trace(bytes, 1)).countsAt(3);
    expect(counts.dma).toBe(2);
    expect(counts.writeback).toBe(2);
    expect(counts.memory).toBe(3);
  });

  it("counts injection at node 0 only, links on four ports, results on every node", () => {
    const rb = 6 + 2 * 2;
    const bytes = new Uint8Array(rb);
    const view = new DataView(bytes.buffer);
    view.setUint16(6, (1 << PORT_E) | (1 << PORT_INJECT) | (1 << 5), true); // node 0: east link, injection, a result
    view.setUint16(8, (1 << PORT_W) | (1 << PORT_INJECT), true); // node 1: west link and an injection that must not count
    const counts = new Activity(new Trace(bytes, 2)).countsAt(1);
    expect(counts).toMatchObject({ inject: 1, links: 2, results: 1 });
  });

  it("works on an empty trace", () => {
    const empty = new Activity(new Trace(new Uint8Array(0), 1));
    expect(empty.countsAt(0)).toEqual(naive(new Trace(new Uint8Array(0), 1), 0));
    expect(empty.countsAt(50).busy).toBe(0);
  });

  it("is monotone: no counter ever goes down as the cycle goes up", () => {
    let last = activity.countsAt(0);
    for (let cycle = 1; cycle <= 300; cycle++) {
      const now = activity.countsAt(cycle);
      for (const key of Object.keys(now) as (keyof Counts)[]) expect(now[key], `${key} at ${cycle}`).toBeGreaterThanOrEqual(last[key]);
      last = now;
    }
  });
});
