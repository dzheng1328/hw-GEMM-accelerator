import type { Gsap } from "./gsapLoader";

export interface MotionHandle {
  kill(): void;
}

type TweenLike = { kill(): void; scrollTrigger?: { kill(): void } | null | undefined };

/** Everything here moves only transform, opacity and clip-path, so it can never change the layout the page was measured in. */
function handle(g: Gsap, el: Element, tweens: TweenLike[]): MotionHandle {
  return {
    kill() {
      for (const tween of tweens) {
        tween.kill();
        tween.scrollTrigger?.kill();
      }
      g.set(el, { clearProps: "transform,opacity,clipPath" });
    },
  };
}

const done = (el: HTMLElement | SVGElement) => () => {
  el.dataset.motion = "done";
};

const onScroll = (el: Element, start = "top 88%") => ({ trigger: el, start, once: true });

/**
 * An element already past its start line when GSAP arrives was painted in its final state, so setting its from-state
 * now would hide it and sweep it back in: a flash. Such an element is left alone and marked done.
 */
function alreadyShown(el: HTMLElement | SVGElement, start: string): boolean {
  const line = Number(/(\d+)%/.exec(start)?.[1] ?? 88) / 100;
  if (el.getBoundingClientRect().top >= window.innerHeight * line) return false;
  el.dataset.motion = "done";
  return true;
}

/** The print drifts slowly against the scroll. The layer is taller than the screen, so no edge ever shows. */
export function printParallax(g: Gsap, layer: HTMLElement): MotionHandle {
  const tween = g.to(layer, {
    yPercent: -5,
    ease: "none",
    scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: true },
  });
  return handle(g, layer, [tween]);
}

/** Slides in from the side as it enters the screen. */
export function sweepIn(g: Gsap, el: HTMLElement, opts: { from?: "left" | "right" } = {}): MotionHandle {
  if (alreadyShown(el, "top 88%")) return handle(g, el, []);
  const distance = opts.from === "left" ? -48 : 48;
  const tween = g.fromTo(
    el,
    { x: distance, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.8, ease: "power3.out", scrollTrigger: onScroll(el), onComplete: done(el) },
  );
  return handle(g, el, [tween]);
}

/** A hairline that draws from the left. */
export function drawRule(g: Gsap, el: HTMLElement): MotionHandle {
  if (alreadyShown(el, "top 92%")) return handle(g, el, []);
  const tween = g.fromTo(
    el,
    { scaleX: 0 },
    { scaleX: 1, duration: 0.9, ease: "power2.out", scrollTrigger: onScroll(el, "top 92%"), onComplete: done(el) },
  );
  return handle(g, el, [tween]);
}

/** A washi sheet slides in across the page. */
export function sheetSlide(g: Gsap, el: HTMLElement): MotionHandle {
  if (alreadyShown(el, "top 85%")) return handle(g, el, []);
  const tween = g.fromTo(
    el,
    { x: 80, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.9, ease: "power3.out", scrollTrigger: onScroll(el, "top 85%"), onComplete: done(el) },
  );
  return handle(g, el, [tween]);
}

/** The strokes are drawn left to right, like unrolling a scroll. */
export function strokeWipe(g: Gsap, el: SVGGElement): MotionHandle {
  if (alreadyShown(el, "top 80%")) return handle(g, el, []);
  const tween = g.fromTo(
    el,
    { clipPath: "inset(0 100% 0 0)" },
    { clipPath: "inset(0 0% 0 0)", duration: 1.6, ease: "power1.inOut", scrollTrigger: onScroll(el, "top 80%"), onComplete: done(el) },
  );
  return handle(g, el, [tween]);
}

/**
 * Counts up in `.figure-live`, which sits over the real text (`.figure-final`) in one grid cell, so the box keeps the
 * final width and nothing around it moves. The Japanese-designed faces have no tabular figures, so digits do jostle
 * inside the box: that is why the count lives in an overlay and the final text holds the room.
 */
export function countUp(g: Gsap, el: HTMLElement, opts: { to: number; format: (n: number) => string }): MotionHandle {
  const live = el.querySelector<HTMLElement>(".figure-live");
  const state = { v: 0 };
  const tween = g.to(state, {
    v: opts.to,
    duration: 1.8,
    ease: "power2.out",
    scrollTrigger: onScroll(el, "top 92%"),
    onUpdate: () => {
      el.classList.add("figure--counting");
      if (live) live.textContent = opts.format(state.v);
    },
    onComplete: () => {
      el.classList.remove("figure--counting");
      if (live) live.textContent = "";
      el.dataset.motion = "done";
    },
  });
  return {
    kill() {
      tween.kill();
      tween.scrollTrigger?.kill();
      el.classList.remove("figure--counting");
      if (live) live.textContent = "";
    },
  };
}
