import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findEntry, parseEntries } from "../../scripts/decisions";
import { formatInt, formatRatio } from "../format";
import type { PerformanceData } from "../performance/types";
import { PHASES, TIMELINE } from "./timeline";

const root = join(import.meta.dirname, "..", "..", "..");
const decisions = readFileSync(join(root, "docs", "decisions.md"), "utf8");
const performance = JSON.parse(
  readFileSync(join(root, "web", "src", "data", "generated", "performance.json"), "utf8"),
) as PerformanceData;

// the same parser the generator uses, so the test and decisions.json cannot disagree about what an entry is
const entries = parseEntries(decisions);
const entryFor = (n: { decision: { date: string; title: string } }) => findEntry(entries, n.decision);

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (s: string) => (s.match(NUMBER) ?? []).map((t) => t.replace(/,$/, ""));

function resolve(path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], performance);
}

describe("the timeline", () => {
  it("has about twenty nodes with unique ids", () => {
    expect(TIMELINE.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TIMELINE.map((n) => n.id)).size).toBe(TIMELINE.length);
  });

  it("is oldest first, with ISO dates and phases that never go backwards", () => {
    for (const n of TIMELINE) expect(n.date, n.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (let i = 1; i < TIMELINE.length; i++) {
      expect(TIMELINE[i]!.date >= TIMELINE[i - 1]!.date, `${TIMELINE[i]!.id} after ${TIMELINE[i - 1]!.id}`).toBe(true);
      expect(TIMELINE[i]!.phase >= TIMELINE[i - 1]!.phase, TIMELINE[i]!.id).toBe(true);
    }
  });

  it("cites a decisions.md entry that exists, written on or before the node's date", () => {
    for (const n of TIMELINE) {
      const entry = entryFor(n);
      expect(entry, `${n.id}: no decisions.md heading "${n.decision.date} ... ${n.decision.title}"`).toBeDefined();
      expect(n.date >= n.decision.date, `${n.id}: dated ${n.date}, before its entry ${n.decision.date}`).toBe(true);
    }
  });

  it("only quotes numbers that appear in the cited entry", () => {
    for (const n of TIMELINE) {
      if (!n.metric) continue;
      const text = entryFor(n)!.text;
      for (const value of [n.metric.before, n.metric.after]) {
        if (!value) continue;
        for (const token of numbersIn(value)) {
          expect(text.includes(token), `${n.id}: "${token}" is not in the entry "${n.decision.title}"`).toBe(true);
        }
      }
    }
  });

  it("matches the performance data where a node names a field", () => {
    const withPerf = TIMELINE.filter((n) => n.perf);
    expect(withPerf.length).toBeGreaterThanOrEqual(2);
    for (const n of withPerf) {
      const value = resolve(n.perf!.path);
      expect(typeof value, `${n.id}: ${n.perf!.path}`).toBe("number");
      const formatted = n.perf!.format === "ratio" ? formatRatio(value as number) : formatInt(value as number);
      expect(n.metric!.after, n.id).toContain(formatted);
    }
  });

  it("has a PR list that is positive, ascending and non-empty", () => {
    for (const n of TIMELINE) {
      expect(n.prs.length, n.id).toBeGreaterThan(0);
      for (const pr of n.prs) expect(Number.isInteger(pr) && pr > 0, `${n.id} #${pr}`).toBe(true);
      expect([...n.prs].sort((a, b) => a - b), n.id).toEqual(n.prs);
    }
  });

  it("marks between 7 and 9 headline nodes", () => {
    const count = TIMELINE.filter((n) => n.headline).length;
    expect(count).toBeGreaterThanOrEqual(7);
    expect(count).toBeLessThanOrEqual(9);
  });

  it("names every phase and uses no em dash", () => {
    for (const p of [1, 2, 3, 4] as const) expect(PHASES[p].length).toBeGreaterThan(0);
    for (const n of TIMELINE) {
      expect(`${n.title}${n.summary}${n.metric?.label ?? ""}${n.metric?.before ?? ""}${n.metric?.after ?? ""}`, n.id).not.toMatch(/\u2014/);
    }
  });
});
