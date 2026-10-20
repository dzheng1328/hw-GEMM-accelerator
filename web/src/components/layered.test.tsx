// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeepContext } from "./deepContext";
import { OPEN_DRAWER_EVENT } from "./drawerEvents";
import { DeepToggle } from "./DeepToggle";
import { Section } from "./Section";
import { useDeepMode } from "./useDeepMode";

function Harness() {
  const [deep, setDeep] = useDeepMode();
  return (
    <DeepContext.Provider value={deep}>
      <DeepToggle deep={deep} onChange={setDeep} />
      <Section id="a" title="A" headline="Headline A" drawer={{ summary: "Go deeper", body: <p>detail A</p> }}>
        <p>skim A</p>
      </Section>
      <Section id="b" title="B" headline="Headline B" drawer={{ summary: "Go deeper", body: <p>detail B</p> }}>
        <p>skim B</p>
      </Section>
    </DeepContext.Provider>
  );
}

const drawers = (root: HTMLElement) => Array.from(root.querySelectorAll("details"));
const states = (root: HTMLElement) => drawers(root).map((d) => d.open);

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("layered sections", () => {
  it("show the skim content always and keep drawers closed by default", () => {
    const { container, getByText } = render(<Harness />);
    expect(getByText("skim A")).toBeTruthy();
    expect(getByText("Headline B")).toBeTruthy();
    expect(states(container)).toEqual([false, false]);
  });

  it("open and close a single drawer without touching the URL", () => {
    const { container } = render(<Harness />);
    const first = container.querySelector("summary")!;
    fireEvent.click(first);
    expect(states(container)).toEqual([true, false]);
    expect(window.location.search).toBe("");
    fireEvent.click(first);
    expect(states(container)).toEqual([false, false]);
  });

  it("Deep mode opens every drawer and sets ?deep=1", () => {
    const { container, getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: /deep mode/i }));
    expect(states(container)).toEqual([true, true]);
    expect(window.location.search).toBe("?deep=1");
    expect(getByRole("button", { name: /deep mode/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaving Deep mode returns each drawer to the state the visitor left it in", () => {
    const { container, getByRole } = render(<Harness />);
    fireEvent.click(container.querySelector("summary")!);
    const toggle = getByRole("button", { name: /deep mode/i });
    fireEvent.click(toggle);
    expect(states(container)).toEqual([true, true]);
    fireEvent.click(toggle);
    expect(states(container)).toEqual([true, false]);
    expect(window.location.search).toBe("");
  });

  it("lets a drawer be closed while Deep mode is on, and Deep mode starts every drawer open again", () => {
    const { container, getByRole } = render(<Harness />);
    const toggle = getByRole("button", { name: /deep mode/i });
    fireEvent.click(toggle);
    const second = container.querySelectorAll("summary")[1]!;
    fireEvent.click(second);
    expect(states(container)).toEqual([true, false]);
    fireEvent.click(second);
    expect(states(container)).toEqual([true, true]);
    fireEvent.click(second);
    fireEvent.click(toggle);
    expect(states(container)).toEqual([false, false]);
    fireEvent.click(toggle);
    expect(states(container)).toEqual([true, true]);
  });

  it("follows the browser when it opens the element itself, as find-in-page does, so the next click closes it", () => {
    const { container } = render(<Harness />);
    const first = container.querySelector("details")!;
    first.open = true;
    fireEvent(first, new Event("toggle"));
    fireEvent.click(first.querySelector("summary")!);
    expect(first.open).toBe(false);
  });

  it("follows the browser in Deep mode too", () => {
    const { container, getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: /deep mode/i }));
    const first = container.querySelector("details")!;
    first.open = false;
    fireEvent(first, new Event("toggle"));
    expect(states(container)).toEqual([false, true]);
    fireEvent.click(first.querySelector("summary")!);
    expect(first.open).toBe(true);
  });

  it("starts in Deep mode when the URL says ?deep=1", () => {
    window.history.replaceState(null, "", "/?deep=1");
    const { container, getByRole } = render(<Harness />);
    expect(states(container)).toEqual([true, true]);
    expect(getByRole("button", { name: /deep mode/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps other query parameters and the hash when toggling", () => {
    window.history.replaceState(null, "", "/?utm=x#a");
    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: /deep mode/i }));
    expect(window.location.search).toBe("?utm=x&deep=1");
    expect(window.location.hash).toBe("#a");
  });

  it("treats ?deep=0 as off", () => {
    window.history.replaceState(null, "", "/?deep=0");
    const { container } = render(<Harness />);
    expect(states(container)).toEqual([false, false]);
  });
  it("opens when a proof jump asks, and the visitor can still close it", () => {
    const { container } = render(<Harness />);
    const first = container.querySelector("details")!;
    fireEvent(first, new CustomEvent(OPEN_DRAWER_EVENT));
    expect(states(container)).toEqual([true, false]);
    fireEvent.click(first.querySelector("summary")!);
    expect(states(container)).toEqual([false, false]);
  });

  it("opens for a proof jump in Deep mode after the visitor closed it", () => {
    const { container, getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: /deep mode/i }));
    const first = container.querySelector("details")!;
    fireEvent.click(first.querySelector("summary")!);
    expect(first.open).toBe(false);
    fireEvent(first, new CustomEvent(OPEN_DRAWER_EVENT));
    expect(first.open).toBe(true);
  });
});

describe("Section bands", () => {
  it("wraps a known section in a band with an inner column, a heading and a rule, and no eyebrow", () => {
    const { container } = render(<Section id="replay" title="Watch it think" headline="h" />);
    const section = container.querySelector("section#replay")!;
    expect(section.classList.contains("band")).toBe(true);
    expect(section.querySelector(".kicker")).toBeNull();
    expect(section.querySelector(":scope > .band-inner > .band-rule")?.getAttribute("aria-hidden")).toBe("true");
    expect(section.querySelector(".band-inner > h2")!.textContent).toBe("Watch it think");
  });

  it("no longer alternates band colors", () => {
    const { container } = render(<Section id="live" title="Run it live" headline="h" />);
    expect(container.querySelector("section#live")!.classList.contains("band-alt")).toBe(false);
  });

  it("renders the same band for an id that is not in the sections list", () => {
    const { container } = render(<Section id="other" title="Other" headline="h" />);
    expect(container.querySelector(".kicker")).toBeNull();
    expect(container.querySelector("section#other")!.classList.contains("band")).toBe(true);
  });
});
