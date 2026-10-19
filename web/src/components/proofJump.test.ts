// @vitest-environment jsdom
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_DRAWER_EVENT } from "./drawerEvents";
import { pinSection } from "./pinSection";
import { FLASH_CLASS, FLASH_MS, jumpToProof, onProofClick } from "./proofJump";

vi.mock("./pinSection", () => ({ pinSection: vi.fn() }));

function mount() {
  document.body.innerHTML = `
    <main id="main">
      <details class="drawer"><summary>Go deeper</summary><div id="proof-cycles" tabindex="-1" data-proof>table</div></details>
      <div id="proof-cifar" tabindex="-1" data-proof>card</div>
      <figure id="proof-scaling" tabindex="-1" data-proof>
        <svg><rect class="bar" data-mesh="1x1"></rect><rect class="bar" data-mesh="2x2"></rect><rect class="bar" data-mesh="4x4"></rect></svg>
      </figure>
    </main>`;
}
const el = (id: string) => document.getElementById(id)!;
const flashed = () => [...document.querySelectorAll(`.${FLASH_CLASS}`)];

let scrollIntoView: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  mount();
  window.history.replaceState(null, "", "/");
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as never;
  vi.mocked(pinSection).mockClear();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("jumpToProof", () => {
  it("does nothing and says so for an unknown id or a missing element", () => {
    expect(jumpToProof("nope")).toBe(false);
    document.getElementById("proof-cifar")!.remove();
    expect(jumpToProof("proof-cifar", { push: true })).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("scrolls the target to the top, pins it, focuses it and rings it", () => {
    expect(jumpToProof("proof-cifar")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(pinSection).toHaveBeenCalledWith(el("proof-cifar"), el("main"));
    expect(document.activeElement).toBe(el("proof-cifar"));
    expect(flashed()).toEqual([el("proof-cifar")]);
  });

  it("lands at once when asked to (a shared link on load)", () => {
    jumpToProof("proof-cifar", { instant: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
  });

  it("removes the ring after FLASH_MS", () => {
    jumpToProof("proof-cifar");
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(flashed()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(flashed()).toHaveLength(0);
  });

  it("opens the enclosing drawer before it scrolls", () => {
    const drawer = document.querySelector<HTMLDetailsElement>("details.drawer")!;
    drawer.addEventListener(OPEN_DRAWER_EVENT, () => {
      drawer.open = true;
    });
    let openWhenScrolled: boolean | null = null;
    scrollIntoView.mockImplementation(() => {
      openWhenScrolled = drawer.open;
    });
    jumpToProof("proof-cycles");
    expect(openWhenScrolled).toBe(true);
  });

  it("does not poke a drawer that is already open", () => {
    const drawer = document.querySelector<HTMLDetailsElement>("details.drawer")!;
    drawer.open = true;
    const listener = vi.fn();
    drawer.addEventListener(OPEN_DRAWER_EVENT, listener);
    jumpToProof("proof-cycles");
    expect(listener).not.toHaveBeenCalled();
  });

  it("rings only the 2x2 and 4x4 bars for the scaling target, never the figure or the 1x1 bar", () => {
    jumpToProof("proof-scaling");
    expect(flashed().map((node) => node.getAttribute("data-mesh"))).toEqual(["2x2", "4x4"]);
    expect(document.activeElement).toBe(el("proof-scaling"));
  });

  it("keeps only the latest ring when two jumps follow each other", () => {
    jumpToProof("proof-cifar");
    jumpToProof("proof-scaling");
    expect(el("proof-cifar").classList.contains(FLASH_CLASS)).toBe(false);
    expect(flashed()).toHaveLength(2);
    vi.advanceTimersByTime(FLASH_MS);
    expect(flashed()).toHaveLength(0);
  });

  it("adds a history entry only when asked, and not twice for the same hash", () => {
    const before = window.history.length;
    jumpToProof("proof-cifar");
    expect(window.location.hash).toBe("");
    jumpToProof("proof-cifar", { push: true });
    expect(window.location.hash).toBe("#proof-cifar");
    expect(window.history.length).toBe(before + 1);
    jumpToProof("proof-cifar", { push: true });
    expect(window.history.length).toBe(before + 1);
  });
});

describe("onProofClick", () => {
  const click = (overrides: Partial<ReactMouseEvent<HTMLAnchorElement>> = {}) => {
    const event = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      ...overrides,
    };
    onProofClick("proof-cifar")(event as unknown as ReactMouseEvent<HTMLAnchorElement>);
    return event;
  };

  it("takes over a plain click: jumps, adds a history entry and stops the browser's own jump", () => {
    const event = click();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("#proof-cifar");
  });

  it("leaves a modified or non-primary click to the browser", () => {
    for (const overrides of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = click(overrides);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the click to the browser when the target is not on the page", () => {
    document.getElementById("proof-cifar")!.remove();
    const event = click();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
