// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepContext } from "../components/deepContext";
import { BLOCKS, DEFAULT_BLOCK, STAGES, VIEWBOX, VOP_NOTE } from "../content/architecture";
import { REPO_URL } from "../content/timeline";
import { TestSession } from "../live/session/testSession.testlib";
import { BlockDetail } from "./BlockDetail";
import { ArchitectureSection } from "./ArchitectureSection";
import { BlockDiagram } from "./BlockDiagram";
import { BlockTable } from "./BlockTable";
import { edges, findBlock } from "./layout";
import { Stepper } from "./Stepper";
import { KIND_LABEL } from "./types";

afterEach(cleanup);

describe("BlockDiagram", () => {
  const diagram = (selected = "corner", onSelect: (id: string) => void = () => {}) =>
    render(<BlockDiagram blocks={BLOCKS} viewBox={VIEWBOX} selected={selected} onSelect={onSelect} />);

  it("draws one focusable button per block, named by its full name and kind", () => {
    const { container, getByRole } = diagram();
    const buttons = container.querySelectorAll(".arch-block");
    expect(buttons).toHaveLength(BLOCKS.length);
    for (const b of BLOCKS) {
      const button = getByRole("button", { name: `${b.name}, ${KIND_LABEL[b.kind]}` });
      expect(button.getAttribute("tabindex"), b.id).toBe("0");
      expect(button.getAttribute("data-block"), b.id).toBe(b.id);
    }
  });

  it("marks only the selected block as pressed", () => {
    const { container } = diagram("noc");
    const pressed = [...container.querySelectorAll(".arch-block")].filter((g) => g.getAttribute("aria-pressed") === "true");
    expect(pressed.map((g) => g.getAttribute("data-block"))).toEqual(["noc"]);
  });

  it("selects a block on click, Enter and Space, and ignores other keys", () => {
    const onSelect = vi.fn();
    const { getByRole } = diagram("corner", onSelect);
    const gemm = getByRole("button", { name: /^GEMM tile/ });
    fireEvent.click(gemm);
    expect(onSelect).toHaveBeenLastCalledWith("gemm_tile");
    fireEvent.keyDown(getByRole("button", { name: /^Requantizer/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("requant");
    fireEvent.keyDown(getByRole("button", { name: /^Write-back/ }), { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith("writeback");
    onSelect.mockClear();
    fireEvent.keyDown(gemm, { key: "a" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("draws one line per connection", () => {
    const { container } = diagram();
    expect(container.querySelectorAll(".arch-link")).toHaveLength(edges(BLOCKS).length);
  });

  it("is a group, not an image, so its buttons stay visible to assistive technology, and states the connections in text", () => {
    const { container } = diagram();
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("group");
    const label = svg.getAttribute("aria-label")!;
    expect(label).toContain("Command processor to DMA gather");
    expect(label).toContain("Injection port at node (0,0) to Network on chip");
  });

  it("tints every block no stronger than 45% of its kind color, so the label stays readable", () => {
    const { container } = diagram();
    const tints = [...container.querySelectorAll(".arch-tint")];
    expect(tints).toHaveLength(BLOCKS.length);
    for (const t of tints) expect(Number(t.getAttribute("fill-opacity"))).toBeLessThanOrEqual(0.45);
  });

  it("writes each block's short label inside its box", () => {
    const { container } = diagram();
    const labels = [...container.querySelectorAll(".arch-label")].map((n) => n.textContent);
    expect(labels).toEqual(BLOCKS.map((b) => b.label));
  });

  it("draws a counter line in every block: a dash with no run, the block's text with one", () => {
    const idle = diagram();
    expect([...idle.container.querySelectorAll(".arch-live")].map((n) => n.textContent)).toEqual(BLOCKS.map(() => "-"));
    idle.unmount();
    const live = Object.fromEntries(BLOCKS.map((b) => [b.id, { lit: b.id === "noc", text: `${b.id} text`, detail: "" }]));
    const { container } = render(<BlockDiagram blocks={BLOCKS} viewBox={VIEWBOX} selected="corner" onSelect={() => {}} live={live} />);
    expect([...container.querySelectorAll(".arch-live")].map((n) => n.textContent)).toEqual(BLOCKS.map((b) => `${b.id} text`));
  });

  it("marks exactly the lit blocks, and a lit block can also be the selected one", () => {
    const live = Object.fromEntries(BLOCKS.map((b) => [b.id, { lit: b.id === "noc" || b.id === "corner", text: "", detail: "" }]));
    const { container } = render(<BlockDiagram blocks={BLOCKS} viewBox={VIEWBOX} selected="corner" onSelect={() => {}} live={live} />);
    const lit = [...container.querySelectorAll(".arch-lit")].map((g) => g.getAttribute("data-block"));
    expect(lit.sort()).toEqual(["corner", "noc"]);
    expect(container.querySelector(".arch-block[data-block='corner']")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps each block's accessible name free of the counters, so the live numbers are never announced", () => {
    const live = Object.fromEntries(BLOCKS.map((b) => [b.id, { lit: true, text: "12,345 busy", detail: "" }]));
    const { getByRole } = render(<BlockDiagram blocks={BLOCKS} viewBox={VIEWBOX} selected="corner" onSelect={() => {}} live={live} />);
    expect(getByRole("button", { name: /^Vector unit/ }).getAttribute("aria-label")).toBe("Vector unit, compute");
  });

  it("puts the counter line inside the box, below the label", () => {
    const { container } = diagram();
    for (const g of container.querySelectorAll(".arch-block")) {
      const block = findBlock(BLOCKS, g.getAttribute("data-block")!);
      const label = Number(g.querySelector(".arch-label")!.getAttribute("y"));
      const counter = Number(g.querySelector(".arch-live")!.getAttribute("y"));
      expect(label).toBeGreaterThan(block.box.y);
      expect(counter).toBeGreaterThan(label);
      expect(counter).toBeLessThan(block.box.y + block.box.h);
    }
  });
});

describe("BlockDetail", () => {
  it("shows the name, kind, role, files, suites and number of the block", () => {
    const block = findBlock(BLOCKS, "writeback");
    const { container, getByRole } = render(<BlockDetail block={block} />);
    expect(getByRole("heading", { name: block.name })).toBeDefined();
    const text = container.textContent!;
    expect(text).toContain(KIND_LABEL[block.kind]);
    expect(text).toContain(block.role);
    expect(text).toContain(block.number.value);
    expect(text).toContain(block.number.label);
    for (const target of block.suites[0]!.targets) expect(text).toContain(`make ${target}`);
  });

  it("links each RTL file and suite directory to the repository", () => {
    const block = findBlock(BLOCKS, "vpu");
    const { container } = render(<BlockDetail block={block} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const f of block.rtl) expect(hrefs).toContain(`${REPO_URL}/blob/main/${f}`);
    for (const s of block.suites) expect(hrefs).toContain(`${REPO_URL}/tree/main/${s.dir}`);
    for (const a of container.querySelectorAll("a")) expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("names where the number comes from", () => {
    const perf = render(<BlockDetail block={findBlock(BLOCKS, "corner")} />);
    expect(perf.container.textContent).toContain("performance.json");
    cleanup();
    const decision = render(<BlockDetail block={findBlock(BLOCKS, "cmd_seq")} />);
    expect(decision.container.textContent).toContain("decisions.md");
    expect(decision.container.textContent).toContain("2026-09-28");
  });

  it("keeps the selection's own content in a polite live region, so a screen reader hears a new selection", () => {
    const { container } = render(<BlockDetail block={findBlock(BLOCKS, "noc")} />);
    const region = container.querySelector(".arch-detail > [aria-live='polite']")!;
    expect(region.querySelector(".arch-detail-title")!.textContent).toBe("Network on chip");
    expect(region.querySelector(".arch-number")).not.toBeNull();
  });

  it("shows no run row without a run", () => {
    const { container } = render(<BlockDetail block={findBlock(BLOCKS, "noc")} />);
    expect(container.querySelector(".arch-live-row")).toBeNull();
  });

  it("adds an In this run row outside the live region, so the changing numbers are never announced", () => {
    const live = { lit: true, text: "1 transfers", detail: "1 flit transfers have crossed mesh links so far." };
    const { container } = render(<BlockDetail block={findBlock(BLOCKS, "noc")} live={live} />);
    const row = container.querySelector(".arch-live-row")!;
    expect(row.querySelector("h4")!.textContent).toBe("In this run");
    expect(row.textContent).toContain(live.detail);
    expect(row.closest("[aria-live]")).toBeNull();
    expect(container.querySelector("[aria-live='polite']")!.contains(row)).toBe(false);
  });

  it("says the vector unit is not used in this run", () => {
    const live = { lit: false, text: "not used", detail: "Not used in this run. The story model uses it: 15,108,284 busy cycles on every mesh." };
    const { container } = render(<BlockDetail block={findBlock(BLOCKS, "vpu")} live={live} />);
    expect(container.querySelector(".arch-live-row")!.textContent).toContain("Not used in this run");
  });
});

describe("Stepper", () => {
  const stepper = (selected: string, onSelect: (id: string) => void = () => {}) =>
    render(<Stepper stages={STAGES} selected={selected} onSelect={onSelect} note={VOP_NOTE} />);

  it("lists the eight stages in order and marks the selected block's stage as the current step", () => {
    const { container } = stepper("noc");
    const items = container.querySelectorAll("ol > li");
    expect(items).toHaveLength(8);
    expect(container.querySelector("ol")!.tagName).toBe("OL");
    const current = [...container.querySelectorAll("[aria-current='step']")];
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain(STAGES[4]!.title);
  });

  it("has no current step when the selected block is not on the walk", () => {
    const { container } = stepper("vpu");
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(0);
  });

  it("selects the block of a stage when its button is clicked", () => {
    const onSelect = vi.fn();
    const { getByRole } = stepper("corner", onSelect);
    fireEvent.click(getByRole("button", { name: new RegExp(STAGES[5]!.title) }));
    expect(onSelect).toHaveBeenCalledWith(STAGES[5]!.block);
  });

  it("moves with Next and Previous, and disables them at the ends", () => {
    const onSelect = vi.fn();
    const mid = stepper("corner", onSelect);
    fireEvent.click(mid.getByRole("button", { name: "Next" }));
    expect(onSelect).toHaveBeenLastCalledWith("noc");
    fireEvent.click(mid.getByRole("button", { name: "Previous" }));
    expect(onSelect).toHaveBeenLastCalledWith("flit_pack");
    cleanup();

    const first = stepper("cmd_seq");
    expect((first.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const last = stepper("writeback");
    expect((last.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const off = stepper("vpu", onSelect);
    expect((off.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(off.getByRole("button", { name: "Next" }));
    expect(onSelect).toHaveBeenLastCalledWith("cmd_seq");
  });

  it("explains the vector-unit branch", () => {
    const { container } = stepper("corner");
    expect(container.textContent).toContain("A VOP takes a different path");
  });
});

describe("BlockTable", () => {
  it("has a row per block with its files, suites and number", () => {
    const { container } = render(<BlockTable blocks={BLOCKS} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(BLOCKS.length);
    for (const [i, b] of BLOCKS.entries()) {
      const text = rows[i]!.textContent!;
      expect(text).toContain(b.name);
      expect(text).toContain(b.rtl[0]!);
      expect(text).toContain(b.suites[0]!.dir);
      expect(text).toContain(b.number.value);
    }
  });
});

describe("BlockTable semantics", () => {
  it("keeps its table semantics explicit, so stacking the rows on a phone does not remove them for a screen reader", () => {
    const { container } = render(<BlockTable blocks={BLOCKS} />);
    const table = container.querySelector("table")!;
    expect(table.getAttribute("role")).toBe("table");
    expect(table.querySelector("thead")!.getAttribute("role")).toBe("rowgroup");
    expect(table.querySelector("tbody")!.getAttribute("role")).toBe("rowgroup");
    expect([...table.querySelectorAll("tr")].every((tr) => tr.getAttribute("role") === "row")).toBe(true);
    expect([...table.querySelectorAll("th")].every((th) => th.getAttribute("role") === "columnheader")).toBe(true);
    expect([...table.querySelectorAll("td")].every((td) => td.getAttribute("role") === "cell")).toBe(true);
  });
});

describe("ArchitectureSection", () => {
  it("starts on the injection port, with its number in the panel", () => {
    const { container } = render(<TestSession><ArchitectureSection /></TestSession>);
    const pressed = container.querySelector(".arch-block[aria-pressed='true']")!;
    expect(pressed.getAttribute("data-block")).toBe(DEFAULT_BLOCK);
    const corner = findBlock(BLOCKS, DEFAULT_BLOCK);
    expect(container.querySelector(".arch-detail-title")!.textContent).toBe(corner.name);
    expect(container.querySelector(".arch-number")!.textContent).toContain(corner.number.value);
  });

  it("updates the panel when another block is chosen", () => {
    const { container, getByRole } = render(<TestSession><ArchitectureSection /></TestSession>);
    fireEvent.click(getByRole("button", { name: /^Vector unit/ }));
    expect(container.querySelector(".arch-detail-title")!.textContent).toBe("Vector unit");
    expect(container.querySelector(".arch-block[aria-pressed='true']")!.getAttribute("data-block")).toBe("vpu");
  });

  it("shares one selection between the stepper and the diagram", () => {
    const { container, getByRole } = render(
      <DeepContext.Provider value={true}>
        <TestSession>
          <ArchitectureSection />
        </TestSession>
      </DeepContext.Provider>,
    );
    fireEvent.click(getByRole("button", { name: "Next" }));
    expect(container.querySelector(".arch-block[aria-pressed='true']")!.getAttribute("data-block")).toBe("noc");
    expect(container.querySelector(".arch-detail-title")!.textContent).toBe("Network on chip");
    fireEvent.click(within(container.querySelector(".arch-stepper")!).getByRole("button", { name: new RegExp(STAGES[7]!.title) }));
    expect(container.querySelector(".arch-block[aria-pressed='true']")!.getAttribute("data-block")).toBe("writeback");
  });

  it("keeps the legend, the title and a closed drawer by default, and opens the drawer in Deep mode", () => {
    const closed = render(<TestSession><ArchitectureSection /></TestSession>);
    expect(closed.container.querySelector("section#architecture h2")!.textContent).toBe("The chip");
    expect(closed.container.querySelectorAll(".arch-legend li")).toHaveLength(4);
    expect(closed.container.querySelector("details")!.hasAttribute("open")).toBe(false);
    cleanup();
    const deep = render(
      <DeepContext.Provider value={true}>
        <TestSession>
          <ArchitectureSection />
        </TestSession>
      </DeepContext.Provider>,
    );
    expect(deep.container.querySelector("details")!.open).toBe(true);
    expect(deep.container.querySelectorAll("details .data-table tbody tr")).toHaveLength(BLOCKS.length);
  });

  it("shows the strip under the diagram, with dashes in the blocks while no run exists", () => {
    const { container, getByText } = render(
      <TestSession>
        <ArchitectureSection />
      </TestSession>,
    );
    expect(getByText("Run the chip to see this light up.")).toBeTruthy();
    expect([...container.querySelectorAll(".arch-live")].every((n) => n.textContent === "-")).toBe(true);
    expect(container.querySelector(".arch-live-row")).toBeNull();
    expect(container.querySelectorAll(".arch-lit")).toHaveLength(0);
  });
});
