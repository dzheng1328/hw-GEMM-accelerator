import attentionUrl from "../data/generated/lm-attention.json?no-inline";
import stepsUrl from "../data/generated/lm-steps.json?no-inline";
import storiesUrl from "../data/generated/lm-stories.json?no-inline";
import vocabUrl from "../data/generated/lm-vocab.json?no-inline";
import type { AttentionProbs, ReplayData, StepRecord, StoryRecord, VocabFile } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Fetches the four generated files the replay needs. Each is a hashed asset, not part of the JS bundle. */
export async function loadReplayData(): Promise<ReplayData> {
  const [steps, stories, vocab, attention] = await Promise.all([
    getJson<{ steps: StepRecord[] }>(stepsUrl),
    getJson<{ promptIds: number[]; stories: StoryRecord[] }>(storiesUrl),
    getJson<VocabFile>(vocabUrl),
    getJson<{ probs: AttentionProbs }>(attentionUrl),
  ]);
  return {
    steps: steps.steps,
    stories: stories.stories,
    promptLength: stories.promptIds.length,
    vocab,
    probs: attention.probs,
  };
}
