import raw from "./artifacts/manifest.json";
import type { Manifest, MeshEntry, MeshKey } from "./types";

export const manifest = raw as unknown as Manifest;

export function meshEntry(key: MeshKey): MeshEntry {
  const entry = manifest.meshes[key];
  if (!entry) throw new Error(`the manifest has no ${key} build`);
  return entry;
}
