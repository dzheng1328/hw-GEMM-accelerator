import { describe, expect, it } from "vitest";
import { edges, boxesOverlap, insideViewBox } from "../architecture/layout";
import { KINDS } from "../architecture/types";
import { formatInt, formatPercent } from "../format";
import { performance } from "../performance/data";
import { BLOCKS, DEFAULT_BLOCK, STAGES, VIEWBOX, VOP_NOTE } from "./architecture";
import { exists, findDecision, makeTargets, numbersIn, read, testShCommands } from "./repoFiles.testlib";

const ids = BLOCKS.map((b) => b.id);
const shCommands = testShCommands(read("test.sh"));

function perfValue(path: string): number {
  const value = path.split(".").reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], performance);
  if (typeof value !== "number") throw new Error(`performance.json has no number at "${path}"`);
  return value;
}

describe("the architecture blocks", () => {
  it("has twelve blocks with unique ids, valid kinds and short labels", () => {
    expect(BLOCKS.length).toBe(12);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BLOCKS) {
      expect(KINDS, b.id).toContain(b.kind);
      expect(b.label.length, `${b.id}: label "${b.label}"`).toBeLessThanOrEqual(16);
      expect(b.role.length, b.id).toBeGreaterThan(20);
    }
    expect(DEFAULT_BLOCK).toBe("corner");
    expect(ids).toContain(DEFAULT_BLOCK);
  });

  it("cites RTL files that exist", () => {
    for (const b of BLOCKS) {
      expect(b.rtl.length, `${b.id} cites no RTL`).toBeGreaterThan(0);
      for (const path of b.rtl) expect(exists(path), `${b.id}: ${path} does not exist`).toBe(true);
    }
  });

  it("cites testbench directories whose Makefile defines every named target, and test.sh runs it", () => {
    for (const b of BLOCKS) {
      expect(b.suites.length, `${b.id} cites no suite`).toBeGreaterThan(0);
      for (const suite of b.suites) {
        expect(exists(`${suite.dir}/Makefile`), `${b.id}: ${suite.dir}/Makefile does not exist`).toBe(true);
        const defined = makeTargets(read(`${suite.dir}/Makefile`));
        const run = shCommands.get(suite.dir);
        expect(run, `${b.id}: test.sh never enters ${suite.dir}`).toBeDefined();
        for (const target of suite.targets) {
          expect(defined.has(target), `${b.id}: ${suite.dir}/Makefile has no target "${target}"`).toBe(true);
          expect(run!.has(target), `${b.id}: test.sh does not run "make ${target}" in ${suite.dir}`).toBe(true);
        }
      }
    }
  });

  it("quotes numbers that match the generated data or the cited decisions entry", () => {
    for (const b of BLOCKS) {
      const { value, source } = b.number;
      expect(value.length, b.id).toBeGreaterThan(0);
      if ("perf" in source) {
        const formatted = source.format === "int" ? formatInt(perfValue(source.perf)) : formatPercent(perfValue(source.perf), 1);
        expect(value, `${b.id}: "${value}" does not contain ${source.perf} = ${formatted}`).toContain(formatted);
      } else {
        const entry = findDecision(source.decision);
        expect(entry, `${b.id}: no decisions.md heading "${source.decision.date} ... ${source.decision.title}"`).toBeDefined();
        expect(entry!.text.includes(source.contains), `${b.id}: "${source.contains}" is not in the entry "${source.decision.title}"`).toBe(true);
        for (const token of numbersIn(value)) {
          expect(entry!.text.includes(token), `${b.id}: "${token}" of "${value}" is not in the entry`).toBe(true);
        }
      }
    }
  });

  it("labels the numbers by what their source measures, not by a nearby idea", () => {
    const label = (id: string) => BLOCKS.find((b) => b.id === id)!.number.label;
    // decisions 2026-09-29: the "Other" category fell from 3.04 to 0.045 cycles per BLOCK; what remains is per layer, not a refill gap.
    expect(label("dma_gather")).toContain("Other cycles per BLOCK");
    // decisions 2026-09-08: the area is a synthesis estimate plus the macro's LEF area, not a place-and-route result.
    expect(label("gemm_tile")).toContain("synthesis");
  });

  it("links only to blocks that exist, and never to itself", () => {
    for (const b of BLOCKS) {
      for (const to of b.links) {
        expect(ids, `${b.id} links to "${to}"`).toContain(to);
        expect(to, `${b.id} links to itself`).not.toBe(b.id);
      }
    }
    expect(edges(BLOCKS).length).toBeGreaterThanOrEqual(11);
  });

  it("keeps every box inside the viewBox and no two boxes overlapping", () => {
    for (const b of BLOCKS) expect(insideViewBox(b.box, VIEWBOX), `${b.id} leaves the viewBox`).toBe(true);
    for (let i = 0; i < BLOCKS.length; i++) {
      for (let j = i + 1; j < BLOCKS.length; j++) {
        expect(boxesOverlap(BLOCKS[i]!.box, BLOCKS[j]!.box), `${BLOCKS[i]!.id} overlaps ${BLOCKS[j]!.id}`).toBe(false);
      }
    }
  });

  it("uses no em dash", () => {
    for (const b of BLOCKS) {
      expect(`${b.name}${b.role}${b.number.label}${b.number.value}`, b.id).not.toMatch(/\u2014/);
    }
    expect(VOP_NOTE).not.toMatch(/\u2014/);
  });
});

describe("the BLOCK walk", () => {
  it("has eight stages that each name a different block, from the command processor to write-back", () => {
    expect(STAGES.length).toBe(8);
    expect(new Set(STAGES.map((s) => s.block)).size).toBe(STAGES.length);
    for (const s of STAGES) {
      expect(ids, `stage "${s.title}"`).toContain(s.block);
      expect(s.text.length, s.title).toBeGreaterThan(20);
    }
    expect(STAGES[0]!.block).toBe("cmd_seq");
    expect(STAGES[STAGES.length - 1]!.block).toBe("writeback");
  });

  it("explains the vector-unit branch", () => {
    expect(VOP_NOTE).toContain("vector unit");
  });
});
