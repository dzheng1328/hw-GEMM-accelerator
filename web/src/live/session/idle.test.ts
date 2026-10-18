// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserIdle, saveDataOn } from "./idle";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browserIdle", () => {
  it("uses requestIdleCallback when the browser has it, and can cancel", () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const callback = vi.fn();
    const stop = browserIdle(callback);
    expect(request).toHaveBeenCalledWith(callback, { timeout: 1500 });
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("falls back to a short timer when there is no requestIdleCallback, and can cancel", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const callback = vi.fn();
    browserIdle(callback);
    vi.advanceTimersByTime(250);
    expect(callback).toHaveBeenCalledOnce();
    const cancelled = vi.fn();
    browserIdle(cancelled)();
    vi.advanceTimersByTime(250);
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe("saveDataOn", () => {
  it("is true only when the connection reports Save-Data", () => {
    expect(saveDataOn()).toBe(false);
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    expect(saveDataOn()).toBe(true);
    vi.stubGlobal("navigator", { connection: { saveData: false } });
    expect(saveDataOn()).toBe(false);
  });
});
