// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import steps from "../data/generated/lm-steps.json";
import { formatInt } from "../format";

vi.mock("../replay/loadReplayData", () => ({ loadLmSteps: () => Promise.resolve(steps.steps) }));

import { StrokeRibbon } from "./StrokeRibbon";
import { total } from "./ribbonGeometry";

afterEach(cleanup);

describe("StrokeRibbon", () => {
  it("reserves its height before the data arrives, so nothing below it moves", () => {
    const { container } = render(<StrokeRibbon />);
    expect(container.querySelector(".ribbon-frame")).not.toBeNull();
  });

  it("says what it is loading, in words the replay's own loading line does not use (a page-level text lookup finds one)", () => {
    const { container } = render(<StrokeRibbon />);
    expect(container.textContent).toContain("Loading the per-step numbers...");
    expect(container.textContent).not.toContain("Loading the recorded run...");
  });

  it("makes the plot's frame a named, focusable region, because on a phone the plot scrolls sideways inside it", () => {
    const { container } = render(<StrokeRibbon />);
    const frame = container.querySelector(".ribbon-frame")!;
    expect(frame.getAttribute("role")).toBe("region");
    expect(frame.getAttribute("aria-label")).toMatch(/chart/i);
    expect(frame.getAttribute("tabindex")).toBe("0");
  });

  it("draws 256 strokes of four segments from the committed data", async () => {
    const { container } = render(<StrokeRibbon />);
    await waitFor(() => expect(container.querySelectorAll("svg rect.seg")).toHaveLength(256 * 4));
  });

  it("states the first and last totals and the attention growth, taken from the data", async () => {
    const { container } = render(<StrokeRibbon />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const first = total(steps.steps[0]!);
    const last = total(steps.steps[255]!);
    expect(container.textContent).toContain(formatInt(first));
    expect(container.textContent).toContain(formatInt(last));
    const ratio = Math.round(steps.steps[255]!.attention / steps.steps[0]!.attention);
    expect(container.textContent).toContain(`${ratio}x`);
  });

  it("is a named image with a text summary, not counters in a label", async () => {
    const { container } = render(<StrokeRibbon />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/cycles per step/i);
    expect(svg.getAttribute("aria-label")).not.toMatch(/\d{3}/);
  });

  it("offers the numbers as a table of nine steps, first and last included", async () => {
    const { container } = render(<StrokeRibbon />);
    await waitFor(() => expect(container.querySelector("details table")).not.toBeNull());
    const rows = container.querySelectorAll("details tbody tr");
    expect(rows).toHaveLength(9);
    expect(rows[0]!.textContent).toContain("0");
    expect(rows[8]!.textContent).toContain("255");
    expect(rows[8]!.textContent).toContain(formatInt(total(steps.steps[255]!)));
  });

  it("tags each caption with the figure it belongs to, so a figure may touch only its own caption", async () => {
    const { container } = render(<StrokeRibbon />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    for (const pair of ["first", "last"]) expect(container.querySelectorAll(`svg text[data-pair="${pair}"]`)).toHaveLength(2);
  });
});

// read at run time, not imported: the trace holds the whole attention record and would slow the type check
const recorded = (
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "perf", "lm_trace.json"), "utf8")) as {
    steps: { cycles: number; categories: Record<string, number> }[];
  }
).steps;

describe("StrokeRibbon data", () => {
  it("draws the same first and last step totals as the recorded RTL trace", async () => {
    expect(recorded).toHaveLength(256);
    const { container } = render(<StrokeRibbon />);
    await waitFor(() => expect(container.querySelector('svg text[data-pair="last"]')).not.toBeNull());
    const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);
    // the four categories add up to the step's cycles, and those are the numbers on the chart
    expect(sum(recorded[0]!.categories)).toBe(recorded[0]!.cycles);
    expect(container.querySelector('svg text[data-pair="first"]')!.textContent).toBe(formatInt(recorded[0]!.cycles));
    expect(container.querySelectorAll('svg text[data-pair="last"]')[0]!.textContent).toBe(formatInt(recorded[255]!.cycles));
  });
});
