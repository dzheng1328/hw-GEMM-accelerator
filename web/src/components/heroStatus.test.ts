import { describe, expect, it } from "vitest";
import type { Phase } from "../live/state";
import { heroStatus, type HeroStatusInput } from "./heroStatus";

const base: HeroStatusInput = { phase: { name: "idle" }, hasRun: false, canRun: true, autoPending: false, examplesFailed: false, result: null };
const result = {
  broken: false,
  layerIndex: 2 as number | null,
  layerCount: 6,
  layerName: "conv3",
  cycle: 41200,
  total: 139981,
  finished: false,
  predicted: "cat",
  verified: true,
};
const status = (over: Partial<HeroStatusInput>) => heroStatus({ ...base, ...over });
const done: Phase = { name: "done", run: {} as never };

describe("heroStatus", () => {
  it("says the chip cannot run here when it cannot", () => {
    expect(status({ canRun: false })).toBe("This browser cannot run Web Workers or WebAssembly, so the chip cannot run here.");
  });

  it("names the stage while a run is in progress", () => {
    expect(status({ phase: { name: "running", stage: "starting" } })).toBe("Starting...");
    expect(status({ phase: { name: "running", stage: "loading" } })).toBe("Loading the chip (about 1 MB the first time)...");
    expect(status({ phase: { name: "running", stage: "simulating" } })).toBe("Simulating the chip...");
    expect(status({ phase: { name: "running", stage: "checking" } })).toBe("Checking against the reference...");
  });

  it("follows the layer and the cycle while the run plays", () => {
    expect(status({ phase: done, result })).toBe("Layer 3 of 6: conv3 - cycle 41,200 of 139,981");
  });

  it("without a layer map still gives the cycle", () => {
    expect(status({ phase: done, result: { ...result, layerIndex: null, layerName: "the network" } })).toBe("cycle 41,200 of 139,981");
  });

  it("ends on the prediction and says the check passed", () => {
    expect(status({ phase: done, result: { ...result, finished: true, cycle: 139981 } })).toBe("Predicted: cat - checked against the reference");
  });

  it("never claims a check that failed", () => {
    expect(status({ phase: done, result: { ...result, finished: true, verified: false } })).toBe(
      "Predicted: cat - the check against the reference FAILED",
    );
  });

  it("says when a result cannot be shown", () => {
    expect(status({ phase: done, result: { ...result, broken: true } })).toBe("The result could not be shown. Press Run to try again.");
  });

  it("reports an error, and a chip fault as one", () => {
    expect(status({ phase: { name: "error", message: "boom", fault: false } })).toBe("boom");
    expect(status({ phase: { name: "error", message: "bad word", fault: true } })).toBe("The chip stopped: bad word");
  });

  it("while the first run is pending says the chip is loading", () => {
    expect(status({ autoPending: true })).toBe("Loading the chip...");
  });

  it("after an image change asks for a run, and before any run explains what Run does", () => {
    expect(status({ hasRun: true })).toBe("Ready - press Run");
    expect(status({})).toBe("Press Run to watch the chip classify an image.");
    expect(status({ examplesFailed: true })).toBe("The example images could not be loaded. You can still upload one below.");
  });
});
