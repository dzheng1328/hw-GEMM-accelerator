import { expect, test, type Page } from "@playwright/test";
import { TIMELINE } from "../src/content/timeline";

const HEADLINE = TIMELINE.filter((n) => n.headline);
const LATEST = HEADLINE[HEADLINE.length - 1]!;

const rail = (page: Page) => page.locator("#built .rail");
const dots = (page: Page) => rail(page).locator("button[data-node]");
const dot = (page: Page, id: string) => rail(page).locator(`button[data-node="${id}"]`);
const selected = (page: Page) => rail(page).locator("button[aria-pressed='true']");
const panel = (page: Page) => page.locator("#built .tl-panel");
const title = (page: Page) => panel(page).locator(".tl-title");
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// The timeline never presses Run, and the replay data (which grows the page above this section by thousands of pixels
// when it arrives) is not what these specs are about: block it, so no position or height measured here can be moved by it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  });
  await page.route("**/assets/lm-*", (route) => route.abort());
});

async function openBuilt(page: Page, url = "/") {
  await page.goto(url);
  // the decision file is only fetched once the section is near the screen, so the page can settle before it is asked for
  await page.waitForLoadState("networkidle");
  await rail(page).scrollIntoViewIfNeeded();
  await expect(panel(page)).toBeVisible();
}

test("opens on the latest headline milestone, with the headline milestones on the rail", async ({ page }) => {
  await openBuilt(page);
  await expect(dots(page)).toHaveCount(HEADLINE.length);
  await expect(selected(page)).toHaveAttribute("data-node", LATEST.id);
  await expect(title(page)).toHaveText(LATEST.title);
  await expect(panel(page).locator(".tl-skim").first()).toBeVisible();
});

test("choosing a milestone fills the panel and never moves the page", async ({ page }) => {
  await openBuilt(page);
  await expect(panel(page).locator(".tl-skim").first()).toBeVisible();
  const first = HEADLINE[0]!;
  await dot(page, first.id).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await dot(page, first.id).click();
  await expect(title(page)).toHaveText(first.title);
  await expect(selected(page)).toHaveAttribute("data-node", first.id);
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before), `scrollY ${before} -> ${after}`).toBeLessThanOrEqual(1);
});

