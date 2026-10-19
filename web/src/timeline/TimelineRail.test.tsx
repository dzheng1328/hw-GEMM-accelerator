// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMELINE } from "../content/timeline";
import { formatDate } from "../format";
import { railNodes } from "./rail";
import { TimelineRail } from "./TimelineRail";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HEADLINE = railNodes(TIMELINE, false);

function Harness({ all = false }: { all?: boolean }) {
  const nodes = railNodes(TIMELINE, all);
  const [id, setId] = useState(nodes[nodes.length - 1]!.id);
  return <TimelineRail nodes={nodes} selectedId={id} onSelect={setId} total={TIMELINE.length} onShowAll={all ? undefined : () => {}} />;
}

const dots = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>("button[data-node]")];

describe("TimelineRail", () => {
  it("is a labeled group with one button per visible milestone, named by date and title", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector(".rail")!.getAttribute("aria-label")).toBe("Milestones");
    expect(dots(container)).toHaveLength(HEADLINE.length);
    const first = HEADLINE[0]!;
    expect(screen.getByRole("button", { name: `${formatDate(first.date)}: ${first.title}` })).toBeTruthy();
  });

  it("marks exactly the selected milestone as pressed, and makes only it a Tab stop", () => {
    const { container } = render(<Harness />);
    const pressed = dots(container).filter((d) => d.getAttribute("aria-pressed") === "true");
    expect(pressed.map((d) => d.dataset.node)).toEqual([HEADLINE[HEADLINE.length - 1]!.id]);
    expect(dots(container).filter((d) => d.tabIndex === 0)).toHaveLength(1);
    expect(pressed[0]!.tabIndex).toBe(0);
  });

  it("selects a milestone when its button is clicked", () => {
    const { container } = render(<Harness />);
    fireEvent.click(dots(container)[0]!);
    expect(dots(container)[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(dots(container)[8]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("moves the selection and the focus with the arrow, Home and End keys", () => {
    const { container } = render(<Harness />);
    const list = container.querySelector("ol.rail-dots")!;
    dots(container)[8]!.focus();
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(dots(container)[7]!.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(dots(container)[7]);
    fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(dots(container)[0]);
    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(dots(container)[8]);
  });

  it("ignores other keys", () => {
    const { container } = render(<Harness />);
    fireEvent.keyDown(container.querySelector("ol.rail-dots")!, { key: "a" });
    expect(dots(container)[8]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("draws one band per phase that has a visible milestone, four for the real timeline in either layer", () => {
    const { container } = render(<Harness />);
    expect([...container.querySelectorAll(".rail-band")].map((b) => b.textContent)).toEqual(["Phase 1", "Phase 2", "Phase 3", "Phase 4"]);
    cleanup();
    const all = render(<Harness all />);
    expect([...all.container.querySelectorAll(".rail-band")].map((b) => b.textContent)).toEqual(["Phase 1", "Phase 2", "Phase 3", "Phase 4"]);
  });

  it("marks the milestones only the full set shows as minor", () => {
    const { container } = render(<Harness all />);
    const minor = dots(container).filter((d) => d.classList.contains("is-minor"));
    expect(minor).toHaveLength(13);
  });

  it("offers Show all with the total while some are hidden, and not once everything is shown", () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole("button", { name: "Show all 22" })).toBeTruthy();
    expect(container.querySelector(".rail-foot")!.textContent).toContain("9 of 22 milestones");
    cleanup();
    render(<Harness all />);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("calls onShowAll from the chip", () => {
    const onShowAll = vi.fn();
    render(<TimelineRail nodes={HEADLINE} selectedId={HEADLINE[0]!.id} onSelect={() => {}} total={22} onShowAll={onShowAll} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 22" }));
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("keeps the selected dot in view by scrolling the rail and never the page", () => {
    const railScroll = vi.fn();
    const pageScroll = vi.fn();
    Element.prototype.scrollTo = railScroll as never;
    window.scrollTo = pageScroll as never;
    Element.prototype.scrollIntoView = pageScroll as never;
    const { container } = render(<Harness />);
    fireEvent.click(dots(container)[2]!);
    expect(railScroll).toHaveBeenCalled();
    expect(pageScroll).not.toHaveBeenCalled();
  });
});
