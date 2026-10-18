import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

const ART = join(import.meta.dirname, "..", "src", "live", "sim", "artifacts");
const cycles = JSON.parse(readFileSync(join(ART, "manifest.json"), "utf8")).meshes as Record<string, { cycles: number }>;
const grouped = (n: number) => n.toLocaleString("en-US");

const status = (page: Page) => page.locator(".hero-status");
const mesh = (page: Page, name: string) => page.locator(".hero-mesh").getByRole("button", { name, exact: true });
const DONE = /Predicted: cat - checked against the reference/;

test("on arrival the hero runs the cat on 2x2 by itself, once, with no errors", async ({ page }) => {
  const errors: string[] = [];
  const programRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/program-/.test(path)) programRequests.push(path);
  });
  await page.goto("/");
  await expect(page.locator(".hero-stage-view canvas[data-scene-ready='true']")).toBeVisible({ timeout: 60_000 });
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  await expect(page.locator(".hero-run")).toHaveText("Replay");
  await expect(mesh(page, "2x2")).toHaveAttribute("aria-pressed", "true");
  expect(programRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("the Live section shows the very same run", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  await page.locator("#live").scrollIntoViewIfNeeded();
  await expect(page.locator("#live .live-verdict")).toHaveAttribute("data-state", "match");
  await expect(page.locator("#live .live-cycle-total")).toHaveText(grouped(cycles["2x2"]!.cycles));
  await expect(page.locator("#live .live-logits li[aria-current='true']")).toContainText("cat");
});

test("the stage keeps its size when the 3D scene replaces the board and when the run starts", async ({ page }) => {
  await page.goto("/");
  const stage = page.locator(".hero-stage-view");
  await expect(stage).toBeVisible();
  const first = await stage.boundingBox();
  await expect(page.locator(".hero-stage-view[data-ready='true']")).toBeVisible({ timeout: 60_000 });
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  const last = await stage.boundingBox();
  expect(Math.abs(last!.height - first!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(last!.width - first!.width)).toBeLessThanOrEqual(1);
});

test("the numbers below the stage do not move while the status text changes", async ({ page }) => {
  await page.goto("/");
  const tile = page.locator(".tile").first();
  await expect(tile).toBeVisible();
  // the web fonts swap in after first paint and re-wrap the text above; that is not what this test is about
  await page.evaluate(() => document.fonts.ready);
  const top = async () => (await tile.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
  const first = await top();
  await expect(status(page)).toHaveText(/cycle \d/, { timeout: 90_000 });
  expect(Math.abs((await top()) - first)).toBeLessThanOrEqual(1);
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  expect(Math.abs((await top()) - first)).toBeLessThanOrEqual(1);
});

test("a mesh pill re-runs the same image on that mesh, and the whole page follows", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  await mesh(page, "1x1").click();
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  await expect(mesh(page, "1x1")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#live").scrollIntoViewIfNeeded();
  await expect(page.locator("#live .live-result")).toHaveAttribute("data-mesh", "1x1");
  await expect(page.locator("#live .live-cycle-total")).toHaveText(grouped(cycles["1x1"]!.cycles));
  await page.locator("#performance").scrollIntoViewIfNeeded();
  await expect(page.locator("#performance").getByRole("button", { name: "1x1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#performance .mesh-tile")).toHaveCount(1);
});

test("clicking a performance bar re-runs the hero on that mesh, and Watch it scrolls back up", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  const performance = page.locator("#performance");
  await performance.scrollIntoViewIfNeeded();
  await performance.getByRole("button", { name: "Select 4x4 - Speedup over 1x1" }).click();
  await expect(performance.locator(".mesh-run-status")).toContainText("Running the cat on 4x4");
  await expect(performance.locator(".mesh-run-status")).toContainText(/Ran the cat on 4x4: [\d,]+ cycles/, { timeout: 90_000 });
  await expect(performance.locator(".mesh-tile")).toHaveCount(16);
  await performance.getByRole("button", { name: "Watch it" }).click();
  await expect(page.locator(".hero-stage-view")).toBeInViewport();
  await expect(mesh(page, "4x4")).toHaveAttribute("aria-pressed", "true");
  // the replay plays out over about 20 seconds
  await expect(status(page)).toHaveText(DONE, { timeout: 60_000 });
});

test("a visitor who presses Run in the Live section before the hero finishes still gets one run", async ({ page }) => {
  const programRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/program-/.test(path)) programRequests.push(path);
  });
  await page.goto("/");
  await page.locator("#live").scrollIntoViewIfNeeded();
  await page.locator("#live").getByRole("button", { name: "Run on the chip" }).click();
  await expect(page.locator("#live .live-verdict")).toHaveAttribute("data-state", "match", { timeout: 90_000 });
  expect(programRequests.length).toBeLessThanOrEqual(1);
});

test("the first number tile is partly visible above the fold on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const box = await page.locator(".tile").first().boundingBox();
  expect(box!.y).toBeLessThan(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing heavy loads and nothing runs until Run is pressed, and then it runs", async ({ page }) => {
    const heavy: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/\/assets\/(cifar-|program-|weights|worker-)/.test(path)) heavy.push(path);
    });
    await page.goto("/");
    await expect(page.locator(".hero-stage-view")).toBeVisible();
    await expect(status(page)).toHaveText("Press Run to watch the chip classify an image.");
    await page.waitForLoadState("networkidle");
    expect(heavy).toEqual([]);
    await page.getByRole("button", { name: "Run the chip" }).click();
    await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
    await expect(page.locator(".hero-run")).toHaveText("Replay");
  });
});

test.describe("without WebGL", () => {
  test("the board stays, nothing runs by itself, and Run still works", async ({ page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await page.goto("/");
    await expect(page.locator(".hero-stage-view .board-tile")).toHaveCount(4);
    await expect(page.locator(".hero-stage-view canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "Run the chip" }).click();
    await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  });
});
