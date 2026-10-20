import { useRef, type CSSProperties } from "react";
import { asset } from "../content/art";
import { printParallax } from "../motion/primitives";
import { useMotion } from "../motion/useMotion";

const style = {
  "--print-blur-night": `url("${asset("night-print").blur}")`,
  "--print-blur-day": `url("${asset("day-scroll").blur}")`,
} as CSSProperties;

/** The real print behind the page. Which image shows, and the scrim over it, are in print.css. */
export function PrintLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref, (g, el) => printParallax(g, el));
  return <div ref={ref} className="print-layer" aria-hidden="true" data-print style={style} />;
}
