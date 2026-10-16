import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const WEB_ROOT = resolve(HERE, "..");
export const REPO_ROOT = resolve(WEB_ROOT, "..");
export const OUT_DIR = join(WEB_ROOT, "src", "data", "generated");

export function readPerf(name: string, root: string = REPO_ROOT): string {
  return readFileSync(join(root, "docs", "perf", name), "utf8");
}
