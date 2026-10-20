import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx scripts/shots.ts <out-dir>  (needs `npm run build && npm run preview` running on :4173)");
mkdirSync(out, { recursive: true });
const only = process.argv[3] ? process.argv[3].split(",") : null;

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  for (const theme of ["dark", "light"] as const) {
    for (const width of [1440, 1024, 768, 390]) {
      if (only && !only.includes(String(width))) continue;
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      await context.addInitScript(([key, value]) => localStorage.setItem(key!, value!), ["hwgemm-theme", theme]);
      const page = await context.newPage();
      await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      // the lazy sections load as they come near: walk down once so every height is settled
      for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 700) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(150);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `${theme}-${width}.png`), fullPage: true });
      await context.close();
      console.log(`${theme}-${width}.png`);
    }
  }
} finally {
  await browser.close();
}
