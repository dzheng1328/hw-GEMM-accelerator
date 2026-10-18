import { expect, test, type Page } from "@playwright/test";
import { SECTIONS } from "../src/content/sections";

const bar = (page: Page) => page.locator("header.topbar");
const link = (page: Page, id: string) => page.locator(`header.topbar nav a[data-section="${id}"]`);
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.beforeEach(async ({ page }) => {
  // jumps land at once, so the assertions do not race a smooth scroll
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("the top bar stays on screen and lists the six sections", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header.topbar nav a")).toHaveText(SECTIONS.map((s) => s.label));
  await page.evaluate(() => window.scrollTo(0, 3000));
  const box = await bar(page).boundingBox();
  expect(box!.y).toBe(0);
});

test("clicking a link lands the heading below the bar and highlights that link", async ({ page }) => {
  await page.goto("/");
  for (const id of ["performance", "built"]) {
    await link(page, id).click();
    await expect(link(page, id)).toHaveAttribute("aria-current", "location");
    const barBox = (await bar(page).boundingBox())!;
    const barBottom = barBox.y + barBox.height;
    const heading = (await page.locator(`section#${id} h2`).boundingBox())!;
    expect(heading.y, `${id} heading is not hidden under the bar`).toBeGreaterThanOrEqual(barBottom - 1);
    expect(heading.y, `${id} heading is near the top`).toBeLessThan(barBottom + 220);
  }
});

test("scrolling moves the highlight, and no link is active over the hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header.topbar nav a[aria-current]")).toHaveCount(0);
  for (const id of ["live", "architecture", "verification"]) {
    await page.evaluate((target) => {
      const top = document.getElementById(target)!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + 200);
    }, id);
    await expect(link(page, id)).toHaveAttribute("aria-current", "location");
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator("header.topbar nav a[aria-current]")).toHaveCount(0);
});

test("the last link is active at the very bottom of the page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(link(page, "built")).toHaveAttribute("aria-current", "location");
});

test("the highlight stays right after Deep mode grows the sections", async ({ page }) => {
  await page.goto("/");
  await link(page, "performance").click();
  await expect(link(page, "performance")).toHaveAttribute("aria-current", "location");
  const headingTop = () => page.locator("#performance h2").evaluate((el) => el.getBoundingClientRect().top);
  const before = await headingTop();
  await page.getByRole("button", { name: "Deep mode" }).click();
  await expect.poll(async () => Math.abs((await headingTop()) - before), { message: "Deep mode keeps the section in place" }).toBeLessThan(3);
  await expect(link(page, "performance")).toHaveAttribute("aria-current", "location");
  await link(page, "built").click();
  await expect(link(page, "built")).toHaveAttribute("aria-current", "location");
});

test("a jump right after load still lands where it should while the replay data arrives above it", async ({ page }) => {
  // hold the recorded run back, so its arrival reliably comes after the jump
  await page.route("**/assets/lm-*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto("/");
  // the live hero pushes the replay below the fold, so bring it near first: that is what starts its data load
  await page.locator("#replay").scrollIntoViewIfNeeded();
  await link(page, "performance").click();
  const headingTop = () => page.locator("#performance h2").evaluate((el) => el.getBoundingClientRect().top);
  const landed = await headingTop();
  // the replay section grows by up to 3000 px a moment after load; the page must hold the landing position through it
  await page.waitForFunction(() => document.querySelectorAll("#replay .lane").length > 0);
  await expect.poll(async () => Math.abs((await headingTop()) - landed), { message: "the heading stays where the jump put it" }).toBeLessThan(3);
});

test("focusing a bar control mid-page does not move the page (a keyboard user can tab along the bar)", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 6000));
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const before = await scrollY();
  // the bug this guards against moved the page by 400+ px; allow a couple of pixels for sub-pixel layout differences between machines
  const drift = async () => Math.abs((await scrollY()) - before);
  for (const name of ["Deep mode", /Switch to/]) {
    await page.getByRole("button", { name }).focus();
    expect(await drift(), `focusing ${name}`).toBeLessThanOrEqual(2);
  }
  await link(page, "built").focus();
  await page.getByRole("link", { name: "GitHub", exact: true }).focus();
  expect(await drift()).toBeLessThanOrEqual(2);
});

test("focusing a control just under the bar scrolls it clear of the bar", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const summary = page.locator("#performance summary");
  await page.evaluate(() => {
    const top = document.querySelector("#performance summary")!.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - 10);
  });
  await summary.focus();
  const barBox = (await bar(page).boundingBox())!;
  const top = (await summary.boundingBox())!.y;
  expect(top, "the focused summary is not hidden under the bar").toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
});

