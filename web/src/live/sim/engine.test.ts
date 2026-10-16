import { describe, expect, it } from "vitest";
import { b64, exampleEntries, loadModel, nodeAssets } from "./artifacts.testlib";
import { Chip } from "./chip";
import { Engine, type EngineDeps, type EngineEvent } from "./engine";
import type { MeshKey } from "./types";

const cat = () => exampleEntries()[3]!;

function setup(overrides: Partial<EngineDeps> = {}) {
  const events: EngineEvent[] = [];
  const opened: MeshKey[] = [];
  const deps: EngineDeps = {
    openChip: async (mesh) => {
      opened.push(mesh);
      return Chip.open(mesh, await nodeAssets(mesh));
    },
    loadModel: async () => loadModel(),
    ...overrides,
  };
  return { events, opened, engine: new Engine(deps, (event) => events.push(event)) };
}
const label = (e: EngineEvent) => (e.kind === "stage" ? e.stage : e.kind);

describe("Engine", () => {
  it("runs an image, reports its stages in order, and checks the chip against the reference", async () => {
    const { events, engine } = setup();
    await engine.run({ id: 1, mesh: "2x2", pixels: b64(cat().pixels) });
    expect(events.map(label)).toEqual(["loading", "simulating", "checking", "done"]);
    const done = events.at(-1)!;
    if (done.kind !== "done") throw new Error("expected done");
    expect(Array.from(done.run.logits)).toEqual(cat().logits);
    expect(Array.from(done.run.reference)).toEqual(cat().logits);
    expect(done.run.match).toBe(true);
    expect(done.run.cycles).toBe(139_981);
  }, 60_000);

  it("keeps the chip it opened for the next run on the same mesh, and opens another for another mesh", async () => {
    const { opened, engine } = setup();
    const pixels = b64(cat().pixels);
    await engine.run({ id: 1, mesh: "2x2", pixels });
    await engine.run({ id: 2, mesh: "2x2", pixels });
    expect(opened).toEqual(["2x2"]);
    await engine.run({ id: 3, mesh: "1x1", pixels });
    expect(opened).toEqual(["2x2", "1x1"]);
  }, 120_000);

  it("runs queued requests one after another, in order", async () => {
    const { events, engine } = setup();
    const pixels = b64(cat().pixels);
    await Promise.all([engine.run({ id: 1, mesh: "2x2", pixels }), engine.run({ id: 2, mesh: "2x2", pixels })]);
    const ids = events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(events.filter((e) => e.kind === "done").map((e) => e.id)).toEqual([1, 2]);
  }, 120_000);

  it("skips a queued request that a newer one has replaced, and runs the newest", async () => {
    const { events, engine } = setup();
    const pixels = b64(cat().pixels);
    await Promise.all([
      engine.run({ id: 1, mesh: "2x2", pixels }),
      engine.run({ id: 2, mesh: "2x2", pixels }),
      engine.run({ id: 3, mesh: "2x2", pixels }),
    ]);
    expect(events.filter((e) => e.kind === "done").map((e) => e.id)).toEqual([1, 3]);
    expect(events.some((e) => e.id === 2)).toBe(false);
  }, 120_000);

  it("says so when the chip and the reference disagree", async () => {
    const { events, engine } = setup({
      loadModel: async () => {
        const model = loadModel();
        model.layers[0]!.weights.fill(0);
        return model;
      },
    });
    await engine.run({ id: 1, mesh: "2x2", pixels: b64(cat().pixels) });
    const done = events.at(-1)!;
    if (done.kind !== "done") throw new Error("expected done");
    expect(done.run.match).toBe(false);
  }, 60_000);

  it("reports a chip fault, forgets that chip, and recovers on the next run", async () => {
    let calls = 0;
    const { events, engine } = setup({
      openChip: async (mesh) => {
        const assets = await nodeAssets(mesh);
        calls++;
        return Chip.open(mesh, calls === 1 ? { ...assets, program: new Uint8Array(assets.program.length) } : assets);
      },
    });
    const pixels = b64(cat().pixels);
    await engine.run({ id: 1, mesh: "2x2", pixels });
    const failed = events.find((e) => e.kind === "error");
    expect(failed).toMatchObject({ id: 1, kind: "error", fault: true });
    await engine.run({ id: 2, mesh: "2x2", pixels });
    expect(calls).toBe(2);
    expect(events.at(-1)).toMatchObject({ id: 2, kind: "done" });
  }, 120_000);

  it("reports bad pixel data as an error that is not a chip fault", async () => {
    const { events, engine } = setup();
    await engine.run({ id: 1, mesh: "2x2", pixels: new Uint8Array(10) });
    expect(events.at(-1)).toMatchObject({ id: 1, kind: "error", fault: false });
  }, 60_000);

  it("reports a failure to open the chip as an error, and the queue keeps working", async () => {
    let first = true;
    const { events, engine } = setup({
      openChip: async (mesh) => {
        if (first) {
          first = false;
          throw new Error("HTTP 404");
        }
        return Chip.open(mesh, await nodeAssets(mesh));
      },
    });
    const pixels = b64(cat().pixels);
    await engine.run({ id: 1, mesh: "2x2", pixels });
    expect(events.at(-1)).toMatchObject({ id: 1, kind: "error", message: "HTTP 404", fault: false });
    await engine.run({ id: 2, mesh: "2x2", pixels });
    expect(events.at(-1)).toMatchObject({ id: 2, kind: "done" });
  }, 120_000);
});
