// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeepContext } from "../components/deepContext";
import { PHASES, REPO_URL, TIMELINE } from "../content/timeline";
import { formatDate } from "../format";
import { BuiltSection } from "./BuiltSection";
import { TimelineList } from "./TimelineList";

afterEach(cleanup);

describe("TimelineList", () => {
  const nodes = TIMELINE.filter((n) => n.id === "milestone-4-1" || n.id === "vector-unit");

  it("renders an ordered list with one item per node, oldest first", () => {
    const { container } = render(<TimelineList nodes={nodes} className="timeline" />);
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll(".t-title")[0]!.textContent).toBe("Efficiency fixes, measured");
  });

  it("shows the date in a time element, the summary and the metric", () => {
    const { container } = render(<TimelineList nodes={nodes} className="timeline" />);
    const first = container.querySelector("li")!;
    const time = first.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-09-25");
    expect(time.textContent).toBe(formatDate("2026-09-25"));
    expect(first.querySelector(".t-summary")!.textContent).toContain("1.45x to 4.05x");
    expect(first.querySelector(".t-metric")!.textContent).toContain("529 cycles");
    expect(first.querySelector(".t-metric")!.textContent).toContain("365 cycles");
  });

  it("omits the metric chip for a node without one", () => {
    const { container } = render(<TimelineList nodes={nodes} className="timeline" />);
    expect(container.querySelectorAll("li")[1]!.querySelector(".t-metric")).toBeNull();
  });

  it("links every PR to the repository", () => {
    const { container } = render(<TimelineList nodes={nodes} className="timeline" />);
    const links = [...container.querySelectorAll("li")[0]!.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([65, 66, 67].map((n) => `${REPO_URL}/pull/${n}`));
    expect(links.every((a) => a.getAttribute("rel")?.includes("noopener"))).toBe(true);
  });
});

describe("BuiltSection", () => {
  it("shows only the headline nodes in the skim list", () => {
    const { container } = render(<BuiltSection />);
    const headline = TIMELINE.filter((n) => n.headline);
    expect(container.querySelectorAll(".timeline-skim li")).toHaveLength(headline.length);
  });

  it("puts every node in the drawer, grouped under the four phase headings", () => {
    const { container } = render(<BuiltSection />);
    expect(container.querySelectorAll(".timeline-all li")).toHaveLength(TIMELINE.length);
    const headings = [...container.querySelectorAll(".phase-heading")].map((h) => h.textContent);
    expect(headings).toEqual([PHASES[1], PHASES[2], PHASES[3], PHASES[4]]);
  });

  it("opens the drawer in Deep mode", () => {
    const { container } = render(
      <DeepContext.Provider value={true}>
        <BuiltSection />
      </DeepContext.Provider>,
    );
    expect(container.querySelector("details")!.open).toBe(true);
  });

  it("has the section's id and a title", () => {
    const { container } = render(<BuiltSection />);
    expect(container.querySelector("section#built h2")!.textContent).toBe("How it was built");
  });
});
