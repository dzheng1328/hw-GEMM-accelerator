import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "PerformanceSection.tsx"), "utf8");

describe("the stroke ribbon in the performance section", () => {
  it("is loaded lazily, so its code is not part of the entry chunk (the entry budget is the baseline plus 2 kB gzip)", () => {
    expect(source).not.toMatch(/import \{ StrokeRibbon \} from/);
    expect(source).toMatch(/lazy\(\(\) =>\s*import\("\.\/StrokeRibbon"\)/);
  });

  it("holds the ribbon's room while its chunk loads, so nothing below it moves", () => {
    expect(source).toMatch(/<Suspense fallback=\{[^}]*ribbon-frame/);
  });
});
