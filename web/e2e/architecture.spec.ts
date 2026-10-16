import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BLOCKS, STAGES } from "../src/content/architecture";
import { LIMITS, SUITES } from "../src/content/verification";

const performance = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "src", "data", "generated", "performance.json"), "utf8"),
);
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("the chip starts on the injection port and shows its number", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#architecture");
  await expect(section.locator(".arch-block")).toHaveCount(BLOCKS.length);
  await expect(section.locator(".arch-block[aria-pressed='true']")).toHaveAttribute("data-block", "corner");
  await expect(section.locator(".arch-detail-title")).toHaveText("Injection port at node (0,0)");
  await expect(section.locator(".arch-number")).toContainText(pct1(performance.cifar.meshes[2].cornerBusy));
});

test("clicking a block, and pressing Enter on a focused one, changes the panel", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#architecture");
  await section.locator(".arch-block[data-block='vpu']").click();
  await expect(section.locator(".arch-detail-title")).toHaveText("Vector unit");
  await expect(section.locator(".arch-number")).toContainText("15,108,284");

  await section.locator(".arch-block[data-block='dma_gather']").focus();
  await page.keyboard.press("Enter");
  await expect(section.locator(".arch-detail-title")).toHaveText("DMA gather");
  await expect(section.locator(".arch-block[aria-pressed='true']")).toHaveAttribute("data-block", "dma_gather");
});

test("the stepper in the drawer drives the same diagram", async ({ page }) => {
  await page.goto("/?deep=1");
  const section = page.locator("#architecture");
  const next = section.locator(".arch-stepper").getByRole("button", { name: "Next", exact: true });
  await next.click();
  await expect(section.locator(".arch-block[aria-pressed='true']")).toHaveAttribute("data-block", "noc");
  await expect(section.locator(".arch-stepper [aria-current='step']")).toContainText(STAGES[4]!.title);
  await section.locator(".arch-stepper").getByRole("button", { name: new RegExp(STAGES[0]!.title) }).click();
  await expect(section.locator(".arch-block[aria-pressed='true']")).toHaveAttribute("data-block", "cmd_seq");
  await expect(section.locator(".arch-stepper").getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
});

test("both ladders and the limits are visible without a click, and the suites table is in the drawer", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#verification");
  await expect(section.locator(".ladder")).toHaveCount(2);
  await expect(section.locator(".rung-card")).toHaveCount(7);
  await expect(section.locator(".limits li")).toHaveCount(LIMITS.length);
  await expect(section.locator(".limits li").nth(1)).toContainText("Place and route has been run for the processing element only");
  await expect(section.locator("tbody tr").first()).toBeHidden();
  await page.goto("/?deep=1");
  await expect(section.locator("tbody tr")).toHaveCount(SUITES.length);
  await expect(section.locator(".must-fail li")).toHaveCount(9);
});

test("no placeholder text is left and there are no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("/?deep=1");
  await expect(page.locator("#architecture .arch-block").first()).toBeVisible();
  await expect(page.getByText("Under construction")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("no horizontal scroll at 1280, 390 and 360 px with every drawer open", async ({ page }) => {
  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?deep=1");
    await expect(page.locator("#architecture .arch-stepper li").first()).toBeVisible();
    await expect(page.locator("#verification .suite-table").first()).toBeVisible();
    expect(await noHorizontalScroll(page), `${width}px`).toBe(true);
  }
});
