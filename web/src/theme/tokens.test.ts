import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeBlocks } from "./themeBlocks.testlib";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");

function colors(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}

const blocks = themeBlocks(css);
const themes = { dark: colors(blocks.dark), light: colors(blocks.light) };

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
  ["text", "bg"], ["text", "band"], ["text", "surface"],
  ["muted", "bg"], ["muted", "band"], ["muted", "surface"],
  ["accent", "bg"], ["accent", "band"], ["accent", "surface"],
  ["cat-weights", "surface"], ["cat-attention", "surface"],
  ["cat-vpu", "surface"], ["cat-other", "surface"],
  ["cat-weights", "band"], ["cat-attention", "band"],
  ["cat-vpu", "band"], ["cat-other", "band"],
  ["port-operand", "surface"], ["port-go", "surface"], ["port-stall", "surface"],
  ["port-wait", "surface"], ["port-other", "surface"],
  ["kind-control", "surface"], ["kind-movement", "surface"], ["kind-compute", "surface"], ["kind-memory", "surface"],
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

  it("has no operating-system color-scheme media query left (the page never follows the OS)", () => {
    expect(css).not.toContain("prefers-color-scheme");
  });

  it("opens dark: the :root block declares color-scheme dark and the light block declares light", () => {
    expect(blocks.dark).toContain("color-scheme: dark");
    expect(blocks.light).toContain("color-scheme: light");
  });

  for (const theme of ["dark", "light"] as const) {
    for (const surface of ["bg", "band", "surface"]) {
      it(`${theme}: the focus ring reaches 3:1 against ${surface}`, () => {
        const t = themes[theme];
        expect(contrast(t.ring!, t[surface]!)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("defines the glow and the backdrop grid in both themes", () => {
    for (const block of [blocks.dark, blocks.light]) {
      expect(block).toMatch(/--glow:\s*rgba\(/);
      expect(block).toMatch(/--grid:\s*rgba\(/);
    }
  });

  it("widens the gutter with the window, in one place the bar and the bands share", () => {
    expect(blocks.dark).toContain("--gutter: 16px");
    expect(css).toMatch(/@media \(min-width: 720px\)\s*\{\s*:root\s*\{\s*--gutter: 24px;/);
    expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{\s*:root\s*\{\s*--gutter: 32px;/);
  });

  it("declares the layout and type tokens once, in the :root block", () => {
    for (const token of ["--content-max: 1200px", "--bar-h: 56px", "--radius-panel: 12px", "--text-hero:"]) {
      expect(blocks.dark, token).toContain(token);
    }
    expect(blocks.dark).toContain('"IBM Plex Sans"');
    expect(blocks.dark).toContain('"IBM Plex Mono"');
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

  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: tile text keeps AA on the strongest tile tint (45% of the accent over the surface)`, () => {
      const t = themes[theme];
      const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
      const tinted =
        "#" +
        [0, 1, 2]
          .map((i) => Math.round(channel(t.accent!, i) * 0.45 + channel(t.surface!, i) * 0.55).toString(16).padStart(2, "0"))
          .join("");
      expect(contrast(t.text!, tinted)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const theme of ["dark", "light"] as const) {
    for (const kind of ["kind-control", "kind-movement", "kind-compute", "kind-memory"]) {
      it(`${theme}: block text keeps AA on the strongest ${kind} tint (45% over the surface)`, () => {
        const t = themes[theme];
        const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
        const tinted =
          "#" +
          [0, 1, 2]
            .map((i) => Math.round(channel(t[kind]!, i) * 0.45 + channel(t.surface!, i) * 0.55).toString(16).padStart(2, "0"))
            .join("");
        expect(contrast(t.text!, tinted)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("the scene tile token", () => {
  it("is defined in both themes, and is not as dark as the border so tiles show on the board", () => {
    for (const theme of ["dark", "light"] as const) expect(themes[theme]["scene-tile"], theme).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(luminance(themes.dark["scene-tile"]!)).toBeGreaterThan(luminance(themes.dark["border"]!) * 2);
  });
});
