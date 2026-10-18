// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepContext } from "../components/deepContext";
import { formatInt, formatPercent, formatRatio } from "../format";
import { useLiveSession } from "../live/session/context";
import type { LiveSession } from "../live/session/context";
import { TestSession } from "../live/session/testSession.testlib";
import { manifest } from "../live/sim/manifest";
import { CounterTable } from "./CounterTable";
import { performance } from "./data";
import { findMesh } from "./derive";
import { PerformanceSection } from "./PerformanceSection";

afterEach(cleanup);
const cifar = performance.cifar.meshes;

function renderSection(extra: { deep?: boolean } = {}) {
  let session!: LiveSession;
  function Grab() {
    session = useLiveSession();
    return null;
  }
  const ui = render(
    <TestSession loadExamples={async () => manifest.classNames.map((name) => ({ name, pixels: new Uint8Array(3072), logits: [] }))}>
      <DeepContext.Provider value={extra.deep ?? false}>
        <Grab />
        <PerformanceSection />
      </DeepContext.Provider>
    </TestSession>,
  );
  return { ...ui, session: () => session };
}

describe("PerformanceSection", () => {
  it("starts on the 2x2 mesh, the shared default", () => {
    const { container, getByRole } = renderSection();
    expect(getByRole("button", { name: "2x2" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(4);
  });

  it("redraws the diagram, the stats line and the highlighted bars when another mesh is chosen, and shares the choice", () => {
    const { container, getByRole, session } = renderSection();
    fireEvent.click(getByRole("button", { name: "1x1" }));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(1);
    const one = findMesh(cifar, "1x1");
    expect(container.querySelector(".mesh-stats")!.textContent).toContain(formatInt(one.cyclesPerUnit));
    expect(container.querySelector(".port-text")!.textContent).toContain(formatPercent(one.cornerBusy, 1));
    const selected = [...container.querySelectorAll(".bar-selected")].map((b) => b.getAttribute("data-mesh"));
    expect(selected).toEqual(["1x1", "1x1"]);
    expect(session().state.mesh).toBe("1x1");
  });

  it("follows the shared mesh when another part of the page changes it", () => {
    const { container, session } = renderSection();
    act(() => session().setMesh("4x4"));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(16);
  });

  it("a mesh the chip is not built for is a local view only: it never changes the shared mesh, and ends when that changes", () => {
    const { container, getByRole, session } = renderSection();
    fireEvent.click(getByRole("button", { name: "3x3" }));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(9);
    expect(getByRole("button", { name: "3x3" }).getAttribute("aria-pressed")).toBe("true");
    expect(session().state.mesh).toBe("2x2");
    expect(session().state.hasRun).toBe(false);
    act(() => session().setMesh("4x4"));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(16);
    expect(getByRole("button", { name: "3x3" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("a local view does not come back when the shared mesh goes away and returns", () => {
    const { container, getByRole, session } = renderSection();
    fireEvent.click(getByRole("button", { name: "2x1" }));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(2);
    act(() => session().setMesh("4x4"));
    act(() => session().setMesh("2x2"));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(4);
    expect(getByRole("button", { name: "2x2" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "2x1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("the run line does not come back for a run that did not start here", async () => {
    const { container, getByRole, session } = renderSection();
    act(() => session().run());
    await waitFor(() => expect(session().state.phase.name).toBe("done"));
    fireEvent.click(getByRole("button", { name: "4x4" }));
    await waitFor(() => expect(container.querySelector(".mesh-run-status")!.textContent).toContain("Ran the cat on 4x4"));
    act(() => session().setMesh("1x1"));
    await waitFor(() => expect(session().state.phase.name).toBe("done"));
    expect(container.querySelector(".mesh-run-status")).toBeNull();
    act(() => session().setMesh("4x4"));
    expect(container.querySelector(".mesh-run-status")).toBeNull();
  });

  it("choosing the shared mesh while a local view is open closes the local view", () => {
    const { container, getByRole } = renderSection();
    fireEvent.click(getByRole("button", { name: "2x1" }));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(2);
    fireEvent.click(getByRole("button", { name: "2x2" }));
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(4);
  });

  it("says a run started from here is under way, then done, with a way up to the hero", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
    const hero = document.createElement("div");
    hero.className = "hero-band";
    document.body.append(hero);
    const { container, getByRole, session, findByText } = renderSection();
    act(() => session().run());
    await waitFor(() => expect(session().state.phase.name).toBe("done"));
    expect(container.querySelector(".mesh-run-status")).toBeNull();
    fireEvent.click(getByRole("button", { name: "4x4" }));
    expect(container.querySelector(".mesh-run-status")!.textContent).toContain("Running the cat on 4x4");
    await findByText(/Ran the cat on 4x4: [\d,]+ cycles/);
    fireEvent.click(getByRole("button", { name: "Watch it" }));
    expect(scrollIntoView).toHaveBeenCalledOnce();
    hero.remove();
  });

  it("does not say anything about a run for a choice that started none", () => {
    const { container, getByRole } = renderSection();
    fireEvent.click(getByRole("button", { name: "4x4" }));
    expect(container.querySelector(".mesh-run-status")).toBeNull();
  });

  it("clicking a bar chooses that mesh, a bar for an unbuilt mesh only changes the local view", () => {
    const { container, getByRole, session } = renderSection();
    fireEvent.click(getByRole("button", { name: "Select 4x4 - Speedup over 1x1" }));
    expect(session().state.mesh).toBe("4x4");
    fireEvent.click(getByRole("button", { name: "Select 3x3 - Cycles per CIFAR-10 image" }));
    expect(session().state.mesh).toBe("4x4");
    expect(container.querySelectorAll(".mesh-tile")).toHaveLength(9);
  });

  it("puts the mesh diagram and its three stats side by side in one panel", () => {
    const { container, getByRole } = renderSection();
    const panel = container.querySelector(".mesh-panel")!;
    expect(panel.querySelector(".mesh-figure")).not.toBeNull();
    const stats = panel.querySelector("dl.mesh-stats")!;
    const read = () => [...stats.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
    const two = findMesh(cifar, "2x2");
    expect(read()).toEqual([
      ["Cycles per image", formatInt(two.cyclesPerUnit)],
      ["Speedup over 1x1", formatRatio(two.speedup)],
      ["MAC utilization per tile", formatPercent(two.macUtilization, 1)],
    ]);
    fireEvent.click(getByRole("button", { name: "4x4" }));
    expect(read()[0]![1]).toBe(formatInt(findMesh(cifar, "4x4").cyclesPerUnit));
  });

  it("states the CIFAR-10 and story-model findings", () => {
    const { container } = renderSection();
    const text = container.textContent!;
    expect(text).toContain("CIFAR-10 saturates at the injection port");
    expect(text).toContain("The story model is not port-bound");
    expect(text).toContain("do not prove a single cause");
  });

  it("compares the two workloads at 2x2 with their own WAIT labels", () => {
    const { container } = renderSection();
    const text = container.querySelector(".port-rows")!.textContent!;
    expect(text).toContain("CIFAR-10, 2x2");
    expect(text).toContain("Story model, 2x2");
    expect(text).toContain("WAIT, END or VPU running");
  });

  it("shows the CIFAR-10 card", () => {
    const { container } = renderSection();
    expect(container.querySelector(".stat-grid")!.textContent).toContain(formatPercent(performance.cifar.accuracy.int8));
  });

  it("puts the counter tables in the drawer", () => {
    const { container } = renderSection({ deep: true });
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