test("the hash and ?deep=1 coexist in both orders", async ({ page }) => {
  await page.goto("/?deep=1");
  await link(page, "performance").click();
  expect(new URL(page.url()).search).toBe("?deep=1");
  expect(new URL(page.url()).hash).toBe("#performance");
  await page.getByRole("button", { name: "Deep mode" }).click();
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("#performance");
  await page.getByRole("button", { name: "Deep mode" }).click();
  expect(new URL(page.url()).search).toBe("?deep=1");
  expect(new URL(page.url()).hash).toBe("#performance");
});

test("on a phone the active link scrolls into view in the strip", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "the strip scrolls only on a phone");
  await page.goto("/");
  await link(page, "built").click();
  await expect(link(page, "built")).toHaveAttribute("aria-current", "location");
  const strip = (await page.locator("header.topbar nav").boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await link(page, "built").boundingBox())!;
      return box.x >= strip.x - 1 && box.x + box.width <= strip.x + strip.width + 1;
    })
    .toBe(true);
  await link(page, "replay").click();
  await expect(link(page, "replay")).toHaveAttribute("aria-current", "location");
  await expect
    .poll(async () => {
      const box = (await link(page, "replay").boundingBox())!;
      return box.x >= strip.x - 1 && box.x + box.width <= strip.x + strip.width + 1;
    })
    .toBe(true);
});

test("the bar is about 88 px on a phone and 56 px on desktop, and its controls are 44 px tall on a phone", async ({ page }, info) => {
  await page.goto("/");
  const height = (await bar(page).boundingBox())!.height;
  if (info.project.name === "phone") {
    expect(height).toBeGreaterThanOrEqual(86);
    expect(height).toBeLessThanOrEqual(96);
    for (const el of [link(page, "replay"), page.getByRole("button", { name: "Deep mode" }), page.getByRole("button", { name: /Switch to/ })]) {
      expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  } else {
    expect(height).toBeGreaterThanOrEqual(55);
    expect(height).toBeLessThanOrEqual(60);
  }
});

test("no horizontal scroll at 360 px, bar included", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  expect(await noHorizontalScroll(page)).toBe(true);
  const row = (await page.locator(".topbar-row").boundingBox())!;
  const actions = (await page.locator(".topbar-actions").boundingBox())!;
  expect(actions.x + actions.width).toBeLessThanOrEqual(row.x + row.width + 1);
});

test("the section headings keep a readable line length on desktop", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the cap shows on the wide layout");
  await page.goto("/");
  const width = (await page.locator("#performance .headline").boundingBox())!.width;
  expect(width).toBeLessThanOrEqual(780);
});

test("the fonts load as woff2, two are preloaded, and the text uses them", async ({ page }) => {
  const fonts: { url: string; type: string }[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".woff2")) fonts.push({ url: response.url(), type: response.headers()["content-type"] ?? "" });
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.length).toBeGreaterThanOrEqual(2);
  for (const font of fonts) expect(font.type, font.url).toContain("font/woff2");
  expect(await page.evaluate(() => document.fonts.check('600 16px "IBM Plex Mono"'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".tile-value")!).fontFamily)).toContain("IBM Plex Mono");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("IBM Plex Sans");
  expect(await page.locator('link[rel="preload"][as="font"]').count()).toBe(2);
});

test("reduced motion turns smooth scrolling and transitions off", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".topbar-nav a")!).transitionDuration)).toBe("0s");
});

test("the skip link is the first tab stop, jumps to main, and leaves the heading clear of the bar", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  // the fragment navigation is applied a moment after the key press, later on a busy runner
  await expect(page).toHaveURL(/#main$/);
  const barBox = (await bar(page).boundingBox())!;
  const h1 = (await page.locator("h1").boundingBox())!;
  expect(h1.y, "the h1 is not hidden under the bar").toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("main")!).outlineStyle), "no focus box around the whole page").toBe("none");
});

test("the bar's content lines up with the section content at its left and right edges", async ({ page }) => {
  await page.goto("/");
  const edges = await page.evaluate(() => {
    const content = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
    };
    return { bar: content(document.querySelector(".topbar-row")!), section: content(document.querySelector("#replay .band-inner")!) };
  });
  expect(Math.abs(edges.bar.left - edges.section.left), "left edge").toBeLessThanOrEqual(1);
  expect(Math.abs(edges.bar.right - edges.section.right), "right edge").toBeLessThanOrEqual(1);
});

