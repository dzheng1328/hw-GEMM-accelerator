import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import attributions from "../data/generated/attributions.json";
import { contrast, mixHex, rgbToHex } from "./contrast.testlib";

const css = readFileSync(join(import.meta.dirname, "sheets.css"), "utf8");
const tokens = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
const DENSE = [".sheet", ".replay-stage", ".chart-figure", ".mesh-panel", ".tl-panel", ".drawer", ".arch-detail", ".rung-card"];
const paper = (name: string) => {
  const hex = new RegExp(`--paper-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1];
  if (!hex) throw new Error(`--paper-${name} is missing from tokens.css`);
  return hex;
};

describe("the paper scope", () => {
  it("applies to every dense panel and to .sheet, in one rule", () => {
    const rule = /:is\(([^)]*)\)\s*\{([^}]*)\}/.exec(css);
    expect(rule, "an :is(...) rule").not.toBeNull();
    for (const selector of DENSE) expect(rule![1], selector).toContain(selector);
  });

  it("resets every semantic color the panels read to its paper value", () => {
    const body = /:is\([^)]*\)\s*\{([^}]*)\}/.exec(css)![1]!;
    for (const token of ["bg", "surface", "band", "text", "muted", "border", "accent", "ring", "scene-tile", "cat-weights", "cat-attention", "cat-vpu", "cat-other", "port-operand", "port-go", "port-stall", "port-wait", "port-other", "kind-control", "kind-movement", "kind-compute", "kind-memory"]) {
      expect(body, token).toMatch(new RegExp(`--${token}:\\s*var\\(--paper-`));
    }
  });

  it("paints the paper from the real washi crop, never a built texture", () => {
    expect(css).toContain('url("/art/washi-paper-1280.webp")');
    const listed = attributions.assets.flatMap((a) => a.files.map((f) => f.path));
    expect(listed).toContain("/art/washi-paper-1280.webp");
    expect(css).not.toMatch(/(repeating-)?(linear|radial|conic)-gradient\([^)]*\)\s*,\s*(repeating-)?(linear|radial)-gradient/);
  });

  it("keeps every paper color at 4.5:1 on the darkest pixel of the real washi crop under the tint", () => {
    const tint = /--sheet-tint:\s*rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([0-9.]+)\)/.exec(css);
    expect(tint, "--sheet-tint: rgb(R G B / A) in sheets.css").not.toBeNull();
    const [r, g, b, a] = [Number(tint![1]), Number(tint![2]), Number(tint![3]), Number(tint![4])];
    const crop = attributions.assets.find((x) => x.role === "washi-paper")!;
    const worst = mixHex(rgbToHex([r, g, b]), rgbToHex(crop.darkest), a);
    for (const fg of ["text", "muted", "accent", "cat-weights", "cat-attention", "cat-vpu", "cat-other", "go", "stall"]) {
      expect(contrast(paper(fg), worst), `${fg} on the tinted darkest paper`).toBeGreaterThanOrEqual(4.5);
    }
    // the same pixel under the surface a button sits on is lighter still; the ring needs 3:1
    expect(contrast(paper("ring"), worst)).toBeGreaterThanOrEqual(3);
  });

  it("uses Canvas colors and a border under forced colors", () => {
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*Canvas[\s\S]*CanvasText/);
  });

  it("makes a scrolling sheet scroll inside itself with a visible focus ring", () => {
    expect(css).toMatch(/\.sheet-scroll\s*\{[^}]*overflow:\s*auto/);
    expect(css).toMatch(/\.sheet-scroll:focus-visible\s*\{[^}]*outline/);
  });
});
