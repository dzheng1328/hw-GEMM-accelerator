/** How long after the page opens on a section the target is held at its landing offset (slow networks deliver late content late). */
export const PIN_WINDOW_MS = 4000;

export interface PinEnv {
  /** where the browser puts the top of `target` after a jump: its scroll margin */
  landingTop(target: Element): number;
  observeResize(target: Element, callback: () => void): () => void;
  onUserInput(callback: () => void): () => void;
  scrollBy(options: ScrollToOptions): void;
  setTimeout(callback: () => void, ms: number): () => void;
}

const px = (value: string): number => Number.parseFloat(value) || 0;

export const browserPinEnv: PinEnv = {
  landingTop: (target) => px(getComputedStyle(target).scrollMarginTop),
  observeResize: (target, callback) => {
    if (typeof ResizeObserver === "undefined") return () => {};
    const observer = new ResizeObserver(callback);
    observer.observe(target);
    return () => observer.disconnect();
  },
  onUserInput: (callback) => {
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const name of events) window.addEventListener(name, callback, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, callback);
    };
  },
  scrollBy: (options) => window.scrollBy(options),
  setTimeout: (callback, ms) => {
    const id = window.setTimeout(callback, ms);
    return () => window.clearTimeout(id);
  },
};

let release: (() => void) | null = null;

/**
 * When the page opens on a section (a shared link), content above it is still arriving: the replay data lands a moment
 * after load and grows its section by up to 3000 px, which would leave the visitor short of the section they were sent to.
 * For a few seconds every layout change of `observed` puts `target` back at its landing offset. Any scroll, touch, key or
 * click by the visitor ends it, and so does the time running out. A new pin releases the previous one.
 */
export function pinSection(target: Element, observed: Element, env: PinEnv = browserPinEnv, windowMs: number = PIN_WINDOW_MS): void {
  release?.();
  const check = () => {
    const drift = target.getBoundingClientRect().top - env.landingTop(target);
    if (Math.abs(drift) > 1) env.scrollBy({ top: drift, behavior: "instant" });
  };
  const offResize = env.observeResize(observed, check);
  const offInput = env.onUserInput(() => stop());
  const clearTimer = env.setTimeout(() => stop(), windowMs);
  function stop() {
    offResize();
    offInput();
    clearTimer();
    if (release === stop) release = null;
  }
  release = stop;
}
