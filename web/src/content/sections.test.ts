import { describe, expect, it } from "vitest";
import { SECTIONS, SECTION_IDS, sectionMeta } from "./sections";

describe("sections list", () => {
  it("lists the six sections in page order with the agreed navigation labels", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["replay", "live", "performance", "architecture", "verification", "built"]);
    expect(SECTIONS.map((s) => s.label)).toEqual(["Watch", "Run", "Performance", "Chip", "Verify", "Built"]);
    expect(SECTION_IDS).toEqual(SECTIONS.map((s) => s.id));
  });

  it("carries no section numbers: the sections are not a sequence, so there is no numbered eyebrow", () => {
    for (const section of SECTIONS) expect(Object.keys(section).sort()).toEqual(["id", "label", "title"]);
  });

  it("looks a section up by id, and returns nothing for an unknown id", () => {
    expect(sectionMeta("live")?.title).toBe("Run it live");
    expect(sectionMeta("nope")).toBeUndefined();
  });

  it("has unique ids and unique labels", () => {
    expect(new Set(SECTION_IDS).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.label)).size).toBe(SECTIONS.length);
  });
});
