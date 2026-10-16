// Test-only helpers: they read the committed artifacts from disk, so no component may import this file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseModel, type Model } from "../reference/model";
import type { ChipAssets, SimModule } from "./chip";
import { manifest, meshEntry } from "./manifest";
import type { MeshKey } from "./types";

export const ARTIFACTS = join(import.meta.dirname, "artifacts");

export const readBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(join(ARTIFACTS, name)));
export const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(ARTIFACTS, name), "utf8")) as T;
export const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

export interface ImageEntry {
  pixels: string;
  packed: string;
  logits: number[];
}
export interface ExampleEntry extends ImageEntry {
  class: number;
  name: string;
  index: number;
  int8Pred: number;
  floatPred: number;
}

export const exampleEntries = (): ExampleEntry[] => readJson<ExampleEntry[]>("examples.json");
export const extremeEntries = (): Record<"noise" | "white" | "black", ImageEntry> =>
  readJson<{ extremes: Record<"noise" | "white" | "black", ImageEntry> }>("golden.json").extremes;
export const requantCases = (): number[][] => readJson<{ requant: number[][] }>("golden.json").requant;
export const loadModel = (): Model => parseModel(readJson<unknown>("cifar-model.json"));

/** Assets for a Chip in Node: the committed glue is imported natively, the binaries read from disk. */
export async function nodeAssets(mesh: MeshKey): Promise<ChipAssets> {
  const entry = meshEntry(mesh);
  const url = pathToFileURL(join(ARTIFACTS, `cifar-${mesh}.mjs`)).href;
  return {
    createModule: async () => ((await import(/* @vite-ignore */ url)) as { default: () => Promise<SimModule> }).default(),
    program: readBytes(entry.program),
    weights: readBytes(manifest.weights.file),
    entry,
    output: manifest.output,
    inputBytes: manifest.input.bytes,
  };
}
