export type BlockKind = "control" | "movement" | "compute" | "memory";

export const KINDS: BlockKind[] = ["control", "movement", "compute", "memory"];

export const KIND_LABEL: Record<BlockKind, string> = {
  control: "control",
  movement: "data movement",
  compute: "compute",
  memory: "memory",
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a block's number comes from: a field of performance.json, or a decisions entry that must contain the text. */
export type NumberSource =
  | { perf: string; format: "int" | "percent1" }
  | { decision: { date: string; title: string }; contains: string };

export interface BlockNumber {
  label: string;
  /** What the page shows. A perf number must contain the formatted field; a decision number's digits must appear in the entry. */
  value: string;
  source: NumberSource;
}

/** A testbench directory and the make targets in it that cover the block. */
export interface SuiteRef {
  dir: string;
  targets: string[];
}

export interface Block {
  id: string;
  /** Short name drawn inside the box. */
  label: string;
  /** Full name, the panel's heading. */
  name: string;
  kind: BlockKind;
  /** One or two sentences. */
  role: string;
  /** Repo-relative paths. */
  rtl: string[];
  suites: SuiteRef[];
  number: BlockNumber;
  /** Ids of the blocks this one connects to; the other end need not repeat the link. */
  links: string[];
  box: Box;
}

/** One stage of the "follow one BLOCK" walk. */
export interface Stage {
  block: string;
  title: string;
  text: string;
}
