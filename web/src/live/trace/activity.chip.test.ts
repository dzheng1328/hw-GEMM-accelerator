import { beforeAll, describe, expect, it } from "vitest";
import { b64, exampleEntries, nodeAssets } from "../sim/artifacts.testlib";
import { Chip, type RunResult } from "../sim/chip";
import { Activity } from "./activity";
import { Trace } from "./trace";

describe("the activity index on the real recorded trace (2x2, the cat)", () => {
  let result: RunResult;
  let trace: Trace;
  let activity: Activity;
  let buildMs = 0;
  beforeAll(async () => {
    const chip = await Chip.open("2x2", await nodeAssets("2x2"));
    result = chip.run(b64(exampleEntries()[3]!.packed));
    trace = new Trace(result.trace, result.nodes);
    const start = performance.now();
    activity = new Activity(trace);
    buildMs = performance.now() - start;
  }, 60_000);

  it("totals agree with the chip's own counters", () => {
    const total = activity.countsAt(trace.cycles);
    expect(total.busy).toBe(result.counters.busyCycles.reduce((a, b) => a + b, 0));
    expect(total.inject).toBe(result.counters.slotCycles + result.counters.goCycles);
  });

  it("sees every kind of activity in a real run", () => {
    const total = activity.countsAt(trace.cycles);
    for (const key of ["sequencer", "dma", "writeback", "memory", "inject", "results", "links", "busy"] as const) {
      expect(total[key], key).toBeGreaterThan(0);
    }
    expect(total.memory).toBeGreaterThanOrEqual(Math.max(total.dma, total.writeback));
    expect(total.memory).toBeLessThanOrEqual(total.dma + total.writeback);
  });

  it("builds in well under a frame budget for a full run", () => {
    expect(buildMs, `built ${trace.cycles} cycles in ${buildMs.toFixed(1)} ms`).toBeLessThan(250);
  });
});
