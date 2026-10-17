// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PIN_WINDOW_MS, pinSection, type PinEnv } from "./pinSection";

function fakeEnv(landing = 72) {
  let onResize: () => void = () => {};
  let onInput: () => void = () => {};
  let timer: () => void = () => {};
  const off = { resize: vi.fn(), input: vi.fn(), timer: vi.fn() };
  const scrollBy = vi.fn();
  const env: PinEnv = {
    landingTop: () => landing,
    observeResize: (_target, callback) => {
      onResize = callback;
      return off.resize;
    },
    onUserInput: (callback) => {
      onInput = callback;
      return off.input;
    },
    scrollBy,
    setTimeout: (callback) => {
      timer = callback;
      return off.timer;
    },
  };
  return { env, scrollBy, off, resize: () => onResize(), input: () => onInput(), expire: () => timer() };
}

function targetAt(top: { value: number }): Element {
  const el = document.createElement("section");
  el.getBoundingClientRect = () => ({ top: top.value }) as DOMRect;
  return el;
}

const main = document.createElement("main");
let stopLast: (() => void) | undefined;
afterEach(() => stopLast?.());

describe("pinSection", () => {
  it("scrolls the target back to its landing offset when a layout change moves it, instantly", () => {
    const top = { value: 72 };
    const f = fakeEnv(72);
    pinSection(targetAt(top), main, f.env);
    stopLast = f.input;
    top.value = 516;
    f.resize();
    expect(f.scrollBy).toHaveBeenCalledWith({ top: 444, behavior: "instant" });
  });

  it("leaves the page alone when the target is already at its landing offset, give or take a pixel", () => {
    const top = { value: 72 };
    const f = fakeEnv(72);
    pinSection(targetAt(top), main, f.env);
    stopLast = f.input;
    f.resize();
    top.value = 72.6;
    f.resize();
    expect(f.scrollBy).not.toHaveBeenCalled();
  });

  it("stops holding as soon as the visitor scrolls, touches, presses a key or clicks", () => {
    const f = fakeEnv(72);
    pinSection(targetAt({ value: 72 }), main, f.env);
    f.input();
    expect(f.off.resize).toHaveBeenCalledTimes(1);
    expect(f.off.input).toHaveBeenCalledTimes(1);
    expect(f.off.timer).toHaveBeenCalledTimes(1);
  });

  it("stops holding when its window runs out, so a late layout change never yanks the page", () => {
    const f = fakeEnv(72);
    pinSection(targetAt({ value: 72 }), main, f.env);
    f.expire();
    expect(f.off.resize).toHaveBeenCalledTimes(1);
    expect(PIN_WINDOW_MS).toBe(4000);
  });

  it("releases the previous pin when a new one starts", () => {
    const first = fakeEnv(72);
    pinSection(targetAt({ value: 72 }), main, first.env);
    const second = fakeEnv(72);
    pinSection(targetAt({ value: 72 }), main, second.env);
    stopLast = second.input;
    expect(first.off.resize).toHaveBeenCalledTimes(1);
    expect(second.off.resize).not.toHaveBeenCalled();
  });
});
