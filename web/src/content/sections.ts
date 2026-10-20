export interface SectionMeta {
  id: string;
  title: string;
  /** the short name in the top bar */
  label: string;
}

/** The one list the page sections, the top bar links and the scroll-spy all read, in page order. */
export const SECTIONS: readonly SectionMeta[] = [
  { id: "replay", title: "Watch it think", label: "Watch" },
  { id: "live", title: "Run it live", label: "Run" },
  { id: "performance", title: "Where the cycles go", label: "Performance" },
  { id: "architecture", title: "The chip", label: "Chip" },
  { id: "verification", title: "Why you can believe it", label: "Verify" },
  { id: "built", title: "How it was built", label: "Built" },
];

export const SECTION_IDS: readonly string[] = SECTIONS.map((s) => s.id);

export function sectionMeta(id: string): SectionMeta | undefined {
  return SECTIONS.find((s) => s.id === id);
}
