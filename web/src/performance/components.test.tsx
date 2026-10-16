// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPercent } from "../format";
import { performance } from "./data";
import { findMesh } from "./derive";
import { MeshDiagram } from "./MeshDiagram";
import { MeshSelector } from "./MeshSelector";

afterEach(cleanup);

const cifar = performance.cifar.meshes;

describe("MeshSelector", () => {
  it("marks the selected mesh and reports a choice", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(<MeshSelector meshes={["1x1", "2x2", "4x4"]} selected="2x2" onSelect={onSelect} />);
    expect(getByRole("button", { name: "2x2" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "1x1" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(getByRole("button", { name: "4x4" }));
    expect(onSelect).toHaveBeenCalledWith("4x4");
  });
});

describe("MeshDiagram", () => {
  it("draws one tile per node, with the corner first", () => {
    const { container } = render(<MeshDiagram mesh={findMesh(cifar, "4x4")} />);
    const tiles = [...container.querySelectorAll(".mesh-tile")];
    expect(tiles).toHaveLength(16);
    expect(tiles[0]!.getAttribute("data-x")).toBe("0");
    expect(tiles[0]!.getAttribute("data-y")).toBe("0");
    expect(tiles[5]!.getAttribute("data-x")).toBe("1");
    expect(tiles[5]!.getAttribute("data-y")).toBe("1");
  });

  it("lays a 2x1 mesh out as two tiles in one row", () => {
    const { container } = render(<MeshDiagram mesh={findMesh(cifar, "2x1")} />);
    const tiles = [...container.querySelectorAll(".mesh-tile")];
    expect(tiles.map((t) => [t.getAttribute("data-x"), t.getAttribute("data-y")])).toEqual([
      ["0", "0"],
      ["1", "0"],
    ]);
  });

  it("is a single tile for 1x1", () => {
    const { container } = render(<MeshDiagram mesh={findMesh(cifar, "1x1")} />);
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(1);
  });

  it("prints each tile's utilization and the port's busy share", () => {
    const mesh = findMesh(cifar, "2x2");
    const { container } = render(<MeshDiagram mesh={mesh} />);
    const texts = [...container.querySelectorAll(".tile-text")].map((n) => n.textContent);
    expect(texts).toEqual(mesh.tileUtilization.map((u) => formatPercent(u, 0)));
    expect(container.querySelector(".port-text")!.textContent).toContain(formatPercent(mesh.cornerBusy, 1));
  });

  it("fills the port bar to the corner's busy share of the grid width", () => {
    const mesh = findMesh(cifar, "4x4");
    const { container } = render(<MeshDiagram mesh={mesh} />);
    const track = Number(container.querySelector(".port-track")!.getAttribute("width"));
    const fill = Number(container.querySelector(".port-fill")!.getAttribute("width"));
    expect(fill / track).toBeCloseTo(mesh.cornerBusy, 3);
  });

  it("describes the mesh in text for assistive technology", () => {
    const mesh = findMesh(cifar, "2x2");
    const { getByRole } = render(<MeshDiagram mesh={mesh} />);
    const label = getByRole("img").getAttribute("aria-label")!;
    expect(label).toContain("2x2");
    expect(label).toContain(formatPercent(mesh.cornerBusy, 1));
    expect(label).toContain(formatPercent(mesh.tileUtilization[0]!, 1));
  });

  it("gives every tile a tint no stronger than 45% of the accent, so its text stays readable", () => {
    const { container } = render(<MeshDiagram mesh={findMesh(cifar, "2x2")} />);
    for (const r of container.querySelectorAll(".tile-fill")) {
      expect(Number(r.getAttribute("fill-opacity"))).toBeLessThanOrEqual(0.45);
    }
  });
});
