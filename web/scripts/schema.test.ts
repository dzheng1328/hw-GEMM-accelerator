import { describe, expect, it } from "vitest";
import { readPerf } from "./paths";
import { cifarSchema, lmRunsSchema, lmTraceSchema, lmVocabSchema, parseInput, scalingSchema } from "./schema";

const read = (name: string): unknown => JSON.parse(readPerf(name));

describe("input schemas", () => {
  it("accept the real perf files", () => {
    parseInput("lm_trace.json", lmTraceSchema, read("lm_trace.json"));
    parseInput("lm.json", lmRunsSchema, read("lm.json"));
    parseInput("cifar.json", cifarSchema, read("cifar.json"));
    parseInput("scaling.json", scalingSchema, read("scaling.json"));
  });

  it("accept a story whose end_step is null and keep it null", () => {
    const raw = read("lm_trace.json") as { stories: { end_step: number | null }[] };
    raw.stories[0]!.end_step = null;
    const trace = parseInput("lm_trace.json", lmTraceSchema, raw);
    expect(trace.stories[0]!.end_step).toBeNull();
  });

  it("name the file and the field when a field is renamed", () => {
    const raw = read("cifar.json") as Record<string, unknown>;
    raw.int8_acc = raw.int8_accuracy;
    delete raw.int8_accuracy;
    expect(() => parseInput("cifar.json", cifarSchema, raw)).toThrow(/cifar\.json[\s\S]*int8_accuracy/);
  });

  it("name a nested field path", () => {
    const raw = read("lm_trace.json") as { steps: { cycles?: number }[] };
    delete raw.steps[3]!.cycles;
    expect(() => parseInput("lm_trace.json", lmTraceSchema, raw)).toThrow(/steps\.3\.cycles/);
  });
});

describe("lm_vocab.json schema", () => {
  it("accepts the real file", () => {
    const vocab = parseInput("lm_vocab.json", lmVocabSchema, read("lm_vocab.json"));
    expect(vocab.pieces).toHaveLength(512);
    expect(vocab.bos).toBe(1);
  });

  it("names the field when a piece is not a string", () => {
    const raw = read("lm_vocab.json") as { pieces: unknown[] };
    raw.pieces[3] = 7;
    expect(() => parseInput("lm_vocab.json", lmVocabSchema, raw)).toThrow(/pieces\.3/);
  });
});
