// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_COLOR, THEME_KEY } from "./theme";

const html = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

const run = () => new Function(script!)();

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#080b10" />';
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("the inline theme script in index.html", () => {
  it("exists, runs before the module script, and sits in the head after the theme-color tag", () => {
    expect(script, "inline <script>").toBeDefined();
    expect(html.indexOf("<script>")).toBeGreaterThan(html.indexOf('name="theme-color"'));
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('type="module"'));
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</head>"));
  });

  it("opens dark with nothing saved", () => {
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(THEME_COLOR.dark);
  });

  it("applies a saved light choice before the app runs", () => {
    window.localStorage.setItem(THEME_KEY, "light");
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(THEME_COLOR.light);
  });

  it("opens dark for a garbage saved value", () => {
    window.localStorage.setItem(THEME_KEY, "purple");
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("opens dark and does not throw when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("does not throw when the page has no theme-color tag", () => {
    document.head.innerHTML = "";
    expect(run).not.toThrow();
  });

  it("uses the same storage key and colors as theme.ts, so the two cannot drift", () => {
    expect(script).toContain(`"${THEME_KEY}"`);
    expect(script).toContain(THEME_COLOR.dark);
    expect(script).toContain(THEME_COLOR.light);
  });
});
