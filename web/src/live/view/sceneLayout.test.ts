import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { meshLinks } from "../trace/links";
import { FLIT_GO, FLIT_OPERAND, FLIT_RESULT, FLIT_RESULT8 } from "../trace/trace";
import { FLIT_LEGEND, PITCH, SETTLE_FROM, SETTLE_MS, TILE, cameraFor, controllerCenter, glow, linkGeometry, settleAzimuth, tileCenter } from "./sceneLayout";
import { themeBlocks } from "../../theme/themeBlocks.testlib";

describe("tileCenter", () => {
  it("centres the mesh on the origin, with north (y + 1) going away from the camera", () => {
    expect(tileCenter(1, 1, 0)).toEqual({ x: 0, y: 0, z: 0 });
    const sw = tileCenter(2, 2, 0);
    const ne = tileCenter(2, 2, 3);
    expect(sw.x).toBeCloseTo(-PITCH / 2);
    expect(sw.z).toBeCloseTo(PITCH / 2);
    expect(ne.x).toBeCloseTo(PITCH / 2);
    expect(ne.z).toBeCloseTo(-PITCH / 2);
  });
  it("keeps tiles apart by the pitch", () => {
    expect(tileCenter(4, 4, 1).x - tileCenter(4, 4, 0).x).toBeCloseTo(PITCH);
    expect(tileCenter(4, 4, 0).z - tileCenter(4, 4, 4).z).toBeCloseTo(PITCH);
  });
});

describe("linkGeometry", () => {
  it("has one piece per directed link, in meshLinks order, each shorter than the gap between tiles", () => {
    for (const [w, h] of [[1, 1], [2, 2], [4, 4]] as const) {
      const geoms = linkGeometry(w, h);
      expect(geoms.map((g) => g.link)).toEqual(meshLinks(w, h));
      for (const g of geoms) expect(g.length).toBeLessThan(PITCH - TILE + 1e-9);
    }
  });
  it("puts the two directions of one edge on opposite sides so they do not overlap", () => {
    const geoms = linkGeometry(2, 1);
    const east = geoms.find((g) => g.link.port === 1)!;
    const west = geoms.find((g) => g.link.port === 3)!;
    expect(east.axis).toBe("x");
    expect(east.center.x).toBeCloseTo(west.center.x);
    expect(east.center.z).not.toBeCloseTo(west.center.z);
  });
});

describe("controllerCenter", () => {
  it("sits beside node 0, on its west side, at the same depth", () => {
    const c = controllerCenter(2, 2);
    const n0 = tileCenter(2, 2, 0);
    expect(c.x).toBeLessThan(n0.x - TILE / 2);
    expect(c.z).toBeCloseTo(n0.z);
  });
});

describe("cameraFor", () => {
  it("backs off as the mesh grows", () => {
    expect(cameraFor(4, 4).distance).toBeGreaterThan(cameraFor(2, 2).distance);
    expect(cameraFor(2, 2).distance).toBeGreaterThan(cameraFor(1, 1).distance);
  });
});

describe("glow", () => {
  it("is zero for no activity, visible for a little, one for full activity, and never decreases", () => {
    expect(glow(0)).toBe(0);
    expect(glow(0.01)).toBeGreaterThanOrEqual(0.25);
    expect(glow(1)).toBe(1);
    let last = 0;
    for (let f = 0; f <= 1; f += 0.05) {
      expect(glow(f)).toBeGreaterThanOrEqual(last);
      last = glow(f);
    }
  });
  it("clamps out-of-range input", () => {
    expect(glow(-1)).toBe(0);
    expect(glow(7)).toBe(1);
  });
});

describe("FLIT_LEGEND", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "..", "theme", "tokens.css"), "utf8");
  it("names all four flit types once, in type order", () => {
    expect(FLIT_LEGEND.map((l) => l.type)).toEqual([FLIT_OPERAND, FLIT_GO, FLIT_RESULT, FLIT_RESULT8]);
  });
  it("uses only colour tokens that exist in both themes", () => {
    const { dark, light } = themeBlocks(css);
    for (const { token } of FLIT_LEGEND) {
      expect(dark, token).toContain(`${token}:`);
      expect(light, token).toContain(`${token}:`);
    }
  });
});

describe("settleAzimuth", () => {
  it("starts off to one side, eases to centre, and then stays there", () => {
    expect(settleAzimuth(0)).toBeCloseTo(SETTLE_FROM, 6);
    expect(settleAzimuth(SETTLE_MS)).toBe(0);
    expect(settleAzimuth(SETTLE_MS * 5)).toBe(0);
    expect(settleAzimuth(-50)).toBeCloseTo(SETTLE_FROM, 6);
    const samples = [0, 200, 400, 600, 800, 1000, 1200].map(settleAzimuth);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!);
  });
});
