import { describe, expect, it } from "vitest";
import { assertPublicDomain, encodeWithinBudget, findPaperRegion, luminance01, percentileColor, trimRegion, type MetObject } from "./art";

const obj = (over: Partial<MetObject> = {}): MetObject => ({
  objectID: 1,
  isPublicDomain: true,
  title: "A print",
  artistDisplayName: "An artist",
  objectDate: "1830",
  creditLine: "Credit",
  objectURL: "https://www.metmuseum.org/art/collection/search/1",
  primaryImage: "https://images.metmuseum.org/x.jpg",
  ...over,
});

describe("assertPublicDomain", () => {
  it("accepts a public-domain object with an image", () => {
    expect(() => assertPublicDomain(obj())).not.toThrow();
  });
  it("refuses an object that is not public domain", () => {
    expect(() => assertPublicDomain(obj({ isPublicDomain: false }))).toThrow(/not public domain/);
  });
  it("refuses an object without a primary image", () => {
    expect(() => assertPublicDomain(obj({ primaryImage: "" }))).toThrow(/no primaryImage/);
  });
});

describe("trimRegion", () => {
  it("cuts the fractions from each side", () => {
    expect(trimRegion(1000, 500, { left: 0.1, right: 0.2, top: 0.1, bottom: 0.3 })).toEqual({ left: 100, top: 50, width: 700, height: 300 });
  });
  it("throws when the trim leaves nothing", () => {
    expect(() => trimRegion(100, 100, { left: 0.6, right: 0.5, top: 0, bottom: 0 })).toThrow(/nothing/);
  });
});

describe("luminance01 and percentileColor", () => {
  it("orders black below white", () => {
    expect(luminance01(0, 0, 0)).toBe(0);
    expect(luminance01(255, 255, 255)).toBeCloseTo(1, 5);
  });
  it("returns the colour at the requested luminance percentile", () => {
    // ten grey pixels, 0, 25, 50 ... 225
    const px = new Uint8Array(30);
    for (let i = 0; i < 10; i++) px.fill(i * 25, i * 3, i * 3 + 3);
    expect(percentileColor(px, 1)).toEqual([225, 225, 225]);
    expect(percentileColor(px, 0)).toEqual([0, 0, 0]);
  });
});

describe("findPaperRegion", () => {
  it("picks the flat bright window and avoids the dark noisy one", () => {
    const w = 64;
    const h = 32;
    const gray = new Uint8Array(w * h).fill(230);
    // left half: dark noisy ink
    for (let y = 0; y < h; y++) for (let x = 0; x < 32; x++) gray[y * w + x] = (x * 37 + y * 11) % 90;
    const r = findPaperRegion(gray, w, h, 16);
    expect(r.x).toBeGreaterThanOrEqual(32);
    expect(r.size).toBe(16);
  });
  it("throws when no window is bright enough", () => {
    expect(() => findPaperRegion(new Uint8Array(32 * 32).fill(40), 32, 32, 16)).toThrow(/paper/);
  });
});

describe("encodeWithinBudget", () => {
  const sizes = (q: number) => Buffer.alloc(q * 1000);
  it("returns the highest quality that fits", async () => {
    const r = await encodeWithinBudget(async (q) => sizes(q), 70_000, 82, 50, 4);
    expect(r.quality).toBe(70);
    expect(r.buffer.length).toBeLessThanOrEqual(70_000);
  });
  it("throws when even the floor quality is too big", async () => {
    await expect(encodeWithinBudget(async (q) => sizes(q), 10_000, 82, 50, 4)).rejects.toThrow(/budget/);
  });
});
