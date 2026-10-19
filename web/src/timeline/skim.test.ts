import { describe, expect, it } from "vitest";
import type { DecisionSection } from "./decisionTypes";
import { skimSections } from "./skim";

const s = (label: string | null, body = label ?? "preamble"): DecisionSection => ({ label, body });

describe("skimSections", () => {
  it("shows Decision and Result, in the entry's order, and drops the rest", () => {
    const sections = [s("Context"), s("Options considered"), s("Decision"), s("Why"), s("Result")];
    expect(skimSections(sections).map((x) => x.label)).toEqual(["Decision", "Result"]);
  });

  it("shows just Decision when there is no Result, and just Result when there is no Decision", () => {
    expect(skimSections([s("Context"), s("Decision"), s("Why")]).map((x) => x.label)).toEqual(["Decision"]);
    expect(skimSections([s("Context"), s("Result"), s("What still limits the system")]).map((x) => x.label)).toEqual(["Result"]);
  });

  it("falls back to the first section after Context when there is neither", () => {
    expect(skimSections([s("Context"), s("Why it matters"), s("Why")]).map((x) => x.label)).toEqual(["Why it matters"]);
    expect(skimSections([s(null), s("Context"), s("Why")]).map((x) => x.label)).toEqual(["Why"]);
  });

  it("is empty for an entry with nothing but Context, or nothing at all", () => {
    expect(skimSections([s("Context")])).toEqual([]);
    expect(skimSections([])).toEqual([]);
  });

  it("keeps the note of a Decision", () => {
    const decision: DecisionSection = { label: "Decision", note: "tiled GEMM", body: "x" };
    expect(skimSections([s("Context"), decision])).toEqual([decision]);
  });
});
