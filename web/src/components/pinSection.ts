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
    // an observer reports the element's size once as soon as it is observed; that is not a layout change, and acting on it
    // would cut short the smooth scroll that has only just begun
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) first = false;
      else callback();
    });
    observer.observe(target);
    return () => observer.disconnect();
  },
  onUserInput: (callback) => {
    // a move to another hash or through history ends a pin too: the old target is no longer where the visitor is going
    const events = ["wheel", "touchstart", "keydown", "pointerdown", "hashchange", "popstate"] as const;
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
 * For a few seconds every layout change of `observed` puts `target` back at its landing offset. Any scroll, touch, key, click or
 * navigation by the visitor ends it, and so does the time running out. A new pin releases the previous one.
 * `behavior` is how a correction scrolls: instant for a shared link, "auto" (the page's own setting) after a click, so a
 * smooth scroll that late content cut short carries on gliding to the corrected place.
 */
export function pinSection(
  target: Element,
  observed: Element,
  env: PinEnv = browserPinEnv,
  windowMs: number = PIN_WINDOW_MS,
  behavior: ScrollBehavior = "instant",
): void {
  release?.();
  const check = () => {
    const drift = target.getBoundingClientRect().top - env.landingTop(target);
    if (Math.abs(drift) > 1) env.scrollBy({ top: drift, behavior });
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
