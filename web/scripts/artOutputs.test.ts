import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import attributions from "../src/data/generated/attributions.json";

const web = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "art.manifest.json"), "utf8")) as {
  assets: { role: string; objectId: number; widths: number[]; maxBytes: Record<string, number> }[];
};

describe("the committed art", () => {
  it("lists exactly the roles of the manifest, with one file per requested width and none wider than asked", () => {
    expect(attributions.assets.map((a) => a.role)).toEqual(manifest.assets.map((a) => a.role));
    for (const spec of manifest.assets) {
      const asset = attributions.assets.find((a) => a.role === spec.role)!;
      expect(asset.files).toHaveLength(spec.widths.length);
      asset.files.forEach((file, i) => expect(file.width).toBeLessThanOrEqual(spec.widths[i]!));
    }
  });

  it("has every listed file on disk, inside its byte budget", () => {
    for (const spec of manifest.assets) {
      const asset = attributions.assets.find((a) => a.role === spec.role)!;
      asset.files.forEach((file, i) => {
        const full = join(web, "public", file.path);
        expect(existsSync(full), file.path).toBe(true);
        expect(statSync(full).size, file.path).toBe(file.bytes);
        expect(file.bytes, file.path).toBeLessThanOrEqual(spec.maxBytes[String(spec.widths[i])]!);
      });
    }
  });

  it("has no image in public/art that the attributions do not list", () => {
    const listed = new Set(attributions.assets.flatMap((a) => a.files.map((f) => f.path.replace("/art/", ""))));
    expect(readdirSync(join(web, "public", "art")).sort()).toEqual([...listed].sort());
  });

  it("credits only public-domain objects, one credit per object the assets use", () => {
    for (const credit of attributions.credits) {
      expect(credit.isPublicDomain, credit.title).toBe(true);
      expect(credit.objectUrl).toMatch(/^https:\/\/www\.metmuseum\.org\//);
      expect(credit.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const used = new Set(attributions.assets.map((a) => a.objectId));
    expect(new Set(attributions.credits.map((c) => c.objectId))).toEqual(used);
  });

  it("keeps the night print at the 16:10 frame the design was made for", () => {
    const night = attributions.assets.find((a) => a.role === "night-print")!;
    const big = night.files[0]!;
    expect(big.width / big.height).toBeGreaterThan(1.55);
    expect(big.width / big.height).toBeLessThan(1.65);
  });

  it("carries a tiny blur preview and measured brightest and darkest colours for every asset", () => {
    for (const asset of attributions.assets) {
      expect(asset.blur).toMatch(/^data:image\/webp;base64,/);
      expect(asset.blur.length).toBeLessThan(3000);
      expect(asset.brightest).toHaveLength(3);
      expect(asset.darkest).toHaveLength(3);
    }
  });
});
