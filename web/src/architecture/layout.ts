import type { Block, Box } from "./types";

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function insideViewBox(box: Box, view: { w: number; h: number }): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.w <= view.w && box.y + box.h <= view.h;
}

/** Every connection once, in the order the blocks declare them. */
export function edges(blocks: Block[]): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const block of blocks) {
    for (const to of block.links) {
      const key = [block.id, to].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([block.id, to]);
    }
  }
  return out;
}

/** Where the line from a box's centre toward (tx, ty) leaves the box. */
function exitPoint(box: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const scale = Math.min(dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * The line joining two boxes: vertical through the middle of their shared x span, horizontal through the middle
 * of their shared y span, and otherwise the centre-to-centre line clipped to both boxes.
 */
export function linkSegment(a: Box, b: Box): Segment {
  const ox0 = Math.max(a.x, b.x);
  const ox1 = Math.min(a.x + a.w, b.x + b.w);
  if (ox0 < ox1) {
    const x = (ox0 + ox1) / 2;
    const [upper, lower] = a.y <= b.y ? [a, b] : [b, a];
    return { x1: x, y1: upper.y + upper.h, x2: x, y2: lower.y };
  }
  const oy0 = Math.max(a.y, b.y);
  const oy1 = Math.min(a.y + a.h, b.y + b.h);
  if (oy0 < oy1) {
    const y = (oy0 + oy1) / 2;
    const [left, right] = a.x <= b.x ? [a, b] : [b, a];
    return { x1: left.x + left.w, y1: y, x2: right.x, y2: y };
  }
  const p1 = exitPoint(a, b.x + b.w / 2, b.y + b.h / 2);
  const p2 = exitPoint(b, a.x + a.w / 2, a.y + a.h / 2);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

export function findBlock(blocks: Block[], id: string): Block {
  const found = blocks.find((block) => block.id === id);
  if (!found) throw new Error(`no block "${id}" (have ${blocks.map((block) => block.id).join(", ")})`);
  return found;
}
