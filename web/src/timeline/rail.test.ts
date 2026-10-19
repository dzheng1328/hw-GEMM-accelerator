import { describe, expect, it } from "vitest";
import { TIMELINE } from "../content/timeline";
import { defaultNodeId, keyTarget, phaseBands, railDate, railNodes, resolveSelected, stepTarget } from "./rail";
import type { TimelineNode } from "./types";

const node = (id: string, phase: 1 | 2 | 3 | 4, headline: boolean): TimelineNode => ({
  id,
  date: "2026-07-19",
  phase,
  title: id,
  summary: "",
  headline,
  decision: { date: "2026-07-19", title: id },
  prs: [1],
});

const ALL = [node("a", 1, true), node("b", 2, false), node("c", 2, false), node("d", 3, true), node("e", 4, false), node("f", 4, true)];

describe("railNodes", () => {
  it("shows only the headline nodes until asked for all", () => {
    expect(railNodes(ALL, false).map((n) => n.id)).toEqual(["a", "d", "f"]);
    expect(railNodes(ALL, true)).toEqual(ALL);
  });

  it("shows 9 of the real 22", () => {
    expect(railNodes(TIMELINE, false)).toHaveLength(9);
    expect(railNodes(TIMELINE, true)).toHaveLength(22);
  });
});

describe("phaseBands", () => {
  it("groups consecutive nodes by phase with 1-based starting columns", () => {
    expect(phaseBands(ALL)).toEqual([
      { phase: 1, start: 1, count: 1 },
      { phase: 2, start: 2, count: 2 },
      { phase: 3, start: 4, count: 1 },
      { phase: 4, start: 5, count: 2 },
    ]);
  });

  it("has no band for a phase with no visible node", () => {
    expect(phaseBands(railNodes(ALL, false)).map((b) => b.phase)).toEqual([1, 3, 4]);
  });

  it("is empty for no nodes", () => {
    expect(phaseBands([])).toEqual([]);
  });
});

describe("keyTarget and stepTarget", () => {
  it("moves one step with the arrows and stops at the ends", () => {
    expect(keyTarget(ALL, "c", "ArrowLeft")).toBe("b");
    expect(keyTarget(ALL, "c", "ArrowRight")).toBe("d");
    expect(keyTarget(ALL, "a", "ArrowLeft")).toBe("a");
    expect(keyTarget(ALL, "f", "ArrowRight")).toBe("f");
  });

  it("jumps to the first and last with Home and End", () => {
    expect(keyTarget(ALL, "c", "Home")).toBe("a");
    expect(keyTarget(ALL, "c", "End")).toBe("f");
  });

  it("steps by one and reports the ends as null", () => {
    expect(stepTarget(ALL, "c", -1)).toBe("b");
    expect(stepTarget(ALL, "c", 1)).toBe("d");
    expect(stepTarget(ALL, "a", -1)).toBeNull();
    expect(stepTarget(ALL, "f", 1)).toBeNull();
  });
});

describe("resolveSelected", () => {
  const visible = railNodes(ALL, false);

  it("keeps a visible selection", () => {
    expect(resolveSelected(visible, ALL, "d")).toBe("d");
  });

  it("falls back to the nearest earlier visible node when the selection is hidden", () => {
    expect(resolveSelected(visible, ALL, "c")).toBe("a");
    expect(resolveSelected(visible, ALL, "e")).toBe("d");
  });

  it("falls back to the first visible node for an unknown id or nothing earlier", () => {
    expect(resolveSelected(visible, ALL, "zzz")).toBe("a");
    expect(resolveSelected(railNodes([node("x", 1, false), node("y", 2, true)], false), [node("x", 1, false), node("y", 2, true)], "x")).toBe("y");
  });
});

describe("defaultNodeId", () => {
  it("is the last headline node, which is the story model on the chip for the real timeline", () => {
    expect(defaultNodeId(ALL)).toBe("f");
    expect(defaultNodeId(TIMELINE)).toBe("stories-on-chip");
  });
});

describe("railDate", () => {
  it("writes a short month and day, in UTC", () => {
    expect(railDate("2026-07-19")).toBe("Jul 19");
    expect(railDate("2026-10-01")).toBe("Oct 1");
  });
});
