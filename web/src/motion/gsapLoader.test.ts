// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshOnGrowth } from "./gsapLoader";

let notify: () => void = () => {};
let height = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  height = 1000;
  Object.defineProperty(document.body, "offsetHeight", { configurable: true, get: () => height });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("refreshOnGrowth", () => {
  it("re-measures once, after the page height settles", () => {
    const refresh = vi.fn();
    refreshOnGrowth(refresh);
    height = 1400;
    notify();
    height = 1900;
    notify();
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores a resize that does not change the height", () => {
    const refresh = vi.fn();
    refreshOnGrowth(refresh);
    notify();
    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("waits for a scroll in progress to end, because a refresh would cancel a smooth scroll", () => {
    const refresh = vi.fn();
    refreshOnGrowth(refresh);
    height = 1400;
    notify();
    for (let t = 0; t < 1000; t += 50) {
      vi.advanceTimersByTime(50);
      window.dispatchEvent(new Event("scroll"));
    }
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops when cancelled", () => {
    const refresh = vi.fn();
    const stop = refreshOnGrowth(refresh);
    height = 1400;
    notify();
    stop();
    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
  });
});
