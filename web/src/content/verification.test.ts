import { describe, expect, it } from "vitest";
import { performance } from "../performance/data";
import summary from "../data/generated/summary.json";
import { ladderEvidence } from "../verification/evidence";
import { CLAIM, LADDERS, LAYERS, LIMITS, REPRODUCE, SUITES } from "./verification";
import { exists, findDecision, makeTargets, read, testShCommands } from "./repoFiles.testlib";

const testSh = read("test.sh");
const shCommands = testShCommands(testSh);

describe("the ladders", () => {
  it("has the CIFAR-10 ladder with three rungs and the story-model ladder with four", () => {
    expect(LADDERS.map((l) => [l.id, l.rungs.length])).toEqual([
      ["cifar", 3],
      ["lm", 4],
    ]);
    for (const l of LADDERS) expect(new Set(l.rungs.map((r) => r.id)).size, l.id).toBe(l.rungs.length);
  });

  it("cites files that exist, and commands that name a real file or make target", () => {
    for (const l of LADDERS) {
      for (const r of l.rungs) {
        expect(r.files.length, `${r.id} cites no file`).toBeGreaterThan(0);
        for (const f of r.files) expect(exists(f), `${r.id}: ${f} does not exist`).toBe(true);
        if (r.command?.file) expect(exists(r.command.file), `${r.id}: ${r.command.file} does not exist`).toBe(true);
        if (r.command?.make) {
          const { dir, target } = r.command.make;
          expect(makeTargets(read(`${dir}/Makefile`)).has(target), `${r.id}: ${dir}/Makefile has no target "${target}"`).toBe(true);
        }
      }
    }
  });

  it("ends each ladder on the RTL and makes the claim about make lm a real target", () => {
    for (const l of LADDERS) expect(l.rungs[l.rungs.length - 1]!.files.some((f) => f.startsWith("rtl/")), l.id).toBe(true);
    expect(makeTargets(read(`${CLAIM.make.dir}/Makefile`)).has(CLAIM.make.target)).toBe(true);
    expect(CLAIM.make.target).toBe("lm");
  });

  it("only calls a rung bit-exact where the spec does: every rung but the float model's step to the reference", () => {
    const lm = LADDERS.find((l) => l.id === "lm")!;
    expect(lm.rungs.map((r) => r.bitExact)).toEqual([false, false, true, true]);
    const cifar = LADDERS.find((l) => l.id === "cifar")!;
    expect(cifar.rungs.slice(1).every((r) => r.bitExact)).toBe(true);
  });
});

describe("the ladder evidence", () => {
  it("states the numbers of the generated data", () => {
    expect(ladderEvidence("cifar")).toContain(`${performance.cifar.images} test images`);
    expect(performance.cifar.images).toBe(128);
    expect(ladderEvidence("lm")).toContain(`${summary.lm.stories} stories of ${summary.lm.steps} tokens`);
    expect(`${summary.lm.stories} x ${summary.lm.steps}`).toBe("8 x 256");
  });

  it("covers temperature 0 and 1.0, which are the two 2x2 runs in lm.json", () => {
    const runs = JSON.parse(read("docs/perf/lm.json")).runs as Record<string, { inv_temp: number }>;
    expect(runs["2x2_t0"]!.inv_temp).toBe(0);
    expect(runs["2x2_t256"]!.inv_temp).toBe(256);
    expect(ladderEvidence("lm")).toContain("temperature 0 and 1.0");
  });
});