test("the keyboard: arrows, Home and End move the selection and the focus, and the rail is one Tab stop", async ({ page }) => {
  await openBuilt(page);
  await selected(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(selected(page)).toHaveAttribute("data-node", HEADLINE[HEADLINE.length - 2]!.id);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-node"))).toBe(HEADLINE[HEADLINE.length - 2]!.id);
  await page.keyboard.press("Home");
  await expect(selected(page)).toHaveAttribute("data-node", HEADLINE[0]!.id);
  await page.keyboard.press("End");
  await expect(selected(page)).toHaveAttribute("data-node", LATEST.id);
  expect(await rail(page).locator("button[data-node][tabindex='0']").count()).toBe(1);
});

test("Previous and Next step through the milestones and stop at the ends", async ({ page }) => {
  await openBuilt(page);
  await expect(page.getByRole("button", { name: "Next milestone", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous milestone", exact: true }).click();
  await expect(selected(page)).toHaveAttribute("data-node", HEADLINE[HEADLINE.length - 2]!.id);
  await expect(page.getByRole("button", { name: "Next milestone", exact: true })).toBeEnabled();
});

test("Show all adds the other milestones, and Deep mode starts with all of them and the record open", async ({ page }) => {
  await openBuilt(page);
  await page.getByRole("button", { name: `Show all ${TIMELINE.length}`, exact: true }).click();
  await expect(dots(page)).toHaveCount(TIMELINE.length);
  await expect(rail(page).locator(".rail-band")).toHaveCount(4);
  await openBuilt(page, "/?deep=1");
  await expect(dots(page)).toHaveCount(TIMELINE.length);
  await expect(page.getByRole("button", { name: /^Show all/ })).toHaveCount(0);
  await expect(panel(page).locator("details.tl-record")).toHaveAttribute("open", "");
});

test("the full record opens from the disclosure and shows Context first", async ({ page }) => {
  await openBuilt(page);
  await expect(panel(page).locator(".tl-skim").first()).toBeVisible();
  await panel(page).locator("details.tl-record > summary").click();
  await expect(panel(page).locator("details.tl-record .tl-label").first()).toHaveText("Context");
});

test("the full record closes when another milestone is chosen, and a record the browser opened can still be closed", async ({ page }) => {
  await openBuilt(page);
  await expect(panel(page).locator(".tl-skim").first()).toBeVisible();
  const record = panel(page).locator("details.tl-record");
  await record.locator("summary").click();
  await expect(record).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Previous milestone", exact: true }).click();
  await expect(record).not.toHaveAttribute("open", "");
  // find-in-page opens a closed <details> by setting the attribute itself; the next click must close it, not look dead
  await record.evaluate((el: HTMLDetailsElement) => {
    el.open = true;
  });
  await expect(record).toHaveAttribute("open", "");
  await record.locator("summary").click();
  await expect(record).not.toHaveAttribute("open", "");
});

test("in Deep mode the record starts open and its summary closes it", async ({ page }) => {
  await openBuilt(page, "/?deep=1");
  const record = panel(page).locator("details.tl-record");
  await expect(record).toHaveAttribute("open", "");
  await record.locator("summary").click();
  await expect(record).not.toHaveAttribute("open", "");
});

test("the panel is the same height whichever milestone is chosen, so the page below never moves", async ({ page }) => {
  await openBuilt(page);
  await expect(panel(page).locator(".tl-skim").first()).toBeVisible();
  await page.getByRole("button", { name: `Show all ${TIMELINE.length}`, exact: true }).click();
  const heights: Record<string, number> = {};
  for (const node of TIMELINE) {
    await dot(page, node.id).click();
    await expect(title(page)).toHaveText(node.title);
    heights[node.id] = Math.round((await panel(page).boundingBox())!.height);
  }
  const tallest = Math.max(...Object.values(heights));
  expect(new Set(Object.values(heights)).size, `panel height by milestone (tallest ${tallest}): ${JSON.stringify(heights)}`).toBe(1);
});

// The reservation is measured at the widest content of each width range, so a font that wraps a little more, or a milestone
// that grows a line, must not push one past it: every range keeps this much room. The tallest content is natural height, so
// the reservation is switched off while it is measured. Widths are each range's narrowest, where the text wraps most.
const SLACK_PX = 32;

// Whether a block is cut off (and so gets its Read the full record button) is measured by an observer after the layout,
// so the height right after a click can still be one button short: wait until it stops changing.
async function settledHeight(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const panelEl = document.querySelector("#built .tl-panel")!;
    let last = -1;
    for (let i = 0; i < 20; i++) {
      await frame();
      const now = panelEl.getBoundingClientRect().height;
      if (now === last) return now;
      last = now;
    }
    return last;
  });
}
const RANGE_EDGES = [320, 374, 375, 429, 430, 599, 600, 899, 900, 1280];

test("every width range reserves more height than its tallest milestone needs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the viewport is set here, once is enough");
  test.setTimeout(120_000); // ten widths, every milestone at each
  await openBuilt(page);
  await expect(panel(page).locator(".tl-skim").first()).toBeVisible();
  await page.getByRole("button", { name: `Show all ${TIMELINE.length}`, exact: true }).click();
  await page.addStyleTag({ content: ".tl[data-natural] { --tl-panel-min: 0px !important; }" });
  const short: string[] = [];
  for (const width of RANGE_EDGES) {
    await page.setViewportSize({ width, height: 900 });
    await rail(page).scrollIntoViewIfNeeded();
    const reserved = await panel(page).evaluate((el) => parseFloat(getComputedStyle(el).minHeight));
    await page.locator("#built .tl").evaluate((el) => el.setAttribute("data-natural", ""));
    let tallest = { id: "", height: 0 };
    for (const node of TIMELINE) {
      await dot(page, node.id).click();
      await expect(title(page)).toHaveText(node.title);
      const height = await settledHeight(page);
      if (height > tallest.height) tallest = { id: node.id, height };
    }
    await page.locator("#built .tl").evaluate((el) => el.removeAttribute("data-natural"));
    if (tallest.height + SLACK_PX > reserved) short.push(`${width}px: reserved ${reserved}, ${tallest.id} needs ${Math.round(tallest.height)}`);
  }
  expect(short, `less than ${SLACK_PX}px of room`).toEqual([]);
});

