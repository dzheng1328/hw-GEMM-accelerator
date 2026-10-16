/** A command a reader can run. `file` must exist; `make` must name a target the directory's Makefile defines. */
export interface Command {
  text: string;
  file?: string;
  make?: { dir: string; target: string };
}

export interface Rung {
  id: string;
  name: string;
  proves: string;
  files: string[];
  command?: Command;
  /** Whether this rung is bit-exact against the rung above it (ignored for the first rung). */
  bitExact: boolean;
}

export interface Ladder {
  id: "cifar" | "lm";
  title: string;
  rungs: Rung[];
}

export type Layer = "PE and tile" | "NoC and result path" | "Front end" | "Vector unit" | "System";

export interface Check {
  target: string;
  /** must-fail: a negative test that proves a guard fires. must-hold: a positive probe or a variant suite. */
  kind: "must-fail" | "must-hold";
  says: string;
}

export interface Suite {
  /** A testbench directory, or for pytest rows the directory holding the tests. */
  dir: string;
  kind: "cocotb" | "pytest";
  /** The files under test. */
  dut: string[];
  proves: string;
  layer: Layer;
  checks: Check[];
  /** pytest rows: the paths test.sh passes to pytest, relative to the repo root. */
  paths?: string[];
}

export type LimitSource =
  | { decision: { date: string; title: string }; contains: string }
  | { file: string; contains: string };

export interface Limit {
  id: string;
  text: string;
  source: LimitSource;
}
