import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

const ART = join(import.meta.dirname, "..", "src", "live", "sim", "artifacts");
const DIST = join(import.meta.dirname, "..", "dist");
const cycles = JSON.parse(readFileSync(join(ART, "manifest.json"), "utf8")).meshes as Record<string, { cycles: number }>;
const grouped = (n: number) => n.toLocaleString("en-US");

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const live = (page: Page) => page.locator("#live");
const runButton = (page: Page) => live(page).getByRole("button", { name: "Run on the chip" });
async function runChip(page: Page) {
  await expect(live(page).getByRole("button", { name: "Example: cat" })).toBeVisible();
  await runButton(page).click();
}
const verdict = (page: Page) => live(page).locator(".live-verdict");

/** Opens the page and scrolls the section into view: its examples and 3D chunk load when it nears the viewport, and where it sits depends on the viewport and fonts. */
async function openLive(page: Page, path = "/") {
  await page.goto(path);
  await live(page).scrollIntoViewIfNeeded();
}

// A tiny PNG encoder so upload tests need no fixture files.
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) Buffer.from(pixel(x, y)).copy(row, 1 + x * 4);
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("the entry chunk has no 3D library, and nothing heavy loads before Run", async ({ page }) => {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const entry = /src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(entry, "entry script in dist/index.html").toBeTruthy();
  expect(readFileSync(join(DIST, entry!), "utf8")).not.toContain("WebGLRenderer");

  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await openLive(page);
  await expect(live(page).getByRole("button", { name: "Example: cat" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requested.filter((p) => /\/assets\/(cifar-|program-|weights|worker-)/.test(p))).toEqual([]);
});

test("Run on the cat checks out against the reference and the golden, and the scene appears", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await openLive(page);
  await runChip(page);
  await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 60_000 });
  await expect(verdict(page)).toContainText("Python golden");
  await expect(live(page).locator(".live-cycle-total")).toHaveText(grouped(cycles["2x2"]!.cycles));
  await expect(live(page).locator(".live-scene canvas[data-scene-ready='true']")).toBeVisible();
  await expect(live(page).locator(".live-layers li")).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("pausing at the end names the cat, and the readout and layer strip follow the slider", async ({ page }) => {
  await openLive(page);
  await runChip(page);
  await expect(verdict(page)).toBeVisible({ timeout: 60_000 });
  await live(page).getByRole("button", { name: /^(Pause|Replay)$/ }).click();
  const slider = live(page).getByRole("slider", { name: "Cycle" });
  await slider.fill("30");
  await expect(live(page).locator(".live-layers li[aria-current='step']")).toHaveText("conv1");
  await expect(live(page).locator(".live-readout")).toContainText(/of 4 tiles busy in conv1/);
  await slider.fill(String(cycles["2x2"]!.cycles));
  await expect(live(page).locator(".live-layers li[aria-current='step']")).toHaveText("fc");
  await expect(live(page).locator(".live-logits li[aria-current='true']")).toContainText("cat");
  await expect(live(page).getByRole("button", { name: "Replay" })).toBeVisible();
});

test("the 3D view redraws when the slider moves while paused", async ({ page }) => {
  await openLive(page);
  await runChip(page);
  await expect(verdict(page)).toBeVisible({ timeout: 60_000 });
  await live(page).getByRole("button", { name: /^(Pause|Replay)$/ }).click();
  const canvas = live(page).locator(".live-scene canvas[data-scene-ready='true']");
  await expect(canvas).toBeVisible();
  const slider = live(page).getByRole("slider", { name: "Cycle" });
  await slider.fill("30");
  await page.waitForTimeout(300);
  const early = await canvas.screenshot();
  await slider.fill("60000");
  await page.waitForTimeout(300);
  const later = await canvas.screenshot();
  expect(early.equals(later), "the scene looks the same at cycle 30 and cycle 60,000").toBe(false);
});

test("the 4x4 mesh runs the same image on 16 tiles in fewer cycles than 1x1", async ({ page }) => {
  await openLive(page);
  await live(page).getByRole("radio", { name: "4x4 (16 tiles)" }).check();
  await runChip(page);
  await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 90_000 });
  await expect(live(page).locator(".live-cycle-total")).toHaveText(grouped(cycles["4x4"]!.cycles));
  await live(page).getByRole("button", { name: /^(Pause|Replay)$/ }).click();
  await live(page).getByRole("slider", { name: "Cycle" }).fill("60000");
  await expect(live(page).locator(".live-readout")).toContainText(/of 16 tiles busy/);
  expect(cycles["4x4"]!.cycles).toBeLessThan(cycles["1x1"]!.cycles);
});

