// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeepContext } from "../components/deepContext";
import { formatInt, formatPercent, formatRatio } from "../format";
import { CounterTable } from "./CounterTable";
import { performance } from "./data";
import { findMesh } from "./derive";
import { PerformanceSection } from "./PerformanceSection";

afterEach(cleanup);
const cifar = performance.cifar.meshes;

describe("PerformanceSection", () => {
  it("starts on the 4x4 mesh", () => {
    const { container, getByRole } = render(<PerformanceSection />);
    expect(getByRole("button", { name: "4x4" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(16);
  });

  it("redraws the diagram, the stats line and the highlighted bars when another mesh is chosen", () => {
    const { container, getByRole } = render(<PerformanceSection />);
    fireEvent.click(getByRole("button", { name: "1x1" }));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(1);
    const one = findMesh(cifar, "1x1");
    expect(container.querySelector(".mesh-stats")!.textContent).toContain(formatInt(one.cyclesPerUnit));
    expect(container.querySelector(".port-text")!.textContent).toContain(formatPercent(one.cornerBusy, 1));
    const selected = [...container.querySelectorAll(".bar-selected")].map((b) => b.getAttribute("data-mesh"));
    expect(selected).toEqual(["1x1", "1x1"]);
  });

  it("states the CIFAR-10 and story-model findings", () => {
    const { container } = render(<PerformanceSection />);
    const text = container.textContent!;
    expect(text).toContain("CIFAR-10 saturates at the injection port");
    expect(text).toContain("The story model is not port-bound");
    expect(text).toContain("do not prove a single cause");
  });

  it("compares the two workloads at 2x2 with their own WAIT labels", () => {
    const { container } = render(<PerformanceSection />);
    const text = container.querySelector(".port-rows")!.textContent!;
    expect(text).toContain("CIFAR-10, 2x2");
    expect(text).toContain("Story model, 2x2");
    expect(text).toContain("WAIT, END or VPU running");
  });

  it("shows the CIFAR-10 card", () => {
    const { container } = render(<PerformanceSection />);
    expect(container.querySelector(".stat-grid")!.textContent).toContain(formatPercent(performance.cifar.accuracy.int8));
  });

  it("puts the counter tables in the drawer", () => {
    const { container } = render(
      <DeepContext.Provider value={true}>
        <PerformanceSection />
      </DeepContext.Provider>,
    );
    expect(container.querySelectorAll("details[open] .data-table").length).toBeGreaterThanOrEqual(3);
  });
});

describe("CounterTable", () => {
  it("has a CIFAR-10 row per mesh with the recorded cycles, speedup and port shares", () => {
    const { container } = render(<CounterTable />);
    const table = container.querySelectorAll(".data-table")[0] as HTMLElement;
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    for (const [i, m] of cifar.entries()) {
      const text = rows[i]!.textContent!;
      expect(text).toContain(m.mesh);
      expect(text).toContain(formatInt(m.cyclesPerUnit));
      expect(text).toContain(formatRatio(m.speedup));
      expect(text).toContain(formatPercent(m.port.shares.operand, 1));
    }
  });

  it("has a story-model row for 1x1, 2x2 and 4x4, and says its four-way split is for 2x2 only", () => {
    const { container } = render(<CounterTable />);
    const lmTable = container.querySelectorAll(".data-table")[2] as HTMLElement; // after the CIFAR-10 and link tables
    expect(within(lmTable).getAllByRole("row").slice(1)).toHaveLength(3);
    expect(container.textContent).toContain("measured for the 2x2 run only");
  });

  it("carries the notes the repo already records", () => {
    const { container } = render(<CounterTable />);
    expect(container.textContent).toContain("106 cycles per image");
  });
});
