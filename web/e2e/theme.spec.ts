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

for (const theme of ["dark", "light"]) {
  test(`the story lanes keep a visible divider on the replay sheet in the ${theme} theme`, async ({ page }) => {
    await page.goto("/");
    if (theme === "light") await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.locator("#replay").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll("#replay .lane").length > 0);
    const ratio = await page.locator("#replay .lane").first().evaluate((lane) => {
      const channels = (css: string) => css.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const line = lum(channels(getComputedStyle(lane).borderTopColor));
      const paper = lum(channels(getComputedStyle(lane.closest(".replay-stage")!).backgroundColor));
      return (Math.max(line, paper) + 0.05) / (Math.min(line, paper) + 0.05);
    });
    expect(ratio, "contrast of the divider against the sheet").toBeGreaterThanOrEqual(1.5);
  });
}

test("under forced colors the four kinds of work in the ribbon are four different colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await page.locator(".ribbon-frame :is(.replay-loading, .ribbon-svg)").first().waitFor({ timeout: 15_000 });
  await page.locator(".ribbon").scrollIntoViewIfNeeded();
  await expect(page.locator(".ribbon-svg rect.swatch")).toHaveCount(4, { timeout: 15_000 });
  const fills = await page.locator(".ribbon-svg rect.swatch").evaluateAll((els) => els.map((el) => `${getComputedStyle(el).fill} @${getComputedStyle(el).fillOpacity}`));
  expect(new Set(fills).size, fills.join(" | ")).toBe(4);
});
