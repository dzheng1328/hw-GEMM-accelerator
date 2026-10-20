// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import summary from "../data/generated/summary.json";
import { formatInt, formatPercent, formatRatio } from "../format";
import { HeroStrip } from "./HeroStrip";

afterEach(cleanup);

describe("HeroStrip", () => {
  it("shows the four numbers from summary.json", () => {
    const { getByText } = render(<HeroStrip />);
    expect(getByText(`${summary.lm.stories} × ${summary.lm.steps}`)).toBeTruthy();
    expect(getByText(formatInt(summary.lm.meshes["2x2_t256"]!.cycles))).toBeTruthy();
    expect(getByText(formatPercent(summary.cifar.int8Accuracy))).toBeTruthy();
    expect(getByText(formatRatio(summary.lm.scalingVsOneByOne["2x2"]))).toBeTruthy();
  });

  it("gives every tile a label and a line saying why the number can be trusted", () => {
    const { container } = render(<HeroStrip />);
    const tiles = container.querySelectorAll(".tile");
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.querySelector(".tile-label")?.textContent?.length).toBeGreaterThan(0);
      expect(tile.querySelector(".tile-claim")?.textContent?.length).toBeGreaterThan(20);
    }
  });

  it("names the 4x4 scaling from the data in the scaling claim", () => {
    const { container } = render(<HeroStrip />);
    expect(container.textContent).toContain(formatRatio(summary.lm.scalingVsOneByOne["4x4"]));
  });

  it("makes each tile a link to its proof, in order", () => {
    const { container } = render(<HeroStrip />);
    const tiles = [...container.querySelectorAll("a.tile")];
    expect(tiles.map((tile) => tile.getAttribute("href"))).toEqual(["#proof-stories", "#proof-cycles", "#proof-cifar", "#proof-scaling"]);
    for (const tile of tiles) expect(tile.querySelector(".tile-proof")?.textContent).toBe("See the proof");
  });

  it("scrolls to the target when a tile is clicked", () => {
    document.body.insertAdjacentHTML("beforeend", '<main id="main"><div id="proof-cifar" tabindex="-1" data-proof></div></main>');
    // jsdom has no scrollIntoView; stub it for this test only, so no later test sees a leftover
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
    try {
      const { container } = render(<HeroStrip />);
      fireEvent.click(container.querySelector('a.tile[href="#proof-cifar"]')!);
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(window.location.hash).toBe("#proof-cifar");
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      document.getElementById("main")?.remove();
      window.history.replaceState(null, "", "/");
    }
  });
});
