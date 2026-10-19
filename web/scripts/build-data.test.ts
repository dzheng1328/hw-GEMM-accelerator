import { beforeAll, describe, expect, it } from "vitest";
import { TIMELINE } from "../src/content/timeline";
import { GENERATED_FILES, buildAll, serialize } from "./build-data";
import { readPerf } from "./paths";
import { decisionsFileSchema } from "./schema";

type Built = ReturnType<typeof buildAll>;
let built: Built;
const raw = (name: string) => JSON.parse(readPerf(name)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(() => {
  built = buildAll();
}, 60_000);

describe("summary.json", () => {
  it("carries the LM and CIFAR-10 numbers straight from the perf files", () => {
    const s = built["summary.json"];
    const trace = raw("lm_trace.json");
    const cifar = raw("cifar.json");
    expect(s.lm.steps).toBe(trace.config.steps);
    expect(s.lm.stories).toBe(trace.stories.length);
    expect(s.lm.meshes["2x2_t256"]?.cycles).toBe(trace.meshes["2x2_t256"].cycles);
    expect(s.cifar.int8Accuracy).toBe(cifar.int8_accuracy);
    expect(s.cifar.cyclesPerImage).toBe(cifar.cycles_per_image);
  });

  it("derives the scaling ratio as 1x1 cycles over the mesh's cycles", () => {
    const s = built["summary.json"];
    const trace = raw("lm_trace.json");
    const one = trace.meshes["1x1_t256"].cycles;
    expect(s.lm.scalingVsOneByOne["2x2"]).toBeCloseTo(one / trace.meshes["2x2_t256"].cycles, 12);
    expect(s.lm.scalingVsOneByOne["4x4"]).toBeCloseTo(one / trace.meshes["4x4_t256"].cycles, 12);
    expect(s.cifar.scaling[0]?.speedup).toBe(1);
  });

  it("stamps where it came from", () => {
    expect(built["summary.json"]._generated.regenerate).toContain("npm run build:data");
  });
});

describe("lm-steps.json", () => {
  it("has one record per step and the four categories add up to the step's cycles", () => {
    const { steps } = built["lm-steps.json"];
    expect(steps).toHaveLength(raw("lm_trace.json").config.steps);
    for (const s of steps) {
      expect(s.weights + s.attention + s.vpu + s.other, `step ${s.step}`).toBe(s.cycles);
    }
  });
});

describe("lm-stories.json", () => {
  it("keeps a null end_step as null, never as 0", () => {
    const stories = built["lm-stories.json"].stories;
    const want = (raw("lm_trace.json").stories as { end_step: number | null }[]).map((s) => s.end_step);
    expect(stories.map((s) => s.endStep)).toEqual(want);
  });
});

describe("lm-attention.json", () => {
  it("has probs[step][layer][head] as a list over positions 0..step", () => {
    const { probs } = built["lm-attention.json"];
    expect(probs).toHaveLength(raw("lm_trace.json").config.steps);
    const last = probs.length - 1;
    expect(probs[last]![0]![0]).toHaveLength(last + 1);
    expect(probs[0]![0]![0]).toHaveLength(1);
  });
});

describe("serialize", () => {
  it("ends every file with a newline and is stable", () => {
    for (const name of GENERATED_FILES) {
      const text = serialize(name, built[name]);
      expect(text.endsWith("\n")).toBe(true);
      expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(built[name])));
    }
  });
});

describe("lm-vocab.json", () => {
  it("carries the exported pieces in id order", () => {
    const v = built["lm-vocab.json"];
    const rawVocab = raw("lm_vocab.json");
    expect(v.pieces).toEqual(rawVocab.pieces);
    expect(v.bos).toBe(rawVocab.bos);
    expect(v.eos).toBe(rawVocab.eos);
    expect(v._generated.regenerate).toContain("npm run build:data");
  });
});

describe("decisions.json", () => {
  it("has one record per timeline node and says where it came from", () => {
    const file = built["decisions.json"];
    expect(Object.keys(file.records).sort()).toEqual(TIMELINE.map((n) => n.id).sort());
    expect(file._generated.sources).toEqual(["docs/decisions.md"]);
    expect(file._generated.regenerate).toContain("npm run build:data");
  });

  it("matches its schema and carries no em dash", () => {
    const file = built["decisions.json"];
    expect(() => decisionsFileSchema.parse(file)).not.toThrow();
    expect(JSON.stringify(file)).not.toContain("\u2014");
  });
});
