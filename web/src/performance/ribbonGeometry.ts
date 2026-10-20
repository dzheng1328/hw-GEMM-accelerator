import { formatInt } from "../format";
import type { StepRecord } from "../replay/types";

export type Kind = "weights" | "attention" | "vpu" | "other";
/** bottom to top */
export const KINDS: readonly Kind[] = ["weights", "attention", "vpu", "other"];
export const KIND_LABELS: Record<Kind, string> = { weights: "Weights", attention: "Attention", vpu: "Vector unit", other: "Other" };

export interface RibbonStep {
  weights: number;
  attention: number;
  vpu: number;
  other: number;
}

export const VIEW = { width: 1000, height: 450 } as const;

export interface Layout {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  max: number;
}

export const total = (s: RibbonStep): number => s.weights + s.attention + s.vpu + s.other;

/** The scale follows the data: the largest total, rounded up to 10 000, plus 20 000 of headroom. */
export function layoutFor(steps: readonly RibbonStep[]): Layout {
  const peak = Math.max(...steps.map(total));
  return { x0: 60, x1: 690, y0: 318, y1: 28, max: Math.ceil(peak / 10000) * 10000 + 20000 };
}

export interface Segment {
  kind: Kind;
  y: number;
  height: number;
}

export interface Stroke {
  x: number;
  width: number;
  segments: Segment[];
}

/** One stroke per step; each is split into the four kinds, stacked from the baseline up. */
export function strokes(steps: readonly RibbonStep[], layout: Layout): Stroke[] {
  const slot = (layout.x1 - layout.x0) / steps.length;
  const perCycle = (layout.y0 - layout.y1) / layout.max;
  return steps.map((s, i) => {
    let base = 0;
    const segments = KINDS.map((kind) => {
      const height = s[kind] * perCycle;
      const y = layout.y0 - base * perCycle - height;
      base += s[kind];
      return { kind, y, height };
    });
    return { x: layout.x0 + slot * i, width: slot * 0.66, segments };
  });
}

/** The smallest step of 1, 2 or 5 times a power of ten that gives at most five gridlines above zero. */
function gridStep(max: number): number {
  for (let power = 1; ; power *= 10) {
    for (const mult of [1, 2, 5]) {
      if (max / (mult * power) <= 5) return mult * power;
    }
  }
}

export function gridValues(max: number): number[] {
  const step = gridStep(max);
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}

/** Where the note between the two big figures starts: 270, or further right when a long first total would run into it. */
export function noteX(firstTotal: number, layout: Layout): number {
  const figureWidth = formatInt(firstTotal).length * 24;
  return Math.max(270, layout.x0 + figureWidth + 24);
}

/** Pushes labels apart to at least `gap`, top to bottom, then pulls the whole stack up if it runs past `hi`. */
export function spread(ys: readonly number[], gap: number, hi: number): number[] {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a]! - ys[b]!);
  const out = [...ys];
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1]!;
    const cur = order[i]!;
    if (out[cur]! - out[prev]! < gap) out[cur] = out[prev]! + gap;
  }
  const over = Math.max(...out) - hi;
  return over > 0 ? out.map((y) => y - over) : out;
}

export interface EndLabel {
  kind: Kind;
  anchorY: number;
  labelY: number;
  first: number;
  last: number;
  text: string;
}

/** A label for each kind at the right edge: where its band ends on the last stroke, and its first and last value. */
export function endLabels(steps: readonly RibbonStep[], layout: Layout, gap = 46): EndLabel[] {
  const first = steps[0]!;
  const last = strokes(steps, layout)[steps.length - 1]!;
  const anchors = KINDS.map((kind) => {
    const seg = last.segments.find((s) => s.kind === kind)!;
    return seg.y + seg.height / 2;
  });
  const placed = spread(anchors, gap, layout.y0 - 18);
  return KINDS.map((kind, i) => {
    const lastValue = steps[steps.length - 1]![kind];
    return {
      kind,
      anchorY: anchors[i]!,
      labelY: placed[i]!,
      first: first[kind],
      last: lastValue,
      text: first[kind] === lastValue ? `${formatInt(lastValue)} every step` : `${formatInt(first[kind])} to ${formatInt(lastValue)}`,
    };
  });
}

export function summary(steps: readonly RibbonStep[]): { firstTotal: number; lastTotal: number; attentionRatio: number; weightsConstant: boolean } {
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  return {
    firstTotal: total(first),
    lastTotal: total(last),
    attentionRatio: last.attention / first.attention,
    weightsConstant: steps.every((s) => s.weights === first.weights),
  };
}

/** Evenly spaced rows for the text table, always including the first and the last step. */
export function sampleRows(rows: readonly StepRecord[], count = 9): StepRecord[] {
  if (rows.length <= count) return [...rows];
  return Array.from({ length: count }, (_, i) => rows[Math.round((i * (rows.length - 1)) / (count - 1))]!);
}

export interface RibbonData {
  layout: Layout;
  strokes: Stroke[];
  labels: EndLabel[];
  facts: ReturnType<typeof summary>;
  rows: StepRecord[];
}

/** Everything the chart draws, computed once from the recorded steps. */
export function ribbonData(steps: readonly StepRecord[]): RibbonData {
  const layout = layoutFor(steps);
  return { layout, strokes: strokes(steps, layout), labels: endLabels(steps, layout), facts: summary(steps), rows: sampleRows(steps) };
}
