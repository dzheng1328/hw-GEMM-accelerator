import { describe, expect, it } from "vitest";
import type { LayerRange } from "../sim/types";
import { layerAt, layerSpans } from "./layers";
import { Trace } from "./trace";

const layers: LayerRange[] = [
  { name: "a", pcStart: 0, pcEnd: 10 },
  { name: "b", pcStart: 10, pcEnd: 20 },
  { name: "c", pcStart: 20, pcEnd: 25 },
];

function traceOfPcs(pcs: number[]): Trace {
  const bytes = new Uint8Array(pcs.length * 8);
  const view = new DataView(bytes.buffer);
  pcs.forEach((pc, c) => view.setUint16(c * 8 + 2, pc, true));
  return new Trace(bytes, 1);
}

describe("layerAt", () => {
  it("maps program addresses to layer indices, with boundaries belonging to the later layer", () => {
    expect([0, 9, 10, 19, 20, 24].map((pc) => layerAt(layers, pc))).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it("puts an address past the end in the last layer", () => {
    expect(layerAt(layers, 999)).toBe(2);
  });
});

describe("layerSpans", () => {
  it("returns the first and one-past-last cycle of each layer", () => {
    const spans = layerSpans(traceOfPcs([0, 3, 9, 10, 11, 20, 24, 24]), layers);
    expect(spans).toEqual([{ start: 0, end: 3 }, { start: 3, end: 5 }, { start: 5, end: 8 }]);
  });
  it("throws when the program address goes back to an earlier layer", () => {
    expect(() => layerSpans(traceOfPcs([0, 10, 3, 20]), layers)).toThrow(/back into a/);
  });
  it("throws when a layer is never reached", () => {
    expect(() => layerSpans(traceOfPcs([0, 1, 2, 20]), layers)).toThrow(/layer b was never reached/);
  });
  it("throws on an empty trace", () => {
    expect(() => layerSpans(traceOfPcs([]), layers)).toThrow(/empty/);
  });
});
