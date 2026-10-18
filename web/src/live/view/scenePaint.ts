import type { Color, MeshStandardMaterial } from "three";
import { NO_TYPE, type WindowSummary } from "../trace/trace";
import { glow, type LinkGeom } from "./sceneLayout";

export interface SceneMaterials {
  tiles: (MeshStandardMaterial | null)[];
  links: (MeshStandardMaterial | null)[];
  controller: MeshStandardMaterial | null;
  inject: MeshStandardMaterial | null;
}

export interface SceneColors {
  accent: Color;
  controller: Color;
  flit: Color[];
}

/** The idle board: every light off. Nothing moves before the recorded signals do. */
export function paintIdle(materials: SceneMaterials): void {
  for (const material of [...materials.tiles, ...materials.links, materials.controller, materials.inject]) {
    material?.emissive.setRGB(0, 0, 0);
  }
}

/** One frame of a run: each part glows by how active the window summary says it was. */
export function paintRun(materials: SceneMaterials, summary: WindowSummary, geoms: LinkGeom[], colors: SceneColors, nodes: number): void {
  for (let n = 0; n < nodes; n++) materials.tiles[n]?.emissive.copy(colors.accent).multiplyScalar(glow(summary.tiles[n]!));
  geoms.forEach((g, i) => {
    const material = materials.links[i];
    if (!material) return;
    const type = summary.linkType[g.link.id]!;
    if (type === NO_TYPE) material.emissive.setRGB(0, 0, 0);
    else material.emissive.copy(colors.flit[type]!).multiplyScalar(glow(summary.links[g.link.id]!));
  });
  const busy = Math.max(summary.dma, summary.sequencer);
  materials.controller?.emissive.copy(colors.controller).multiplyScalar(glow(busy));
  const injectType = summary.injectType[0]!;
  if (injectType === NO_TYPE) materials.inject?.emissive.setRGB(0, 0, 0);
  else materials.inject?.emissive.copy(colors.flit[injectType]!).multiplyScalar(glow(summary.inject[0]!));
}
