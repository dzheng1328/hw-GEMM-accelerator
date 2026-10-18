// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MeshBoard } from "./MeshBoard";
import { linkGeometry } from "./sceneLayout";

afterEach(cleanup);

describe("MeshBoard", () => {
  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
  ])("draws a %ix%i board: one tile per node, the controller, every link and the injection link", (w, h) => {
    const { container } = render(<MeshBoard w={w} h={h} />);
    expect(container.querySelectorAll(".board-tile")).toHaveLength(w * h);
    expect(container.querySelectorAll(".board-controller")).toHaveLength(1);
    expect(container.querySelectorAll(".board-link")).toHaveLength(linkGeometry(w, h).length + 1);
  });

  it("is decoration: the stage that holds it carries the description", () => {
    const { container } = render(<MeshBoard w={2} h={2} />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps every shape inside its viewBox", () => {
    const { container } = render(<MeshBoard w={4} h={4} />);
    const svg = container.querySelector("svg")!;
    const [, , width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    for (const rect of container.querySelectorAll(".board-tile, .board-controller, .board-link")) {
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + Number(rect.getAttribute("width"))).toBeLessThanOrEqual(width!);
      expect(y + Number(rect.getAttribute("height"))).toBeLessThanOrEqual(height!);
    }
  });
});
