import { describe, expect, it } from "vitest";
import { newSummary } from "../trace/trace";
import { describeActivity } from "./readout";

describe("describeActivity", () => {
  it("counts the tiles with any activity", () => {
    const s = newSummary(4);
    s.tiles[0] = 1;
    s.tiles[2] = 0.25;
    expect(describeActivity(s, "conv3")).toBe("2 of 4 tiles busy in conv3");
  });
  it("says 1 tile in the singular form of the mesh", () => {
    expect(describeActivity(newSummary(1), "fc")).toBe("0 of 1 tiles busy in fc");
  });
});
