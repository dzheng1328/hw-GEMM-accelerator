import type { DecisionRecord, DecisionSection } from "../src/timeline/decisionTypes";

export interface RawEntry {
  date: string;
  title: string;
  text: string;
}

export interface DecisionRef {
  date: string;
  title: string;
}

// A heading looks like "### 2026-09-24 -- Title", or with an em dash in the older entries.
const HEADING = /^(\d{4}-\d{2}-\d{2}) (?:\u2014|--) (.*)$/;
// A section opens with a bold label at the start of a line: "**Decision:** text" or "**Decision - note:** text".
const LABEL_LINE = /^\*\*([^*\n]+?):\*\*[ \t]*(.*)$/;

/** The labels that open a section of an entry. Any other bold line stays in the body of the section above it. */
export const KNOWN_LABELS = [
  "Context",
  "Options considered",
  "Decision",
  "Why",
  "Result",
  "Why it matters",
  "What still limits the system",
] as const;

/** The project writes a plain dash; some older entries have an em dash. */
export const normalizeDashes = (text: string): string => text.replaceAll("\u2014", "-");

export function parseEntries(markdown: string): RawEntry[] {
  return markdown
    .split("\n### ")
    .slice(1)
    .map((chunk) => {
      const [head = "", ...rest] = chunk.split("\n");
      const m = HEADING.exec(head);
      return { date: m?.[1] ?? "", title: m?.[2] ?? "", text: rest.join("\n") };
    });
}

export function findEntry(entries: RawEntry[], ref: DecisionRef): RawEntry | undefined {
  return entries.find((e) => e.date === ref.date && e.title.startsWith(ref.title));
}

export function splitSections(text: string): DecisionSection[] {
  const parts: { label: string | null; note?: string; lines: string[] }[] = [];
  for (const line of normalizeDashes(text).split("\n")) {
    const m = LABEL_LINE.exec(line);
    // only a known label opens a section; another bold line ("**A real gap found along the way:**") is part of the text above it
    const [label = "", ...rest] = (m?.[1] ?? "").split(" - ");
    if (m && (KNOWN_LABELS as readonly string[]).includes(label.trim())) {
      parts.push({ label: label.trim(), note: rest.length ? rest.join(" - ").trim() : undefined, lines: [m[2] ?? ""] });
    } else {
      if (parts.length === 0) parts.push({ label: null, lines: [] });
      parts[parts.length - 1]!.lines.push(line);
    }
  }
  return parts
    .map(({ label, note, lines }) => ({
      label,
      ...(note ? { note } : {}),
      body: lines.join("\n").trim().replace(/\n+-{3,}$/, "").trim(),
    }))
    .filter((section) => section.body.length > 0);
}

/** The record of every timeline node, by node id. Throws, naming the node, when its cited entry is not in the file. */
export function buildDecisions(markdown: string, nodes: { id: string; decision: DecisionRef }[]): Record<string, DecisionRecord> {
  const entries = parseEntries(markdown);
  const records: Record<string, DecisionRecord> = {};
  for (const node of nodes) {
    const entry = findEntry(entries, node.decision);
    if (!entry) throw new Error(`${node.id}: no decisions.md heading "${node.decision.date} ... ${node.decision.title}"`);
    records[node.id] = {
      heading: `${entry.date} - ${normalizeDashes(entry.title)}`,
      sections: splitSections(entry.text),
    };
  }
  return records;
}
