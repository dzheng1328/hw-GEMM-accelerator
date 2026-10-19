import { describe, expect, it } from "vitest";
import { STAGE_TEXT, UNSUPPORTED } from "../live/session/messages";
import type { Phase } from "../live/state";
import { stripView, type StripInput } from "./stripView";

const idle: Phase = { name: "idle" };
const base: StripInput = { canRun: true, phase: idle, autoPending: false, result: null };
const result = { broken: false, mesh: "2x2", cycle: 41_200, total: 118_000, layerIndex: 2 as number | null, layerCount: 6 };

describe("stripView", () => {
  it("says the chip cannot run here, with no button, when the browser cannot run it", () => {
    expect(stripView({ ...base, canRun: false })).toEqual({ text: UNSUPPORTED, button: null });
  });

  it("invites a run when there is none", () => {
    expect(stripView(base)).toEqual({ text: "Run the chip to see this light up.", button: "Run the chip" });
  });

  it("says the chip is loading while the first run is about to start by itself", () => {
    expect(stripView({ ...base, autoPending: true })).toEqual({ text: "Loading the chip...", button: "Run the chip" });
  });

  it("shows the stage while running, with the button reading Running...", () => {
    expect(stripView({ ...base, phase: { name: "running", stage: "simulating" } })).toEqual({
      text: STAGE_TEXT.simulating,
      button: "Running...",
    });
  });

  it("shows the run's place while it plays and rests on its end", () => {
    const done: Phase = { name: "done", run: {} as never };
    expect(stripView({ ...base, phase: done, result })).toEqual({
      text: "2x2 mesh - cycle 41,200 of 118,000 - layer 3 of 6",
      button: "Replay",
    });
    expect(stripView({ ...base, phase: done, result: { ...result, cycle: 118_000, layerIndex: 5 } }).text).toBe(
      "2x2 mesh - cycle 118,000 of 118,000 - layer 6 of 6",
    );
    expect(stripView({ ...base, phase: done, result: { ...result, layerIndex: null } }).text).toBe("2x2 mesh - cycle 41,200 of 118,000");
  });

  it("says block activity is unavailable when the trace could not be decoded, and offers a new run", () => {
    const done: Phase = { name: "done", run: {} as never };
    expect(stripView({ ...base, phase: done, result: { ...result, broken: true } })).toEqual({
      text: "Block activity is unavailable for this run.",
      button: "Run the chip",
    });
  });

  it("shows the same message as the hero when a run failed, and offers a retry", () => {
    expect(stripView({ ...base, phase: { name: "error", message: "boom", fault: false } })).toEqual({ text: "boom", button: "Run the chip" });
    expect(stripView({ ...base, phase: { name: "error", message: "boom", fault: true } }).text).toBe("The chip stopped: boom");
  });
});
