import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUT_DIR, REPO_ROOT, readPerf } from "./paths";
import { buildPerformance } from "./performance";
import { cifarSchema, lmRunsSchema, lmTraceSchema, lmVocabSchema, parseInput, scalingSchema } from "./schema";

export const GENERATED_FILES = [
  "summary.json",
  "lm-steps.json",
  "lm-stories.json",
  "lm-attention.json",
  "lm-vocab.json",
  "performance.json",
] as const;
export type GeneratedName = (typeof GENERATED_FILES)[number];

const stamp = (sources: string[]) => ({
  sources: sources.map((s) => `docs/perf/${s}`),
  regenerate: "npm run build:data (in web/)",
  note: "generated, do not edit by hand",
});

export function buildAll(root: string = REPO_ROOT) {
  const read = (name: string): unknown => JSON.parse(readPerf(name, root));
  const trace = parseInput("lm_trace.json", lmTraceSchema, read("lm_trace.json"));
  const lm = parseInput("lm.json", lmRunsSchema, read("lm.json"));
  const cifar = parseInput("cifar.json", cifarSchema, read("cifar.json"));
  const scaling = parseInput("scaling.json", scalingSchema, read("scaling.json"));
  const vocab = parseInput("lm_vocab.json", lmVocabSchema, read("lm_vocab.json"));

  const meshCycles = (key: string): number => {
    const m = trace.meshes[key];
    if (!m) throw new Error(`docs/perf/lm_trace.json has no mesh run "${key}"`);
    return m.cycles;
  };
  const oneByOne = meshCycles("1x1_t256");
  const run = lm.runs["2x2_t256"];
  if (!run) throw new Error('docs/perf/lm.json has no run "2x2_t256"');
  const cifarOne = scaling.find((s) => s.mesh === "1x1");
  if (!cifarOne) throw new Error('docs/perf/scaling.json has no "1x1" mesh');

  const summary = {
    _generated: stamp(["lm_trace.json", "lm.json", "cifar.json", "scaling.json"]),
    lm: {
      steps: trace.config.steps,
      stories: trace.stories.length,
      floatValLoss: trace.config.float_val_loss,
      intValLoss: trace.config.int_val_loss,
      meshes: Object.fromEntries(
        Object.entries(trace.meshes).map(([key, m]) => [
          key,
          { cycles: m.cycles, cyclesPerStep: m.cycles_per_step },
        ]),
      ),
      scalingVsOneByOne: {
        "2x2": oneByOne / meshCycles("2x2_t256"),
        "4x4": oneByOne / meshCycles("4x4_t256"),
      },
      run: { slots: run.slots, blocks: run.blocks, slotUtilization: run.slot_utilization },
    },
    cifar: {
      images: cifar.images,
      int8Accuracy: cifar.int8_accuracy,
      floatAccuracy: cifar.float_accuracy,
      mesh: cifar.mesh,
      cycles: cifar.cycles,
      cyclesPerImage: cifar.cycles_per_image,
      slotUtilization: cifar.slot_utilization,
      scaling: scaling.map((s) => ({
        mesh: s.mesh,
        cycles: s.cycles,
        cyclesPerImage: s.cycles_per_image,
        speedup: cifarOne.cycles / s.cycles,
      })),
    },
  };

  const lmSteps = {
    _generated: stamp(["lm_trace.json"]),
    steps: trace.steps.map((s) => ({
      step: s.step,
      cycles: s.cycles,
      weights: s.categories["weight matmuls"],
      attention: s.categories.attention,
      vpu: s.categories.VPU,
      other: s.categories.other,
      tileBusy: s.tile_busy,
    })),
  };

  const lmStories = {
    _generated: stamp(["lm_trace.json"]),
    promptIds: trace.config.prompt_ids,
    seeds: trace.config.seeds,
    stories: trace.stories.map((s) => ({ tokens: s.tokens, text: s.text, endStep: s.end_step })),
  };

  const lmAttention = {
    _generated: stamp(["lm_trace.json"]),
    source: trace.attention.source,
    story: trace.attention.story,
    units: trace.attention.units,
    layout: trace.attention.layout,
    probs: trace.attention.probs,
  };

  const lmVocab = {
    _generated: stamp(["lm_vocab.json"]),
    bos: vocab.bos,
    eos: vocab.eos,
    pieces: vocab.pieces,
  };

  const performance = buildPerformance({ trace, lm, cifar, scaling });

  return {
    "summary.json": summary,
    "lm-steps.json": lmSteps,
    "lm-stories.json": lmStories,
    "lm-attention.json": lmAttention,
    "lm-vocab.json": lmVocab,
    "performance.json": performance,
  } satisfies Record<GeneratedName, unknown>;
}

export function serialize(name: GeneratedName, data: unknown): string {
  const text = name === "summary.json" || name === "performance.json" ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  return `${text}\n`;
}

export function main(): void {
  const built = buildAll();
  mkdirSync(OUT_DIR, { recursive: true });
  for (const name of GENERATED_FILES) {
    const text = serialize(name, built[name]);
    writeFileSync(join(OUT_DIR, name), text);
    console.log(`wrote src/data/generated/${name} (${text.length.toLocaleString("en-US")} bytes)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
