import { useEffect, useState, type RefObject } from "react";

/**
 * True while the element's content is wider than its box. A box that scrolls sideways must be a focusable region so a
 * keyboard can reach the rest; a box that does not scroll must not be a tab stop.
 */
export function useOverflows(ref: RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // the content (the plot, the table) can change size without the box changing
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref]);

  return overflows;
}
