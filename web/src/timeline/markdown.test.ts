import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "./markdown";

describe("parseInline", () => {
  it("reads inline code, bold and italics", () => {
    expect(parseInline("a `b c` d **e** f *g* h")).toEqual([
      { type: "text", text: "a " },
      { type: "code", text: "b c" },
      { type: "text", text: " d " },
      { type: "strong", children: [{ type: "text", text: "e" }] },
      { type: "text", text: " f " },
      { type: "em", children: [{ type: "text", text: "g" }] },
      { type: "text", text: " h" },
    ]);
  });

  it("reads code inside bold, and leaves asterisks inside code alone", () => {
    expect(parseInline("**`pe`: 6,209.7 um^2** and `a*b*c`")).toEqual([
      {
        type: "strong",
        children: [
          { type: "code", text: "pe" },
          { type: "text", text: ": 6,209.7 um^2" },
        ],
      },
      { type: "text", text: " and " },
      { type: "code", text: "a*b*c" },
    ]);
  });

  it("does not take a spaced asterisk or a pipe for markup", () => {
    expect(parseInline("2 * 3 and |max(|X|)| ok")).toEqual([{ type: "text", text: "2 * 3 and |max(|X|)| ok" }]);
  });

  it("returns a single text node for plain text and nothing for an empty string", () => {
    expect(parseInline("plain")).toEqual([{ type: "text", text: "plain" }]);
    expect(parseInline("")).toEqual([]);
  });
});

describe("parseBlocks", () => {
  it("joins the lines of a paragraph and splits paragraphs on blank lines", () => {
    expect(parseBlocks("one\ntwo\n\nthree")).toEqual([
      { type: "p", text: "one two" },
      { type: "p", text: "three" },
    ]);
  });

  it("reads a table with alignment, and stops it at the first non-row line", () => {
    const md = "the table:\n\n| A | B | C |\n|:--|--:|:-:|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nafter";
    expect(parseBlocks(md)).toEqual([
      { type: "p", text: "the table:" },
      { type: "table", head: ["A", "B", "C"], align: ["left", "right", "center"], rows: [["1", "2", "3"], ["4", "5", "6"]] },
      { type: "p", text: "after" },
    ]);
  });

  it("reads bullets, with indented continuation lines joining the item", () => {
    expect(parseBlocks("- first\n  goes on\n- second")).toEqual([{ type: "ul", items: ["first goes on", "second"] }]);
  });

  it("reads (n) lines as an ordered list that keeps its first number", () => {
    expect(parseBlocks("(1) one\n(2) two\ncontinues")).toEqual([{ type: "ol", start: 1, items: ["one", "two continues"] }]);
    expect(parseBlocks("(2) is the harder limit\nSDC change.")).toEqual([
      { type: "ol", start: 2, items: ["is the harder limit SDC change."] },
    ]);
  });

  it("ends a paragraph where a list starts, and a list where a table starts", () => {
    expect(parseBlocks("intro\n- a\n\n| X |\n|---|\n| 1 |")).toEqual([
      { type: "p", text: "intro" },
      { type: "ul", items: ["a"] },
      { type: "table", head: ["X"], align: ["left"], rows: [["1"]] },
    ]);
  });

  it("treats a pipe row with no delimiter line as ordinary text", () => {
    expect(parseBlocks("| not | a table |")).toEqual([{ type: "p", text: "| not | a table |" }]);
  });

  it("returns nothing for an empty source", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n")).toEqual([]);
  });
});
