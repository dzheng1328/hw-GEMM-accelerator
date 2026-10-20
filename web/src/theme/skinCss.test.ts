import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "skin.css"), "utf8");

describe("the skin", () => {
  it("clips sideways overflow on main, so a sheet or tile that starts off screen (motion) never lets the page pan sideways", () => {
    expect(css).toMatch(/\nmain\s*\{[^}]*overflow-x:\s*clip/);
  });
});
