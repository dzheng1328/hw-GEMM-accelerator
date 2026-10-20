import { describe, expect, it } from "vitest";
import { motionEnabled, readMotionEnv } from "./enabled";

const env = (over = {}) => ({ reduced: false, saveData: false, search: "", ...over });

describe("motionEnabled", () => {
  it("is on by default", () => {
    expect(motionEnabled(env())).toBe(true);
  });
  it("is off for reduced motion", () => {
    expect(motionEnabled(env({ reduced: true }))).toBe(false);
  });
  it("is off for Save-Data", () => {
    expect(motionEnabled(env({ saveData: true }))).toBe(false);
  });
  it("is off with ?motion=0, whatever else is in the query", () => {
    expect(motionEnabled(env({ search: "?motion=0" }))).toBe(false);
    expect(motionEnabled(env({ search: "?deep=1&motion=0" }))).toBe(false);
    expect(motionEnabled(env({ search: "?motion=1" }))).toBe(true);
  });
});

describe("readMotionEnv", () => {
  it("treats a window without matchMedia as reduced (no motion in jsdom or an old browser)", () => {
    const win = { navigator: {}, location: { search: "" } } as unknown as Window;
    expect(readMotionEnv(win).reduced).toBe(true);
  });
  it("reads the media query, the connection and the query string", () => {
    const win = {
      matchMedia: (q: string) => ({ matches: q.includes("reduce") }),
      navigator: { connection: { saveData: true } },
      location: { search: "?motion=0" },
    } as unknown as Window;
    expect(readMotionEnv(win)).toEqual({ reduced: true, saveData: true, search: "?motion=0" });
  });
});
