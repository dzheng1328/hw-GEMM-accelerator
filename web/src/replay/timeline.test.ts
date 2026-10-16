import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTimeline, cyclesAt, stepAt } from "./timeline";

const steps = (
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "generated", "lm-steps.json"), "utf8")) as {
    steps: { cycles: number }[];
  }
).steps;
const cycles = steps.map((s) => s.cycles);
const sum = cycles.reduce((a, b) => a + b, 0);

describe("buildTimeline with the recorded steps", () => {
  const t = buildTimeline(cycles, 25);

  it("ends at the sum of the step cycles", () => {
    expect(t.totalCycles).toBe(sum);
    expect(t.cumulative.at(-1)).toBe(sum);
  });

  it("starts at 0 and ends at totalSeconds", () => {
    expect(t.start[0]).toBe(0);
    expect(t.end.at(-1)).toBeCloseTo(25, 9);
  });

  it("makes every step last in proportion to its cycles", () => {
    for (let k = 0; k < cycles.length; k++) {
      expect((t.end[k]! - t.start[k]!) / 25).toBeCloseTo(cycles[k]! / sum, 12);
    }
  });

  it("makes the last step last as many times longer than the first as it has cycles", () => {
    const first = t.end[0]! - t.start[0]!;
    const last = t.end.at(-1)! - t.start.at(-1)!;
    expect(last / first).toBeCloseTo(cycles.at(-1)! / cycles[0]!, 9);
    expect(last / first).toBeGreaterThan(5);
  });

  it("never moves backwards in steps or cycles over the whole run", () => {
    let prevStep = 0;
    let prevCycles = 0;
    for (let s = 0; s <= 25.01; s += 0.01) {
      const step = stepAt(t, s);
      const c = cyclesAt(t, s);
      expect(step).toBeGreaterThanOrEqual(prevStep);
      expect(c).toBeGreaterThanOrEqual(prevCycles);
      prevStep = step;
      prevCycles = c;
    }
  });
});

describe("stepAt", () => {
  const t = buildTimeline([100, 100, 200], 4); // steps end at 1, 2 and 4 seconds

  it("is 0 at and before the start", () => {
    expect(stepAt(t, -1)).toBe(0);
    expect(stepAt(t, 0)).toBe(0);
  });

  it("moves to the next step exactly at a boundary", () => {
    expect(stepAt(t, 0.999)).toBe(0);
    expect(stepAt(t, 1)).toBe(1);
    expect(stepAt(t, 1.999)).toBe(1);
    expect(stepAt(t, 2)).toBe(2);
  });

  it("clamps to the last step at and after the end", () => {
    expect(stepAt(t, 3.9)).toBe(2);
    expect(stepAt(t, 4)).toBe(2);
    expect(stepAt(t, 100)).toBe(2);
  });
});

describe("cyclesAt", () => {
  const t = buildTimeline([100, 100, 200], 4);

  it("interpolates inside a step", () => {
    expect(cyclesAt(t, 0.5)).toBeCloseTo(50, 9);
    expect(cyclesAt(t, 1.5)).toBeCloseTo(150, 9);
    expect(cyclesAt(t, 3)).toBeCloseTo(300, 9);
  });

  it("is 0 at the start and the total at and after the end", () => {
    expect(cyclesAt(t, 0)).toBe(0);
    expect(cyclesAt(t, -5)).toBe(0);
    expect(cyclesAt(t, 4)).toBe(400);
    expect(cyclesAt(t, 9)).toBe(400);
  });
});

describe("buildTimeline validation", () => {
  it("rejects a timeline with no cycles", () => {
    expect(() => buildTimeline([], 25)).toThrow(/at least one step/);
    expect(() => buildTimeline([0, 0], 25)).toThrow(/at least one step/);
  });
});
