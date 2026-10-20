import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "skin.css"), "utf8");

describe("the skin", () => {
  it("clips sideways overflow on main, so a sheet or tile that starts off screen (motion) never lets the page pan sideways", () => {
    expect(css).toMatch(/\nmain\s*\{[^}]*overflow-x:\s*clip/);
  });

  it("hides the counting overlay under forced colors, where transparent text is drawn in the text color and would print twice", () => {
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.figure-live\s*\{\s*display:\s*none/);
  });
});
