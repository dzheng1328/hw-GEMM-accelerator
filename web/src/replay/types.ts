export interface StepRecord {
  step: number;
  cycles: number;
  weights: number;
  attention: number;
  vpu: number;
  other: number;
  tileBusy: number[];
}

export interface StoryRecord {
  tokens: number[];
  text: string;
  endStep: number | null;
}

export interface VocabFile {
  bos: number;
  eos: number;
  pieces: string[];
}

/** probs[step][layer][head] is a list over positions 0..step, integers 0..127. */
export type AttentionProbs = number[][][][];

export interface ReplayData {
  steps: StepRecord[];
  stories: StoryRecord[];
  promptLength: number;
  vocab: VocabFile;
  probs: AttentionProbs;
}

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
