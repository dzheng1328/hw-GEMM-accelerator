import { beforeAll, describe, expect, it } from "vitest";
import { b64, exampleEntries, nodeAssets } from "../sim/artifacts.testlib";
import { Chip, type RunResult } from "../sim/chip";
import { FLIT_GO, FLIT_OPERAND, PORT_E, PORT_INJECT, PORT_N, PORT_S, PORT_W, Trace } from "./trace";

describe("the recorded trace agrees with the chip's own counters (2x2, the cat)", () => {
  let result: RunResult;
  let trace: Trace;
  beforeAll(async () => {
    const chip = await Chip.open("2x2", await nodeAssets("2x2"));
    result = chip.run(b64(exampleEntries()[3]!.packed));
    trace = new Trace(result.trace, result.nodes);
  }, 60_000);

  it("has one record per cycle, and the chip's run counter agrees", () => {
    expect(trace.cycles).toBe(result.cycles);
    expect(Math.abs(result.counters.runCycles - result.cycles)).toBeLessThanOrEqual(2);
  });

  it("each tile's busy bit sums to that node's busy_cyc counter (rtl/node_perf.v)", () => {
    for (let n = 0; n < result.nodes; n++) {
      let busy = 0;
      for (let c = 0; c < trace.cycles; c++) busy += (trace.busyMask(c) >> n) & 1;
      expect(busy, `node ${n}`).toBe(result.counters.busyCycles[n]);
    }
  });

  it("node 0's injected OPERAND and GO flits equal slot_cyc and go_cyc (rtl/cmd_perf.v)", () => {
    let operand = 0;
    let go = 0;
    for (let c = 0; c < trace.cycles; c++) {
      if (!trace.transfer(c, 0, PORT_INJECT)) continue;
      const type = trace.flitType(c, 0, PORT_INJECT);
      if (type === FLIT_OPERAND) operand++;
      if (type === FLIT_GO) go++;
    }
    expect(operand).toBe(result.counters.slotCycles);
    expect(go).toBe(result.counters.goCycles);
    expect(operand).toBeGreaterThan(1000);
  });

  it("only node 0 injects, and RESULTs are delivered only at node 0", () => {
    let violations = 0;
    for (let c = 0; c < trace.cycles; c++) {
      for (let n = 1; n < result.nodes; n++) {
        if (trace.transfer(c, n, PORT_INJECT) || trace.resultDelivered(c, n)) violations++;
      }
    }
    expect(violations).toBe(0);
  });

  it("no flit ever leaves the mesh: edge links of the 2x2 stay silent", () => {
    // 2x2: node 0 has no south or west neighbour, node 1 no south or east, node 2 no north or west, node 3 no north or east.
    const edges: [number, number][] = [[0, PORT_S], [0, PORT_W], [1, PORT_S], [1, PORT_E], [2, PORT_N], [2, PORT_W], [3, PORT_N], [3, PORT_E]];
    let violations = 0;
    for (let c = 0; c < trace.cycles; c++) for (const [n, p] of edges) if (trace.transfer(c, n, p)) violations++;
    expect(violations).toBe(0);
  });

  it("flits do cross the interior links", () => {
    let seen = 0;
    for (let c = 0; c < trace.cycles; c++) if (trace.transfer(c, 0, PORT_E) || trace.transfer(c, 0, PORT_N)) seen++;
    expect(seen).toBeGreaterThan(100);
  });
});
