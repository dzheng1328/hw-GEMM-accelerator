// Test-only helpers: they read the committed artifacts from disk, so no component may import this file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModel, type Model } from "../reference/model";

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
