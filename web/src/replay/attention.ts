import type { AttentionProbs } from "./types";

/** The weights of one head at one step, as fractions: the stored integers over 127. */
export function headWeights(probs: AttentionProbs, step: number, layer: number, head: number): number[] {
  const raw = probs[step]?.[layer]?.[head];
  if (!raw) throw new Error(`no attention for step ${step}, layer ${layer}, head ${head}`);
  return raw.map((v) => v / 127);
}

/** The position with the largest weight; ties go to the earliest position. */
export function peakPosition(weights: number[]): number {
  let best = 0;
  for (let i = 1; i < weights.length; i++) {
    if (weights[i]! > weights[best]!) best = i;
  }
  return best;
}

/** The peak position of every head at a step, as [layer][head]. */
export function layerHeadSummary(probs: AttentionProbs, step: number): number[][] {
  const layers = probs[step];
  if (!layers) throw new Error(`no attention for step ${step}`);
  return layers.map((heads) => heads.map((weights) => peakPosition(weights)));
}

/** Scale so the largest weight is 1, for drawing; all-zero weights stay zero. */
export function normalizeForOverlay(weights: number[]): number[] {
  const max = weights.reduce((a, b) => Math.max(a, b), 0);
  return max > 0 ? weights.map((v) => v / max) : weights.map(() => 0);
}
