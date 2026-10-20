import { expect, test } from "@playwright/test";

test("switching the theme swaps the print and the colors, and keeps the choice", async ({ page }) => {
  await page.goto("/");
  const image = () => page.locator(".print-layer").evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await image()).toContain("night-print");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await image()).toContain("day-scroll");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(228, 218, 194)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#e4dac2");
});

test("forced colors hides the print and leaves the page on its solid background", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  expect(await page.locator(".print-layer").evaluate((el) => getComputedStyle(el).display)).toBe("none");
});
