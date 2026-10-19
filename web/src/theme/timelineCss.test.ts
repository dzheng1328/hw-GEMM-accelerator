import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "timeline.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`timeline.css has no rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("timeline rail marks", () => {
  // The tokens are checked at 3:1 against the line and the surfaces in tokens.test.ts; any opacity would blend the dot
  // with what is behind it and take it below that (3.69:1 against the page and 2.49:1 against the line in the light theme).
  for (const selector of [".rail-mark", ".rail-dot.is-minor .rail-mark", ".rail-dot.is-selected .rail-mark"]) {
    it(`${selector} is drawn in a solid token color`, () => {
      expect(rule(selector)).not.toMatch(/opacity/);
    });
  }
});
