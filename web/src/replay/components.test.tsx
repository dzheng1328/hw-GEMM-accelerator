// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttentionSparkline } from "./AttentionSparkline";
import { Controls } from "./Controls";
import { CycleBar } from "./CycleBar";
import { Lane } from "./Lane";
import { fixtureData } from "./testData";
import { laneAt } from "./tokens";

afterEach(cleanup);

const baseControls = {
  playing: false,
  atEnd: false,
  speed: 1 as const,
  step: 3,
  lastStep: 5,
  onToggle: () => {},
  onReplay: () => {},
  onSpeed: () => {},
  onSeek: () => {},
};

describe("Controls", () => {
  it("offers Play when paused, Pause when playing and Replay at the end", () => {
    const { getByRole, rerender } = render(<Controls {...baseControls} />);
    expect(getByRole("button", { name: "Play" })).toBeTruthy();
    rerender(<Controls {...baseControls} playing />);
    expect(getByRole("button", { name: "Pause" })).toBeTruthy();
    rerender(<Controls {...baseControls} atEnd />);
    expect(getByRole("button", { name: "Replay" })).toBeTruthy();
  });

  it("calls onToggle for Play and onReplay for Replay", () => {
    const onToggle = vi.fn();
    const onReplay = vi.fn();
    const { getByRole, rerender } = render(<Controls {...baseControls} onToggle={onToggle} onReplay={onReplay} />);
    fireEvent.click(getByRole("button", { name: "Play" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<Controls {...baseControls} atEnd onToggle={onToggle} onReplay={onReplay} />);
    fireEvent.click(getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("marks the current speed and reports a speed change", () => {
    const onSpeed = vi.fn();
    const { getByRole } = render(<Controls {...baseControls} speed={2} onSpeed={onSpeed} />);
    expect(getByRole("button", { name: "2x" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "1x" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(getByRole("button", { name: "4x" }));
    expect(onSpeed).toHaveBeenCalledWith(4);
  });

  it("has a scrubber over 0..lastStep with the step in its label", () => {
    const onSeek = vi.fn();
    const { getByRole, getByText } = render(<Controls {...baseControls} onSeek={onSeek} />);
    const slider = getByRole("slider") as HTMLInputElement;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("5");
    expect(slider.value).toBe("3");
    expect(getByText("Step 3 of 5")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "4" } });
    expect(onSeek).toHaveBeenCalledWith(4);
  });
});

describe("Lane", () => {
  const data = fixtureData();

  it("shows the lane's text with prompt tokens marked, and no empty chips", () => {
    const lane = laneAt(data.stories[0]!, data.vocab, data.promptLength, 5);
    const { container } = render(<Lane index={0} lane={lane} />);
    expect(container.querySelector(".lane-text")!.textContent).toBe("Hi there! there! there");
    expect(container.querySelectorAll(".tok-prompt").length).toBe(2); // "Hi" and " there"; BOS is empty
  });

  it("says when the story ended", () => {
    const lane = laneAt(data.stories[1]!, data.vocab, data.promptLength, 5);
    const { getByText } = render(<Lane index={1} lane={lane} />);
    expect(getByText("Ended at step 2")).toBeTruthy();
  });

  it("says nothing about an end for a story that has not ended", () => {
    const lane = laneAt(data.stories[0]!, data.vocab, data.promptLength, 5);
    const { container } = render(<Lane index={0} lane={lane} />);
    expect(container.querySelector(".lane-ended")).toBeNull();
  });

  it("labels the story by its number", () => {
    const lane = laneAt(data.stories[0]!, data.vocab, data.promptLength, 0);
    const { getByLabelText } = render(<Lane index={3} lane={lane} />);
    expect(getByLabelText("Story 4")).toBeTruthy();
  });
});

describe("CycleBar", () => {
  it("shows every category with its cycles and share as text", () => {
    const step = fixtureData().steps[3]!; // 200 cycles: 80 / 60 / 40 / 20
    const { container } = render(<CycleBar step={step} />);
    const text = container.textContent!;
    expect(text).toContain("Weight matmuls");
    expect(text).toContain("80 / 40.0%");
    expect(text).toContain("Attention");
    expect(text).toContain("60 / 30.0%");
    expect(text).toContain("VPU");
    expect(text).toContain("Other");
    expect(container.querySelectorAll(".cycle-bar > span")).toHaveLength(4);
  });

  it("describes the split for assistive technology", () => {
    const step = fixtureData().steps[3]!;
    const { getByRole } = render(<CycleBar step={step} />);
    expect(getByRole("img").getAttribute("aria-label")).toContain("Attention 30.0%");
  });
});

describe("AttentionSparkline", () => {
  it("describes the range and the current step", () => {
    const { getByRole } = render(<AttentionSparkline series={[0.16, 0.3, 0.67]} step={1} />);
    const label = getByRole("img").getAttribute("aria-label")!;
    expect(label).toContain("16%");
    expect(label).toContain("67%");
    expect(label).toContain("step 1");
  });

  it("draws one point per step and a marker", () => {
    const { container } = render(<AttentionSparkline series={[0.1, 0.2, 0.3, 0.4]} step={2} />);
    expect(container.querySelector("polyline")!.getAttribute("points")!.split(" ")).toHaveLength(4);
    expect(container.querySelectorAll("line")).toHaveLength(1);
  });
});
