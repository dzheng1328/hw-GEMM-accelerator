import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIMELINE } from "../src/content/timeline";
import { KNOWN_LABELS, buildDecisions, findEntry, normalizeDashes, parseEntries, splitSections } from "./decisions";
import { REPO_ROOT } from "./paths";

const SAMPLE = `a preface that is not an entry

### 2026-09-25 -- Milestone closes: measured

**Context:** the roadmap needed a table.
It spans two lines.
**Result:** the table:

| A | B |
|---|--:|
| 1 | 2 |

### 2026-07-05 \u2014 Older heading with an em dash

**Decision \u2014 tiled GEMM, no hardware changes:** Option 1.
**Why:** scope.
`;

describe("parseEntries and findEntry", () => {
  const entries = parseEntries(SAMPLE);

  it("reads both heading styles and keeps each entry's text", () => {
    expect(entries.map((e) => [e.date, e.title])).toEqual([
      ["2026-09-25", "Milestone closes: measured"],
      ["2026-07-05", "Older heading with an em dash"],
    ]);
    expect(entries[0]!.text).toContain("**Context:** the roadmap needed a table.");
    expect(entries[1]!.text).toContain("**Why:** scope.");
  });

  it("finds an entry by its date and the start of its title, and nothing else", () => {
    expect(findEntry(entries, { date: "2026-09-25", title: "Milestone closes" })).toBe(entries[0]);
    expect(findEntry(entries, { date: "2026-09-25", title: "Older" })).toBeUndefined();
    expect(findEntry(entries, { date: "2026-01-01", title: "Milestone" })).toBeUndefined();
  });
});

describe("splitSections", () => {
  it("splits on leading bold labels and keeps multi-line bodies and tables", () => {
    const sections = splitSections(parseEntries(SAMPLE)[0]!.text);
    expect(sections.map((s) => s.label)).toEqual(["Context", "Result"]);
    expect(sections[0]!.body).toBe("the roadmap needed a table.\nIt spans two lines.");
    expect(sections[1]!.body).toBe("the table:\n\n| A | B |\n|---|--:|\n| 1 | 2 |");
  });

  it("puts what follows a dash in the label into a note, and normalizes the em dash", () => {
    const [decision, why] = splitSections(parseEntries(SAMPLE)[1]!.text);
    expect(decision).toEqual({ label: "Decision", note: "tiled GEMM, no hardware changes", body: "Option 1." });
    expect(why).toEqual({ label: "Why", body: "scope." });
  });

  it("keeps text before the first label as a section with no label", () => {
    expect(splitSections("A paragraph first.\n**Why:** because")).toEqual([
      { label: null, body: "A paragraph first." },
      { label: "Why", body: "because" },
    ]);
  });

  it("does not treat a bold phrase inside a line as a label", () => {
    const [only] = splitSections("**Context:** has **DRC: 0 violations** inside, and a - b.");
    expect(only!.body).toBe("has **DRC: 0 violations** inside, and a - b.");
  });

  it("keeps a bold line that is not a known label inside the section above it", () => {
    const sections = splitSections("**Decision:** go.\n**A real gap found along the way:**\nit is filed separately.\n**Why:** because");
    expect(sections.map((s) => s.label)).toEqual(["Decision", "Why"]);
    expect(sections[0]!.body).toBe("go.\n**A real gap found along the way:**\nit is filed separately.");
  });

  it("drops a trailing horizontal rule", () => {
    expect(splitSections("**Why:** because\n\n---\n")[0]!.body).toBe("because");
  });
});

describe("normalizeDashes", () => {
  it("turns an em dash into a plain dash and leaves everything else", () => {
    expect(normalizeDashes("a \u2014 b - c")).toBe("a - b - c");
  });
});

describe("the real decisions.md", () => {
  const markdown = readFileSync(join(REPO_ROOT, "docs", "decisions.md"), "utf8");
  const records = buildDecisions(markdown, TIMELINE);

  it("resolves every timeline node to an entry", () => {
    expect(Object.keys(records).sort()).toEqual(TIMELINE.map((n) => n.id).sort());
    for (const record of Object.values(records)) expect(record.sections.length).toBeGreaterThan(0);
  });

  it("splits every entry into known labels only, starting with Context", () => {
    for (const [id, record] of Object.entries(records)) {
      for (const section of record.sections) {
        if (section.label !== null) {
          expect(KNOWN_LABELS as readonly string[], `${id}: label "${section.label}"`).toContain(section.label);
        }
      }
      expect(record.sections[0]!.label, `${id} starts with Context`).toBe("Context");
    }
  });

  it("keeps the note of the mnist Decision and the missing Decision of milestone 4.1", () => {
    const mnist = records["mnist-on-tile"]!.sections.find((s) => s.label === "Decision")!;
    expect(mnist.note).toBe("tiled GEMM via repeated waves, no hardware changes");
    const labels = records["milestone-4-1"]!.sections.map((s) => s.label);
    expect(labels).toContain("Result");
    expect(labels).not.toContain("Decision");
  });

  it("carries no em dash and gives each heading its date and a plain dash", () => {
    for (const [id, record] of Object.entries(records)) {
      expect(record.heading, id).toMatch(/^\d{4}-\d{2}-\d{2} - \S/);
      expect(JSON.stringify(record), id).not.toContain("\u2014");
    }
  });

  it("names the node when an entry is missing", () => {
    expect(() => buildDecisions(markdown, [{ id: "ghost", decision: { date: "1999-01-01", title: "none" } }])).toThrow(/ghost/);
  });
});
