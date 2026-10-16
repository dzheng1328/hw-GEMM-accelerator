// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepContext } from "../components/deepContext";
import { fakeScheduler } from "./fakeScheduler";
import { ReplaySection } from "./ReplaySection";
import { fixtureData } from "./testData";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSection(opts: { deep?: boolean; load?: () => Promise<ReturnType<typeof fixtureData>> } = {}) {
  const scheduler = fakeScheduler();
  const load = opts.load ?? (() => Promise.resolve(fixtureData()));
  const ui = (
    <DeepContext.Provider value={opts.deep ?? false}>
      <ReplaySection scheduler={scheduler} loadData={load} />
    </DeepContext.Provider>
  );
  return { scheduler, tick: (ms: number) => act(() => scheduler.advance(ms)), ...render(ui) };
}

/** Wait for the lanes, then flush the effects (autoplay, the clock's first frame) that follow them. */
async function ready() {
  await screen.findAllByLabelText(/^Story \d$/);
  await act(async () => {});
}

const counter = (container: HTMLElement) => container.querySelector(".counter-value")!.textContent;

describe("ReplaySection", () => {
  it("shows a loading line first and keeps the section's title", async () => {
    let resolve!: (d: ReturnType<typeof fixtureData>) => void;
    const { getByText } = renderSection({ load: () => new Promise((r) => (resolve = r)) });
    expect(getByText("Watch it think")).toBeTruthy();
    expect(getByText("Loading the recorded run...")).toBeTruthy();
    await act(async () => resolve(fixtureData()));
    expect(await screen.findAllByLabelText(/^Story \d$/)).toHaveLength(2);
  });

  it("shows a plain error and keeps rendering when the data cannot be loaded", async () => {
    const { findByRole, getByText } = renderSection({ load: () => Promise.reject(new Error("offline")) });
    expect((await findByRole("alert")).textContent).toContain("could not be loaded");
    expect(getByText("Watch it think")).toBeTruthy();
  });

  it("autoplays once the data is loaded: the counter and the lanes advance", async () => {
    const { container, tick } = renderSection();
    await ready();
    expect(counter(container)).toBe("0");
    tick(1000); // 25 s for 1000 cycles: 40 cycles per second
    expect(counter(container)).toBe("40");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("pauses and holds", async () => {
    const { container, tick } = renderSection();
    await ready();
    tick(1000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(1000);
    expect(counter(container)).toBe("40");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("scrubbing pauses and jumps to the start of that step", async () => {
    const { container } = renderSection();
    await ready();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(screen.getByText("Step 3 of 5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(counter(container)).toBe("300"); // steps 0..2 are 100 cycles each
    expect(container.querySelectorAll(".lane-text")[0]!.textContent).toBe("Hi there! there");
  });

  it("changes pace at 4x without moving the counter backwards", async () => {
    const { container, tick } = renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "4x" }));
    tick(1000); // 4 s into the run: step 1 started at 2.5 s, so 100 + 0.6 * 100 cycles
    expect(counter(container)).toBe("160");
  });

  it("stops at the end showing the total, the last step and a Replay button", async () => {
    const { container, tick } = renderSection();
    await ready();
    tick(30_000);
    expect(counter(container)).toBe("1,000");
    expect(screen.getByText("Step 5 of 5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(counter(container)).toBe("0");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("does not autoplay under reduced motion and starts at the end", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { container, tick } = renderSection();
    await ready();
    expect(counter(container)).toBe("1,000");
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
    tick(5000);
    expect(counter(container)).toBe("1,000");
  });

  it("starts at the end under reduced motion even when the section has not scrolled into view", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    // Only the "near the viewport" observer fires, as on a phone where the section starts below the fold.
    class NearOnlyObserver {
      private cb: IntersectionObserverCallback;
      private margin: string;
      constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.cb = cb;
        this.margin = options?.rootMargin ?? "";
      }
      observe() {
        if (this.margin.startsWith("100%")) this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
      }
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", NearOnlyObserver);
    const { container } = renderSection();
    await ready();
    expect(counter(container)).toBe("1,000");
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
  });

  it("freezes a story that has ended while the others keep growing", async () => {
    const { container } = renderSection();
    await ready();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "5" } });
    const texts = [...container.querySelectorAll(".lane-text")].map((n) => n.textContent);
    expect(texts[1]).toBe("Hi there");
    expect(texts[0]).toBe("Hi there! there! there");
    expect(screen.getByText("Ended at step 2")).toBeTruthy();
  });

  it("announces user actions in a polite live region and not every tick", async () => {
    const { container, tick } = renderSection();
    await ready();
    const live = container.querySelector("[aria-live='polite']")!;
    expect(live.textContent).toBe("");
    tick(1000);
    expect(live.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(live.textContent).toBe("Paused at step 0");
    fireEvent.click(screen.getByRole("button", { name: "2x" }));
    expect(live.textContent).toBe("Speed 2x");
  });

  it("explains that it is a replay and reports the run's total honestly", async () => {
    const { container } = renderSection();
    await ready();
    expect(container.querySelector(".replay-note")!.textContent).toContain("recorded");
    expect(container.querySelector(".counter-note")!.textContent).toMatch(/62,677,232/);
  });

  it("puts the attention view in the drawer and follows the clock", async () => {
    const { container } = renderSection({ deep: true });
    await ready();
    expect(container.querySelectorAll(".head-cell")).toHaveLength(4);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "4" } });
    expect(container.querySelectorAll(".otok")).toHaveLength(5);
    fireEvent.click(container.querySelectorAll(".head-cell")[1]!);
    expect(container.querySelectorAll(".head-cell")[1]!.getAttribute("aria-pressed")).toBe("true");
  });
});
