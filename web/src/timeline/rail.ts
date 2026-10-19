import type { Phase, TimelineNode } from "./types";

/** The skim layer's rail shows the headline milestones; Deep mode or the "Show all" chip shows every one. */
export function railNodes(nodes: TimelineNode[], showAll: boolean): TimelineNode[] {
  return showAll ? nodes : nodes.filter((n) => n.headline);
}

export interface PhaseBand {
  phase: Phase;
  /** the 1-based grid column of the band's first milestone */
  start: number;
  count: number;
}

/** One band per phase that has a visible milestone, so a rail never draws an empty band. */
export function phaseBands(nodes: TimelineNode[]): PhaseBand[] {
  const bands: PhaseBand[] = [];
  nodes.forEach((n, i) => {
    const last = bands[bands.length - 1];
    if (last && last.phase === n.phase) last.count += 1;
    else bands.push({ phase: n.phase, start: i + 1, count: 1 });
  });
  return bands;
}

export type RailKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function keyTarget(nodes: TimelineNode[], selectedId: string, key: RailKey): string {
  const at = Math.max(0, nodes.findIndex((n) => n.id === selectedId));
  const last = nodes.length - 1;
  const to = key === "Home" ? 0 : key === "End" ? last : key === "ArrowLeft" ? Math.max(0, at - 1) : Math.min(last, at + 1);
  return nodes[to]?.id ?? selectedId;
}

/** The milestone one step away, or null at an end. */
export function stepTarget(nodes: TimelineNode[], selectedId: string, delta: -1 | 1): string | null {
  const at = nodes.findIndex((n) => n.id === selectedId);
  return nodes[at + delta]?.id ?? null;
}

/** The selection after the visible set changed (Deep mode went off): keep it, or move to the nearest earlier visible one. */
export function resolveSelected(visible: TimelineNode[], all: TimelineNode[], selectedId: string): string {
  if (visible.some((n) => n.id === selectedId)) return selectedId;
  const at = all.findIndex((n) => n.id === selectedId);
  for (let i = at - 1; i >= 0; i--) {
    const id = all[i]!.id;
    if (visible.some((n) => n.id === id)) return id;
  }
  return visible[0]?.id ?? selectedId;
}

/** The page opens on the last headline milestone: the strongest current story, not the project's first day. */
export function defaultNodeId(nodes: TimelineNode[]): string {
  const headline = nodes.filter((n) => n.headline);
  return (headline[headline.length - 1] ?? nodes[nodes.length - 1])!.id;
}

export function railDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/**
 * Where to scroll a strip so a dot sits in its middle. Both boxes are screen coordinates (getBoundingClientRect), plus the
 * distance the strip is already scrolled: a dot's offsetLeft is measured from its list item, not from the strip.
 */
export function centerScrollLeft(
  strip: { left: number; width: number; scrollLeft: number },
  dot: { left: number; width: number },
): number {
  return Math.max(0, strip.scrollLeft + (dot.left - strip.left) - (strip.width - dot.width) / 2);
}

