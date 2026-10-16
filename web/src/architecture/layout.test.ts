import { describe, expect, it } from "vitest";
import { boxesOverlap, edges, findBlock, insideViewBox, linkSegment } from "./layout";
import type { Block } from "./types";

const box = (x: number, y: number, w = 180, h = 44) => ({ x, y, w, h });

describe("linkSegment", () => {
  it("draws a vertical line between stacked boxes, at the middle of their x overlap", () => {
    expect(linkSegment(box(10, 10), box(10, 84))).toEqual({ x1: 100, y1: 54, x2: 100, y2: 84 });
    // A wide box under a narrow one: the line sits in the middle of the shared span (10..190).
    expect(linkSegment(box(10, 306, 380), box(10, 380))).toEqual({ x1: 100, y1: 350, x2: 100, y2: 380 });
  });

  it("is the same line whichever box is named first", () => {
    expect(linkSegment(box(10, 84), box(10, 10))).toEqual(linkSegment(box(10, 10), box(10, 84)));
  });

  it("draws a horizontal line between side-by-side boxes", () => {
    expect(linkSegment(box(10, 10), box(210, 10))).toEqual({ x1: 190, y1: 32, x2: 210, y2: 32 });
  });

  it("clips a diagonal to the edges of both boxes", () => {
    const a = box(10, 232);
    const b = box(210, 158);
    const s = linkSegment(a, b);
    expect(s.y1).toBeCloseTo(a.y, 6); // leaves the top edge of a
    expect(s.y2).toBeCloseTo(b.y + b.h, 6); // reaches the bottom edge of b
    expect(s.x1).toBeGreaterThan(a.x);
    expect(s.x1).toBeLessThan(a.x + a.w);
  });
});

describe("boxes", () => {
  it("overlap only when they share area, not when they touch", () => {
    expect(boxesOverlap(box(0, 0), box(100, 20))).toBe(true);
    expect(boxesOverlap(box(0, 0, 100, 50), box(100, 0, 100, 50))).toBe(false);
    expect(boxesOverlap(box(0, 0, 100, 50), box(0, 50, 100, 50))).toBe(false);
  });

  it("must lie inside the viewBox", () => {
    expect(insideViewBox(box(10, 10), { w: 400, h: 100 })).toBe(true);
    expect(insideViewBox(box(250, 10), { w: 400, h: 100 })).toBe(false);
    expect(insideViewBox(box(10, 80), { w: 400, h: 100 })).toBe(false);
    expect(insideViewBox(box(-1, 10), { w: 400, h: 100 })).toBe(false);
  });
});

function block(id: string, links: string[]): Block {
  return {
    id,
    label: id,
    name: id,
    kind: "control",
    role: "",
    rtl: [],
    suites: [],
    number: { label: "", value: "", source: { perf: "", format: "int" } },
    links,
    box: box(0, 0),
  };
}

describe("edges", () => {
  it("lists each connection once even when both ends declare it", () => {
    const blocks = [block("a", ["b"]), block("b", ["a", "c"]), block("c", [])];
    expect(edges(blocks)).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });
});

describe("findBlock", () => {
  it("returns the block and names the choices when it is missing", () => {
    const blocks = [block("a", []), block("b", [])];
    expect(findBlock(blocks, "b").id).toBe("b");
    expect(() => findBlock(blocks, "z")).toThrow(/z.*a, b/);
  });
});
