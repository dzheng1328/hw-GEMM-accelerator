import { describe, expect, it } from "vitest";
import { formatInt, formatPercent, formatRatio } from "./format";

describe("format", () => {
  it("groups thousands with commas and rounds to an integer", () => {
    expect(formatInt(62677232)).toBe("62,677,232");
    expect(formatInt(139912.5390625)).toBe("139,913");
    expect(formatInt(0)).toBe("0");
  });

  it("formats a fraction as a percentage with two decimals by default", () => {
    expect(formatPercent(0.8828125)).toBe("88.28%");
    expect(formatPercent(0.5, 0)).toBe("50%");
    expect(formatPercent(1)).toBe("100.00%");
  });

  it("formats a ratio with two decimals and an x", () => {
    expect(formatRatio(1.2278484793329738)).toBe("1.23x");
    expect(formatRatio(1.2424014727332795)).toBe("1.24x");
    expect(formatRatio(1)).toBe("1.00x");
  });
});
