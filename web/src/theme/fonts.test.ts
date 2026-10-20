import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "fonts");
const css = readFileSync(join(import.meta.dirname, "fonts.css"), "utf8");

interface Face {
  file: string;
  family: string;
  weight: number;
}

const FACES: Face[] = [
  { file: "shippori-mincho-b1-latin-700-normal.woff2", family: "Shippori Mincho B1", weight: 700 },
  { file: "zen-kaku-gothic-new-latin-400-normal.woff2", family: "Zen Kaku Gothic New", weight: 400 },
  { file: "zen-kaku-gothic-new-latin-700-normal.woff2", family: "Zen Kaku Gothic New", weight: 700 },
  { file: "ibm-plex-mono-latin-400-normal.woff2", family: "IBM Plex Mono", weight: 400 },
  { file: "ibm-plex-mono-latin-600-normal.woff2", family: "IBM Plex Mono", weight: 600 },
];
const LICENSES = ["OFL-mono.txt", "OFL-shippori.txt", "OFL-zen-kaku.txt"];

describe("self-hosted fonts", () => {
  it("ships exactly the five woff2 files and the three license texts", () => {
    expect(readdirSync(dir).sort()).toEqual([...FACES.map((f) => f.file), ...LICENSES].sort());
    for (const license of LICENSES) {
      expect(readFileSync(join(dir, license), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });

  it("no longer ships IBM Plex Sans", () => {
    expect(readdirSync(dir).some((f) => f.includes("plex-sans"))).toBe(false);
    expect(css).not.toContain("IBM Plex Sans");
  });

  it("stays inside the size budget (about 82 kB today)", () => {
    const total = FACES.reduce((sum, f) => sum + statSync(join(dir, f.file)).size, 0);
    expect(total).toBeLessThan(90 * 1024);
  });

  it("declares one swap-loaded @font-face per file, with the right family and weight", () => {
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(faces).toHaveLength(FACES.length);
    for (const { file, family, weight } of FACES) {
      const face = faces.find((f) => f.includes(file));
      expect(face, file).toBeDefined();
      expect(face).toContain(`font-family: "${family}"`);
      expect(face).toContain(`font-weight: ${weight}`);
      expect(face).toContain("font-display: swap");
      expect(face).toContain('format("woff2")');
    }
  });
});
