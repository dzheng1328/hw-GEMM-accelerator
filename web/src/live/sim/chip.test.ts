import { describe, expect, it } from "vitest";
import { b64, exampleEntries, extremeEntries, nodeAssets } from "./artifacts.testlib";
import { Chip, ChipFault } from "./chip";
import { meshEntry } from "./manifest";
import { MESH_KEYS } from "./types";

const images = () => [
  ...exampleEntries().map((e) => ({ ...e, name: e.name })),
  ...Object.entries(extremeEntries()).map(([name, e]) => ({ ...e, name })),
];
const cat = () => exampleEntries()[3]!;

describe("the 2x2 chip in WebAssembly", () => {
  it("classifies every example and extreme image bit-exactly, back to back in one module", async () => {
    const chip = await Chip.open("2x2", await nodeAssets("2x2"));
    for (const img of images()) {
      const r = chip.run(b64(img.packed));
      expect(Array.from(r.logits), img.name).toEqual(img.logits);
      expect(r.cycles, img.name).toBe(meshEntry("2x2").cycles);
    }
  }, 180_000);

  it("takes 139,981 cycles for any image on the 2x2 mesh, with one trace record per cycle", async () => {
    const chip = await Chip.open("2x2", await nodeAssets("2x2"));
    const r = chip.run(b64(cat().packed));
    expect(r.cycles).toBe(139_981);
    expect(r.nodes).toBe(4);
    expect(r.recordBytes).toBe(6 + 2 * 4);
    expect(r.trace.length).toBe(r.cycles * r.recordBytes);
  }, 60_000);

  it("gives the same answer for the same image whatever ran before it", async () => {
    const chip = await Chip.open("2x2", await nodeAssets("2x2"));
    const image = b64(cat().packed);
    const first = chip.run(image);
    chip.run(b64(extremeEntries().white.packed));
    const again = chip.run(image);
    expect(Array.from(again.logits)).toEqual(Array.from(first.logits));
    expect(again.cycles).toBe(first.cycles);
    expect(again.trace).toEqual(first.trace);
  }, 60_000);

  it("reports a chip fault, refuses to run again, and a fresh chip works", async () => {
    const assets = await nodeAssets("2x2");
    const bad = await Chip.open("2x2", { ...assets, program: new Uint8Array(assets.program.length) });
    expect(() => bad.run(b64(cat().packed))).toThrow(ChipFault);
    expect(bad.broken).toBe(true);
    expect(() => bad.run(b64(cat().packed))).toThrow(/stopped/);
    const good = await Chip.open("2x2", assets);
    expect(Array.from(good.run(b64(cat().packed)).logits)).toEqual(cat().logits);
  }, 60_000);

  it("releases the simulated model after each run, once everything has been read from it", async () => {
    const assets = await nodeAssets("2x2");
    const calls: string[] = [];
    const chip = await Chip.open("2x2", {
      ...assets,
      createModule: async () => {
        const real = await assets.createModule();
        return new Proxy(real, {
          get(target, name, receiver) {
            const value = Reflect.get(target, name, receiver) as unknown;
            if (typeof name === "string" && name.startsWith("_sim_") && typeof value === "function") {
              return (...args: unknown[]) => {
                calls.push(name);
                return (value as (...a: unknown[]) => unknown)(...args);
              };
            }
            return value;
          },
        });
      },
    });
    const r = chip.run(b64(cat().packed));
    expect(calls.at(-1)).toBe("_sim_free");
    expect(calls.filter((c) => c === "_sim_free")).toHaveLength(1); // sim_init frees the previous model inside C++
    expect(Array.from(r.logits)).toEqual(cat().logits);
    expect(Array.from(chip.run(b64(cat().packed)).logits)).toEqual(cat().logits);
  }, 60_000);

  it("rejects an image of the wrong size without breaking the chip", async () => {
    const chip = await Chip.open("2x2", await nodeAssets("2x2"));
    expect(() => chip.run(new Uint8Array(10))).toThrow(RangeError);
    expect(chip.broken).toBe(false);
    expect(Array.from(chip.run(b64(cat().packed)).logits)).toEqual(cat().logits);
  }, 60_000);
});

describe("the tiles are mostly idle on 4x4, which the page's caption says", () => {
  it("busy tile-cycles are under 20% of tiles x cycles", async () => {
    const chip = await Chip.open("4x4", await nodeAssets("4x4"));
    const r = chip.run(b64(images()[3]!.packed));
    const busy = r.counters.busyCycles.reduce((a, b) => a + b, 0);
    expect(busy / (r.nodes * r.cycles)).toBeLessThan(0.2);
  }, 120_000);
});

describe("every mesh is bit-exact on every example, with its own cycle count", () => {
  for (const mesh of MESH_KEYS) {
    it(mesh, async () => {
      const chip = await Chip.open(mesh, await nodeAssets(mesh));
      for (const img of images()) {
        const r = chip.run(b64(img.packed));
        expect(Array.from(r.logits), `${mesh} ${img.name}`).toEqual(img.logits);
        expect(r.cycles).toBe(meshEntry(mesh).cycles);
        expect(r.trace.length).toBe(r.cycles * (6 + 2 * meshEntry(mesh).nodes));
      }
    }, 300_000);
  }
});
