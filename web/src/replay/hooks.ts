import { useEffect, useRef, useState, type RefObject } from "react";

/** True once the element has intersected the viewport (with `rootMargin`); never goes back to false. */
export function useInView(ref: RefObject<Element | null>, rootMargin: string, threshold = 0): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, threshold, seen]);

  return seen;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  return reduced;
}

export type LazyStatus = "idle" | "loading" | "ready" | "error";

/** Starts `load` the first time `enabled` is true, and only once. */
export function useLazyData<T>(load: () => Promise<T>, enabled: boolean) {
  const [result, setResult] = useState<{ data?: T; error?: Error }>({});
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    load().then(
      (data) => setResult({ data }),
      (error: unknown) => setResult({ error: error instanceof Error ? error : new Error(String(error)) }),
    );
  }, [enabled, load]);

  const status: LazyStatus =
    result.data !== undefined ? "ready" : result.error ? "error" : enabled ? "loading" : "idle";
  return { status, data: result.data, error: result.error };
}
