import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { laneAt } from "./tokens";
import type { StepRecord, StoryRecord, VocabFile } from "./types";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "generated", name), "utf8"));

const vocab = read("lm-vocab.json") as VocabFile;
const { stories, promptIds } = read("lm-stories.json") as { stories: StoryRecord[]; promptIds: number[] };
const { steps } = read("lm-steps.json") as { steps: StepRecord[] };
const last = steps.length - 1;

describe("the vocabulary file and the trace agree", () => {
  it("decoding each story from the exported pieces reproduces the trace's text", () => {
    for (const [i, story] of stories.entries()) {
      const lane = laneAt(story, vocab, promptIds.length, last);
      expect(lane.chips.map((c) => c.text).join(""), `story ${i}`).toBe(story.text);
    }
  });
});

describe("the facts the replay relies on", () => {
  it("every story has one more token than the run has steps and starts with BOS", () => {
    for (const story of stories) {
      expect(story.tokens).toHaveLength(steps.length + 1);
      expect(story.tokens[0]).toBe(vocab.bos);
    }
  });

  it("every lane starts with the shared prompt", () => {
    for (const story of stories) expect(story.tokens.slice(0, promptIds.length)).toEqual(promptIds);
  });

  it("an end_step, where there is one, points at the BOS the story sampled", () => {
    for (const [i, story] of stories.entries()) {
      if (story.endStep === null) continue;
      expect(story.tokens[story.endStep + 1], `story ${i}`).toBe(vocab.bos);
      expect(laneAt(story, vocab, promptIds.length, last).endedAtStep, `story ${i}`).toBe(story.endStep);
    }
  });

  it("laneAt reports no end for a story the trace says never ended", () => {
    for (const [i, story] of stories.entries()) {
      if (story.endStep !== null) continue;
      expect(laneAt(story, vocab, promptIds.length, last).endedAtStep, `story ${i}`).toBeNull();
    }
  });

  it("the trace uses a byte-fallback piece, so the byte rules are exercised by real data", () => {
    const bytePieces = new Set(vocab.pieces.flatMap((p, id) => (/^<0x[0-9A-F]{2}>$/.test(p) ? [id] : [])));
    const used = stories.some((s) => s.tokens.some((id) => bytePieces.has(id)));
    expect(used).toBe(true);
  });
});
