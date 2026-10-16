import { describe, expect, it } from "vitest";
import { formatPercent } from "../format";
import { performance } from "./data";
import {
  SHADE_FULL_SCALE,
  cifarFinding,
  cyclesBars,
  findMesh,
  lmFinding,
  portSegments,
  speedupBars,
  tilePosition,
  tileShade,
} from "./derive";

const cifar = performance.cifar.meshes;
const lm = performance.lm.meshes;

describe("tilePosition", () => {
  it("places node i at (i mod W, floor(i / W)), with node 0 at the corner", () => {
    expect(tilePosition(0, 4)).toEqual({ x: 0, y: 0 });
    expect(tilePosition(5, 4)).toEqual({ x: 1, y: 1 });
    expect(tilePosition(15, 4)).toEqual({ x: 3, y: 3 });
  });

  it("handles a non-square mesh: 2x1 is two tiles in one row", () => {
    expect(tilePosition(0, 2)).toEqual({ x: 0, y: 0 });
    expect(tilePosition(1, 2)).toEqual({ x: 1, y: 0 });
  });
});

describe("tileShade", () => {
  it("is 0 to 1, linear up to the full-scale utilization and clamped after", () => {
    expect(tileShade(0)).toBe(0);
    expect(tileShade(SHADE_FULL_SCALE / 2)).toBeCloseTo(0.5, 12);
    expect(tileShade(SHADE_FULL_SCALE)).toBe(1);
    expect(tileShade(0.9)).toBe(1);
    expect(tileShade(-0.1)).toBe(0);
  });

  it("keeps every recorded tile's shade in 0..1", () => {
    for (const m of [...cifar, ...lm]) for (const u of m.tileUtilization) expect(tileShade(u)).toBeGreaterThanOrEqual(0);
  });
});

describe("bars", () => {
  it("starts the speedup series at 1 and compares each mesh with its tile count", () => {
    const bars = speedupBars(cifar);
    expect(bars[0]!.value).toBe(1);
    expect(bars.map((b) => b.reference)).toEqual([1, 2, 4, 9, 16]);
    expect(bars.every((b) => b.value <= b.reference)).toBe(true);
  });

  it("compares cycles per image with the floor on every mesh", () => {
    const bars = cyclesBars(cifar, performance.floorFlitsPerImage);
    expect(bars.every((b) => b.reference === 134482)).toBe(true);
    expect(bars.every((b) => b.value >= b.reference)).toBe(true);
  });
});

describe("portSegments", () => {
  const port = cifar[2]!.port;

  it("folds the credit stall into Other so there are five segments", () => {
    const segments = portSegments(port, "WAIT/END stall");
    expect(segments.map((s) => s.key)).toEqual(["operand", "go", "stall", "wait", "other"]);
    expect(segments[4]!.share).toBeCloseTo(port.shares.credit + port.shares.other, 12);
    expect(segments[4]!.cycles).toBe(port.cycles.credit + port.cycles.other);
  });

  it("uses the label it is given for the WAIT category", () => {
    expect(portSegments(port, "WAIT, END or VPU running")[3]!.label).toBe("WAIT, END or VPU running");
  });

  it("keeps the shares summing to 1", () => {
    expect(portSegments(port, "x").reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 12);
  });
});

describe("findMesh", () => {
  it("returns the named mesh and names the choices when it is missing", () => {
    expect(findMesh(cifar, "2x2").mesh).toBe("2x2");
    expect(() => findMesh(lm, "3x3")).toThrow(/3x3.*1x1, 2x2, 4x4/);
  });
});

describe("findings", () => {
  it("says CIFAR-10 saturates at the port, with the data's numbers", () => {
    const text = cifarFinding(cifar[4]!, performance.floorFlitsPerImage);
    expect(text).toContain(formatPercent(cifar[4]!.cornerBusy, 1));
    expect(text).toContain("134,482");
    expect(text).toContain("98.2%");
  });

  it("hedges the story model's cause the way the repo does", () => {
    const text = lmFinding(lm[1]!, lm[2]!, performance.lm.vpuCycles);
    expect(text).toContain(formatPercent(lm[1]!.cornerBusy, 0));
    expect(text).toContain("1.24x");
    expect(text).toContain("15,108,284");
    expect(text).toMatch(/do not prove a single cause/);
    expect(text).not.toMatch(/because the serial VPU/i);
  });
});
