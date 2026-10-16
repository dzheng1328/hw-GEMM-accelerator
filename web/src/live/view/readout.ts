import type { WindowSummary } from "../trace/trace";

/** A plain-text description of what the scene shows, for the paused state and for screen readers. */
export function describeActivity(summary: WindowSummary, layerName: string): string {
  const busy = Array.from(summary.tiles).filter((fraction) => fraction > 0).length;
  return `${busy} of ${summary.tiles.length} tiles busy in ${layerName}`;
}
