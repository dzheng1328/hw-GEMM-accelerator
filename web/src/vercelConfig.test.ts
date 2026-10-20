import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `vite preview` ignores vercel.json, so no browser test can see the cache header; this keeps the rule that makes the
// hashed assets (the JS, CSS, fonts, the wasm and the data files) immutable in step with the paths the build writes.
const config = JSON.parse(readFileSync(join(import.meta.dirname, "..", "vercel.json"), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

const HASHED = [
  "/assets/index-0UGA9w6i.css",
  "/assets/index-C1x2y3z4.js",
  "/assets/ibm-plex-sans-latin-400-normal-Dk3lPq9a.woff2",
  "/assets/ibm-plex-mono-latin-600-normal-Zz81bQ2c.woff2",
  "/assets/accel_2x2-Bc12De34.wasm",
  "/assets/decisions-Qw12Er34.json",
];

describe("vercel.json cache headers", () => {
  const rule = config.headers.find((h) => new RegExp(`^${h.source}$`).test(HASHED[0]!));

  it("has a rule for the build's assets directory", () => {
    expect(rule, "no header rule matches /assets/...").toBeDefined();
  });

  it("matches every kind of hashed file the build writes", () => {
    const pattern = new RegExp(`^${rule!.source}$`);
    for (const path of HASHED) expect(pattern.test(path), path).toBe(true);
  });

  it("makes them cacheable for a year and immutable", () => {
    const cache = rule!.headers.find((h) => h.key.toLowerCase() === "cache-control")!;
    expect(cache.value).toContain("immutable");
    expect(cache.value).toMatch(/max-age=(\d+)/);
    expect(Number(/max-age=(\d+)/.exec(cache.value)![1])).toBeGreaterThanOrEqual(31536000);
  });

  it("does not cover the page itself, which must be revalidated to pick up a new build", () => {
    const pattern = new RegExp(`^${rule!.source}$`);
    for (const path of ["/", "/index.html", "/og.png", "/favicon.svg"]) expect(pattern.test(path), path).toBe(false);
  });
});
