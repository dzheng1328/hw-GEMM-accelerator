import { useRef } from "react";
import { formatInt } from "../format";
import { countUp } from "../motion/primitives";
import { useMotion } from "../motion/useMotion";

/**
 * A number that counts up when it comes into view. The real text (.figure-final) holds the room and is what a screen
 * reader gets; the count is drawn over it in an aria-hidden layer, so nothing around the figure ever moves.
 */
export function CountFigure({ value, text }: { value: number; text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useMotion(ref, (g, el) => countUp(g, el, { to: value, format: formatInt }));
  return (
    <span ref={ref} className="figure">
      <span className="figure-live" aria-hidden="true" />
      <span className="figure-final">{text}</span>
    </span>
  );
}
