// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { holdPosition } from "./holdPosition";

function anchorAt(tops: number[]): HTMLElement {
  const el = document.createElement("section");
  let call = 0;
  el.getBoundingClientRect = () => ({ top: tops[Math.min(call++, tops.length - 1)] }) as DOMRect;
  return el;
}

describe("holdPosition", () => {
  it("applies the change and scrolls by how far the anchor moved, instantly", () => {
    const scrollBy = vi.fn();
    const apply = vi.fn();
    holdPosition(anchorAt([190, 1875]), apply, scrollBy);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: 1685, behavior: "instant" });
  });

  it("scrolls back up when the anchor moved up", () => {
    const scrollBy = vi.fn();
    holdPosition(anchorAt([500, 120]), () => {}, scrollBy);
    expect(scrollBy).toHaveBeenCalledWith({ top: -380, behavior: "instant" });
  });

  it("does not scroll when the anchor did not move", () => {
    const scrollBy = vi.fn();
    holdPosition(anchorAt([300, 300]), () => {}, scrollBy);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("just applies the change when there is no anchor (over the hero)", () => {
    const scrollBy = vi.fn();
    const apply = vi.fn();
    holdPosition(null, apply, scrollBy);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("measures the anchor before and after, in that order", () => {
    const order: string[] = [];
    const el = document.createElement("section");
    el.getBoundingClientRect = () => {
      order.push("measure");
      return { top: 0 } as DOMRect;
    };
    holdPosition(el, () => order.push("apply"), vi.fn());
    expect(order).toEqual(["measure", "apply", "measure"]);
  });
});
