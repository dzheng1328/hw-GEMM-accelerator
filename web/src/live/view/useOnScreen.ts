import { useEffect, useState, type RefObject } from "react";

/** True while the element intersects the viewport (unlike `useInView`, which never goes back to false). */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [on, setOn] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setOn(last.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return on;
}
