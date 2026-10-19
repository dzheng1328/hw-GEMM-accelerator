import { expect, test, type Page } from "@playwright/test";
import { PROOF } from "../src/content/proof";

// These specs click tiles, not Run, so they opt out of the arrival auto-run the way a data-saver visitor does.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  });
  // landing is at once, so assertions do not race a smooth scroll; the ring is static under reduced motion
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const bar = (page: Page) => page.locator("header.topbar");
const tile = (page: Page, id: string) => page.locator(`a.tile[href="#${id}"]`);
const top = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!.y;

/** The target's top lands just under the sticky bar: after its scroll margin, within a pixel or two. */
async function expectBelowBar(page: Page, id: string) {
  const barBox = (await bar(page).boundingBox())!;
  const barBottom = barBox.y + barBox.height;
  await expect
    .poll(async () => top(page, `#${id}`), { message: `#${id} should sit just below the bar (bar bottom ${barBottom})` })
    .toBeGreaterThanOrEqual(barBottom - 1);
  expect(await top(page, `#${id}`), `#${id} top`).toBeLessThan(barBottom + 80);
}

const CASES: [string, string][] = [
  ["stories", PROOF.stories.id],
  ["cycles", PROOF.cycles.id],
  ["cifar", PROOF.cifar.id],
  ["scaling", PROOF.scaling.id],
];

for (const [name, id] of CASES) {
  test(`clicking the ${name} tile lands on its proof, rings it and moves focus there`, async ({ page }) => {
    await page.goto("/");
    await tile(page, id).click();
    // the ring lasts under two seconds, so look at it first
    if (name === "scaling") {
      await expect(page.locator("#proof-scaling rect.proof-flash")).toHaveCount(2);
      await expect(page.locator("#proof-scaling rect.bar[data-mesh='1x1']")).not.toHaveClass(/proof-flash/);
    } else {
      await expect(page.locator(`#${id}`)).toHaveClass(/proof-flash/);
    }
    await expectBelowBar(page, id);
    expect(await page.evaluate(() => window.location.hash)).toBe(`#${id}`);
    await expect(page.locator(`#${id}`)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(id);
    await expect(page.locator(".proof-flash")).toHaveCount(0, { timeout: 4000 });
  });
}

test("the cycles tile opens the Performance drawer first", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#performance details.drawer")).not.toHaveAttribute("open", "");
  await tile(page, PROOF.cycles.id).click();
  await expect(page.locator("#performance details.drawer")).toHaveAttribute("open", "");
  await expect(page.locator("#proof-cycles caption")).toContainText("Story model, 256 steps");
  await expectBelowBar(page, PROOF.cycles.id);
});

test("with motion allowed a tile click glides to its proof instead of jumping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  // content still arriving moves the page, and the pin then corrects at once: click after the page has settled
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const frames: number[] = [];
    (window as unknown as { __frames: number[] }).__frames = frames;
    const sample = () => {
      frames.push(Math.round(window.scrollY));
      if (frames.length < 150) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await tile(page, PROOF.cifar.id).click();
  // the helper below passes while the page is still gliding past, so let the sampled frames finish first
  await page.waitForFunction(() => (window as unknown as { __frames: number[] }).__frames.length >= 150);
  await expectBelowBar(page, PROOF.cifar.id);
  const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
  // a jump passes through two or three positions; a glide passes through dozens
  expect(new Set(frames).size, `scrollY by frame: ${frames.join(" ")}`).toBeGreaterThan(12);
});

test("the keyboard works: Enter on a focused tile does the same jump", async ({ page }) => {
  await page.goto("/");
  await tile(page, PROOF.cifar.id).focus();
  await page.keyboard.press("Enter");
  await expectBelowBar(page, PROOF.cifar.id);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(PROOF.cifar.id);
});

test("Back returns to where the tile was", async ({ page }) => {
  await page.goto("/");
  await tile(page, PROOF.cifar.id).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await tile(page, PROOF.cifar.id).click();
  await expectBelowBar(page, PROOF.cifar.id);
  await page.goBack();
  await expect
    .poll(() => page.evaluate((from) => Math.abs(window.scrollY - from), before), { message: `scrollY after Back, from ${before} before the click` })
    .toBeLessThanOrEqual(2);
});

test("a shared proof link lands on its target, rings it, and opens the drawer it sits in", async ({ page }) => {
  await page.goto(`/#${PROOF.cycles.id}`);
  await expect(page.locator("#performance details.drawer")).toHaveAttribute("open", "");
  await expectBelowBar(page, PROOF.cycles.id);
  await page.goto(`/#${PROOF.cifar.id}`);
  await expectBelowBar(page, PROOF.cifar.id);
});

test("Deep mode and a proof link together land on the target", async ({ page }) => {
  await page.goto(`/?deep=1#${PROOF.cycles.id}`);
  await expectBelowBar(page, PROOF.cycles.id);
});

test("a click while the replay data is still arriving above the target still lands below the bar", async ({ page }) => {
  // hold the recorded run back, so its arrival (which grows the replay section by thousands of pixels) comes after the click
  await page.route("**/assets/lm-*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/");
  await tile(page, PROOF.cifar.id).click();
  await page.waitForTimeout(2500);
  await expectBelowBar(page, PROOF.cifar.id);
});

test("clicking a tile never changes the shared mesh or starts a run", async ({ page }) => {
  await page.goto("/");
  await tile(page, PROOF.scaling.id).click();
  await expectBelowBar(page, PROOF.scaling.id);
  await expect(page.locator(".hero-mesh button[aria-pressed='true']")).toHaveText("2x2");
  await expect(page.getByRole("group", { name: "Live chip", exact: true }).getByRole("button", { name: "Run the chip" })).toBeVisible();
});
