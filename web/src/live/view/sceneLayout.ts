import { meshLinks, type Link } from "../trace/links";
import { FLIT_GO, FLIT_OPERAND, FLIT_RESULT, FLIT_RESULT8 } from "../trace/trace";

export const TILE = 1;
/** Centre-to-centre distance between neighbouring tiles. */
export const PITCH = 1.7;
const LANE = 0.16; // how far a directed link sits to one side of the tile-to-tile axis

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Node i is at x = i % w, y = floor(i / w). North (y + 1) is -z, away from the camera. */
export function tileCenter(w: number, h: number, node: number): Vec3 {
  const x = node % w;
  const y = Math.floor(node / w);
  // written as (centre - y) so the 1x1 mesh gets +0, not -0, which toEqual would tell apart
  return { x: (x - (w - 1) / 2) * PITCH, y: 0, z: ((h - 1) / 2 - y) * PITCH };
}

export interface LinkGeom {
  link: Link;
  center: Vec3;
  axis: "x" | "z";
  length: number;
}

/** One thin bar per directed link; N and E sit on one side of the edge, S and W on the other. */
export function linkGeometry(w: number, h: number): LinkGeom[] {
  return meshLinks(w, h).map((link) => {
    const a = tileCenter(w, h, link.from);
    const b = tileCenter(w, h, link.to);
    const axis = link.port === 0 || link.port === 2 ? "z" : "x";
    const side = link.port <= 1 ? LANE : -LANE;
    const center: Vec3 = {
      x: (a.x + b.x) / 2 + (axis === "z" ? side : 0),
      y: 0.12,
      z: (a.z + b.z) / 2 + (axis === "x" ? side : 0),
    };
    return { link, center, axis, length: PITCH - TILE - 0.1 };
  });
}

/** The command processor, DMA and memories sit beside node 0, where every flit enters the mesh. */
export function controllerCenter(w: number, h: number): Vec3 {
  const n0 = tileCenter(w, h, 0);
  return { x: n0.x - PITCH, y: 0, z: n0.z };
}

export function cameraFor(w: number, h: number) {
  const span = Math.max(w, h) * PITCH + PITCH; // one extra pitch for the controller block
  const distance = 2.2 + span * 1.05;
  return { position: [0, distance * 0.78, distance * 0.82] as [number, number, number], fov: 38, distance, height: distance * 0.78 };
}

/** Maps an activity fraction to light: none is dark, any activity is visible, full activity is full. */
export function glow(fraction: number): number {
  if (!(fraction > 0)) return 0;
  return Math.min(1, 0.25 + 0.75 * Math.sqrt(Math.min(1, fraction)));
}

/** Flit type to colour token and plain-language name, shared by the scene and the legend. */
export const FLIT_LEGEND: { type: number; label: string; token: string }[] = [
  { type: FLIT_OPERAND, label: "OPERAND: weights and activations loaded into a tile", token: "--port-operand" },
  { type: FLIT_GO, label: "GO: start a tile's matrix multiply", token: "--port-go" },
  { type: FLIT_RESULT, label: "RESULT: a raw accumulator cell coming back", token: "--cat-attention" },
  { type: FLIT_RESULT8, label: "RESULT8: a requantized row coming back", token: "--cat-vpu" },
];

/** The widest stage shape the camera will zoom in for; past it the board would run off the top and bottom. */
export const MAX_FIT = 1.5;

/** How much closer the camera goes for a stage this wide (width over height): `cameraFor` frames a 4:3 stage, so a wider one has room to spare. */
export function fitFor(aspect: number): number {
  if (!(aspect > 0)) return 1;
  return Math.min(MAX_FIT, Math.max(1, aspect / (4 / 3)));
}

export const SETTLE_MS = 1200;
export const SETTLE_FROM = 0.35;

/** The camera's sideways angle (radians) this long after the stage appears: it eases from SETTLE_FROM to 0, then stays. */
export function settleAzimuth(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / SETTLE_MS));
  return SETTLE_FROM * (1 - t) ** 3;
}
