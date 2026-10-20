// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Gsap } from "./gsapLoader";
import { countUp, drawRule, printParallax, sheetSlide, strokeWipe, sweepIn } from "./primitives";

interface Call {
  fn: "fromTo" | "to" | "set";
  target: unknown;
  from?: Record<string, unknown>;
  to: Record<string, unknown>;
}

function fakeGsap() {
  const calls: Call[] = [];
  const tweens: { kill: ReturnType<typeof vi.fn>; scrollTrigger: { kill: ReturnType<typeof vi.fn> } }[] = [];
  const make = () => {
    const t = { kill: vi.fn(), scrollTrigger: { kill: vi.fn() } };
    tweens.push(t);
    return t;
  };
  const gsap = {
    fromTo: (target: unknown, from: Record<string, unknown>, to: Record<string, unknown>) => (calls.push({ fn: "fromTo", target, from, to }), make()),
    to: (target: unknown, to: Record<string, unknown>) => (calls.push({ fn: "to", target, to }), make()),
    set: (target: unknown, to: Record<string, unknown>) => void calls.push({ fn: "set", target, to }),
  } as unknown as Gsap;
  return { gsap, calls, tweens };
}

/** the properties that may change: nothing that moves other elements. */
const ALLOWED = new Set(["x", "y", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotate", "opacity", "clipPath", "v", "duration", "delay", "ease", "stagger", "scrollTrigger", "immediateRender", "onUpdate", "onComplete", "clearProps"]);
const LAYOUT = ["width", "height", "top", "left", "right", "bottom", "margin", "padding", "display", "position", "fontSize"];

const div = () => document.createElement("div");
const svgG = () => document.createElementNS("http://www.w3.org/2000/svg", "g");

function withLive(): HTMLElement {
  const el = div();
  el.innerHTML = '<span class="figure-live"></span><span class="figure-final">1,234</span>';
  return el;
}

describe("the motion primitives", () => {
  const cases: [string, (g: Gsap) => unknown][] = [
    ["printParallax", (g) => printParallax(g, div())],
    ["sweepIn", (g) => sweepIn(g, div())],
    ["sweepIn from the left", (g) => sweepIn(g, div(), { from: "left" })],
    ["drawRule", (g) => drawRule(g, div())],
    ["sheetSlide", (g) => sheetSlide(g, div())],
    ["strokeWipe", (g) => strokeWipe(g, svgG())],
    ["countUp", (g) => countUp(g, withLive(), { to: 1234, format: (n) => String(Math.round(n)) })],
  ];

  for (const [name, run] of cases) {
    it(`${name} changes only transform, opacity and clip-path, never layout`, () => {
      const { gsap, calls } = fakeGsap();
      run(gsap);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        for (const vars of [call.from ?? {}, call.to]) {
          for (const key of Object.keys(vars)) {
            expect(LAYOUT, `${name}: ${key}`).not.toContain(key);
            expect(ALLOWED.has(key), `${name}: ${key} is not an allowed animated property`).toBe(true);
          }
        }
      }
    });

    it(`${name} returns a handle whose kill stops the tween and its scroll trigger`, () => {
      const { gsap, tweens } = fakeGsap();
      const handle = run(gsap) as { kill(): void };
      handle.kill();
      expect(tweens.length).toBeGreaterThan(0);
      for (const t of tweens) {
        expect(t.kill).toHaveBeenCalled();
        expect(t.scrollTrigger.kill).toHaveBeenCalled();
      }
    });
  }

  const finishing: [string, (g: Gsap, el: HTMLElement) => unknown][] = [
    ["sweepIn", (g, el) => sweepIn(g, el)],
    ["drawRule", (g, el) => drawRule(g, el)],
    ["sheetSlide", (g, el) => sheetSlide(g, el)],
  ];
  for (const [name, run] of finishing) {
    it(`${name} marks its element as done when it finishes, for the end-to-end tests`, () => {
      const el = div();
      const { gsap, calls } = fakeGsap();
      run(gsap, el);
      expect(el.dataset.motion).toBeUndefined();
      (calls[0]!.to.onComplete as () => void)();
      expect(el.dataset.motion).toBe("done");
    });
  }

  it("strokeWipe marks its group as done when it finishes", () => {
    const el = svgG();
    const { gsap, calls } = fakeGsap();
    strokeWipe(gsap, el);
    (calls[0]!.to.onComplete as () => void)();
    expect(el.dataset.motion).toBe("done");
  });

  it("kill puts the element back to its final visible state", () => {
    const el = div();
    const { gsap, calls } = fakeGsap();
    sweepIn(gsap, el).kill();
    const clear = calls.find((c) => c.fn === "set");
    expect(clear?.target).toBe(el);
    expect(String(clear?.to.clearProps)).toContain("opacity");
    expect(String(clear?.to.clearProps)).toContain("transform");
  });

  it("countUp writes the formatted value into .figure-live while it counts, and clears it at the end", () => {
    const el = withLive();
    const { gsap, calls } = fakeGsap();
    countUp(gsap, el, { to: 1234, format: (n) => `#${Math.round(n)}` });
    const call = calls.find((c) => c.fn === "to")!;
    const state = call.target as { v: number };
    state.v = 617;
    (call.to.onUpdate as () => void)();
    expect(el.querySelector(".figure-live")!.textContent).toBe("#617");
    expect(el.classList.contains("figure--counting")).toBe(true);
    (call.to.onComplete as () => void)();
    expect(el.querySelector(".figure-live")!.textContent).toBe("");
    expect(el.classList.contains("figure--counting")).toBe(false);
    expect(el.dataset.motion).toBe("done");
  });

  it("strokeWipe starts fully clipped and ends fully open", () => {
    const { gsap, calls } = fakeGsap();
    strokeWipe(gsap, svgG());
    expect(calls[0]!.from!.clipPath).toBe("inset(0 100% 0 0)");
    expect(calls[0]!.to.clipPath).toBe("inset(0 0% 0 0)");
  });
});
