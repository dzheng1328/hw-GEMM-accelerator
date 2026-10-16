import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

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

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

const reducedMotionNow = () => typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;

/** Follows the OS setting, including a change while the page is open. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => false);
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
