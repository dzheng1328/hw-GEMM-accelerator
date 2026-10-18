import { Color, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { paintIdle, paintRun, type SceneColors, type SceneMaterials } from "./scenePaint";
import { linkGeometry } from "./sceneLayout";
import { FLIT_OPERAND, NO_TYPE, newSummary } from "../trace/trace";

const lit = () => {
  const m = new MeshStandardMaterial();
  m.emissive.setRGB(1, 1, 1);
  return m;
};
const materials = (nodes: number, links: number): SceneMaterials => ({
  tiles: Array.from({ length: nodes }, lit),
  links: Array.from({ length: links }, lit),
  controller: lit(),
  inject: lit(),
});
const colors: SceneColors = { accent: new Color("#4cc3ff"), controller: new Color("#ff9f43"), flit: [new Color("#ff0000"), new Color("#00ff00"), new Color("#0000ff"), new Color("#ffff00")] };
const dark = (m: MeshStandardMaterial | null) => m!.emissive.r === 0 && m!.emissive.g === 0 && m!.emissive.b === 0;

describe("paintIdle", () => {
  it("turns every light off, and tolerates materials that are not mounted yet", () => {
    const m = materials(4, 3);
    m.tiles.push(null);
    paintIdle(m);
    expect([...m.tiles, ...m.links, m.controller, m.inject].filter(Boolean).every(dark)).toBe(true);
  });
});

describe("paintRun", () => {
  it("lights a busy tile and a link carrying a flit, and leaves quiet parts dark", () => {
    const geoms = linkGeometry(2, 2);
    const m = materials(4, geoms.length);
    const s = newSummary(4);
    s.tiles[0] = 1;
    s.links[geoms[0]!.link.id] = 1;
    s.linkType[geoms[0]!.link.id] = FLIT_OPERAND;
    s.dma = 1;
    paintRun(m, s, geoms, colors, 4);
    expect(dark(m.tiles[0]!)).toBe(false);
    expect(dark(m.tiles[1]!)).toBe(true);
    expect(dark(m.links[0]!)).toBe(false);
    expect(dark(m.links[1]!)).toBe(true);
    expect(dark(m.controller)).toBe(false);
    expect(dark(m.inject)).toBe(true);
    expect(s.injectType[0]).toBe(NO_TYPE);
  });
});
