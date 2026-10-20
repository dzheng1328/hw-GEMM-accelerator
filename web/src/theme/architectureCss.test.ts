import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "architecture.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("the chip diagram's block states", () => {
  it("draws the selected block's edge in the text color and a lit block's in the accent, so the two never look alike", () => {
    expect(rule(".arch-selected .arch-bg")).toContain("stroke: var(--text)");
    expect(rule(".arch-lit .arch-bg")).toContain("stroke: var(--accent)");
  });

  it("keeps the selected edge, with the glow, on a block that is both", () => {
    const both = rule(".arch-selected.arch-lit .arch-bg");
    expect(both).toContain("stroke: var(--text)");
    expect(both).toContain("stroke-width: 3");
  });

  it("still tells the keyboard focus apart: accent and dashed", () => {
    const focus = rule(".arch-block:focus-visible .arch-bg");
    expect(focus).toContain("stroke: var(--accent)");
    expect(focus).toContain("stroke-dasharray");
  });

  describe("in forced-colors mode (Windows high contrast)", () => {
    // the page turns white there while the SVG blocks keep their dark fills, so a near-white selected edge disappears into it
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

    it("draws the selected edge in a system color, thicker than the lit one", () => {
      expect(forced).toMatch(/\.arch-selected \.arch-bg[^{]*\{[^}]*stroke: Highlight/);
      expect(forced).toMatch(/\.arch-lit \.arch-bg[^{]*\{[^}]*stroke: LinkText/);
    });

    it("keeps the swatches their own colors (they are defined in replay.css and shared by every legend), which are what they say", () => {
      const replay = readFileSync(join(import.meta.dirname, "replay.css"), "utf8");
      const block = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(replay)?.[1] ?? "";
      expect(block).toMatch(/\.swatch[^{]*\{[^}]*forced-color-adjust: none/);
    });
  });
});
