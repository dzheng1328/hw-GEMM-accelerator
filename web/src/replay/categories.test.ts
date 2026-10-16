import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_LABELS, attentionShareSeries, shareAt } from "./categories";
import type { StepRecord } from "./types";

const { steps } = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "data", "generated", "lm-steps.json"), "utf8"),
) as { steps: StepRecord[] };

describe("shareAt", () => {
  it("gives four fractions that sum to 1 for every recorded step", () => {
    for (const s of steps) {
      const share = shareAt(s);
      expect(CATEGORIES.reduce((a, c) => a + share[c], 0), `step ${s.step}`).toBeCloseTo(1, 12);
    }
  });

  it("matches a hand-computed step", () => {
    const share = shareAt({ step: 0, cycles: 200, weights: 100, attention: 50, vpu: 30, other: 20, tileBusy: [] });
    expect(share).toEqual({ weights: 0.5, attention: 0.25, vpu: 0.15, other: 0.1 });
  });
});

describe("attentionShareSeries", () => {
  it("has one value per step, equal to that step's attention over its cycles", () => {
    const series = attentionShareSeries(steps);
    expect(series).toHaveLength(steps.length);
    expect(series[0]).toBe(steps[0]!.attention / steps[0]!.cycles);
    expect(series.at(-1)).toBe(steps.at(-1)!.attention / steps.at(-1)!.cycles);
  });

  it("rises from the first step to the last on the recorded run", () => {
    const series = attentionShareSeries(steps);
    expect(series.at(-1)!).toBeGreaterThan(series[0]! * 3);
  });
});

describe("labels", () => {
  it("has a label for every category", () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0);
  });
});
