import type { StepRecord } from "./types";

export const CATEGORIES = ["weights", "attention", "vpu", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  weights: "Weight matmuls",
  attention: "Attention",
  vpu: "VPU",
  other: "Other",
};

export function shareAt(step: StepRecord): Record<Category, number> {
  return {
    weights: step.weights / step.cycles,
    attention: step.attention / step.cycles,
    vpu: step.vpu / step.cycles,
    other: step.other / step.cycles,
  };
}

export function attentionShareSeries(steps: StepRecord[]): number[] {
  return steps.map((s) => s.attention / s.cycles);
}
