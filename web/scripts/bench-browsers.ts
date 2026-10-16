// Dev tool, not run in CI: times the committed chip in Chromium, Firefox and WebKit.
//   npx playwright install chromium firefox webkit   (once)
//   npx tsx scripts/bench-browsers.ts
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";

const ART = join(import.meta.dirname, "..", "src", "live", "sim", "artifacts");
const TYPES: Record<string, string> = {
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".json": "application/json",
};
const LIMIT_MS = 15_000;

const PAGE = `<!doctype html><meta charset="utf-8"><title>bench</title><script type="module">
const mesh = new URLSearchParams(location.search).get("mesh");
const t0 = performance.now();
const create = (await import("/cifar-" + mesh + ".mjs")).default;
const m = await create();
const get = async (n) => new Uint8Array(await (await fetch("/" + n)).arrayBuffer());
const program = await get("program-" + mesh + ".bin");
const weights = await get("weights.bin");
const examples = await (await fetch("/examples.json")).json();
const image = Uint8Array.from(atob(examples[3].packed), (c) => c.charCodeAt(0));
const put = (b) => { const p = m._malloc(b.length); m.HEAPU8.set(b, p); return p; };
const t1 = performance.now();
m._sim_init();
const pp = put(program), wp = put(weights), ip = put(image);
m._sim_load(pp, program.length / 8, wp, weights.length / 8);
m._sim_set_input(ip, image.length / 8);
const cycles = m._sim_run(2000000);
const t2 = performance.now();
window.__result = { cycles, loadMs: t1 - t0, runMs: t2 - t1, traceBytes: m._sim_trace_bytes() };
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    res.end(PAGE);
    return;
  }
  try {
    const body = readFileSync(join(ART, url.pathname.slice(1)));
    res.setHeader("content-type", TYPES[extname(url.pathname)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;

const rows: string[] = [];
let failed = false;
for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]] as const) {
  for (const mesh of ["1x1", "2x2", "4x4"]) {
    try {
      const browser = await type.launch();
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/?mesh=${mesh}`);
      await page.waitForFunction(() => (window as unknown as { __result?: unknown }).__result, null, { timeout: 180_000 });
      const r = (await page.evaluate(() => (window as unknown as { __result: unknown }).__result)) as {
        cycles: number;
        loadMs: number;
        runMs: number;
        traceBytes: number;
      };
      await browser.close();
      const slow = r.runMs > LIMIT_MS;
      failed ||= slow;
      rows.push(`| ${name} | ${mesh} | ${r.cycles} | ${r.loadMs.toFixed(0)} | ${r.runMs.toFixed(0)} | ${slow ? "OVER LIMIT" : "ok"} |`);
    } catch (error) {
      failed = true;
      rows.push(`| ${name} | ${mesh} | - | - | - | FAILED: ${String(error).split("\n")[0]} |`);
    }
  }
}
server.close();
console.log("| browser | mesh | cycles | load ms | run ms | status |\n|---|---|---:|---:|---:|---|\n" + rows.join("\n"));
process.exit(failed ? 1 : 0);
