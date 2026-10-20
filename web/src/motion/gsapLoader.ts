export type Gsap = typeof import("gsap").gsap;

const REFRESH_AFTER_MS = 150;

/**
 * ScrollTrigger measures where each trigger starts once, when it is created. Lazy sections and the autoplaying replay
 * grow the page afterwards, so every trigger below them would fire early. Re-measure whenever the page's height
 * changes, but only once the page has stopped scrolling: a refresh resets the scroll position, which cancels a smooth
 * scroll in progress (a "Watch it" jump would stop half way).
 */
export function refreshOnGrowth(refresh: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let height = document.body.offsetHeight;
  let lastScroll = 0;
  let pending = false;

  const settle = () => {
    const quiet = Date.now() - lastScroll;
    if (quiet < REFRESH_AFTER_MS) {
      timer = setTimeout(settle, REFRESH_AFTER_MS - quiet);
      return;
    }
    pending = false;
    refresh();
  };
  const schedule = () => {
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(settle, REFRESH_AFTER_MS);
  };
  const onScroll = () => {
    lastScroll = Date.now();
    if (pending) schedule();
  };

  const observer = new ResizeObserver(() => {
    if (document.body.offsetHeight === height) return;
    height = document.body.offsetHeight;
    schedule();
  });
  observer.observe(document.body);
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
  };
}

let cached: Promise<Gsap> | null = null;

/** GSAP and ScrollTrigger are one lazy chunk. A failed load is not remembered, so a later mount can try again. */
export function loadGsap(): Promise<Gsap> {
  const loading = (cached ??= Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
    gsap.registerPlugin(ScrollTrigger);
    refreshOnGrowth(() => ScrollTrigger.refresh());
    return gsap;
  }));
  loading.catch(() => {
    if (cached === loading) cached = null;
  });
  return loading;
}
