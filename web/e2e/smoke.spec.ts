import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const summary = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "src", "data", "generated", "summary.json"), "utf8"),
);
const grouped = (n: number) => Math.round(n).toLocaleString("en-US");
const HERO = [
  `${summary.lm.stories} × ${summary.lm.steps}`,
  grouped(summary.lm.meshes["2x2_t256"].cycles),
  `${(summary.cifar.int8Accuracy * 100).toFixed(2)}%`,
  `${summary.lm.scalingVsOneByOne["2x2"].toFixed(2)}x`,
];

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("the hero numbers are visible with no click and no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/");
  for (const value of HERO) await expect(page.getByText(value, { exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

test("Deep mode opens every drawer, shares through the URL, and closes them again", async ({ page }) => {
  await page.goto("/?utm=x");
  const toggle = page.getByRole("button", { name: "Deep mode" });
  const open = () => page.locator("details[open]").count();

  expect(await open()).toBe(0);
  await toggle.click();
  expect(await open()).toBe(4);
  expect(new URL(page.url()).search).toBe("?utm=x&deep=1");
  await toggle.click();
  expect(await open()).toBe(0);
  expect(new URL(page.url()).search).toBe("?utm=x");

  await page.goto("/?deep=1");
  expect(await open()).toBe(4);
});

test("no horizontal scroll at 1280, 390 and 360 px", async ({ page }) => {
  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    expect(await noHorizontalScroll(page), `${width}px`).toBe(true);
    const longest = await page
      .getByText(HERO[1]!, { exact: true })
      .evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(longest, `${width}px: the longest hero number is clipped`).toBe(true);
  }
});

test("the light scheme repaints the page", async ({ page }) => {
  await page.goto("/");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).toBe("rgb(11, 15, 20)");
  await page.emulateMedia({ colorScheme: "light" });
  expect(await background()).toBe("rgb(247, 249, 251)");
});