test("an uploaded picture is checked against the reference only", async ({ page }) => {
  await openLive(page);
  await expect(live(page).getByRole("button", { name: "Example: cat" })).toBeVisible();
  await live(page).getByLabel("Upload your own image").setInputFiles({
    name: "stripes.png",
    mimeType: "image/png",
    buffer: png(64, 48, (x) => (x % 16 < 8 ? [220, 40, 40, 255] : [30, 30, 200, 255])),
  });
  await expect(live(page).getByText("Using your image: stripes.png")).toBeVisible();
  await runButton(page).click();
  await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 60_000 });
  await expect(verdict(page)).not.toContainText("Python golden");
});

test("a transparent portrait picture and a landscape picture both run", async ({ page }) => {
  await openLive(page);
  await expect(live(page).getByRole("button", { name: "Example: cat" })).toBeVisible();
  for (const [name, w, h] of [["portrait.png", 30, 90], ["landscape.png", 90, 30]] as const) {
    await live(page).getByLabel("Upload your own image").setInputFiles({
      name,
      mimeType: "image/png",
      buffer: png(w, h, (x, y) => (x < w / 2 ? [0, 0, 0, 0] : [10, 200, 10, y < h / 2 ? 255 : 128])),
    });
    await expect(live(page).getByText(`Using your image: ${name}`)).toBeVisible();
    await runButton(page).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 60_000 });
  }
});

test("a file that is not an image is explained, and the section still works", async ({ page }) => {
  await openLive(page);
  await expect(live(page).getByRole("button", { name: "Example: cat" })).toBeVisible();
  await live(page).getByLabel("Upload your own image").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(live(page).locator(".live-notice")).toContainText("could not be read as an image");
  await runButton(page).click();
  await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 60_000 });
});

test("pressing Run on one mesh and then switching mesh never shows the first mesh's result", async ({ page }) => {
  await openLive(page);
  await live(page).getByRole("radio", { name: "4x4 (16 tiles)" }).check();
  await runChip(page);
  await live(page).getByRole("radio", { name: "1x1 (1 tile)" }).check();
  await runButton(page).click();
  await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 90_000 });
  await expect(live(page).locator(".live-result")).toHaveAttribute("data-mesh", "1x1");
  await expect(live(page).locator(".live-cycle-total")).toHaveText(grouped(cycles["1x1"]!.cycles));
});

test("a chip fault is reported, and the next run on a fresh module succeeds", async ({ page }) => {
  const zeros = Buffer.alloc(statSync(join(ART, "program-2x2.bin")).size);
  await page.route("**/program-2x2*.bin", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: zeros }));
  await openLive(page);
  await runChip(page);
  await expect(live(page).locator(".live-error")).toBeVisible({ timeout: 60_000 });
  await expect(live(page).locator(".live-error")).toContainText("chip");
  await page.unroute("**/program-2x2*.bin");
  await runButton(page).click();
  await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 60_000 });
});

test.describe("without WebGL", () => {
  test("the run still shows its strip, scores and check", async ({ page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await openLive(page);
    await runChip(page);
    await expect(verdict(page)).toHaveAttribute("data-state", "match", { timeout: 60_000 });
    await expect(live(page).locator(".live-fallback")).toContainText("WebGL");
    await expect(live(page).locator("canvas[data-scene-ready]")).toHaveCount(0);
    await expect(live(page).locator(".live-layers li")).toHaveCount(6);
  });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the run starts paused at its end with the scores shown", async ({ page }) => {
    await openLive(page);
    await runChip(page);
    await expect(verdict(page)).toBeVisible({ timeout: 60_000 });
    await expect(live(page).getByRole("button", { name: "Replay" })).toBeVisible();
    await expect(live(page).getByRole("slider", { name: "Cycle" })).toHaveValue(String(cycles["2x2"]!.cycles));
    await expect(live(page).locator(".live-logits li[aria-current='true']")).toContainText("cat");
  });
});

test("no horizontal scroll at 1280, 390 and 360 px with a run on screen and every drawer open", async ({ page }) => {
  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await openLive(page, "/?deep=1");
    await runChip(page);
    await expect(verdict(page)).toBeVisible({ timeout: 60_000 });
    expect(await noHorizontalScroll(page), `${width}px`).toBe(true);
  }
});

test("keyboard users can run, pause and step", async ({ page }) => {
  await openLive(page);
  await expect(live(page).getByRole("button", { name: "Example: cat" })).toBeVisible();
  await runButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(verdict(page)).toBeVisible({ timeout: 60_000 });
  const toggle = live(page).getByRole("button", { name: /^(Pause|Replay)$/ });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const slider = live(page).getByRole("slider", { name: "Cycle" });
  await slider.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("1");
});
