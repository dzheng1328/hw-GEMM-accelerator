import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import attributions from "../data/generated/attributions.json";
import { contrast, mixHex, rgbToHex } from "./contrast.testlib";
import { themeBlocks } from "./themeBlocks.testlib";

const printCss = readFileSync(join(import.meta.dirname, "print.css"), "utf8");
const tokens = themeBlocks(readFileSync(join(import.meta.dirname, "tokens.css"), "utf8"));
const printBlocks = themeBlocks(printCss);

const text = (block: string) => /--text:\s*(#[0-9a-fA-F]{6})/.exec(block)![1]!;
const scrim = (block: string) => {
  const rgb = /--scrim-rgb:\s*(\d+)\s+(\d+)\s+(\d+)/.exec(block);
  const alpha = /--scrim-alpha:\s*([0-9.]+)/.exec(block);
  if (!rgb || !alpha) throw new Error("print.css needs --scrim-rgb and --scrim-alpha in both theme blocks");
  return { color: rgbToHex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]), alpha: Number(alpha[1]) };
};
const night = attributions.assets.find((a) => a.role === "night-print")!;
const day = attributions.assets.find((a) => a.role === "day-scroll")!;

describe("the print scrim", () => {
  it("keeps cream text at 4.5:1 over the brightest part of the night print", () => {
    const s = scrim(printBlocks.dark);
    const worst = mixHex(s.color, rgbToHex(night.brightest), s.alpha);
    expect(contrast(text(tokens.dark), worst)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps sumi text at 4.5:1 over the darkest part of the day scroll", () => {
    const s = scrim(printBlocks.light);
    const worst = mixHex(s.color, rgbToHex(day.darkest), s.alpha);
    expect(contrast(text(tokens.light), worst)).toBeGreaterThanOrEqual(4.5);
  });

  it("never hides the print: alpha stays at 0.9 or less in both themes", () => {
    expect(scrim(printBlocks.dark).alpha).toBeLessThanOrEqual(0.9);
    expect(scrim(printBlocks.light).alpha).toBeLessThanOrEqual(0.9);
  });
});

describe("the print layer css", () => {
  it("only names images that the attributions list", () => {
    const listed = new Set(attributions.assets.flatMap((a) => a.files.map((f) => f.path)));
    const used = [...printCss.matchAll(/url\("(\/art\/[^"]+)"\)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThanOrEqual(4);
    for (const path of used) expect(listed.has(path), path).toBe(true);
  });

  it("falls back to the solid background and hides the layer under forced colors", () => {
    expect(printCss).toMatch(/\.print-layer\s*\{[^}]*background-color:\s*var\(--bg\)/);
    expect(printCss).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.print-layer\s*\{\s*display:\s*none/);
  });

  it("gives the blur variables a fallback, so a missing one cannot void the whole declaration", () => {
    expect(printCss).toContain("var(--print-blur-night, none)");
    expect(printCss).toContain("var(--print-blur-day, none)");
  });
});
