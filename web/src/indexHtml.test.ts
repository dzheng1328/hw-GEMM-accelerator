import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import summary from "./data/generated/summary.json";

const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const tag = (re: RegExp) => re.exec(html)?.[1];
const meta = (key: "name" | "property", value: string) =>
  tag(new RegExp(`<meta\\s+${key}="${value}"\\s+content="([^"]*)"`, "s"));
const SITE = "https://hw-gemm-accelerator.vercel.app";

describe("index.html head", () => {
  it("points the icons at real files in public/", () => {
    const icon = tag(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/);
    expect(icon).toBe("/favicon.svg");
    expect(existsSync(join(root, "public", "favicon.svg"))).toBe(true);
    const touch = tag(/<link rel="apple-touch-icon" href="([^"]+)"/);
    expect(touch).toBe("/apple-touch-icon.png");
    expect(existsSync(join(root, "public", "apple-touch-icon.png"))).toBe(true);
  });

  it("has a share preview: Open Graph, Twitter card and an absolute image URL that exists", () => {
    expect(meta("property", "og:title")).toBe("hw-GEMM accelerator");
    expect(meta("property", "og:type")).toBe("website");
    expect(meta("property", "og:url")).toBe(`${SITE}/`);
    expect(meta("property", "og:description")).toBe(meta("name", "description"));
    expect(meta("property", "og:image")).toBe(`${SITE}/og.png`);
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
    const alt = meta("property", "og:image:alt");
    expect(alt).toContain(Math.round(summary.lm.meshes["2x2_t256"].cycles).toLocaleString("en-US"));
    expect(alt).toContain(`${(summary.cifar.int8Accuracy * 100).toFixed(2)}%`);
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(existsSync(join(root, "public", "og.png"))).toBe(true);
  });

  it("has one theme colour (the inline theme script and the toggle update it) and no color-scheme meta", () => {
    expect(html).toMatch(/<meta name="theme-color" content="#0b1226"\s*\/>/);
    expect(html.match(/<meta name="theme-color"/g)).toHaveLength(1);
    expect(html).not.toContain('name="color-scheme"');
  });
});
