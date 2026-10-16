// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCKS, VIEWBOX } from "../content/architecture";
import { REPO_URL } from "../content/timeline";
import { BlockDetail } from "./BlockDetail";
import { BlockDiagram } from "./BlockDiagram";
import { edges, findBlock } from "./layout";
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

  it("is a polite live region, so a screen reader hears the new selection", () => {
    const { container } = render(<BlockDetail block={findBlock(BLOCKS, "noc")} />);
    expect(container.querySelector(".arch-detail")!.getAttribute("aria-live")).toBe("polite");
  });
});
