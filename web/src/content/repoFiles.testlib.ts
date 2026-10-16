// Test-only helpers: they read the repository from disk, so no component may import this file.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

export const exists = (rel: string): boolean => existsSync(join(REPO_ROOT, rel));
export const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

export interface DecisionEntry {
  date: string;
  title: string;
  text: string;
}

// A heading looks like "### 2026-09-24 -- Title", or with an em dash in the older entries.
const HEADING = /^### (\d{4}-\d{2}-\d{2}) (?:\u2014|--) (.*)$/;

export function decisionEntries(): DecisionEntry[] {
  return read("docs/decisions.md")
    .split("\n### ")
    .slice(1)
    .map((chunk) => {
      const [head = "", ...rest] = chunk.split("\n");
      const match = HEADING.exec(`### ${head}`);
      return { date: match?.[1] ?? "", title: match?.[2] ?? "", text: rest.join("\n") };
    });
}

export function findDecision(ref: { date: string; title: string }): DecisionEntry | undefined {
  return decisionEntries().find((entry) => entry.date === ref.date && entry.title.startsWith(ref.title));
}

/** The names of the targets a Makefile defines (`name:` at the start of a line). */
export function makeTargets(makefile: string): Set<string> {
  return new Set([...makefile.matchAll(/^([A-Za-z0-9_-]+):(?!=)/gm)].map((m) => m[1]!));
}

/**
 * The make targets test.sh runs, keyed by the directory it `cd`s into, e.g. "tb/vpu" -> {"fault-check", ...}.
 * Variable assignments such as MESH_W=4 and quoted arguments such as "$@" are not targets.
 */
export function testShCommands(testSh: string): Map<string, Set<string>> {
  const byDir = new Map<string, Set<string>>();
  let dir: string | undefined;
  for (const line of testSh.split("\n")) {
    const cd = /^cd "\$REPO_ROOT\/(.+)"$/.exec(line);
    if (cd) {
      dir = cd[1]!;
      if (!byDir.has(dir)) byDir.set(dir, new Set());
      continue;
    }
    if (dir && line.startsWith("make ")) {
      for (const token of line.split(/\s+/).slice(1)) {
        if (token.includes("=") || token.startsWith('"')) continue;
        byDir.get(dir)!.add(token);
      }
    }
  }
  return byDir;
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
export const numbersIn = (text: string): string[] => (text.match(NUMBER) ?? []).map((t) => t.replace(/,$/, ""));
