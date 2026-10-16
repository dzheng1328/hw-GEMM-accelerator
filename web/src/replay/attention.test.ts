import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { headWeights, layerHeadSummary, normalizeForOverlay, peakPosition } from "./attention";
import type { AttentionProbs } from "./types";

describe("headWeights", () => {
  const probs: AttentionProbs = [[[[127]]], [[[0, 127]]], [[[64, 0, 127]]]];

  it("divides the integers by 127 and has one weight per position 0..step", () => {
    expect(headWeights(probs, 0, 0, 0)).toEqual([1]);
    expect(headWeights(probs, 2, 0, 0)).toEqual([64 / 127, 0, 1]);
  });

  it("names the step, layer and head when asked for one that does not exist", () => {
    expect(() => headWeights(probs, 9, 0, 0)).toThrow(/step 9, layer 0, head 0/);
  });
});

describe("peakPosition", () => {
  it("is the index of the largest weight, with ties going to the earliest position", () => {
    expect(peakPosition([0, 5, 5, 2])).toBe(1);
    expect(peakPosition([7])).toBe(0);
    expect(peakPosition([0, 0, 0])).toBe(0);
  });
});

describe("layerHeadSummary", () => {
  it("gives one peak position per layer and head", () => {
    const probs: AttentionProbs = [
      [
        [[3, 9], [9, 3]],
        [[0, 1], [5, 5]],
      ],
    ];
    expect(layerHeadSummary(probs, 0)).toEqual([[1, 0], [1, 0]]);
  });
});

describe("normalizeForOverlay", () => {
  it("scales the largest weight to 1", () => {
    expect(normalizeForOverlay([0.1, 0.4, 0.2])).toEqual([0.25, 1, 0.5]);
  });

  it("gives all zeros for all-zero weights", () => {
    expect(normalizeForOverlay([0, 0])).toEqual([0, 0]);
  });
});

describe("the recorded attention", () => {
  const { probs } = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "data", "generated", "lm-attention.json"), "utf8"),
  ) as { probs: AttentionProbs };

  it("has one weight per position 0..step for every step, layer and head", () => {
    expect(probs).toHaveLength(256);
    for (const [step, layers] of probs.entries()) {
      expect(layers.length).toBe(probs[0]!.length);
      for (const heads of layers) {
        expect(heads.length).toBe(probs[0]![0]!.length);
        for (const weights of heads) expect(weights).toHaveLength(step + 1);
      }
    }
  });

  it("gives weights between 0 and 1 for the last step", () => {
    const last = probs.length - 1;
    for (let l = 0; l < probs[0]!.length; l++) {
      for (let h = 0; h < probs[0]![0]!.length; h++) {
        for (const w of headWeights(probs, last, l, h)) {
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
