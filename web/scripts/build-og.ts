import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const summary = JSON.parse(readFileSync(join(web, "src", "data", "generated", "summary.json"), "utf8"));
const grouped = (n: number) => Math.round(n).toLocaleString("en-US");
const b64 = (path: string) => readFileSync(join(web, path)).toString("base64");
const mincho = b64("src/theme/fonts/shippori-mincho-b1-latin-700-normal.woff2");
const kaku = b64("src/theme/fonts/zen-kaku-gothic-new-latin-400-normal.woff2");
const print = b64("public/art/night-print-1280.webp");

const stats = [
  [`${summary.lm.stories} × ${summary.lm.steps}`, "stories on chip, tokens each"],
  [grouped(summary.lm.meshes["2x2_t256"].cycles), "cycles, 2x2 mesh"],
  [`${(summary.cifar.int8Accuracy * 100).toFixed(2)}%`, "CIFAR-10 int8 accuracy"],
];

const card = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: M; font-weight: 700; src: url(data:font/woff2;base64,${mincho}) format("woff2"); }
  @font-face { font-family: K; font-weight: 400; src: url(data:font/woff2;base64,${kaku}) format("woff2"); }
  body { margin: 0; width: 1200px; height: 630px; box-sizing: border-box; padding: 72px; color: #f1e8d3;
    background: linear-gradient(rgba(11,18,38,.74), rgba(11,18,38,.74)), url(data:image/webp;base64,${print}) center / cover;
    font-family: K, system-ui, sans-serif; display: flex; flex-direction: column; justify-content: space-between; }
  h1 { margin: 0; font: 700 84px/1.02 M, serif; }
  p { margin: 18px 0 0; font-size: 32px; line-height: 1.4; max-width: 980px; }
  .stats { display: flex; gap: 40px; }
  .stat { flex: 1; border-top: 2px solid rgba(241,232,211,.5); padding-top: 14px; }
  .stat b { display: block; font: 700 58px/1.1 M, serif; color: #dfbd62; }
  .stat span { display: block; margin-top: 6px; font-size: 24px; }
  .foot { font-size: 24px; opacity: .85; }
</style>
<div><h1>hw-GEMM accelerator</h1>
<p>A systolic GEMM accelerator with a command processor, a vector unit and a tiny language model, simulated end to end in RTL.</p></div>
<div class="stats">${stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
<div class="foot">Bit-exact against the integer reference at every level. hw-gemm-accelerator.vercel.app</div>`;

const browser = await chromium.launch();
try {
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(card);
  await og.evaluate(() => document.fonts.ready.then(() => true));
  writeFileSync(join(web, "public", "og.png"), await og.screenshot({ type: "png" }));

  const touch = await browser.newPage({ viewport: { width: 180, height: 180 } });
  const svg = readFileSync(join(web, "public", "favicon.svg"), "utf8");
  await touch.setContent(`<body style="margin:0;background:#0b1226">${svg.replace("<svg ", '<svg width="180" height="180" ')}</body>`);
  writeFileSync(join(web, "public", "apple-touch-icon.png"), await touch.screenshot({ type: "png" }));
} finally {
  await browser.close();
}