test("the upload button and the radio buttons use the page's own look, not the browser default", async ({ page }) => {
  await page.goto("/");
  const look = await page.evaluate(() => {
    const file = document.querySelector<HTMLInputElement>('#live input[type="file"]')!;
    const radio = document.querySelector<HTMLInputElement>('#live input[type="radio"]')!;
    const button = getComputedStyle(file, "::file-selector-button");
    return { background: button.backgroundColor, radius: button.borderTopLeftRadius, accent: getComputedStyle(radio).accentColor };
  });
  expect(look.background).toBe("rgb(17, 25, 34)");
  expect(look.radius).toBe("8px");
  expect(look.accent).toBe("rgb(76, 195, 255)");
});

test("a keyboard focus ring on a section link is drawn inside the link, where the scrolling strip cannot clip it", async ({ page }) => {
  await page.goto("/");
  // Tab only once the bar exists: pressing it during the first render lands focus on the wrong element on a busy runner
  await expect(link(page, "replay")).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await expect(link(page, "replay")).toBeFocused();
  const ring = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!);
    return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
  });
  expect(ring.style).toBe("solid");
  expect(ring.width).toBe("2px");
  expect(parseFloat(ring.offset), "the ring sits inside the link").toBeLessThanOrEqual(0);
});

test("at tablet width the bar uses its two rows, the strip scrolls to the active link, and nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  const height = (await bar(page).boundingBox())!.height;
  expect(height).toBeGreaterThanOrEqual(86);
  expect(height).toBeLessThanOrEqual(96);
  expect(await noHorizontalScroll(page)).toBe(true);
  await link(page, "built").click();
  await expect(link(page, "built")).toHaveAttribute("aria-current", "location");
  const strip = (await page.locator("header.topbar nav").boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await link(page, "built").boundingBox())!;
      return box.x >= strip.x - 1 && box.x + box.width <= strip.x + strip.width + 1;
    })
    .toBe(true);
  await link(page, "replay").click();
  await expect(link(page, "replay")).toHaveAttribute("aria-current", "location");
  await expect
    .poll(async () => {
      const box = (await link(page, "replay").boundingBox())!;
      return box.x >= strip.x - 1 && box.x + box.width <= strip.x + strip.width + 1;
    })
    .toBe(true);
});

test("without a reduced-motion preference the page scrolls smoothly and its links fade (the counterpart of the reduced-motion test)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("smooth");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".topbar-nav a")!).transitionDuration)).toContain("0.15s");
});

test("in forced-colors mode the active link keeps its underline and loses the glow", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await page.evaluate(() => {
    const top = document.getElementById("performance")!.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top + 200);
  });
  await expect(link(page, "performance")).toHaveAttribute("aria-current", "location");
  const style = await link(page, "performance").evaluate((el) => {
    const s = getComputedStyle(el);
    return { decoration: s.textDecorationLine, textShadow: s.textShadow, boxShadow: s.boxShadow };
  });
  expect(style.decoration).toBe("underline");
  expect(style.textShadow).toBe("none");
  expect(style.boxShadow).toBe("none");
});

test("a link to a section opens on that section, and keeps it while content above it arrives", async ({ page }) => {
  // hold the recorded run back: the replay is only fetched when it is near the view, so it arrives late for #live
  await page.route("**/assets/lm-*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  const cases = [
    { url: "/#performance", id: "performance", dataArrives: false },
    { url: "/#live", id: "live", dataArrives: true },
    { url: "/?deep=1#live", id: "live", dataArrives: true },
    { url: "/?deep=1#built", id: "built", dataArrives: false },
  ];
  for (const { url, id, dataArrives } of cases) {
    // a fresh load each time: going from one #hash to another on the same page is only a native jump, with no new mount
    await page.goto("about:blank");
    await page.goto(url);
    const headingTop = () => page.locator(`#${id} h2`).evaluate((el) => el.getBoundingClientRect().top);
    const barBox = (await bar(page).boundingBox())!;
    await expect.poll(headingTop, { message: `${url} lands on the section` }).toBeLessThan(barBox.height + 260);
    expect(await headingTop(), `${url} is not under the bar`).toBeGreaterThanOrEqual(barBox.height - 1);
    const landed = await headingTop();
    if (dataArrives) await page.waitForFunction(() => document.querySelectorAll("#replay .lane").length > 0);
    await page.waitForTimeout(500);
    expect(Math.abs((await headingTop()) - landed), `${url} stays put`).toBeLessThan(3);
    await expect(link(page, id)).toHaveAttribute("aria-current", "location");
  }
});
