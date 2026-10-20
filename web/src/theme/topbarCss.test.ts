import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");
const topbar = read("topbar.css");
const bands = read("bands.css");
const tokens = read("tokens.css");

/** The body of the first rule that starts with `selector {`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("the top bar", () => {
  it("is solid unless the browser can also blur what scrolls under it", () => {
    // Safari 16.2 to 17.x has color-mix() but only -webkit-backdrop-filter: a see-through bar with no blur lets the text under it show through
    const blocks = [...topbar.matchAll(/@supports\s*(\([^{]*\))\s*\{([^@]*?)\n\}/g)];
    const translucent = blocks.filter((b) => b[2]!.includes("color-mix"));
    expect(translucent).toHaveLength(1);
    expect(translucent[0]![1]).toContain("backdrop-filter");
    expect(translucent[0]![1]).toContain("-webkit-backdrop-filter");
    expect(topbar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@supports[\s\S]*?\n\}/g, "")).not.toContain("color-mix");
  });

  it("blurs with the prefixed property as well as the standard one", () => {
    expect(topbar).toContain("-webkit-backdrop-filter: blur(12px)");
    expect(topbar).toContain("  backdrop-filter: blur(12px)");
  });

  it("keeps the source link a 44 px touch target wide, not only tall", () => {
    const body = rule(topbar, ".topbar-link");
    expect(body).toContain("min-height: 44px");
    expect(body).toContain("min-width: 44px");
    expect(body).toContain("justify-content: center");
  });
});

describe("the section headline size", () => {
  it("is a token, used by the headline", () => {
    expect(tokens).toMatch(/--text-headline:\s*1\.125rem;/);
    expect(rule(bands, ".band .headline")).toContain("font-size: var(--text-headline)");
  });
});
