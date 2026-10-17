import { describe, expect, it } from "vitest";
import { SECTIONS, SECTION_IDS, isAlternate, kicker, sectionMeta } from "./sections";

describe("sections list", () => {
  it("lists the six sections in page order with the agreed navigation labels", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["replay", "live", "performance", "architecture", "verification", "built"]);
    expect(SECTIONS.map((s) => s.label)).toEqual(["Watch", "Run", "Performance", "Chip", "Verify", "Built"]);
    expect(SECTION_IDS).toEqual(SECTIONS.map((s) => s.id));
  });

  it("numbers the sections 01 to 06 and builds the kicker from the number and label", () => {
    expect(SECTIONS.map((s) => s.number)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(kicker(SECTIONS[0]!)).toBe("01 / WATCH");
    expect(kicker(SECTIONS[2]!)).toBe("03 / PERFORMANCE");
  });

  it("looks a section up by id, and returns nothing for an unknown id", () => {
    expect(sectionMeta("live")?.title).toBe("Run it live");
    expect(sectionMeta("nope")).toBeUndefined();
  });

  it("alternates the band background: the 2nd, 4th and 6th sections are the raised ones", () => {
    expect(SECTIONS.map((s) => isAlternate(s.id))).toEqual([false, true, false, true, false, true]);
    expect(isAlternate("nope")).toBe(false);
  });

  it("has unique ids and unique labels", () => {
    expect(new Set(SECTION_IDS).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.label)).size).toBe(SECTIONS.length);
  });
});
