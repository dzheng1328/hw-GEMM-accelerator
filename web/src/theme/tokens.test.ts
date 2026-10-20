import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, luminance, mixHex } from "./contrast.testlib";
import { themeBlocks } from "./themeBlocks.testlib";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");

function colors(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}

const blocks = themeBlocks(css);
const themes = { dark: colors(blocks.dark), light: colors(blocks.light) };

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
    // the paper set is the same in both themes, so it is declared once, in the :root block only
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).filter((k) => !k.startsWith("paper-")).sort());
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

  for (const theme of ["dark", "light"] as const) {
    for (const behind of ["bg", "band", "surface", "border"]) {
      // the minor milestone marks are drawn in --muted on the rail line (--border) and on the page
      it(`${theme}: the muted rail marks reach 3:1 against ${behind}`, () => {
        const t = themes[theme];
        expect(contrast(t.muted!, t[behind]!)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("no longer defines the glow or the backdrop grid (the dev-tool look)", () => {
    for (const block of [blocks.dark, blocks.light]) {
      expect(block).not.toContain("--glow");
      expect(block).not.toContain("--grid");
    }
  });

  it("keeps a hairline rule color in both themes (the open and ruled surface language)", () => {
    for (const block of [blocks.dark, blocks.light]) expect(block).toMatch(/--rule:\s*rgba\(/);
  });

  it("widens the gutter with the window, in one place the bar and the bands share", () => {
    expect(blocks.dark).toContain("--gutter: 16px");
    expect(css).toMatch(/@media \(min-width: 720px\)\s*\{\s*:root\s*\{\s*--gutter: 24px;/);
    expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{\s*:root\s*\{\s*--gutter: 32px;/);
  });

  it("declares the layout and type tokens once, in the :root block", () => {
    for (const token of ["--content-max: 1200px", "--bar-h: 56px", "--radius-panel: 2px", "--text-hero:", "--text-figure:"]) {
      expect(blocks.dark, token).toContain(token);
    }
    expect(blocks.dark).toContain('"Shippori Mincho B1"');
    expect(blocks.dark).toContain('"Zen Kaku Gothic New"');
    expect(blocks.dark).toContain('"IBM Plex Mono"');
    expect(blocks.dark).not.toContain("IBM Plex Sans");
  });

  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: overlay text keeps AA on the strongest tint (45% of the attention color over the surface)`, () => {
      const t = themes[theme];
      const tinted = mixHex(t["cat-attention"]!, t.surface!, 0.45);
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
      const tinted = mixHex(t.accent!, t.surface!, 0.45);
      expect(contrast(t.text!, tinted)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const theme of ["dark", "light"] as const) {
    for (const kind of ["kind-control", "kind-movement", "kind-compute", "kind-memory"]) {
      it(`${theme}: block text keeps AA on the strongest ${kind} tint (45% over the surface)`, () => {
        const t = themes[theme];
        const tinted = mixHex(t[kind]!, t.surface!, 0.45);
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

describe("the paper set (the colors a washi sheet resets to, in both themes)", () => {
  const get = (name: string) => {
    const hex = new RegExp(`--paper-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(blocks.dark)?.[1];
    if (!hex) throw new Error(`--paper-${name} is missing from the :root block`);
    return hex;
  };

  it("is declared once, in the :root block, and not repeated in the light block", () => {
    expect(blocks.dark).toContain("--paper-bg:");
    expect(blocks.light).not.toContain("--paper-");
  });

  for (const surface of ["bg", "surface"]) {
    for (const fg of ["text", "muted", "accent", "cat-weights", "cat-attention", "cat-vpu", "cat-other", "go", "stall"]) {
      it(`paper: ${fg} on ${surface} meets WCAG AA (4.5:1)`, () => {
        expect(contrast(get(fg), get(surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`paper: the focus ring reaches 3:1 against ${surface}`, () => {
      expect(contrast(get("ring"), get(surface))).toBeGreaterThanOrEqual(3);
    });
  }

  for (const kind of ["accent", "cat-attention", "cat-vpu", "go", "cat-weights"]) {
    it(`paper: text keeps AA on the strongest ${kind} tint (45% over the surface)`, () => {
      expect(contrast(get("text"), mixHex(get(kind), get("surface"), 0.45))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("paper: the muted text reaches 3:1 on the paper border (rail marks)", () => {
    expect(contrast(get("muted"), get("border"))).toBeGreaterThanOrEqual(3);
  });

  it("is lighter than the page in the day theme, so a sheet reads as a sheet", () => {
    expect(luminance(get("bg"))).toBeGreaterThan(luminance(themes.light.bg!));
  });
});
