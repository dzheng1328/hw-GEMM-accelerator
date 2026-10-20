import { expect, test, type Page } from "@playwright/test";

/** Walks down the page once so every lazy section has loaded, then waits for the heights to stop changing. */
async function settle(page: Page): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 60 && stable < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    stable = h === last ? stable + 1 : 0;
    last = h;
  }
}

/**
 * The heights of the parts of the page the replay does not grow (the replay autoplays for everyone who allows motion,
 * so the page's total height is not comparable between two loads).
 */
const SECTIONS = [".hero-band", "#performance", "#architecture", "#verification", "#built", ".ribbon"];
const heights = (page: Page) =>
  page.evaluate((selectors) => Object.fromEntries(selectors.map((s) => [s, document.querySelector(s)?.getBoundingClientRect().height ?? -1])), SECTIONS);

test.describe("with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  test("motion adds no height: every section is as tall with it as with ?motion=0", async ({ page }) => {
    await page.goto("/?motion=0");
    await settle(page);
    const off = await heights(page);
    await page.goto("/");
    await settle(page);
    await page.waitForTimeout(3000); // let every animation finish
    const on = await heights(page);
    for (const selector of SECTIONS) {
      expect(off[selector], `${selector} exists`).toBeGreaterThan(0);
      expect(Math.abs(on[selector]! - off[selector]!), `${selector}: ${on[selector]}px with motion, ${off[selector]}px without`).toBeLessThanOrEqual(1);
    }
  });

  test("the stroke ribbon draws itself and ends fully shown", async ({ page }) => {
    await page.goto("/");
    await page.locator(".ribbon").scrollIntoViewIfNeeded();
    await expect(page.locator(".ribbon-svg g[data-motion]").first()).toHaveAttribute("data-motion", "done", { timeout: 20_000 });
    await expect(page.locator(".ribbon-svg rect.seg")).toHaveCount(256 * 4);
    const clip = await page.locator(".ribbon-svg g[data-motion]").first().evaluate((el) => getComputedStyle(el).clipPath);
    expect(clip === "none" || /inset\(0(px|%)? 0(px|%)? 0(px|%)? 0(px|%)?\)/.test(clip), `clip-path ended as ${clip}`).toBe(true);
  });

  test("the lead hero figure counts up and then shows the exact final number", async ({ page }) => {
    await page.goto("/");
    const figure = page.locator(".hero .tile:first-child .figure");
    // it counts when it comes into view, which on a short window is below the fold
    await figure.scrollIntoViewIfNeeded();
    await expect(figure).toHaveAttribute("data-motion", "done", { timeout: 15_000 });
    await expect(figure.locator(".figure-final")).toHaveText(/^\d{1,3}(,\d{3})+$/);
    await expect(figure.locator(".figure-live")).toHaveText("");
  });

  test("the print layer drifts with the scroll, by transform only", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(() => page.locator(".print-layer").evaluate((el) => getComputedStyle(el).transform), { timeout: 15_000 })
      .not.toBe("none");
  });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing is animated or hidden: no motion marker appears and the ribbon is whole at once", async ({ page }) => {
    await page.goto("/");
    await page.locator(".ribbon").scrollIntoViewIfNeeded();
    await expect(page.locator(".ribbon-svg rect.seg")).toHaveCount(256 * 4, { timeout: 20_000 });
    expect(await page.locator("[data-motion]").count()).toBe(0);
    expect(await page.locator(".ribbon").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    expect(await page.locator(".print-layer").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  });
});
