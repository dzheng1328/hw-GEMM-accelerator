import { parseModel, type Model } from "../reference/model";
import modelUrl from "./artifacts/cifar-model.json?url&no-inline";
import program1x1Url from "./artifacts/program-1x1.bin?url&no-inline";
import program2x2Url from "./artifacts/program-2x2.bin?url&no-inline";
import program4x4Url from "./artifacts/program-4x4.bin?url&no-inline";
import weightsUrl from "./artifacts/weights.bin?url&no-inline";
import { Chip, type ChipAssets, type SimModule } from "./chip";
import { manifest, meshEntry } from "./manifest";
import type { MeshKey } from "./types";

type Glue = () => Promise<{ default: () => Promise<SimModule> }>;

// Static import() calls, so Vite emits one lazy chunk (and one hashed .wasm) per mesh.
const MESHES: Record<MeshKey, { glue: Glue; programUrl: string }> = {
  "1x1": { glue: () => import("./artifacts/cifar-1x1.mjs"), programUrl: program1x1Url },
  "2x2": { glue: () => import("./artifacts/cifar-2x2.mjs"), programUrl: program2x2Url },
  "4x4": { glue: () => import("./artifacts/cifar-4x4.mjs"), programUrl: program4x4Url },
};

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}
const fetchBytes = async (url: string) => new Uint8Array(await (await fetchOk(url)).arrayBuffer());

export async function openChipInBrowser(mesh: MeshKey): Promise<Chip> {
  const { glue, programUrl } = MESHES[mesh];
  const [program, weights] = await Promise.all([fetchBytes(programUrl), fetchBytes(weightsUrl)]);
  const assets: ChipAssets = {
    createModule: async () => (await glue()).default(),
    program,
    weights,
    entry: meshEntry(mesh),
    output: manifest.output,
    inputBytes: manifest.input.bytes,
  };
  return Chip.open(mesh, assets);
}

export async function loadModelInBrowser(): Promise<Model> {
  return parseModel(await (await fetchOk(modelUrl)).json());
}
