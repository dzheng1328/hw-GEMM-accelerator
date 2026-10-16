import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const gen = (name: string): any => // eslint-disable-line @typescript-eslint/no-explicit-any
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "src", "data", "generated", name), "utf8"));
const steps = gen("lm-steps.json").steps as { cycles: number }[];
const stories = gen("lm-stories.json").stories as { text: string }[];
const probs = gen("lm-attention.json").probs as number[][][][];
const stepSum = steps.reduce((a, s) => a + s.cycles, 0);
const grouped = (n: number) => Math.round(n).toLocaleString("en-US");
const CELLS = probs[0]!.length * probs[0]![0]!.length;
const HERO_CYCLES = grouped(gen("summary.json").lm.meshes["2x2_t256"].cycles);

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("with reduced motion the replay starts at the end", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows all eight stories, the final counter and a Replay button", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".lane")).toHaveCount(8);
    await expect(page.locator(".counter-value")).toHaveText(grouped(stepSum));
    await expect(page.getByRole("button", { name: "Replay" })).toBeVisible();
    const first = await page.locator(".lane-text").first().evaluate((el) => el.textContent);
    expect(first).toBe(stories[0]!.text);
  });

  test("the deep drawer shows the head grid, and a head can be selected", async ({ page }) => {
    await page.goto("/?deep=1");
    await expect(page.locator(".head-cell")).toHaveCount(CELLS);
    const second = page.locator(".head-cell").nth(1);
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".overlay .otok")).toHaveCount(steps.length);
  });

  test("no horizontal scroll at 1280, 390 and 360 px with everything loaded", async ({ page }) => {
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/?deep=1");
      await expect(page.locator(".head-cell")).toHaveCount(CELLS);
      expect(await noHorizontalScroll(page), `${width}px`).toBe(true);
    }
  });
});

test("autoplay starts by itself once the section is in view, and can be paused", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".lane")).toHaveCount(8);
  await page.locator(".controls").scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".counter-value").textContent(), { timeout: 5000 }).not.toBe("0");
  await page.getByRole("button", { name: "Pause" }).click();
  const held = await page.locator(".counter-value").textContent();
  await page.waitForTimeout(400);
  expect(await page.locator(".counter-value").textContent()).toBe(held);
});

test("the page paints before the data arrives", async ({ page }) => {
  await page.route(/lm-attention/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText(HERO_CYCLES, { exact: true })).toBeVisible();
  await expect(page.getByText("Loading the recorded run...")).toBeVisible();
  await expect(page.locator(".lane")).toHaveCount(8, { timeout: 15_000 });
});

test("the page keeps working when the data fails to load", async ({ page }) => {
  await page.route(/lm-attention/, (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await expect(page.getByText(HERO_CYCLES, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deep mode" })).toBeVisible();
});
