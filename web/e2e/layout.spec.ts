import { expect, test, type Page } from "@playwright/test";

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `page is ${scrollWidth}px wide in a ${innerWidth}px window`).toBeLessThanOrEqual(innerWidth);
}

for (const width of [320, 390, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("the hero and the ribbon never make the page scroll sideways", async ({ page }) => {
      await page.goto("/");
      await noSidewaysScroll(page);
      await page.locator(".ribbon").scrollIntoViewIfNeeded();
      await expect(page.locator(".ribbon-svg rect.seg").first()).toBeAttached({ timeout: 15_000 });
      await noSidewaysScroll(page);
    });

    test("no two texts in the ribbon overlap, except a figure and its own caption", async ({ page }) => {
      await page.goto("/");
      await page.locator(".ribbon").scrollIntoViewIfNeeded();
      await expect(page.locator(".ribbon-svg text").first()).toBeAttached({ timeout: 15_000 });
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll(".ribbon-svg text")].map((t) => {
          const r = t.getBoundingClientRect();
          return { text: t.textContent!, pair: t.getAttribute("data-pair") ?? "", l: r.left, t: r.top, r: r.right, b: r.bottom };
        }),
      );
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const c = boxes[j]!;
          if (a.pair && a.pair === c.pair) continue;
          const wide = Math.min(a.r, c.r) - Math.max(a.l, c.l);
          const high = Math.min(a.b, c.b) - Math.max(a.t, c.t);
          expect(wide > 2 && high > 3, `"${a.text}" overlaps "${c.text}"`).toBe(false);
        }
      }
    });
  });
}
