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
