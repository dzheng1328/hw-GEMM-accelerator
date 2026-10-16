// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInView, useLazyData, usePrefersReducedMotion } from "./hooks";

afterEach(() => vi.unstubAllGlobals());

describe("useInView", () => {
  it("is true at once when IntersectionObserver is unavailable", () => {
    const ref = createRef<HTMLDivElement>();
    const { result } = renderHook(() => useInView(ref, "0px"));
    expect(result.current).toBe(true);
  });

  it("stays false until the element intersects, then stays true and disconnects", () => {
    let callback: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const el = document.createElement("div");
    const ref = { current: el };
    const { result } = renderHook(() => useInView(ref, "0px"));
    expect(result.current).toBe(false);
    act(() => callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(result.current).toBe(false);
    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(result.current).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("usePrefersReducedMotion", () => {
  it("is false when matchMedia is unavailable", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reads the media query once", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });
});

describe("useLazyData", () => {
  it("does not start loading until enabled, and loads once", async () => {
    const load = vi.fn(() => Promise.resolve("data"));
    const { result, rerender } = renderHook(({ on }) => useLazyData(load, on), { initialProps: { on: false } });
    expect(result.current.status).toBe("idle");
    expect(load).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toBe("data");
    rerender({ on: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reports an error and no data when loading fails", async () => {
    const { result } = renderHook(() => useLazyData(() => Promise.reject(new Error("boom")), true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.data).toBeUndefined();
  });

  it("wraps a rejection that is not an Error", async () => {
    const { result } = renderHook(() => useLazyData(() => Promise.reject("nope"), true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("nope");
  });
});
