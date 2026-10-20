import attentionUrl from "../data/generated/lm-attention.json?url&no-inline";
import stepsUrl from "../data/generated/lm-steps.json?url&no-inline";
import storiesUrl from "../data/generated/lm-stories.json?url&no-inline";
import vocabUrl from "../data/generated/lm-vocab.json?url&no-inline";
import type { AttentionProbs, ReplayData, StepRecord, StoryRecord, VocabFile } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

let stepsLoading: Promise<StepRecord[]> | null = null;

/** The per-step records are read by the replay and by the ribbon: one fetch and one parse serve both. A failure is not remembered. */
function loadSteps(): Promise<StepRecord[]> {
  const loading = (stepsLoading ??= getJson<{ steps: StepRecord[] }>(stepsUrl).then((file) => file.steps));
  loading.catch(() => {
    if (stepsLoading === loading) stepsLoading = null;
  });
  return loading;
}

/** Fetches the four generated files the replay needs. Each is a hashed asset, not part of the JS bundle. */
export async function loadReplayData(): Promise<ReplayData> {
  const [steps, stories, vocab, attention] = await Promise.all([
    loadSteps(),
    getJson<{ promptIds: number[]; stories: StoryRecord[] }>(storiesUrl),
    getJson<VocabFile>(vocabUrl),
    getJson<{ probs: AttentionProbs }>(attentionUrl),
  ]);
  return {
    steps,
    stories: stories.stories,
    promptLength: stories.promptIds.length,
    vocab,
    probs: attention.probs,
  };
}

/** Only the per-step cycle split (about 32 kB), for the chart in the performance section. */
export function loadLmSteps(): Promise<StepRecord[]> {
  return loadSteps();
}
