import { beforeAll, describe, expect, it } from "vitest";
import { b64, exampleEntries, nodeAssets } from "../sim/artifacts.testlib";
import { Chip } from "../sim/chip";
import { meshEntry } from "../sim/manifest";
import { layerSpans, type LayerSpan } from "./layers";
import { Trace } from "./trace";

describe("the program address maps the real 2x2 run onto six layers in order (gate 3)", () => {
  const entry = meshEntry("2x2");
  let trace: Trace;
  let spans: LayerSpan[];
  beforeAll(async () => {
    const chip = await Chip.open("2x2", await nodeAssets("2x2"));
    const result = chip.run(b64(exampleEntries()[3]!.packed));
    trace = new Trace(result.trace, result.nodes);
    spans = layerSpans(trace, entry.layers);
  }, 60_000);

  it("covers the whole run with six consecutive, non-empty spans", () => {
    expect(spans).toHaveLength(6);
    expect(spans[0]!.start).toBe(0);
    expect(spans[5]!.end).toBe(trace.cycles);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.start).toBe(spans[i - 1]!.end);
    for (const [i, s] of spans.entries()) expect(s.end - s.start, entry.layers[i]!.name).toBeGreaterThan(100);
  });

  it("the tiles do work inside every layer's span, and the first layer is not the whole run", () => {
    for (const [i, s] of spans.entries()) {
      let busy = 0;
      for (let c = s.start; c < s.end; c++) busy += trace.busyMask(c) === 0 ? 0 : 1;
      expect(busy, entry.layers[i]!.name).toBeGreaterThan(0);
    }
    expect(spans[0]!.end).toBeLessThan(trace.cycles * 0.9);
  });

  it("prints the boundaries so the measured offset is on record", () => {
    const table = spans.map((s, i) => `${entry.layers[i]!.name}: ${s.start}..${s.end} (${s.end - s.start})`);
    console.log(`2x2 layer spans:\n${table.join("\n")}`);
    expect(table).toHaveLength(6);
  });
});
