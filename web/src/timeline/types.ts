export type Phase = 1 | 2 | 3 | 4;

export interface TimelineNode {
  id: string;
  /** ISO merge date of the node's main PR. */
  date: string;
  phase: Phase;
  title: string;
  summary: string;
  /** Shown in the skim layer. */
  headline: boolean;
  metric?: { label: string; before?: string; after: string };
  /** The docs/decisions.md entry that records the node: its heading's date and the start of its title. */
  decision: { date: string; title: string };
  /** A dotted path into performance.json whose formatted value the metric's `after` must contain. */
  perf?: { path: string; format: "int" | "ratio" };
  prs: number[];
}
