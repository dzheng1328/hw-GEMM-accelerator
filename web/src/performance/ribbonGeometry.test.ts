import { describe, expect, it } from "vitest";
import { endLabels, gridValues, KINDS, layoutFor, noteX, ribbonData, sampleRows, spread, strokes, summary, total, type RibbonStep } from "./ribbonGeometry";

const step = (weights: number, attention: number, vpu: number, other: number): RibbonStep => ({ weights, attention, vpu, other });
// a series shaped like the real run: weights and other constant, attention and vpu growing
const series = (n: number, scale = 1): RibbonStep[] =>
  Array.from({ length: n }, (_, i) => step(37536 * scale, (10772 + i * 1060) * scale, (16296 + i * 320) * scale, 2616 * scale));

describe("layoutFor", () => {
  it("derives the scale from the data: the largest total plus headroom, in steps of 10 000", () => {
    const steps = [step(100, 100, 100, 100), step(37536, 280452, 98745, 2616)];
    expect(layoutFor(steps).max).toBe(440000);
  });

  it("grows when the data grows (a regenerated run with twice the cycles)", () => {
    expect(layoutFor(series(256, 2)).max).toBeGreaterThan(layoutFor(series(256)).max);
    expect(layoutFor(series(256, 2)).max).toBeGreaterThanOrEqual(Math.max(...series(256, 2).map(total)));
  });

  it("puts y0 below y1: the baseline is lower on the page than the top", () => {
    const l = layoutFor(series(4));
    expect(l.y0).toBeGreaterThan(l.y1);
    expect(l.x1).toBeGreaterThan(l.x0);
  });
});

describe("strokes", () => {
  const steps = series(256);
  const layout = layoutFor(steps);
  const all = strokes(steps, layout);

  it("makes one stroke per step, left to right inside the plot", () => {
    expect(all).toHaveLength(256);
    expect(all[0]!.x).toBeGreaterThanOrEqual(layout.x0);
    expect(all[255]!.x + all[255]!.width).toBeLessThanOrEqual(layout.x1 + 0.01);
    for (let i = 1; i < all.length; i++) expect(all[i]!.x).toBeGreaterThan(all[i - 1]!.x);
  });

  it("splits each stroke into the four kinds, bottom to top, with no gap and no overlap", () => {
    for (const s of all) {
      expect(s.segments.map((seg) => seg.kind)).toEqual([...KINDS]);
      for (let i = 1; i < s.segments.length; i++) {
        // the upper segment ends where the lower one starts
        expect(s.segments[i]!.y + s.segments[i]!.height).toBeCloseTo(s.segments[i - 1]!.y, 5);
      }
      expect(s.segments[0]!.y + s.segments[0]!.height).toBeCloseTo(layout.y0, 5);
    }
  });

  it("makes a segment as tall as its share of the cycles", () => {
    const first = all[0]!;
    const per = (layout.y0 - layout.y1) / layout.max;
    expect(first.segments[1]!.height).toBeCloseTo(steps[0]!.attention * per, 5);
  });

  it("never draws above the top of the plot", () => {
    for (const s of all) expect(Math.min(...s.segments.map((seg) => seg.y))).toBeGreaterThanOrEqual(layout.y1 - 0.01);
  });
});

describe("gridValues", () => {
  it("lists 0 and a nice step (1, 2 or 5 times a power of ten) up to the scale, giving at most six lines", () => {
    expect(gridValues(440000)).toEqual([0, 100000, 200000, 300000, 400000]);
    expect(gridValues(90000)).toEqual([0, 20000, 40000, 60000, 80000]);
  });

  it("scales with a run ten times larger instead of drawing thirty crowded lines", () => {
    const lines = gridValues(4_400_000);
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[1]).toBe(1_000_000);
  });
});

