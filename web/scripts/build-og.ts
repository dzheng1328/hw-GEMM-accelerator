import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const summary = JSON.parse(readFileSync(join(web, "src", "data", "generated", "summary.json"), "utf8"));
const grouped = (n: number) => Math.round(n).toLocaleString("en-US");

const stats = [
  [`${summary.lm.stories} × ${summary.lm.steps}`, "stories on chip, tokens each"],
  [grouped(summary.lm.meshes["2x2_t256"].cycles), "cycles, 2x2 mesh"],
  [`${(summary.cifar.int8Accuracy * 100).toFixed(2)}%`, "CIFAR-10 int8 accuracy"],
];

const card = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 630px; box-sizing: border-box; padding: 72px; background: #0b0f14; color: #e6edf3;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; justify-content: space-between; }
  h1 { margin: 0; font-size: 76px; letter-spacing: -0.02em; }
  p { margin: 18px 0 0; font-size: 34px; line-height: 1.35; color: #9fb0c0; max-width: 980px; }
  .stats { display: flex; gap: 24px; }
  .stat { flex: 1; background: #121922; border: 2px solid #2a3644; border-radius: 18px; padding: 28px 30px; }
  .stat b { display: block; font: 600 56px ui-monospace, "SF Mono", Menlo, monospace; color: #4cc3ff; }
  .stat span { display: block; margin-top: 8px; font-size: 24px; letter-spacing: 0.04em; text-transform: uppercase; color: #9fb0c0; }
  .foot { font-size: 26px; color: #9fb0c0; }
</style>
<div><h1>hw-GEMM accelerator</h1>
<p>A systolic GEMM accelerator with a command processor, a vector unit and a tiny language model, simulated end to end in RTL.</p></div>
<div class="stats">${stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
<div class="foot">Bit-exact against the integer reference at every level. hw-gemm-accelerator.vercel.app</div>`;

const browser = await chromium.launch();
try {
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(card);
  writeFileSync(join(web, "public", "og.png"), await og.screenshot({ type: "png" }));

  const touch = await browser.newPage({ viewport: { width: 180, height: 180 } });
  const svg = readFileSync(join(web, "public", "favicon.svg"), "utf8");
  await touch.setContent(`<body style="margin:0;background:#0b0f14">${svg.replace("<svg ", '<svg width="180" height="180" ')}</body>`);
  writeFileSync(join(web, "public", "apple-touch-icon.png"), await touch.screenshot({ type: "png" }));
} finally {
  await browser.close();
}
