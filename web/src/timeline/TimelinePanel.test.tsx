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

describe("TimelinePanel full record state", () => {
  const other = TIMELINE.find((n) => n.id !== node.id)!;
  const summaryOf = (container: HTMLElement) => container.querySelector("details > summary")!;
  const detailsOf = (container: HTMLElement) => container.querySelector("details")!;

  it("closes again when another milestone is chosen, so stepping never changes the panel height", () => {
    const { container, rerender } = render(<TimelinePanel {...props()} />);
    fireEvent.click(summaryOf(container));
    expect(detailsOf(container).open).toBe(true);
    rerender(<TimelinePanel {...props({ node: other })} />);
    expect(detailsOf(container).open).toBe(false);
  });

  it("can be closed in Deep mode, where it starts open, and starts open again when Deep mode comes back", () => {
    const { container, rerender } = render(<TimelinePanel {...props({ deep: true })} />);
    expect(detailsOf(container).open).toBe(true);
    fireEvent.click(summaryOf(container));
    expect(detailsOf(container).open).toBe(false);
    fireEvent.click(summaryOf(container));
    expect(detailsOf(container).open).toBe(true);
    fireEvent.click(summaryOf(container));
    rerender(<TimelinePanel {...props({ deep: false })} />);
    expect(detailsOf(container).open).toBe(false);
    rerender(<TimelinePanel {...props({ deep: true })} />);
    expect(detailsOf(container).open).toBe(true);
  });

  it("follows the browser when it opens the element itself, as find-in-page does, so the next click closes it", () => {
    const { container } = render(<TimelinePanel {...props()} />);
    const details = detailsOf(container);
    details.open = true;
    fireEvent(details, new Event("toggle"));
    fireEvent.click(summaryOf(container));
    expect(details.open).toBe(false);
  });

  it("stops offering to read on once the browser has opened the record", () => {
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
    expect(screen.getAllByRole("button", { name: "Read the full record" })).toHaveLength(2);
    const details = detailsOf(container);
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(screen.queryAllByRole("button", { name: "Read the full record" })).toHaveLength(0);
  });
});

describe("TimelinePanel without a record", () => {
  const ENTRIES = `${REPO_URL}/blob/main/docs/decisions.md`;

  it("says it is loading while the records are on their way, keeps the facts, and already links to the file", () => {
    for (const status of ["idle", "loading"] as const) {
      const { container, unmount } = render(<TimelinePanel {...props({ status, record: undefined })} />);
      expect(container.querySelector(".tl-msg")!.textContent).toContain("Loading the decision record");
      expect(container.querySelector(".tl-title")!.textContent).toBe(node.title);
      expect(container.querySelector("details")).toBeNull();
      // a fetch that stalls never turns into the failure line, so the way out is there from the start
      expect(container.querySelector(".tl-msg a")!.getAttribute("href")).toBe(ENTRIES);
      unmount();
    }
  });

  it("says it could not be shown, with a link to the file, after a failure or for a missing record", () => {
    for (const status of ["error", "ready"] as const) {
      const { container, unmount } = render(<TimelinePanel {...props({ status, record: undefined })} />);
      expect(container.querySelector(".tl-msg")!.textContent).toContain("could not be shown here");
      expect(container.querySelector(".tl-msg a")!.getAttribute("href")).toBe(ENTRIES);
      unmount();
    }
  });

  it("names the entry by its date and does not claim the link opens that entry", () => {
    for (const status of ["loading", "error"] as const) {
      const { container, unmount } = render(<TimelinePanel {...props({ status, record: undefined })} />);
      const message = container.querySelector(".tl-msg")!.textContent!;
      expect(message).toContain(node.decision.date);
      expect(message).not.toContain("Read the entry");
      expect(container.querySelector(".tl-msg a")!.textContent).toBe("docs/decisions.md on GitHub");
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
