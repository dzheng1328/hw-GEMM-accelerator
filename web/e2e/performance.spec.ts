import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TIMELINE } from "../src/content/timeline";

const performance = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "src", "data", "generated", "performance.json"), "utf8"),
);
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const grouped = (n: number) => Math.round(n).toLocaleString("en-US");

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("the page has six sections, with the live demo second, the performance section third and the timeline last", async ({ page }) => {
  await page.goto("/");
  const ids = await page.locator("main > section").evaluateAll((els) => els.map((e) => e.id));
  expect(ids).toEqual(["replay", "live", "performance", "architecture", "verification", "built"]);
});

test("the performance section starts on the shared 2x2 and redraws when another mesh is chosen", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#performance");
  await expect(section.getByRole("button", { name: "2x2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(section.locator(".mesh-tile")).toHaveCount(4);
  await expect(section.locator(".port-text")).toContainText(pct1(performance.cifar.meshes[2].cornerBusy));

  await section.getByRole("button", { name: "1x1", exact: true }).click();
  await expect(section.locator(".mesh-tile")).toHaveCount(1);
  await expect(section.locator(".port-text")).toContainText(pct1(performance.cifar.meshes[0].cornerBusy));
  await expect(section.locator(".mesh-stats")).toContainText(grouped(performance.cifar.meshes[0].cyclesPerUnit));
});

test("a mesh the chip is not built for can be looked at here without touching the hero", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#performance");
  await section.getByRole("button", { name: "3x3", exact: true }).click();
  await expect(section.locator(".mesh-tile")).toHaveCount(9);
  await expect(page.locator(".hero-mesh").getByRole("button", { name: "2x2", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("the two workloads and their findings are visible without any click", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#performance");
  await expect(section.getByText("CIFAR-10 saturates at the injection port", { exact: false })).toBeVisible();
  await expect(section.getByText("The story model is not port-bound", { exact: false })).toBeVisible();
  await expect(section.locator(".port-row")).toHaveCount(2);
});

test("the timeline rail shows the headline milestones, and Deep mode shows all of them", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#built .rail button[data-node]")).toHaveCount(TIMELINE.filter((n) => n.headline).length);
  await page.goto("/?deep=1");
  await expect(page.locator("#built .rail button[data-node]")).toHaveCount(TIMELINE.length);
  await expect(page.locator("#built .rail-band")).toHaveCount(4);
});

test("no horizontal scroll at 1280, 390 and 360 px with every drawer open", async ({ page }) => {
  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?deep=1");
    await expect(page.locator("#built .tl-panel")).toBeVisible();
    await expect(page.locator("#performance .data-table").first()).toBeVisible();
    expect(await noHorizontalScroll(page), `${width}px`).toBe(true);
  }
});
