export type MeshKey = "1x1" | "2x2" | "4x4";
export const MESH_KEYS: readonly MeshKey[] = ["1x1", "2x2", "4x4"];

export interface LayerRange {
  name: string;
  /** program word range [pcStart, pcEnd) of the layer: its setup, its BLOCKs and the WAIT after it */
  pcStart: number;
  pcEnd: number;
}

export interface MeshEntry {
  w: number;
  h: number;
  nodes: number;
  program: string;
  programWords: number;
  /** cycles of one image; identical for every image on a given mesh */
  cycles: number;
  recordBytes: number;
  layers: LayerRange[];
}

export interface Manifest {
  generated: { regenerate: string; note: string };
  sources: Record<string, string>;
  excludedRtl: string[];
  input: { bytes: number; words: number };
  output: { base: number; stride: number; logits: number; classes: number };
  classNames: string[];
  weights: { file: string; words: number };
  meshes: Partial<Record<MeshKey, MeshEntry>>;
}
