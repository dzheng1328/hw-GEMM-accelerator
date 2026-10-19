// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHASES, REPO_URL, TIMELINE } from "../content/timeline";
import { formatDate } from "../format";
import type { DecisionRecord } from "./decisionTypes";
import { TimelinePanel, type TimelinePanelProps } from "./TimelinePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

const node = TIMELINE.find((n) => n.id === "milestone-4-1")!;
const RECORD: DecisionRecord = {
  heading: "2026-09-25 - Milestone 4.1 closes: `tb/perf/`",
  sections: [
    { label: "Context", body: "Why we measured." },
    { label: "Options considered", body: "(1) a\n(2) b" },
    { label: "Decision", note: "keep it small", body: "Keep **it** small." },
    { label: "Why", body: "Because." },
    { label: "Result", body: "| A | B |\n|---|---|\n| 1 | 2 |" },
  ],
};

const props = (over: Partial<TimelinePanelProps> = {}): TimelinePanelProps => ({
  node,
  status: "ready",
  record: RECORD,
  deep: false,
  hasPrev: true,
  hasNext: true,
  onStep: () => {},
  ...over,
});

describe("TimelinePanel facts", () => {
  it("shows the date, phase, title, summary, metric and PR links of the milestone", () => {
    const { container } = render(<TimelinePanel {...props()} />);
    expect(container.querySelector("time")!.getAttribute("datetime")).toBe(node.date);
    expect(container.querySelector("time")!.textContent).toBe(formatDate(node.date));
    expect(container.querySelector(".tl-phase")!.textContent).toBe(PHASES[node.phase]);
    expect(container.querySelector(".tl-title")!.textContent).toBe(node.title);
    expect(container.querySelector(".tl-summary")!.textContent).toBe(node.summary);
    expect(container.querySelector(".tl-metric")!.textContent).toContain("529 cycles");
    const links = [...container.querySelectorAll(".tl-prs a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(node.prs.map((n) => `${REPO_URL}/pull/${n}`));
    expect(links.every((a) => a.getAttribute("rel")?.includes("noopener"))).toBe(true);
  });

  it("omits the metric for a milestone without one", () => {
    const plain = TIMELINE.find((n) => !n.metric)!;
    const { container } = render(<TimelinePanel {...props({ node: plain })} />);
    expect(container.querySelector(".tl-metric")).toBeNull();
  });

  it("keeps the facts in one polite live region, and the disclosure and the steps outside it", () => {
    const { container } = render(<TimelinePanel {...props()} />);
    const live = container.querySelector("[aria-live='polite']")!;
    expect(live.querySelector(".tl-title")).not.toBeNull();
    expect(live.contains(container.querySelector("details")!)).toBe(false);
    expect(live.contains(container.querySelector(".tl-steps")!)).toBe(false);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});

describe("TimelinePanel skim layer", () => {
  it("shows Decision with its note and Result, and not Context, Options or Why", () => {
    const { container } = render(<TimelinePanel {...props()} />);
    const skim = container.querySelector("[aria-live='polite']")!;
    const labels = [...skim.querySelectorAll(".tl-skim .tl-label")].map((h) => h.textContent);
    expect(labels).toEqual(["Decision - keep it small", "Result"]);
    expect(skim.querySelector(".tl-skim strong")!.textContent).toBe("it");
    expect(skim.querySelector(".tl-skim table")).not.toBeNull();
    expect(skim.textContent).not.toContain("Why we measured");
  });

  it("shows no Read the full record button while nothing is clipped", () => {
    render(<TimelinePanel {...props()} />);
    expect(screen.queryByRole("button", { name: "Read the full record" })).toBeNull();
  });

  it("clips a long block and offers to read the rest, which opens the disclosure", () => {
    class Resize {
      constructor(private callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Resize);
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 140 });
    const { container } = render(<TimelinePanel {...props()} />);
    expect(container.querySelectorAll(".tl-clip.is-clipped")).toHaveLength(2);
    expect(container.querySelector("details")!.open).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Read the full record" })[0]!);
    expect(container.querySelector("details")!.open).toBe(true);
  });
});

describe("TimelinePanel Read the full record button", () => {
  function clipEverything() {
    class Resize {
      constructor(private callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Resize);
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 140 });
  }

  it("is not offered when the full record is already open, in Deep mode or after the visitor opened it", () => {
    clipEverything();
    const deep = render(<TimelinePanel {...props({ deep: true })} />);
    expect(deep.container.querySelectorAll(".tl-clip.is-clipped")).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: "Read the full record" })).toHaveLength(0);
    deep.unmount();
    render(<TimelinePanel {...props()} />);
    expect(screen.getAllByRole("button", { name: "Read the full record" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Read the full record" })[0]!);
    expect(screen.queryAllByRole("button", { name: "Read the full record" })).toHaveLength(0);
  });
});

describe("TimelinePanel full record", () => {
  it("is closed by default and the visitor can open and close it", () => {
    const { container } = render(<TimelinePanel {...props()} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(false);
  });

  it("is open in Deep mode, in the entry's own order, with its source line", () => {
    const { container } = render(<TimelinePanel {...props({ deep: true })} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(true);
    const labels = [...details.querySelectorAll(".tl-label")].map((h) => h.textContent);
    expect(labels).toEqual(["Context", "Options considered", "Decision - keep it small", "Why", "Result"]);
    expect(details.querySelector(".tl-source code")!.textContent).toBe("tb/perf/");
    expect(details.querySelector(".tl-source a")!.getAttribute("href")).toBe(`${REPO_URL}/blob/main/docs/decisions.md`);
  });
});

describe("TimelinePanel without a record", () => {
  it("says it is loading while the records are on their way, and keeps the facts", () => {
    for (const status of ["idle", "loading"] as const) {
      const { container, unmount } = render(<TimelinePanel {...props({ status, record: undefined })} />);
      expect(container.querySelector(".tl-msg")!.textContent).toContain("Loading the decision record");
      expect(container.querySelector(".tl-title")!.textContent).toBe(node.title);
      expect(container.querySelector("details")).toBeNull();
      unmount();
    }
  });

  it("says it could not be shown, with a link to the entry, after a failure or for a missing record", () => {
    for (const status of ["error", "ready"] as const) {
      const { container, unmount } = render(<TimelinePanel {...props({ status, record: undefined })} />);
      expect(container.querySelector(".tl-msg")!.textContent).toContain("could not be shown here");
      expect(container.querySelector(".tl-msg a")!.getAttribute("href")).toBe(`${REPO_URL}/blob/main/docs/decisions.md`);
      unmount();
    }
  });
});

describe("TimelinePanel steps", () => {
  it("calls onStep with -1 and 1", () => {
    const onStep = vi.fn();
    render(<TimelinePanel {...props({ onStep })} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous milestone" }));
    fireEvent.click(screen.getByRole("button", { name: "Next milestone" }));
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
  });

  it("disables a step that has nowhere to go", () => {
    render(<TimelinePanel {...props({ hasPrev: false, hasNext: false })} />);
    expect((screen.getByRole("button", { name: "Previous milestone" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next milestone" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
