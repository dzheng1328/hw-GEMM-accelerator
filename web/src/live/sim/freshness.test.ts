import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTIFACTS } from "./artifacts.testlib";
import { manifest } from "./manifest";
import { MESH_KEYS } from "./types";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const FIX =
  'the simulator artifacts are stale: run ".venv/bin/python web/sim-build/build_sim.py" at the repo root and commit web/src/live/sim/artifacts';

describe("the committed simulator artifacts are fresh", () => {
  it("every recorded source file still has the recorded sha256", () => {
    const stale = Object.entries(manifest.sources).filter(
      ([rel, sha]) => createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex") !== sha,
    );
    expect(stale.map(([rel]) => rel), FIX).toEqual([]);
  });

  it("every rtl/*.v file is hashed or explicitly excluded", () => {
    const onDisk = readdirSync(join(REPO, "rtl")).filter((f) => f.endsWith(".v")).map((f) => `rtl/${f}`);
    const unaccounted = onDisk.filter((rel) => !(rel in manifest.sources) && !manifest.excludedRtl.includes(rel));
    expect(unaccounted, `${FIX} (a new RTL file must be added to sources.RTL_FILES or EXCLUDED_RTL)`).toEqual([]);
  });

  it("all three meshes have a wasm, a glue module and a program image", () => {
    for (const key of MESH_KEYS) {
      expect(manifest.meshes[key], `${key} missing from the manifest`).toBeDefined();
      for (const file of [`cifar-${key}.mjs`, `cifar-${key}.wasm`, manifest.meshes[key]!.program]) {
        expect(existsSync(join(ARTIFACTS, file)), file).toBe(true);
      }
    }
  });

  it("records the cycle counts the spike measured", () => {
    expect(manifest.meshes["1x1"]!.cycles).toBe(313_539);
    expect(manifest.meshes["2x2"]!.cycles).toBe(139_981);
    expect(manifest.meshes["4x4"]!.cycles).toBe(136_987);
  });
});

describe("artifact sizes stay within budget (gate 5)", () => {
  const size = (name: string) => statSync(join(ARTIFACTS, name)).size;
  it("each wasm is under 3 MB and the whole artifacts folder under 9 MB", () => {
    for (const key of MESH_KEYS) expect(size(`cifar-${key}.wasm`), key).toBeLessThan(3_000_000);
    const total = readdirSync(ARTIFACTS).reduce((sum, f) => sum + size(f), 0);
    expect(total).toBeLessThan(9_000_000);
  });
});
