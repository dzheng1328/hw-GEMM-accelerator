import { describe, expect, it } from "vitest";
import { BLOCKS } from "../content/architecture";
import type { Counts } from "../live/trace/activity";
import { PACE_SECONDS } from "../live/playback/usePlayback";
import { performance } from "../performance/data";
import { LIT_WINDOW, SLOW_LIT_WINDOW, blockStates, litWindow, type BlockStateInput } from "./blockStates";

const counts = (over: Partial<Counts> = {}): Counts => ({
  sequencer: 0, dma: 0, writeback: 0, memory: 0, inject: 0, results: 0, links: 0, busy: 0, ...over,
});

const input = (now: Partial<Counts>, before: Partial<Counts> = {}, over: Partial<BlockStateInput> = {}): BlockStateInput => ({
  now: counts(now),
  before: counts(before),
  cycle: 1000,
  total: 5000,
  playing: true,
  pc: 120,
  programEnd: 480,
  nodes: 4,
  ...over,
});

describe("litWindow", () => {
  it("is 64 cycles on a short run and one cycle at the slowest two speeds", () => {
    expect(litWindow(1, 1000)).toBe(LIT_WINDOW);
    expect(litWindow(0.25, 5000)).toBe(LIT_WINDOW);
    expect(litWindow(0.05, 1_000_000)).toBe(SLOW_LIT_WINDOW);
    expect(litWindow(0.01, 1_000_000)).toBe(SLOW_LIT_WINDOW);
  });

  it("is never shorter than the cycles one frame advances, so a burst between two commits is still seen", () => {
    const total = 139_981; // the 2x2 CIFAR-10 run: 7,000 cycles per second at 1x, about 117 per frame
    expect(litWindow(1, total)).toBe(Math.ceil(total / PACE_SECONDS / 60));
    expect(litWindow(1, total)).toBeGreaterThan(LIT_WINDOW);
    expect(litWindow(16, total)).toBe(Math.ceil((total / PACE_SECONDS / 60) * 16));
    expect(litWindow(4, total)).toBeGreaterThanOrEqual(litWindow(1, total));
  });
});

describe("blockStates", () => {
  it("covers exactly the blocks of the diagram", () => {
    expect(Object.keys(blockStates(input({}))).sort()).toEqual(BLOCKS.map((block) => block.id).sort());
  });

  it("lights nothing but the clock when nothing moved in the window", () => {
    const states = blockStates(input({ dma: 40, busy: 10 }, { dma: 40, busy: 10 }));
    const lit = Object.entries(states).filter(([, state]) => state.lit).map(([id]) => id);
    expect(lit).toEqual(["perf"]);
  });

  it("lights the perf counters only while playing", () => {
    expect(blockStates(input({}, {}, { playing: false })).perf!.lit).toBe(false);
    expect(blockStates(input({}, {}, { playing: true })).perf!.lit).toBe(true);
  });

  it("lights a block when its own series moved, and only that block's group", () => {
    const states = blockStates(input({ dma: 50 }, { dma: 40 }));
    expect(states.dma_gather!.lit).toBe(true);
    expect(states.memory!.lit).toBe(false); // memory moves on its own series, which did not
    expect(blockStates(input({ memory: 51 }, { memory: 40 })).memory!.lit).toBe(true);
    expect(states.writeback!.lit).toBe(false);
    expect(states.noc!.lit).toBe(false);
  });

  it("lights the injection port and the flit packer on injection, and the port also on results", () => {
    const injecting = blockStates(input({ inject: 5 }, { inject: 0 }));
    expect(injecting.flit_pack!.lit).toBe(true);
    expect(injecting.corner!.lit).toBe(true);
    const resulting = blockStates(input({ results: 5 }, { results: 0 }));
    expect(resulting.flit_pack!.lit).toBe(false);
    expect(resulting.corner!.lit).toBe(true);
    expect(resulting.requant!.lit).toBe(true);
  });

  it("lights the tile and the PE array together when any tile was busy", () => {
    const states = blockStates(input({ busy: 30 }, { busy: 20 }));
    expect(states.gemm_tile!.lit).toBe(true);
    expect(states.pe_array!.lit).toBe(true);
  });

  it("never lights the vector unit, and says it is not used", () => {
    const states = blockStates(input({ sequencer: 9, dma: 9, writeback: 9, memory: 9, inject: 9, results: 9, links: 9, busy: 9 }));
    expect(states.vpu!.lit).toBe(false);
    expect(states.vpu!.text).toBe("not used");
    expect(states.vpu!.detail).toContain("Not used in this run");
    expect(states.vpu!.detail).toContain(performance.lm.vpuCycles.toLocaleString("en-US"));
  });

  it("writes the counter of each block", () => {
    const states = blockStates(input({ sequencer: 700, dma: 41_200, writeback: 3, memory: 41_300, inject: 8_000, results: 500, links: 12_345, busy: 1_000 }));
    expect(states.cmd_seq!.text).toBe("pc 120/480");
    expect(states.dma_gather!.text).toBe("41,200 busy");
    expect(states.memory!.text).toBe("41,300 busy");
    expect(states.writeback!.text).toBe("3 busy");
    expect(states.flit_pack!.text).toBe("8,000 flits");
    expect(states.corner!.text).toBe("8,500 flits");
    expect(states.noc!.text).toBe("12,345 transfers");
    expect(states.requant!.text).toBe("500 results");
    expect(states.gemm_tile!.text).toBe("25% busy"); // 1,000 of 1,000 cycles x 4 nodes
    expect(states.pe_array!.text).toBe("25% busy");
    expect(states.perf!.text).toBe("cycle 1,000");
  });

  it("explains each counter in a sentence with the share of elapsed cycles", () => {
    const states = blockStates(input({ dma: 250, sequencer: 500 }));
    expect(states.dma_gather!.detail).toBe("The DMA gather was busy in 250 of the 1,000 cycles so far (25.0%).");
    expect(states.cmd_seq!.detail).toContain("The command processor was busy in 500 of the 1,000 cycles so far (50.0%).");
    expect(states.cmd_seq!.detail).toContain("The program address is 120 of 480.");
    expect(states.perf!.detail).toBe("The counters have counted 1,000 of 5,000 cycles.");
  });

  it("starts clean at cycle 0: zero shares, no division by zero", () => {
    const states = blockStates(input({}, {}, { cycle: 0, pc: 0 }));
    expect(states.dma_gather!.detail).toBe("The DMA gather was busy in 0 of the 0 cycles so far (0.0%).");
    expect(states.gemm_tile!.text).toBe("0% busy");
    expect(Object.values(states).every((state) => !/NaN|Infinity/.test(state.text + state.detail))).toBe(true);
  });

  it("says the PE array shares the tile's busy signal", () => {
    expect(blockStates(input({ busy: 4 })).pe_array!.detail).toContain("does not separate the PE array");
  });
});
