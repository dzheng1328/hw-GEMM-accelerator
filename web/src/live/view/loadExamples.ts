import { decodeBase64 } from "../reference/model";
import examplesUrl from "../sim/artifacts/examples.json?url&no-inline";

export interface LoadedExample {
  name: string;
  /** 3072 bytes, channel-first */
  pixels: Uint8Array;
  /** the Python golden logits */
  logits: number[];
}

/** The ten built-in examples: one test image per class. A hashed asset, fetched when the section is near. */
export async function loadExamples(): Promise<LoadedExample[]> {
  const response = await fetch(examplesUrl);
  if (!response.ok) throw new Error(`${examplesUrl}: HTTP ${response.status}`);
  const raw = (await response.json()) as { name: string; pixels: string; logits: number[] }[];
  return raw.map((e) => ({ name: e.name, pixels: decodeBase64(e.pixels), logits: e.logits }));
}
