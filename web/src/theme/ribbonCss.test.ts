import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "ribbon.css"), "utf8");
const forced = css.slice(css.indexOf("@media (forced-colors: active)"));

describe("the ribbon under forced colors", () => {
  it("gives each of the four kinds its own fill and opacity, so the strokes and the swatches stay apart", () => {
    const looks = ["weights", "attention", "vpu", "other"].map((kind) => {
      const block = new RegExp(`\\[data-kind="${kind}"\\]\\s*\\{([^}]*)\\}`).exec(forced)?.[1] ?? "";
      return `${/fill:\s*(\w+)/.exec(block)?.[1]} ${/fill-opacity:\s*([\d.]+)/.exec(block)?.[1] ?? "1"}`;
    });
    expect(looks.some((l) => l.startsWith("undefined")), looks.join(", ")).toBe(false);
    expect(new Set(looks).size, looks.join(", ")).toBe(4);
  });
});
