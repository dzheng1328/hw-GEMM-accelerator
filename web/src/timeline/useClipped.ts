import { useEffect, useState, type RefObject } from "react";

/** True while the element's content is taller than its box, so something is cut off; re-measured whenever it resizes. */
export function useClipped(ref: RefObject<HTMLElement | null>): boolean {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setClipped(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return clipped;
}
