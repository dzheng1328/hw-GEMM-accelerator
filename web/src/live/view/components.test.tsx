// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meshEntry } from "../sim/manifest";
import { Controls } from "./Controls";
import { ImagePicker } from "./ImagePicker";
import { LayerStrip, layerAtCycle } from "./LayerStrip";
import { Logits } from "./Logits";
import { MeshChoice } from "./MeshChoice";
import { firstDifference, sameLogits, Verdict } from "./Verdict";
import { makeRun } from "./testRun.testlib";

afterEach(cleanup);

const noop = () => {};

describe("Controls", () => {
  const base = { playing: false, atEnd: false, speed: 1 as const, cycle: 10, total: 100, onToggle: noop, onReplay: noop, onStep: noop, onSeek: noop, onSpeed: noop };

  it("shows Play when paused, Pause when playing and Replay at the end", () => {
    const { rerender } = render(<Controls {...base} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    rerender(<Controls {...base} playing />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    rerender(<Controls {...base} atEnd cycle={100} />);
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
  });

  it("calls the handlers", () => {
    const onToggle = vi.fn();
    const onReplay = vi.fn();
    const onStep = vi.fn();
    const onSeek = vi.fn();
    const onSpeed = vi.fn();
    render(<Controls {...base} onToggle={onToggle} onReplay={onReplay} onStep={onStep} onSeek={onSeek} onSpeed={onSpeed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Back one cycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward one cycle" }));
    fireEvent.change(screen.getByRole("slider", { name: "Cycle" }), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "4x" }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
    expect(onSeek).toHaveBeenCalledWith(42);
    expect(onSpeed).toHaveBeenCalledWith(4);
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("marks the current speed pressed and disables stepping past either end", () => {
    const { rerender } = render(<Controls {...base} cycle={0} speed={0.25} />);
    expect(screen.getByRole("button", { name: "0.25x" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "1x" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("button", { name: "Back one cycle" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Controls {...base} cycle={100} atEnd />);
    expect((screen.getByRole("button", { name: "Forward one cycle" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("describes the slider in words", () => {
    render(<Controls {...base} cycle={1234} total={20000} />);
    expect(screen.getByRole("slider", { name: "Cycle" }).getAttribute("aria-valuetext")).toBe("cycle 1,234 of 20,000");
  });
});

describe("LayerStrip", () => {
  const layers = meshEntry("2x2").layers;
  const spans = [{ start: 0, end: 10 }, { start: 10, end: 30 }, { start: 30, end: 60 }, { start: 60, end: 70 }, { start: 70, end: 90 }, { start: 90, end: 100 }];

  it("layerAtCycle follows the last completed cycle", () => {
    expect([0, 1, 10, 11, 100, 999].map((c) => layerAtCycle(spans, c))).toEqual([0, 0, 0, 1, 5, 5]);
  });

  it("lists the six layers sized by their cycles and marks the current one", () => {
    const { container } = render(<LayerStrip layers={layers} spans={spans} cycle={40} total={100} />);
    const items = container.querySelectorAll("li");
    expect(Array.from(items).map((li) => li.textContent)).toEqual(["conv1", "conv2", "conv3", "conv4", "conv5", "fc"]);
    expect(Array.from(items).map((li) => (li as HTMLElement).style.flexGrow)).toEqual(["10", "20", "30", "10", "20", "10"]);
    expect(Array.from(items).filter((li) => li.getAttribute("aria-current") === "step").map((li) => li.textContent)).toEqual(["conv3"]);
  });

  it("shows the cycle counter", () => {
    const { container } = render(<LayerStrip layers={layers} spans={spans} cycle={1234} total={139981} />);
    expect(container.querySelector(".live-cycle-current")?.textContent).toBe("1,234");
    expect(container.querySelector(".live-cycle-total")?.textContent).toBe("139,981");
  });
});

describe("Logits", () => {
  const names = ["airplane", "automobile", "bird", "cat", "deer", "dog", "frog", "horse", "ship", "truck"];
  const logits = Int32Array.from({ length: 16 }, (_, i) => (i === 3 ? 5000 : -1000 + i));

  it("shows placeholders and no winner until the run has ended", () => {
    const { container } = render(<Logits logits={logits} classNames={names} revealed={false} />);
    expect(container.querySelectorAll("li")).toHaveLength(10);
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(Array.from(container.querySelectorAll(".logit-value")).every((v) => v.textContent === "-")).toBe(true);
  });

  it("shows every value, signed, and marks the largest as the prediction", () => {
    const { container } = render(<Logits logits={logits} classNames={names} revealed />);
    const winner = container.querySelector("li[aria-current='true']");
    expect(winner?.textContent).toContain("cat");
    expect(winner?.textContent).toContain("predicted");
    expect(container.textContent).toContain("5,000");
    expect(container.textContent).toContain("-1,000");
  });

  it("scales the bars from the smallest (0%) to the largest (100%) and survives equal values", () => {
    const { container, rerender } = render(<Logits logits={logits} classNames={names} revealed />);
    const widths = Array.from(container.querySelectorAll<HTMLElement>(".logit-bar span")).map((s) => s.style.width);
    expect(widths[3]).toBe("100%");
    expect(widths[0]).toBe("0%");
    rerender(<Logits logits={new Int32Array(16)} classNames={names} revealed />);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".logit-bar span")).every((s) => s.style.width === "0%")).toBe(true);
  });
});

describe("ImagePicker", () => {
  const examples = ["airplane", "cat", "dog"].map((name) => ({ name, pixels: new Uint8Array(3072) }));

  it("offers every example, marks the selected one, and reports a click", () => {
    const onExample = vi.fn();
    render(<ImagePicker examples={examples} selected={1} uploadName={null} onExample={onExample} onUpload={noop} />);
    expect(screen.getByRole("button", { name: "Example: cat" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Example: dog" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Example: dog" }));
    expect(onExample).toHaveBeenCalledWith(2);
  });

  it("reports an uploaded file, ignores an empty selection, and names the upload in use", () => {
    const onUpload = vi.fn();
    const { rerender } = render(<ImagePicker examples={examples} selected={null} uploadName="me.png" onExample={noop} onUpload={onUpload} />);
    expect(screen.getByText(/Using your image: me.png/)).toBeTruthy();
    const input = screen.getByLabelText("Upload your own image") as HTMLInputElement;
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith(file);
    fireEvent.change(input, { target: { files: [] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    rerender(<ImagePicker examples={examples} selected={0} uploadName={null} onExample={noop} onUpload={onUpload} />);
    expect(screen.queryByText(/Using your image/)).toBeNull();
  });
});

describe("MeshChoice", () => {
  it("is a radio group of the three meshes and reports a change", () => {
    const onChange = vi.fn();
    render(<MeshChoice value="2x2" onChange={onChange} />);
    expect((screen.getByRole("radio", { name: "2x2 (4 tiles)" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "4x4 (16 tiles)" }));
    expect(onChange).toHaveBeenCalledWith("4x4");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});

describe("Verdict", () => {
  it("sameLogits and firstDifference compare all cells", () => {
    expect(sameLogits([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameLogits([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(sameLogits([1, 2], [1, 2, 3])).toBe(false);
    expect(firstDifference([1, 2, 3], [1, 9, 3])).toBe(1);
    expect(firstDifference([1, 2], [1, 2])).toBe(-1);
  });

  it("verifies against the reference for an upload", () => {
    const { container } = render(<Verdict run={makeRun()} golden={null} />);
    const v = container.querySelector(".live-verdict")!;
    expect(v.getAttribute("data-state")).toBe("match");
    expect(v.textContent).toContain("Verified");
    expect(v.textContent).toContain("TypeScript reference");
    expect(v.textContent).not.toContain("Python golden");
  });

  it("also names the Python golden for a built-in example", () => {
    const run = makeRun();
    const { container } = render(<Verdict run={run} golden={Array.from(run.logits)} />);
    expect(container.querySelector(".live-verdict")!.textContent).toContain("Python golden");
  });

  it("reports a mismatch loudly, with the first differing cell, and never a check mark", () => {
    const { container } = render(<Verdict run={makeRun("2x2", { mismatch: true })} golden={null} />);
    const v = container.querySelector(".live-verdict")!;
    expect(v.getAttribute("data-state")).toBe("mismatch");
    expect(v.getAttribute("role")).toBe("alert");
    expect(v.textContent).toContain("output cell 2");
    expect(v.textContent).not.toContain("Verified");
  });

  it("does not trust the engine's match flag: it compares the arrays itself", () => {
    const run = { ...makeRun("2x2", { mismatch: true }), match: true };
    const { container } = render(<Verdict run={run} golden={null} />);
    expect(container.querySelector(".live-verdict")!.getAttribute("data-state")).toBe("mismatch");
  });

  it("reports a disagreement with the Python golden even when the reference agrees", () => {
    const run = makeRun();
    const wrong = Array.from(run.logits);
    wrong[0] = 1;
    const { container } = render(<Verdict run={run} golden={wrong} />);
    expect(container.querySelector(".live-verdict")!.getAttribute("data-state")).toBe("mismatch");
  });
});
