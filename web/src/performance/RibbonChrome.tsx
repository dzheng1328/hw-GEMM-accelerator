import type { ReactNode } from "react";
import { Sheet } from "../components/Sheet";

/**
 * The parts of the stroke ribbon that do not depend on its data. The lazy chunk and its Suspense fallback both build
 * the figure from these, so the fallback is as tall as the real figure and nothing below it moves when the chunk lands.
 */
export function RibbonHead() {
  return (
    <figcaption className="ribbon-head">
      <h3>Where the cycles go, one stroke per step</h3>
      <p>Each stroke is one step, split by the work it took. The strokes get taller as the story grows.</p>
    </figcaption>
  );
}

export function RibbonSource() {
  return <p className="ribbon-src">docs/perf/lm_trace.json - 2x2, temperature 1.0</p>;
}

/** The closed "See the numbers" row, held open until the table exists. */
export function RibbonTableRoom() {
  return <div className="ribbon-table-room" aria-hidden="true" />;
}

export function RibbonFallback(): ReactNode {
  return (
    <Sheet as="figure" className="ribbon">
      <RibbonHead />
      <div className="ribbon-frame" />
      <RibbonTableRoom />
      <RibbonSource />
    </Sheet>
  );
}
