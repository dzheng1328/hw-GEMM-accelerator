// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIGGER_MARGIN, pickActive, useActiveSection, type ActiveEnv } from "./useActiveSection";

const IDS = ["a", "b", "c"] as const;

function setup() {
  let callback: IntersectionObserverCallback = () => {};
  const observed: string[] = [];
  const disconnect = vi.fn();
  let bottom = false;
  const inits: IntersectionObserverInit[] = [];
  let resized: () => void = () => {};
  const stopWatching = vi.fn();
  const env: ActiveEnv = {
    createObserver: (cb, init) => {
      callback = cb;
      inits.push(init);
      return { observe: (el) => observed.push((el as HTMLElement).id), disconnect };
    },
    isAtBottom: () => bottom,
    watchSize: (cb) => {
      resized = cb;
      return stopWatching;
    },
  };
  const fire = (changes: Record<string, boolean>) =>
    act(() =>
      callback(
        Object.entries(changes).map(([id, isIntersecting]) => ({ target: document.getElementById(id)!, isIntersecting }) as unknown as IntersectionObserverEntry),
        {} as IntersectionObserver,
      ),
    );
  const scrollTo = (atBottom: boolean) => {
    bottom = atBottom;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
  };
  /** the page grew or shrank without any scrolling, as lazy content arriving does */
  const resize = (atBottom: boolean) => {
    bottom = atBottom;
    act(() => resized());
  };
  return { env, fire, scrollTo, resize, observed, disconnect, inits, stopWatching };
}

beforeEach(() => {
  document.body.innerHTML = IDS.map((id) => `<section id="${id}"></section>`).join("");
});
afterEach(cleanup);

describe("pickActive", () => {
  it("returns the topmost crossing id, and null when nothing crosses", () => {
    expect(pickActive(IDS, new Set(["c", "b"]))).toBe("b");
    expect(pickActive(IDS, new Set())).toBeNull();
    expect(pickActive(IDS, new Set(["zzz"]))).toBeNull();
  });
});

describe("useActiveSection", () => {
  it("observes every section with a trigger line a little above the middle of the window", () => {
    const { env, observed, inits } = setup();
    renderHook(() => useActiveSection(IDS, env));
    expect(observed).toEqual(["a", "b", "c"]);
    expect(inits[0]).toEqual({ rootMargin: TRIGGER_MARGIN, threshold: 0 });
  });

  it("is null over the hero, follows the section crossing the line, and the topmost wins a tie", () => {
    const { env, fire } = setup();
    const { result } = renderHook(() => useActiveSection(IDS, env));
    expect(result.current).toBeNull();
    fire({ a: true });
    expect(result.current).toBe("a");
    fire({ b: true });
    expect(result.current).toBe("a");
    fire({ a: false });
    expect(result.current).toBe("b");
    fire({ b: false });
    expect(result.current).toBeNull();
  });

  it("makes the last section active at the very bottom of the page, and releases it when scrolling up", () => {
    const { env, fire, scrollTo } = setup();
    const { result } = renderHook(() => useActiveSection(IDS, env));
    fire({ b: true });
    scrollTo(true);
    expect(result.current).toBe("c");
    scrollTo(false);
    expect(result.current).toBe("b");
  });

  it("notices the bottom of the page being reached or left by the page resizing, with no scroll event", () => {
    const { env, fire, resize } = setup();
    const { result } = renderHook(() => useActiveSection(IDS, env));
    fire({ b: true });
    resize(true);
    expect(result.current).toBe("c");
    resize(false);
    expect(result.current).toBe("b");
  });

  it("stops watching the page size on unmount", () => {
    const { env, stopWatching } = setup();
    renderHook(() => useActiveSection(IDS, env)).unmount();
    expect(stopWatching).toHaveBeenCalledTimes(1);
  });

  it("stays right when a section grows or shrinks (the observer reports new intersections for the same ids)", () => {
    const { env, fire } = setup();
    const { result } = renderHook(() => useActiveSection(IDS, env));
    fire({ b: true });
    expect(result.current).toBe("b");
    fire({ b: false, c: true });
    expect(result.current).toBe("c");
    fire({ c: false, b: true });
    expect(result.current).toBe("b");
  });

  it("ignores an id that has no element on the page", () => {
    const { env, observed } = setup();
    renderHook(() => useActiveSection(["a", "missing", "c"], env));
    expect(observed).toEqual(["a", "c"]);
  });

  it("disconnects the observer and removes its scroll listener on unmount", () => {
    const { env, disconnect } = setup();
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useActiveSection(IDS, env));
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    remove.mockRestore();
  });
});