test("the decision record arriving late moves nothing", async ({ page }) => {
  await page.route("**/assets/decisions-*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await openBuilt(page);
  await expect(panel(page)).toContainText("Loading the decision record");
  // a fetch that stalls never turns into the failure line, so the link is there while it loads
  await expect(panel(page).locator(".tl-msg a")).toHaveAttribute("href", /docs\/decisions\.md$/);
  const before = (await panel(page).boundingBox())!;
  const footerBefore = (await page.locator("footer.site-footer").boundingBox())!.y;
  await expect(panel(page).locator(".tl-skim").first()).toBeVisible({ timeout: 10_000 });
  const after = (await panel(page).boundingBox())!;
  const footerAfter = (await page.locator("footer.site-footer").boundingBox())!.y;
  expect(Math.abs(after.height - before.height), `panel height ${before.height} -> ${after.height}`).toBeLessThanOrEqual(1);
  expect(Math.abs(footerAfter - footerBefore), `footer ${footerBefore} -> ${footerAfter}`).toBeLessThanOrEqual(1);
});

test("a blocked decision file leaves the facts and a link to the entry", async ({ page }) => {
  await page.route("**/assets/decisions-*", (route) => route.abort());
  await openBuilt(page);
  await expect(panel(page)).toContainText("could not be shown here");
  await expect(panel(page).locator(".tl-msg a")).toHaveAttribute("href", /docs\/decisions\.md$/);
  await expect(title(page)).toHaveText(LATEST.title);
  await expect(panel(page).locator(".tl-summary")).toHaveText(LATEST.summary);
});

test("no horizontal page scroll with the full record and a table open", async ({ page }) => {
  await openBuilt(page, "/?deep=1");
  await dot(page, "milestone-4-1").click();
  await expect(title(page)).toHaveText(TIMELINE.find((n) => n.id === "milestone-4-1")!.title);
  await expect(panel(page).locator("table").first()).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("a milestone chosen by click or key is brought into view in the rail", async ({ page }) => {
  await openBuilt(page, "/?deep=1");
  const inView = () =>
    page.evaluate(() => {
      const strip = document.querySelector("#built .rail-scroll")!.getBoundingClientRect();
      const dot = document.querySelector("#built .rail button[aria-pressed='true']")!.getBoundingClientRect();
      return { dotLeft: Math.round(dot.left), dotRight: Math.round(dot.right), stripLeft: Math.round(strip.left), stripRight: Math.round(strip.right) };
    });
  const expectInView = async (what: string) => {
    await expect
      .poll(async () => {
        const r = await inView();
        return r.dotLeft >= r.stripLeft - 1 && r.dotRight <= r.stripRight + 1;
      }, { message: `${what}: the selected dot is inside the rail (${JSON.stringify(await inView())})` })
      .toBe(true);
  };
  await dot(page, TIMELINE[0]!.id).click();
  await page.keyboard.press("End");
  await expectInView("End");
  await page.keyboard.press("Home");
  await expectInView("Home");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await expectInView("twelve ArrowRight presses");
});

test("the rail scrolls on its own and the page does not", async ({ page }) => {
  await openBuilt(page, "/?deep=1");
  await dot(page, TIMELINE[0]!.id).click();
  const strip = rail(page).locator(".rail-scroll");
  const scrollLeftFirst = await strip.evaluate((el) => el.scrollLeft);
  await dot(page, TIMELINE[TIMELINE.length - 1]!.id).click();
  const scrollLeftLast = await strip.evaluate((el) => el.scrollLeft);
  expect(scrollLeftLast, "the rail scrolled to the last milestone").toBeGreaterThanOrEqual(scrollLeftFirst);
  expect(await noHorizontalScroll(page)).toBe(true);
});
