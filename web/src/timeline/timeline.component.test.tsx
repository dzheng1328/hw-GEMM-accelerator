// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeepContext } from "../components/deepContext";
import { TIMELINE } from "../content/timeline";
import decisions from "../data/generated/decisions.json";
import { BuiltSection } from "./BuiltSection";
import type { DecisionsFile } from "./decisionTypes";

afterEach(cleanup);

const FILE = decisions as unknown as DecisionsFile;
const load = async () => FILE;
const HEADLINE = TIMELINE.filter((n) => n.headline);
const dots = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>("button[data-node]")];
const selectedId = (container: HTMLElement) => dots(container).find((d) => d.getAttribute("aria-pressed") === "true")?.dataset.node;
const title = (container: HTMLElement) => container.querySelector(".tl-title")!.textContent;

async function renderBuilt(deep = false) {
  const view = render(
    <DeepContext.Provider value={deep}>
      <BuiltSection loadData={load} />
    </DeepContext.Provider>,
  );
  await screen.findByText(/^Decision/, { selector: ".tl-skim .tl-label" });
  return view;
}

describe("BuiltSection", () => {
  it("has the section's id and title, and no drawer", async () => {
    const { container } = await renderBuilt();
    expect(container.querySelector("section#built h2")!.textContent).toBe("How it was built");
    expect(container.querySelector("section#built > .band-inner > details")).toBeNull();
  });

  it("opens on the last headline milestone with only the headline milestones on the rail", async () => {
    const { container } = await renderBuilt();
    expect(dots(container)).toHaveLength(HEADLINE.length);
    expect(selectedId(container)).toBe(HEADLINE[HEADLINE.length - 1]!.id);
    expect(title(container)).toBe(HEADLINE[HEADLINE.length - 1]!.title);
  });

  it("shows the milestone's decision record in the panel once it has loaded", async () => {
    const { container } = await renderBuilt();
    expect(container.querySelector(".tl-skim")!.textContent).toContain("Decision");
    expect(container.querySelector("details.tl-record")).not.toBeNull();
  });

  it("shows the facts and a loading line before the records arrive", () => {
    const { container } = render(<BuiltSection loadData={() => new Promise(() => {})} />);
    expect(container.querySelector(".tl-msg")!.textContent).toContain("Loading the decision record");
    expect(title(container)).toBe(HEADLINE[HEADLINE.length - 1]!.title);
  });

  it("shows the failure line and keeps the facts when the records cannot be loaded", async () => {
    const { container } = render(
      <BuiltSection
        loadData={async () => {
          throw new Error("blocked");
        }}
      />,
    );
    await screen.findByText(/could not be shown here/);
    expect(title(container)).toBe(HEADLINE[HEADLINE.length - 1]!.title);
  });

  it("selects another milestone from the rail and shows that milestone's own record", async () => {
    const { container } = await renderBuilt();
    fireEvent.click(dots(container)[0]!);
    expect(selectedId(container)).toBe(HEADLINE[0]!.id);
    expect(title(container)).toBe(HEADLINE[0]!.title);
    const heading = FILE.records[HEADLINE[0]!.id]!.heading;
    fireEvent.click(container.querySelector("details.tl-record > summary")!);
    expect(container.querySelector(".tl-source")!.textContent).toContain(heading.split(" - ")[0]);
  });

  it("never shows another milestone's record while the records are still loading", async () => {
    let resolve: (file: DecisionsFile) => void = () => {};
    const slow = () => new Promise<DecisionsFile>((r) => (resolve = r));
    const { container } = render(<BuiltSection loadData={slow} />);
    fireEvent.click(dots(container)[1]!);
    fireEvent.click(dots(container)[2]!);
    expect(title(container)).toBe(HEADLINE[2]!.title);
    expect(container.querySelector(".tl-skim")).toBeNull();
    await act(async () => resolve(FILE));
    expect(title(container)).toBe(HEADLINE[2]!.title);
    expect(container.querySelector(".tl-skim")).not.toBeNull();
  });

  it("steps with Previous and Next, and stops at the ends", async () => {
    const { container } = await renderBuilt();
    const next = screen.getByRole("button", { name: "Next milestone" }) as HTMLButtonElement;
    const prev = screen.getByRole("button", { name: "Previous milestone" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(prev);
    expect(selectedId(container)).toBe(HEADLINE[HEADLINE.length - 2]!.id);
    expect(next.disabled).toBe(false);
    fireEvent.click(dots(container)[0]!);
    expect(prev.disabled).toBe(true);
  });

  it("shows all 22 milestones from the Show all chip and keeps the selection", async () => {
    const { container } = await renderBuilt();
    const before = selectedId(container);
    fireEvent.click(screen.getByRole("button", { name: "Show all 22" }));
    expect(dots(container)).toHaveLength(TIMELINE.length);
    expect(selectedId(container)).toBe(before);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("shows all 22 and opens the full record in Deep mode", async () => {
    const { container } = await renderBuilt(true);
    expect(dots(container)).toHaveLength(TIMELINE.length);
    expect(container.querySelector("details.tl-record")!.hasAttribute("open")).toBe(true);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("moves the selection to the nearest visible milestone when Deep mode goes off while a Deep-only one is chosen", async () => {
    const view = await renderBuilt(true);
    const minor = TIMELINE.find((n) => !n.headline)!;
    fireEvent.click(dots(view.container).find((d) => d.dataset.node === minor.id)!);
    expect(selectedId(view.container)).toBe(minor.id);
    view.rerender(
      <DeepContext.Provider value={false}>
        <BuiltSection loadData={load} />
      </DeepContext.Provider>,
    );
    expect(dots(view.container)).toHaveLength(HEADLINE.length);
    const earlier = [...TIMELINE.slice(0, TIMELINE.indexOf(minor))].reverse().find((n) => n.headline);
    expect(selectedId(view.container)).toBe(earlier?.id ?? HEADLINE[0]!.id);
  });
});
