// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatInt, formatPercent } from "../format";
import { performance } from "./data";
import { cyclesBars, findMesh, speedupBars } from "./derive";
import { CifarCard } from "./CifarCard";
import { MeshBarChart } from "./MeshBarChart";
import { MeshDiagram } from "./MeshDiagram";
import { MeshSelector } from "./MeshSelector";
import { PortBars } from "./PortBars";

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

describe("MeshBarChart", () => {
  const bars = speedupBars(cifar);
  const props = { title: "Speedup over 1x1", bars, max: 16, format: (v: number) => `${v.toFixed(2)}x`, referenceLabel: "linear ideal" };

  it("draws one bar per mesh and highlights only the selected one", () => {
    const { container } = render(<MeshBarChart {...props} selected="2x2" />);
    expect(container.querySelectorAll(".bar")).toHaveLength(5);
    const selected = container.querySelectorAll(".bar-selected");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.getAttribute("data-mesh")).toBe("2x2");
  });

  it("draws the reference line through one point per mesh", () => {
    const { container } = render(<MeshBarChart {...props} selected="2x2" />);
    expect(container.querySelector(".ref-line")!.getAttribute("points")!.split(" ")).toHaveLength(5);
  });

  it("scales bar heights with their values", () => {
    const { container } = render(<MeshBarChart {...props} selected="1x1" />);
    const heights = [...container.querySelectorAll(".bar")].map((b) => Number(b.getAttribute("height")));
    expect(heights[4]!).toBeGreaterThan(heights[0]!);
    expect(heights[0]!).toBeGreaterThan(0);
  });

  it("draws the reference line over the bars and under the labels, so a label is never struck through", () => {
    const { container } = render(<MeshBarChart {...props} selected="2x2" />);
    const order = [...container.querySelector("svg")!.querySelectorAll(".bar, .ref-line, .bar-label")];
    const at = (cls: string) => order.map((el, i) => (el.classList.contains(cls) ? i : -1)).filter((i) => i >= 0);
    expect(Math.max(...at("bar"))).toBeLessThan(at("ref-line")[0]!);
    expect(at("ref-line")[0]!).toBeLessThan(Math.min(...at("bar-label")));
  });

  it("states every value and the reference in text", () => {
    const { getByRole, container } = render(<MeshBarChart {...props} selected="2x2" />);
    const label = getByRole("img").getAttribute("aria-label")!;
    for (const m of cifar) expect(label).toContain(`${m.mesh} ${m.speedup.toFixed(2)}x`);
    expect(label).toContain("linear ideal");
    expect(container.querySelectorAll(".bar-label")).toHaveLength(5);
  });

  it("draws cycles per image against a constant floor", () => {
    const floor = cyclesBars(cifar, performance.floorFlitsPerImage);
    const { container } = render(
      <MeshBarChart title="Cycles per image" bars={floor} selected="4x4" max={350000} format={formatInt} referenceLabel="134,482-flit floor" />,
    );
    const points = container.querySelector(".ref-line")!.getAttribute("points")!.split(" ").map((p) => p.split(",")[1]);
    expect(new Set(points).size).toBe(1);
  });
});

describe("PortBars", () => {
  const rows = [
    { label: "CIFAR-10, 2x2", port: findMesh(cifar, "2x2").port, waitLabel: "WAIT/END stall" },
    { label: "Story model, 2x2", port: findMesh(performance.lm.meshes, "2x2").port, waitLabel: "WAIT, END or VPU running" },
  ];

  it("draws one stacked bar per workload with five segments each", () => {
    const { container } = render(<PortBars rows={rows} />);
    expect(container.querySelectorAll(".port-row")).toHaveLength(2);
    expect(container.querySelectorAll(".port-bar")[0]!.children).toHaveLength(5);
  });

  it("sizes each segment by its share and labels it in text", () => {
    const { container } = render(<PortBars rows={rows} />);
    const first = container.querySelectorAll(".port-bar")[0]!.children[0] as HTMLElement;
    expect(parseFloat(first.style.width)).toBeCloseTo(rows[0]!.port.shares.operand * 100, 1);
    const legend = container.querySelectorAll(".port-legend")[0]!.textContent!;
    expect(legend).toContain("OPERAND flits");
    expect(legend).toContain(formatPercent(rows[0]!.port.shares.operand, 1));
  });

  it("uses each workload's own label for the WAIT category", () => {
    const { container } = render(<PortBars rows={rows} />);
    expect(container.querySelectorAll(".port-legend")[0]!.textContent).toContain("WAIT/END stall");
    expect(container.querySelectorAll(".port-legend")[1]!.textContent).toContain("WAIT, END or VPU running");
  });
});

describe("CifarCard", () => {
  it("shows the accuracy, the agreement and the cycles per image on 1x1 and 2x2", () => {
    const { container } = render(<CifarCard />);
    const text = container.textContent!;
    expect(text).toContain(formatPercent(performance.cifar.accuracy.int8));
    expect(text).toContain(formatPercent(performance.cifar.accuracy.float));
    expect(text).toContain(formatPercent(performance.cifar.accuracy.agreement));
    expect(text).toContain(formatInt(findMesh(cifar, "2x2").cyclesPerUnit));
    expect(text).toContain(formatInt(findMesh(cifar, "1x1").cyclesPerUnit));
  });
});
