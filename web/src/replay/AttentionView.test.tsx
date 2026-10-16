// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionView, overlayStyle } from "./AttentionView";
import { headWeights } from "./attention";
import { fixtureData } from "./testData";

afterEach(cleanup);
const data = fixtureData(); // 2 layers x 2 heads, 6 steps

describe("AttentionView", () => {
  it("draws one cell per layer and head, sized from the data", () => {
    const { container } = render(<AttentionView data={data} step={3} />);
    expect(container.querySelectorAll(".head-cell")).toHaveLength(4);
  });

  it("labels each cell with its layer, head and strongest position", () => {
    const { getByRole } = render(<AttentionView data={data} step={3} />);
    const cell = getByRole("button", { name: /Layer 1, head 1: strongest at position \d+/ });
    expect(cell).toBeTruthy();
  });

  it("selects layer 1, head 1 first, and moves the selection on click", () => {
    const { container, getAllByRole } = render(<AttentionView data={data} step={3} />);
    const cells = getAllByRole("button").filter((b) => b.classList.contains("head-cell"));
    expect(cells[0]!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(cells[3]!);
    expect(cells[3]!.getAttribute("aria-pressed")).toBe("true");
    expect(cells[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".overlay-caption")!.textContent).toContain("Layer 2, head 2");
  });

  it("paints one chip per position 0..step on story 0, with BOS labelled", () => {
    const { container } = render(<AttentionView data={data} step={3} />);
    const chips = container.querySelectorAll(".otok");
    expect(chips).toHaveLength(4);
    expect(chips[0]!.textContent).toBe("BOS");
    expect(chips[0]!.classList.contains("otok-bos")).toBe(true);
  });

  it("puts the true weight in each chip's tooltip", () => {
    const { container } = render(<AttentionView data={data} step={3} />);
    const weights = headWeights(data.probs, 3, 0, 0);
    const chips = container.querySelectorAll(".otok");
    chips.forEach((chip, i) => {
      expect(chip.getAttribute("title")).toBe(`position ${i}: weight ${weights[i]!.toFixed(3)}`);
    });
  });

  it("gives the strongest position strength 1 and the weakest strength 0", () => {
    const { container } = render(<AttentionView data={data} step={4} />);
    const weights = headWeights(data.probs, 4, 0, 0);
    const strongest = weights.indexOf(Math.max(...weights));
    const weakest = weights.indexOf(Math.min(...weights));
    const chips = [...container.querySelectorAll<HTMLElement>(".otok")];
    expect(chips[strongest]!.dataset.strength).toBe("1.00");
    expect(chips[weakest]!.dataset.strength).toBe("0.00");
  });

  it("caps the tint at 45% and thickens the underline with the strength", () => {
    expect(overlayStyle(1)).toEqual({
      background: "color-mix(in srgb, var(--cat-attention) 45%, transparent)",
      boxShadow: "inset 0 -4.0px 0 var(--cat-attention)",
    });
    expect(overlayStyle(0)).toEqual({
      background: "color-mix(in srgb, var(--cat-attention) 0%, transparent)",
      boxShadow: "inset 0 -1.0px 0 var(--cat-attention)",
    });
  });

  it("follows the step: the overlay grows as the step grows", () => {
    const { container, rerender } = render(<AttentionView data={data} step={1} />);
    expect(container.querySelectorAll(".otok")).toHaveLength(2);
    rerender(<AttentionView data={data} step={5} />);
    expect(container.querySelectorAll(".otok")).toHaveLength(6);
  });

  it("says the data is for story 0 only and where the probabilities come from", () => {
    const { container } = render(<AttentionView data={data} step={0} />);
    expect(container.querySelector(".attn-note")!.textContent).toContain("Story 0 only");
    expect(container.querySelector(".attn-note")!.textContent).toContain("lm_reference.py");
  });
});
