// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_COLOR, THEME_KEY } from "../theme/theme";
import { useTheme } from "./useTheme";

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#080b10" />';
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useTheme", () => {
  it("starts from the theme the inline script put on <html>, dark when it is missing", () => {
    expect(renderHook(() => useTheme()).result.current[0]).toBe("dark");
    cleanup();
    document.documentElement.dataset.theme = "light";
    expect(renderHook(() => useTheme()).result.current[0]).toBe("light");
  });

  it("toggling applies the theme, updates the meta tag and saves the choice", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]());
    expect(result.current[0]).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(THEME_COLOR.light);
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    act(() => result.current[1]());
    expect(result.current[0]).toBe("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("still toggles when the browser refuses to store the choice", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]());
    expect(result.current[0]).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(THEME_COLOR.light);
    act(() => result.current[1]());
    expect(result.current[0]).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    vi.restoreAllMocks();
  });
});
