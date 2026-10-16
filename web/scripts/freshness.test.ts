import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GENERATED_FILES, buildAll, serialize } from "./build-data";
import { OUT_DIR, readPerf } from "./paths";

let built: ReturnType<typeof buildAll>;
beforeAll(() => {
  built = buildAll();
}, 60_000);

describe("generated data is fresh", () => {
  for (const name of GENERATED_FILES) {
    it(`${name} matches what docs/perf produces`, () => {
      const committed = readFileSync(join(OUT_DIR, name), "utf8");
      const same = serialize(name, built[name]) === committed;
      expect(
        same,
        `web/src/data/generated/${name} is stale: run "npm run build:data" in web/ and commit the result`,
      ).toBe(true);
    });
  }
});

function mdValue(md: string, label: string): string {
  const values = md
    .split("\n")
    .filter((line) => line.startsWith(`| ${label} |`))
    .map((line) => (line.split("|")[2] ?? "").trim());
  const value = values.find((v) => /^[\d,.]+%?$/.test(v));
  if (value === undefined) throw new Error(`no numeric table row "${label}" in the report`);
  return value;
}

const grouped = (n: number): string => Math.round(n).toLocaleString("en-US");

describe("summary agrees with the generated reports", () => {
  it("matches docs/perf/lm.md", () => {
    const md = readPerf("lm.md");
    const { lm } = built["summary.json"];
    expect(mdValue(md, "Decode steps")).toBe(String(lm.steps));
    expect(mdValue(md, "Cycles")).toBe(grouped(lm.meshes["2x2_t256"]!.cycles));
    expect(mdValue(md, "Cycles at temperature 0 (same mesh)")).toBe(grouped(lm.meshes["2x2_t0"]!.cycles));
  });

  it("matches docs/perf/cifar.md", () => {
    const md = readPerf("cifar.md");
    const { cifar } = built["summary.json"];
    expect(mdValue(md, "Images")).toBe(String(cifar.images));
    expect(mdValue(md, "Cycles")).toBe(grouped(cifar.cycles));
    expect(mdValue(md, "Cycles per image")).toBe(grouped(cifar.cyclesPerImage));
    expect(mdValue(md, "int8 accuracy (RTL logits vs labels)")).toBe(`${(cifar.int8Accuracy * 100).toFixed(2)}%`);
  });
});
