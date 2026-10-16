// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
