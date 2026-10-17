// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_COLOR, THEME_KEY, applyTheme, parseTheme, readSavedTheme, saveTheme } from "./theme";

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#080b10" />';
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => window.localStorage.clear());

describe("theme helpers", () => {
  it("treats anything but 'light' as dark, so a bad saved value opens dark", () => {
    expect(parseTheme("light")).toBe("light");
    for (const value of ["dark", "purple", "", null, undefined, 3]) expect(parseTheme(value)).toBe("dark");
  });

  it("reads the saved choice, and falls back to dark when storage throws or is missing", () => {
    expect(readSavedTheme({ getItem: () => "light" })).toBe("light");
    expect(readSavedTheme({ getItem: () => null })).toBe("dark");
    expect(readSavedTheme({ getItem: () => { throw new Error("blocked"); } })).toBe("dark");
  });

  it("saves under one key and swallows a storage failure", () => {
    saveTheme("light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    expect(() => saveTheme("dark", { setItem: () => { throw new Error("quota"); } })).not.toThrow();
  });

  it("applies the theme to <html> and to the theme-color meta tag", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(THEME_COLOR.light);
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(THEME_COLOR.dark);
  });

  it("does not throw when the page has no theme-color meta tag", () => {
    document.head.innerHTML = "";
    expect(() => applyTheme("light")).not.toThrow();
  });
});
