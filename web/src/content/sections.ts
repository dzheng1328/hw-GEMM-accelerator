export interface SectionMeta {
  id: string;
  number: string;
  title: string;
  /** the short name in the top bar and in the kicker */
  label: string;
}

/** The one list the page sections, the top bar links and the scroll-spy all read, in page order. */
export const SECTIONS: readonly SectionMeta[] = [
  { id: "replay", number: "01", title: "Watch it think", label: "Watch" },
  { id: "live", number: "02", title: "Run it live", label: "Run" },
  { id: "performance", number: "03", title: "Where the cycles go", label: "Performance" },
  { id: "architecture", number: "04", title: "The chip", label: "Chip" },
  { id: "verification", number: "05", title: "Why you can believe it", label: "Verify" },
  { id: "built", number: "06", title: "How it was built", label: "Built" },
];

export const SECTION_IDS: readonly string[] = SECTIONS.map((s) => s.id);

export function sectionMeta(id: string): SectionMeta | undefined {
  return SECTIONS.find((s) => s.id === id);
}

export function kicker(meta: SectionMeta): string {
  return `${meta.number} / ${meta.label.toUpperCase()}`;
}

/** The 2nd, 4th and 6th sections sit on the raised band surface. */
export function isAlternate(id: string): boolean {
  const index = SECTIONS.findIndex((s) => s.id === id);
  return index >= 0 && index % 2 === 1;
}
