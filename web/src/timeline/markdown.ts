/** The small markdown subset the decision entries use: paragraphs, tables, bullets, (n) lists, code, bold and italics. */

export type Inline =
  | { type: "text" | "code"; text: string }
  | { type: "strong" | "em"; children: Inline[] };

export type Align = "left" | "right" | "center";

export type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; start: number; items: string[] }
  | { type: "table"; head: string[]; align: Align[]; rows: string[][] };

// code first (its contents are never markup), then bold, then italics: an asterisk that has a space or a word on its other side is not italics
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: source.slice(last, at) });
    if (m[1] !== undefined) out.push({ type: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "strong", children: parseInline(m[2]) });
    else out.push({ type: "em", children: parseInline(m[3] ?? "") });
    last = at + m[0].length;
  }
  if (last < source.length) out.push({ type: "text", text: source.slice(last) });
  return out;
}

const BULLET = /^\s*[-*] +(.*)$/;
const NUMBERED = /^\((\d+)\) +(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const alignOf = (cell: string): Align => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");

export function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list = null as { kind: "ul" | "ol"; start: number; items: string[] } | null;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list.kind === "ul" ? { type: "ul", items: list.items } : { type: "ol", start: list.start, items: list.items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const next = lines[i + 1];
    if (TABLE_ROW.test(line) && next !== undefined && DELIMITER.test(next)) {
      flushPara();
      flushList();
      const head = cells(line);
      const align = cells(next).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        rows.push(cells(lines[i]!));
        i++;
      }
      i--;
      blocks.push({ type: "table", head, align, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(((bullet ?? numbered) as RegExpExecArray)[bullet ? 1 : 2] ?? "");
      continue;
    }
    // a line that starts nothing continues the open list item, or the open paragraph
    if (list) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""} ${line.trim()}`;
    } else para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
