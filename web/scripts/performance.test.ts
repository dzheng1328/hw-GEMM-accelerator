import { beforeAll, describe, expect, it } from "vitest";
import { buildAll } from "./build-data";
import { readPerf } from "./paths";

type Built = ReturnType<typeof buildAll>;
let built: Built;
const raw = (name: string) => JSON.parse(readPerf(name)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(() => {
  built = buildAll();
}, 60_000);

const PORT = ["operand", "go", "stall", "wait", "credit", "other"] as const;

describe("performance.json, CIFAR-10", () => {
  it("derives the floor as the injected flits per image", () => {
    const c = raw("cifar.json");
    expect(built["performance.json"].floorFlitsPerImage).toBe(
      (c.counters.slot_cyc + c.counters.go_cyc) / c.images,
    );
    expect(built["performance.json"].floorFlitsPerImage).toBe(134482);
  });

  it("has the five meshes in order, with 1x1 as the speedup baseline", () => {
    const meshes = built["performance.json"].cifar.meshes;
    expect(meshes.map((m) => m.mesh)).toEqual(["1x1", "2x1", "2x2", "3x3", "4x4"]);
    expect(meshes[0]!.speedup).toBe(1);
  });

  it("recomputes every mesh's numbers from the raw counters", () => {
    const scaling = raw("scaling.json") as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const one = scaling.find((s) => s.mesh === "1x1").cycles;
    for (const [i, m] of built["performance.json"].cifar.meshes.entries()) {
      const s = scaling[i];
      expect(m.cycles).toBe(s.cycles);
      expect(m.cyclesPerUnit).toBeCloseTo(s.cycles / s.images, 9);
      expect(m.speedup).toBeCloseTo(one / s.cycles, 12);
      expect(m.cornerBusy).toBeCloseTo(s.mesh_perf.corner.lcl_in_xfer / s.counters.run_cyc, 12);
      expect(m.cornerStalled).toBeCloseTo(s.mesh_perf.corner.lcl_in_stall / s.counters.run_cyc, 12);
      expect(m.tileUtilization).toHaveLength(m.width * m.height);
      expect(m.tiles).toBe(m.width * m.height);
      s.mesh_perf.feed_cyc.forEach((f: number, k: number) => {
        expect(m.tileUtilization[k]).toBeCloseTo(f / s.counters.run_cyc, 12);
      });
      const mean = m.tileUtilization.reduce((a, b) => a + b, 0) / m.tileUtilization.length;
      expect(m.macUtilization).toBeCloseTo(mean, 12);
    }
  });

  it("keeps the six port shares summing to 1 and the cycles summing to the run", () => {
    for (const m of built["performance.json"].cifar.meshes) {
      expect(PORT.reduce((a, k) => a + m.port.shares[k], 0), m.mesh).toBeCloseTo(1, 12);
      expect(PORT.reduce((a, k) => a + m.port.cycles[k], 0), m.mesh).toBe(m.cycles);
    }
  });

  it("carries the accuracy straight from cifar.json", () => {
    const c = raw("cifar.json");
    expect(built["performance.json"].cifar.accuracy).toEqual({
      int8: c.int8_accuracy,
      float: c.float_accuracy,
      agreement: c.float_agreement,
    });
  });
});

describe("performance.json, story model", () => {
  it("has 1x1, 2x2 and 4x4 and the serial VPU's cycles on every mesh", () => {
    const lm = built["performance.json"].lm;
    expect(lm.meshes.map((m) => m.mesh)).toEqual(["1x1", "2x2", "4x4"]);
    const runs = raw("lm.json").runs;
    for (const mesh of ["1x1", "2x2", "4x4"]) expect(runs[`${mesh}_t256`].vpu[0]).toBe(lm.vpuCycles);
    expect(lm.vpuCycles).toBe(15108284);
  });

  it("recomputes cycles, speedup, port and corner busy from the raw run", () => {
    const runs = raw("lm.json").runs;
    const one = runs["1x1_t256"].cycles;
    for (const m of built["performance.json"].lm.meshes) {
      const r = runs[`${m.mesh}_t256`];
      expect(m.cycles).toBe(r.cycles);
      expect(m.cyclesPerUnit).toBeCloseTo(r.cycles / r.steps, 9);
      expect(m.speedup).toBeCloseTo(one / r.cycles, 12);
      expect(m.cornerBusy).toBeCloseTo(r.mesh_perf.corner.lcl_in_xfer / r.counters.run_cyc, 12);
      expect(PORT.reduce((a, k) => a + m.port.cycles[k], 0), m.mesh).toBe(r.cycles);
    }
  });

  it("counts the VPU's cycles inside the WAIT category", () => {
    for (const m of built["performance.json"].lm.meshes) {
      expect(m.port.cycles.wait).toBeGreaterThanOrEqual(built["performance.json"].lm.vpuCycles);
    }
  });

  it("sums the four categories over the steps and keeps the tail separate", () => {
    const c = built["performance.json"].lm.categories2x2;
    const total = c.cycles.weights + c.cycles.attention + c.cycles.vpu + c.cycles.other;
    const run = raw("lm.json").runs["2x2_t256"].cycles;
    expect(total + c.tail).toBe(run);
    expect(c.tail).toBeGreaterThanOrEqual(0);
    expect(c.shares.weights + c.shares.attention + c.shares.vpu + c.shares.other).toBeCloseTo(1, 12);
  });
});

describe("performance.json and the hero strip agree", () => {
  it("has the same 2x2 story-model speedup and CIFAR-10 cycles per image as summary.json", () => {
    const p = built["performance.json"];
    const s = built["summary.json"];
    expect(p.lm.meshes[1]!.speedup).toBe(s.lm.scalingVsOneByOne["2x2"]);
    expect(p.lm.meshes[2]!.speedup).toBe(s.lm.scalingVsOneByOne["4x4"]);
    expect(p.cifar.meshes[2]!.cyclesPerUnit).toBe(s.cifar.cyclesPerImage);
  });
});
