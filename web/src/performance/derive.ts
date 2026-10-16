import { formatInt, formatPercent, formatRatio } from "../format";
import type { MeshPerf, PortNumbers } from "./types";

/** A tile that was fed a slot half the cycles gets the full shade. */
export const SHADE_FULL_SCALE = 0.5;

export function tilePosition(index: number, width: number): { x: number; y: number } {
  return { x: index % width, y: Math.floor(index / width) };
}

export function tileShade(utilization: number): number {
  return Math.min(1, Math.max(0, utilization / SHADE_FULL_SCALE));
}

export interface Bar {
  mesh: string;
  tiles: number;
  value: number;
  reference: number;
}

export function speedupBars(meshes: MeshPerf[]): Bar[] {
  return meshes.map((m) => ({ mesh: m.mesh, tiles: m.tiles, value: m.speedup, reference: m.tiles }));
}

export function cyclesBars(meshes: MeshPerf[], floorFlitsPerImage: number): Bar[] {
  return meshes.map((m) => ({ mesh: m.mesh, tiles: m.tiles, value: m.cyclesPerUnit, reference: floorFlitsPerImage }));
}

export interface PortSegment {
  key: "operand" | "go" | "stall" | "wait" | "other";
  label: string;
  share: number;
  cycles: number;
}

/** The six-way partition as five segments: the credit stall is folded into Other. */
export function portSegments(port: { cycles: PortNumbers; shares: PortNumbers }, waitLabel: string): PortSegment[] {
  const { cycles, shares } = port;
  return [
    { key: "operand", label: "OPERAND flits", share: shares.operand, cycles: cycles.operand },
    { key: "go", label: "GO flits", share: shares.go, cycles: cycles.go },
    { key: "stall", label: "Injection stall", share: shares.stall, cycles: cycles.stall },
    { key: "wait", label: waitLabel, share: shares.wait, cycles: cycles.wait },
    { key: "other", label: "Other", share: shares.credit + shares.other, cycles: cycles.credit + cycles.other },
  ];
}

export function findMesh(meshes: MeshPerf[], name: string): MeshPerf {
  const found = meshes.find((m) => m.mesh === name);
  if (!found) throw new Error(`no mesh "${name}" (have ${meshes.map((m) => m.mesh).join(", ")})`);
  return found;
}

export function cifarFinding(mesh: MeshPerf, floorFlitsPerImage: number): string {
  return (
    `CIFAR-10 saturates at the injection port: on ${mesh.mesh} the corner is ${formatPercent(mesh.cornerBusy, 1)} busy, ` +
    `and the mesh runs at ${formatPercent(floorFlitsPerImage / mesh.cyclesPerUnit, 1)} of the speed the ` +
    `${formatInt(floorFlitsPerImage)}-flit floor allows.`
  );
}

export function lmFinding(mesh2x2: MeshPerf, mesh4x4: MeshPerf, vpuCycles: number): string {
  return (
    `The story model is not port-bound: its corner is only ${formatPercent(mesh2x2.cornerBusy, 0)} busy, ` +
    `and it stops at ${formatRatio(mesh4x4.speedup)}. The serial VPU (${formatInt(vpuCycles)} busy cycles on every mesh) ` +
    `and injection back-pressure inside attention are consistent with that, but the committed counters do not prove a single cause.`
  );
}
