import type { CSSProperties } from "react";
import { asset } from "../content/art";

const style = {
  "--print-blur-night": `url("${asset("night-print").blur}")`,
  "--print-blur-day": `url("${asset("day-scroll").blur}")`,
} as CSSProperties;

/** The real print behind the page. Which image shows, and the scrim over it, are in print.css. */
export function PrintLayer() {
  return <div className="print-layer" aria-hidden="true" data-print style={style} />;
}
