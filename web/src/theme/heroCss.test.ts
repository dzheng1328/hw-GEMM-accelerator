import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "hero.css"), "utf8");

describe("the hero controls", () => {
  it("are at least 44 px tall: the mesh pills and Run are touch targets", () => {
    const block = /\.hero-mesh button,\s*\.hero-run \{([^}]*)\}/.exec(css);
    expect(block, "the shared rule for the pills and Run").not.toBeNull();
    expect(block![1]).toMatch(/min-height:\s*(44px|2\.75rem)/);
  });
});

describe("the Run button", () => {
  it("is border-box like the pills, so the 44 px minimum is its height and not its content's", () => {
    const rules = [...css.matchAll(/\.hero-run \{([^}]*)\}/g)].map((m) => m[1]).join("\n");
    expect(rules).not.toContain("content-box");
    expect(rules).toContain("min-width: calc(12ch + 1.8rem + 2px)");
  });
});
