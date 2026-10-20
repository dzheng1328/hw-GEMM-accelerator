import { useEffect, useRef, type RefObject } from "react";
import { motionEnabled, readMotionEnv } from "./enabled";
import { loadGsap, type Gsap } from "./gsapLoader";
import type { MotionHandle } from "./primitives";
import { afterFirstPaint } from "./schedule";

/**
 * Runs one motion primitive on the element, if motion is on. The page is complete without it: nothing is hidden until
 * GSAP has loaded, a failed load leaves the element alone, and unmounting kills the animation and restores the element.
 */
export function useMotion<T extends Element>(ref: RefObject<T | null>, make: (g: Gsap, el: T) => MotionHandle | null): void {
  const latest = useRef(make);
  // kept current after each render, so the effect below runs once per mount and still calls the newest factory
  useEffect(() => {
    latest.current = make;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !motionEnabled(readMotionEnv())) return;
    let cancelled = false;
    let handle: MotionHandle | null = null;
    const cancelWait = afterFirstPaint(() => {
      loadGsap().then(
        (g) => {
          if (!cancelled) handle = latest.current(g, el);
        },
        () => {
          // GSAP did not load: the element stays exactly as the page drew it
        },
      );
    });
    return () => {
      cancelled = true;
      cancelWait();
      handle?.kill();
    };
  }, [ref]);
}
