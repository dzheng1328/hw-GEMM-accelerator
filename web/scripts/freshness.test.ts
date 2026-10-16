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

/** The rows of the markdown table whose header line starts with `header`, keyed by their first cell. */
function mdTable(md: string, header: string): Map<string, string[]> {
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line.startsWith(header));
  if (start === -1) throw new Error(`no table starting "${header}"`);
  const rows = new Map<string, string[]>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    rows.set(cells[0]!, cells.slice(1));
  }
  return rows;
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const ratio = (x: number) => `${x.toFixed(2)}x`;

describe("performance.json agrees with scaling.md", () => {
  const md = readPerf("scaling.md");
  const meshes = () => built["performance.json"].cifar.meshes;

  it("matches the results table", () => {
    const rows = mdTable(md, "| Mesh | Tiles | Cycles per image");
    for (const m of meshes()) {
      const row = rows.get(m.mesh);
      expect(row, m.mesh).toBeDefined();
      expect(row![1], `${m.mesh} cycles per image`).toBe(grouped(m.cyclesPerUnit));
      expect(row![2], `${m.mesh} speedup`).toBe(ratio(m.speedup));
      expect(row![4], `${m.mesh} MAC utilization`).toBe(pct1(m.macUtilization));
      expect(row![5], `${m.mesh} corner busy`).toBe(pct1(m.cornerBusy));
      expect(row![6], `${m.mesh} corner stalled`).toBe(pct1(m.cornerStalled));
    }
  });

  it("matches the injection-port partition table", () => {
    const rows = mdTable(md, "| Mesh | OPERAND flits");
    for (const m of meshes()) {
      const row = rows.get(m.mesh)!;
      const s = m.port.shares;
      expect(row.slice(0, 6), m.mesh).toEqual([s.operand, s.go, s.stall, s.wait, s.credit, s.other].map(pct1));
    }
  });

  it("matches the link occupancy table", () => {
    const rows = mdTable(md, "| Mesh | East link");
    for (const m of meshes()) {
      expect(rows.get(m.mesh), m.mesh).toEqual([pct1(m.links.east), pct1(m.links.north), pct1(m.links.local)]);
    }
  });
});

describe("performance.json agrees with lm.md", () => {
  it("matches the scaling table", () => {
    const rows = mdTable(readPerf("lm.md"), "| Mesh | Tiles | Cycles | Cycles per step");
    for (const m of built["performance.json"].lm.meshes) {
      const row = rows.get(m.mesh)!;
      expect(row[1], `${m.mesh} cycles`).toBe(grouped(m.cycles));
      expect(row[2], `${m.mesh} cycles per step`).toBe(grouped(m.cyclesPerUnit));
      expect(row[4], `${m.mesh} speedup`).toBe(ratio(m.speedup));
      expect(row[5], `${m.mesh} MAC utilization`).toBe(pct1(m.macUtilization));
      expect(row[6], `${m.mesh} corner busy`).toBe(pct1(m.cornerBusy));
    }
  });

  it("matches the four-way split of the 2x2 run", () => {
    const rows = mdTable(readPerf("lm.md"), "| Category | Cycles | Share");
    const c = built["performance.json"].lm.categories2x2;
    expect(rows.get("weight matmuls")![0]).toBe(grouped(c.cycles.weights));
    expect(rows.get("attention")![0]).toBe(grouped(c.cycles.attention));
    expect(rows.get("VPU")![0]).toBe(grouped(c.cycles.vpu));
    // lm.md folds the run's tail (the cycles after the last SAMPLE) into "other"; performance.json keeps it apart.
    expect(rows.get("other")![0]).toBe(grouped(c.cycles.other + c.tail));
  });
});
