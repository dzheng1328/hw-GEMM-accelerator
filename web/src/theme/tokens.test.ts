import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
const MARKER = "@media (prefers-color-scheme: light)";

function colors(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}

const [darkPart = "", lightPart = ""] = css.split(MARKER);
const themes = { dark: colors(darkPart), light: colors(lightPart) };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT_ON_SURFACES: [string, string][] = [
  ["text", "bg"], ["text", "surface"],
  ["muted", "bg"], ["muted", "surface"],
  ["accent", "bg"], ["accent", "surface"],
  ["cat-weights", "surface"], ["cat-attention", "surface"],
  ["cat-vpu", "surface"], ["cat-other", "surface"],
];

describe("theme tokens", () => {
  it("define the same colors in the dark and the light theme", () => {
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).sort());
    expect(Object.keys(themes.dark).length).toBeGreaterThanOrEqual(10);
  });

  for (const theme of ["dark", "light"] as const) {
    for (const [fg, bg] of TEXT_ON_SURFACES) {
      it(`${theme}: ${fg} on ${bg} meets WCAG AA (4.5:1)`, () => {
        const t = themes[theme];
        expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("make the two themes actually different", () => {
    expect(themes.dark.bg).not.toBe(themes.light.bg);
  });

  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: overlay text keeps AA on the strongest tint (45% of the attention color over the surface)`, () => {
      const t = themes[theme];
      const mix = (fg: string, bg: string, a: number) =>
        "#" +
        [0, 1, 2]
          .map((i) => {
            const c = parseInt(fg.slice(1 + i * 2, 3 + i * 2), 16) * a + parseInt(bg.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a);
            return Math.round(c).toString(16).padStart(2, "0");
          })
          .join("");
      const tinted = mix(t["cat-attention"]!, t.surface!, 0.45);
      expect(contrast(t.text!, tinted)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("draws the BOS tag in the body text color, not the muted one, so it stays readable on a strong tint", () => {
    const replay = readFileSync(join(import.meta.dirname, "replay.css"), "utf8");
    const rule = /\.otok-bos\s*\{([^}]*)\}/.exec(replay)?.[1] ?? "";
    expect(rule).toContain("color: var(--text)");
  });
});