describe("noteX", () => {
  const layout = layoutFor(series(256));
  it("stays at 270 for the real run, whose first total is short", () => {
    expect(noteX(67220, layout)).toBe(270);
  });
  it("moves right of a long first total, so the note never runs into the figure", () => {
    const x = noteX(245_000_000, layout);
    expect(x).toBeGreaterThan(270);
    // 11 characters of a 46 px serif are at least 260 units wide
    expect(x).toBeGreaterThanOrEqual(layout.x0 + 11 * 24);
  });
});

describe("spread", () => {
  it("keeps every label at least `gap` apart, in the original order of the anchors", () => {
    const out = spread([100, 102, 104, 300], 40, 500);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(40);
  });
  it("pulls the stack back up when it would run past the bottom", () => {
    const out = spread([380, 382, 384], 40, 400);
    expect(Math.max(...out)).toBeLessThanOrEqual(400);
  });
});

describe("endLabels", () => {
  it("never overlap, for the real shape and for a run twice as large", () => {
    for (const scale of [1, 2]) {
      const steps = series(256, scale);
      const layout = layoutFor(steps);
      const labels = endLabels(steps, layout, 46);
      const ys = labels.map((l) => l.labelY).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(46);
      expect(Math.max(...ys)).toBeLessThanOrEqual(layout.y0 + 20);
    }
  });

  it("says 'every step' when a kind does not change, and 'first to last' when it does", () => {
    const labels = endLabels(series(256), layoutFor(series(256)));
    const byKind = Object.fromEntries(labels.map((l) => [l.kind, l.text]));
    expect(byKind.weights).toBe("37,536 every step");
    expect(byKind.other).toBe("2,616 every step");
    expect(byKind.attention).toBe("10,772 to 281,072");
    expect(byKind.vpu).toBe("16,296 to 97,896");
  });

  it("reads 'every step' for a constant series (all four kinds equal first and last)", () => {
    const flat = Array.from({ length: 5 }, () => step(10, 20, 30, 40));
    for (const l of endLabels(flat, layoutFor(flat))) expect(l.text).toMatch(/every step$/);
  });

  it("anchors each label at the middle of its band on the last stroke", () => {
    const steps = series(256);
    const layout = layoutFor(steps);
    const last = strokes(steps, layout)[255]!;
    for (const label of endLabels(steps, layout)) {
      const seg = last.segments.find((s) => s.kind === label.kind)!;
      expect(label.anchorY).toBeCloseTo(seg.y + seg.height / 2, 5);
    }
  });
});

describe("summary", () => {
  it("reports the first and last totals and the attention growth, from the data", () => {
    const s = summary(series(256));
    expect(s.firstTotal).toBe(37536 + 10772 + 16296 + 2616);
    expect(s.lastTotal).toBe(total(series(256)[255]!));
    expect(s.attentionRatio).toBeCloseTo(series(256)[255]!.attention / 10772, 5);
    expect(s.weightsConstant).toBe(true);
  });
  it("notices that weights are not constant when they are not", () => {
    expect(summary([step(1, 1, 1, 1), step(2, 1, 1, 1)]).weightsConstant).toBe(false);
  });
});

describe("sampleRows", () => {
  const rows = Array.from({ length: 256 }, (_, i) => ({ step: i, cycles: i, weights: 0, attention: 0, vpu: 0, other: 0, tileBusy: [] }));
  it("picks evenly spaced steps and always includes the first and the last", () => {
    const picked = sampleRows(rows, 9).map((r) => r.step);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBe(255);
    expect(picked).toHaveLength(9);
  });
  it("returns everything when there are fewer steps than asked", () => {
    expect(sampleRows(rows.slice(0, 3), 9)).toHaveLength(3);
  });
});

describe("ribbonData", () => {
  it("bundles 256 strokes, four end labels, the summary and nine table rows", () => {
    const rows = Array.from({ length: 256 }, (_, i) => ({ step: i, cycles: 0, tileBusy: [], ...series(256)[i]! }));
    const d = ribbonData(rows);
    expect(d.strokes).toHaveLength(256);
    expect(d.labels).toHaveLength(4);
    expect(d.rows).toHaveLength(9);
    expect(d.facts.firstTotal).toBe(total(rows[0]!));
  });
});
