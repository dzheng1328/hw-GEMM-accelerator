/** One labeled part of a docs/decisions.md entry: Context, Decision, Result and so on. */
export interface DecisionSection {
  /** the bold keyword that opens the part; null for text before the first label */
  label: string | null;
  /** what follows a dash in the label, for example "tiled GEMM via repeated waves" */
  note?: string;
  /** the part's text, still markdown: paragraphs, tables, lists, inline code, bold and italics */
  body: string;
}

export interface DecisionRecord {
  /** the entry's heading without the leading ###, with a plain dash after the date: "2026-07-05 - Real MNIST on ..." */
  heading: string;
  sections: DecisionSection[];
}

export interface DecisionsFile {
  _generated: { sources: string[]; regenerate: string; note: string };
  /** by timeline node id */
  records: Record<string, DecisionRecord>;
}