describe("the suites", () => {
  it("has a row for every directory test.sh runs, and nothing else", () => {
    const cocotb = SUITES.filter((s) => s.kind === "cocotb").map((s) => s.dir).sort();
    expect(cocotb).toEqual([...shCommands.keys()].sort());
    expect(SUITES.length).toBeGreaterThanOrEqual(19);
    expect(new Set(SUITES.map((s) => s.dir)).size).toBe(SUITES.length);
    for (const s of SUITES) expect(LAYERS, s.dir).toContain(s.layer);
  });

  it("cites files that exist, and cocotb rows whose Makefile exists", () => {
    for (const s of SUITES) {
      expect(s.dut.length, `${s.dir} names no file under test`).toBeGreaterThan(0);
      for (const f of s.dut) expect(exists(f), `${s.dir}: ${f} does not exist`).toBe(true);
      if (s.kind === "cocotb") expect(exists(`${s.dir}/Makefile`), `${s.dir}/Makefile does not exist`).toBe(true);
    }
  });

  it("lists pytest rows only for paths test.sh passes to pytest", () => {
    for (const s of SUITES.filter((x) => x.kind === "pytest")) {
      expect(s.paths?.length, `${s.dir} lists no pytest path`).toBeGreaterThan(0);
      for (const p of s.paths!) {
        expect(exists(p), `${s.dir}: ${p} does not exist`).toBe(true);
        expect(testSh.includes(`$REPO_ROOT/${p}`), `test.sh does not run pytest on ${p}`).toBe(true);
      }
    }
  });

  it("lists only checks the Makefile defines and test.sh runs", () => {
    for (const s of SUITES.filter((x) => x.kind === "cocotb")) {
      const defined = makeTargets(read(`${s.dir}/Makefile`));
      for (const c of s.checks) {
        expect(defined.has(c.target), `${s.dir}/Makefile has no target "${c.target}"`).toBe(true);
        expect(shCommands.get(s.dir)!.has(c.target), `test.sh does not run "make ${c.target}" in ${s.dir}`).toBe(true);
      }
    }
  });

  it("lists every *-check and q16 target test.sh runs, so a new check cannot go missing from the page", () => {
    for (const [dir, targets] of shCommands) {
      const listed = new Set(SUITES.find((s) => s.dir === dir)?.checks.map((c) => c.target));
      for (const target of targets) {
        if (/-check$/.test(target) || target === "q16") {
          expect(listed.has(target), `test.sh runs "make ${target}" in ${dir}, but the suites table does not list it`).toBe(true);
        }
      }
    }
  });

  it("marks the two positive probes as must-hold and every other check as must-fail", () => {
    const hold = SUITES.flatMap((s) => s.checks.filter((c) => c.kind === "must-hold").map((c) => `${s.dir}:${c.target}`));
    expect(hold.sort()).toEqual(["tb/accel:reset-check", "tb/requant:q16"]);
    expect(SUITES.flatMap((s) => s.checks).filter((c) => c.kind === "must-fail").length).toBe(9);
  });
});

describe("the limits", () => {
  it("has six limits, each backed by text in its cited decisions entry or file", () => {
    expect(LIMITS.length).toBe(6);
    expect(new Set(LIMITS.map((l) => l.id)).size).toBe(6);
    for (const l of LIMITS) {
      if ("decision" in l.source) {
        const entry = findDecision(l.source.decision);
        expect(entry, `${l.id}: no decisions.md heading "${l.source.decision.date} ... ${l.source.decision.title}"`).toBeDefined();
        expect(entry!.text.includes(l.source.contains), `${l.id}: "${l.source.contains}" is not in the entry`).toBe(true);
      } else {
        expect(exists(l.source.file), `${l.id}: ${l.source.file} does not exist`).toBe(true);
        expect(read(l.source.file).includes(l.source.contains), `${l.id}: "${l.source.contains}" is not in ${l.source.file}`).toBe(true);
      }
    }
  });

  it("keeps the hedge about the story model's cause", () => {
    const hedge = LIMITS.find((l) => l.id === "cause-hedged")!;
    expect(hedge.text).toContain("do not prove a single cause");
    expect(hedge.text).not.toMatch(/because the serial VPU/i);
  });
});

describe("the reproduce lines", () => {
  it("name files and make targets that exist", () => {
    expect(REPRODUCE.length).toBeGreaterThanOrEqual(4);
    for (const r of REPRODUCE) {
      if (r.command.file) expect(exists(r.command.file), r.command.text).toBe(true);
      if (r.command.make) {
        expect(makeTargets(read(`${r.command.make.dir}/Makefile`)).has(r.command.make.target), r.command.text).toBe(true);
      }
    }
  });
});

describe("the text", () => {
  it("uses no em dash", () => {
    const text = JSON.stringify([LADDERS, SUITES, LIMITS, REPRODUCE, CLAIM]);
    expect(text).not.toMatch(/\u2014/);
  });
});
