import { describe, expect, it } from "vitest";
import {
  FLIT_GO, FLIT_OPERAND, FLIT_RESULT, NO_TYPE, PORT_E, PORT_INJECT, PORT_N, Trace, newSummary, summarize,
} from "./trace";

interface Rec {
  busy?: number;
  pc?: number;
  flags?: number;
  nodes?: number[];
}
/** A node word: transfers on ports (bit i), the RESULT bit and per-port flit types. */
const word = (o: { xfer?: number[]; result?: boolean; types?: Record<number, number> }) => {
  let v = 0;
  for (const p of o.xfer ?? []) v |= 1 << p;
  if (o.result) v |= 1 << 5;
  for (const [p, t] of Object.entries(o.types ?? {})) v |= t << (6 + 2 * Number(p));
  return v;
};
function make(nodes: number, records: Rec[]): Trace {
  const rb = 6 + 2 * nodes;
  const bytes = new Uint8Array(records.length * rb);
  const view = new DataView(bytes.buffer);
  records.forEach((r, c) => {
    view.setUint16(c * rb, r.busy ?? 0, true);
    view.setUint16(c * rb + 2, r.pc ?? 0, true);
    view.setUint8(c * rb + 4, r.flags ?? 0);
    for (let n = 0; n < nodes; n++) view.setUint16(c * rb + 6 + 2 * n, r.nodes?.[n] ?? 0, true);
  });
  return new Trace(bytes, nodes);
}

describe("Trace", () => {
  const t = make(2, [
    { busy: 0b01, pc: 5, flags: 0b101, nodes: [word({ xfer: [PORT_E, PORT_INJECT], types: { [PORT_E]: FLIT_GO, [PORT_INJECT]: FLIT_OPERAND } }), word({ result: true })] },
    { busy: 0b11, pc: 6 },
  ]);

  it("counts cycles and decodes every field", () => {
    expect(t.cycles).toBe(2);
    expect(t.nodes).toBe(2);
    expect(t.busyMask(0)).toBe(1);
    expect(t.busyMask(1)).toBe(3);
    expect(t.pc(1)).toBe(6);
    expect(t.flags(0)).toBe(5);
    expect(t.transfer(0, 0, PORT_E)).toBe(true);
    expect(t.transfer(0, 0, PORT_N)).toBe(false);
    expect(t.flitType(0, 0, PORT_E)).toBe(FLIT_GO);
    expect(t.flitType(0, 0, PORT_INJECT)).toBe(FLIT_OPERAND);
    expect(t.resultDelivered(0, 1)).toBe(true);
    expect(t.resultDelivered(0, 0)).toBe(false);
  });

  it("rejects bytes that are not whole records", () => {
    expect(() => new Trace(new Uint8Array(13), 2)).toThrow(/whole records/);
  });
});

describe("summarize", () => {
  const typed = (type: number) => word({ xfer: [PORT_N], types: { [PORT_N]: type } });
  const t = make(2, [
    { busy: 0b01, pc: 1, nodes: [typed(FLIT_OPERAND), 0] },
    { busy: 0b01, pc: 2, nodes: [typed(FLIT_OPERAND), 0] },
    { busy: 0b11, pc: 3, nodes: [typed(FLIT_GO), 0] },
    { busy: 0b00, pc: 4, nodes: [0, 0] },
  ]);

  it("gives busy and link fractions over a window and the dominant flit type", () => {
    const s = summarize(t, 0, 4);
    expect(Array.from(s.tiles)).toEqual([0.75, 0.25]);
    expect(s.links[0 * 4 + PORT_N]).toBeCloseTo(0.75);
    expect(s.linkType[0 * 4 + PORT_N]).toBe(FLIT_OPERAND);
    expect(s.linkType[1 * 4 + PORT_N]).toBe(NO_TYPE);
    expect(s.pc).toBe(4);
  });

  it("shows a single cycle exactly when the window is one cycle", () => {
    const s = summarize(t, 2, 3);
    expect(Array.from(s.tiles)).toEqual([1, 1]);
    expect(s.linkType[PORT_N]).toBe(FLIT_GO);
    expect(s.pc).toBe(3);
  });

  it("clamps a window that runs past the end and treats an empty window as one cycle", () => {
    expect(summarize(t, 2, 99).to).toBe(4);
    const empty = summarize(t, 1, 1);
    expect([empty.from, empty.to]).toEqual([1, 2]);
    const atEnd = summarize(t, 4, 4);
    expect([atEnd.from, atEnd.to]).toEqual([3, 4]);
  });

  it("reuses the output object and zeroes it between calls", () => {
    const out = newSummary(2);
    summarize(t, 0, 4, out);
    summarize(t, 3, 4, out);
    expect(Array.from(out.tiles)).toEqual([0, 0]);
    expect(out.linkType[PORT_N]).toBe(NO_TYPE);
  });

  it("handles an empty trace", () => {
    const s = summarize(make(1, []), 0, 10);
    expect(s.tiles[0]).toBe(0);
    expect(s.to).toBe(0);
  });

  it("counts RESULT deliveries and the dominant type when types are mixed", () => {
    const mix = make(1, [
      { nodes: [word({ xfer: [PORT_N], result: true, types: { [PORT_N]: FLIT_RESULT } })] },
      { nodes: [word({ xfer: [PORT_N], types: { [PORT_N]: FLIT_GO } })] },
      { nodes: [word({ xfer: [PORT_N], types: { [PORT_N]: FLIT_RESULT } })] },
    ]);
    const s = summarize(mix, 0, 3);
    expect(s.linkType[PORT_N]).toBe(FLIT_RESULT);
    expect(s.results[0]).toBeCloseTo(1 / 3);
  });
});
