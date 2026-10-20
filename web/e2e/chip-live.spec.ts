import { expect, test, type Page } from "@playwright/test";

test.setTimeout(150_000);

const DONE = /Predicted: cat - checked against the reference/;
const status = (page: Page) => page.locator(".hero-status");
const block = (page: Page, id: string) => page.locator(`#architecture .arch-block[data-block='${id}']`);
const counter = (page: Page, id: string) => block(page, id).locator(".arch-live");
const strip = (page: Page) => page.locator("#architecture .arch-run");
const number = async (page: Page, id: string) => Number(((await counter(page, id).textContent()) ?? "").replace(/[^0-9]/g, ""));

test("the diagram follows the hero's run: counters, lit blocks, a dark vector unit, and a working Replay", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("/");
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  await page.locator("#architecture").scrollIntoViewIfNeeded();

  // the run has finished: the strip rests on its end, and the counters hold final values
  await expect(strip(page)).toContainText(/^2x2 mesh - cycle (\d[\d,]*) of \1 - layer 6 of 6/);
  expect(await number(page, "dma_gather")).toBeGreaterThan(1000);
  expect(await number(page, "noc")).toBeGreaterThan(1000);
  await expect(counter(page, "vpu")).toHaveText("not used");
  await expect(block(page, "vpu")).not.toHaveClass(/arch-lit/);

  // Replay restarts the clock from zero and the diagram plays along
  const finalDma = await number(page, "dma_gather");
  await strip(page).getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => number(page, "dma_gather"), { message: "the counter restarts below its final value" }).toBeLessThan(finalDma);
  let seenLit = false;
  let last = await number(page, "dma_gather");
  const ended = /cycle (\d[\d,]*) of \1/;
  for (let i = 0; i < 100; i++) {
    if ((await page.locator("#architecture .arch-lit").count()) > 0) seenLit = true;
    const now = await number(page, "dma_gather");
    expect(now, "the DMA counter never goes down while playing").toBeGreaterThanOrEqual(last);
    last = now;
    await expect(block(page, "vpu")).not.toHaveClass(/arch-lit/);
    if (ended.test((await strip(page).textContent()) ?? "")) break;
    await page.waitForTimeout(250);
  }
  expect(seenLit, "some block lit while the run played").toBe(true);
  expect(last, "the DMA counter grew").toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("selecting a block shows its run numbers in the panel, and the vector unit says it is not used", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  await page.locator("#architecture").scrollIntoViewIfNeeded();
  await block(page, "dma_gather").click();
  await expect(page.locator("#architecture .arch-live-row")).toContainText("The DMA gather was busy in");
  await block(page, "vpu").click();
  await expect(page.locator("#architecture .arch-live-row")).toContainText("no vector commands");
  await expect(page.locator("#architecture .arch-live-row").locator("xpath=ancestor-or-self::*[@aria-live]")).toHaveCount(0);
});

test("with data saver on there is no run: dashes in the blocks, an invitation, and a Run button that works", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  });
  await page.goto("/");
  await page.locator("#architecture").scrollIntoViewIfNeeded();
  await expect(strip(page)).toContainText("Run the chip to see this light up.");
  await expect(counter(page, "dma_gather")).toHaveText("-");
  await expect(page.locator("#architecture .arch-lit")).toHaveCount(0);
  await expect(page.locator("#architecture .arch-live-row")).toHaveCount(0);

  await strip(page).getByRole("button", { name: "Run the chip", exact: true }).click();
  await expect(strip(page)).toContainText(/2x2 mesh - cycle/, { timeout: 90_000 });
  await expect(status(page)).toBeVisible();
  await expect(strip(page).getByRole("button", { name: "Replay", exact: true })).toBeVisible();
});

test("changing the mesh while the diagram is on screen restarts its counters on the new run", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toHaveText(DONE, { timeout: 90_000 });
  await page.locator("#performance .mesh-selector").getByRole("button", { name: "1x1", exact: true }).click();
  await page.locator("#architecture").scrollIntoViewIfNeeded();
  await expect(strip(page)).toContainText(/^1x1 mesh - cycle/, { timeout: 90_000 });
  await expect(counter(page, "dma_gather")).not.toHaveText("-");
});

test("no horizontal scroll at 390 px with the taller diagram", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?deep=1");
  await expect(page.locator("#architecture .arch-block").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
