// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import decisions from "../data/generated/decisions.json";
import type { DecisionsFile } from "./decisionTypes";
import { parseBlocks } from "./markdown";
import { Inlines, MiniMarkdown } from "./MiniMarkdown";

afterEach(cleanup);

describe("MiniMarkdown", () => {
  it("renders paragraphs with code, bold and italics as elements", () => {
    const { container } = render(<MiniMarkdown source={"use `x` **now** and *later*"} />);
    expect(container.querySelector("p code")!.textContent).toBe("x");
    expect(container.querySelector("p strong")!.textContent).toBe("now");
    expect(container.querySelector("p em")!.textContent).toBe("later");
  });

  it("renders a table inside a scroll container, with right-aligned numeric columns", () => {
    const { container } = render(<MiniMarkdown source={"| Name | Cycles |\n|---|---:|\n| a | 12 |"} />);
    expect(container.querySelector(".table-scroll table.data-table")).not.toBeNull();
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect((container.querySelector("td:nth-child(2)") as HTMLElement).style.textAlign).toBe("right");
  });

  it("renders a numbered list from its first number, and bullets", () => {
    const { container } = render(<MiniMarkdown source={"(3) three\n(4) four\n\n- a\n- b"} />);
    expect(container.querySelector("ol")!.getAttribute("start")).toBe("3");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("never injects markup: angle brackets stay text", () => {
    const { container } = render(<MiniMarkdown source={"a <b>not bold</b> c"} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>not bold</b>");
  });

  it("renders inline only for a heading", () => {
    const { container } = render(<Inlines text={"2026-07-05 - Tile `fsm`"} />);
    expect(container.querySelector("code")!.textContent).toBe("fsm");
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("every cited decision record", () => {
  const file = decisions as unknown as DecisionsFile;

  it("renders with no markup syntax left over", () => {
    for (const [id, record] of Object.entries(file.records)) {
      for (const section of record.sections) {
        const { container, unmount } = render(<MiniMarkdown source={section.body} />);
        // a glob such as `web/**` is legitimate inside inline code: look at the text outside code spans
        container.querySelectorAll("code").forEach((code) => code.remove());
        const text = container.textContent ?? "";
        expect(text, `${id} / ${section.label}: a ** survived`).not.toContain("**");
        expect(text, `${id} / ${section.label}: a backtick survived`).not.toContain("`");
        unmount();
      }
    }
  });

  it("turns every markdown table into a table block of even width", () => {
    for (const [id, record] of Object.entries(file.records)) {
      for (const section of record.sections) {
        const delimiters = section.body.split("\n").filter((line) => /^\s*\|?\s*:?-+:?\s*\|/.test(line)).length;
        const tables = parseBlocks(section.body).filter((block) => block.type === "table");
        expect(tables.length, `${id} / ${section.label}: tables`).toBe(delimiters);
        for (const table of tables) {
          for (const row of table.rows) expect(row.length, `${id} / ${section.label}: row width`).toBe(table.head.length);
        }
      }
    }
  });
});
