// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeepContext } from "./deepContext";
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

  it("ignores summary clicks while Deep mode is on", () => {
    const { container, getByRole } = render(<Harness />);
    const toggle = getByRole("button", { name: /deep mode/i });
    fireEvent.click(toggle);
    fireEvent.click(container.querySelectorAll("summary")[1]!);
    expect(states(container)).toEqual([true, true]);
    fireEvent.click(toggle);
    expect(states(container)).toEqual([false, false]);
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
});
