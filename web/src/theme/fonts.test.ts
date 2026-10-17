import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "fonts");
const css = readFileSync(join(import.meta.dirname, "fonts.css"), "utf8");
const FILES = [
  "ibm-plex-sans-latin-400-normal.woff2",
  "ibm-plex-sans-latin-600-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-600-normal.woff2",
];

describe("self-hosted fonts", () => {
  it("ships exactly the four woff2 files and both license texts", () => {
    expect(readdirSync(dir).sort()).toEqual([...FILES, "OFL-mono.txt", "OFL-sans.txt"].sort());
    for (const license of ["OFL-sans.txt", "OFL-mono.txt"]) {
      expect(readFileSync(join(dir, license), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });

  it("stays inside the size budget (the spec allows about 80 kB)", () => {
    const total = FILES.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
    expect(total).toBeLessThan(90 * 1024);
  });

  it("declares one swap-loaded @font-face per file, with the right family and weight", () => {
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(faces).toHaveLength(4);
    for (const file of FILES) {
      const [, family, weight] = /ibm-plex-(sans|mono)-latin-(\d+)-normal/.exec(file)!;
      const face = faces.find((f) => f.includes(file));
      expect(face, file).toBeDefined();
      expect(face).toContain(`font-family: "IBM Plex ${family === "sans" ? "Sans" : "Mono"}"`);
      expect(face).toContain(`font-weight: ${weight}`);
      expect(face).toContain("font-display: swap");
      expect(face).toContain('format("woff2")');
    }
  });
});
