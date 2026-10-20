// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CountFigure } from "./CountFigure";

afterEach(cleanup);

describe("CountFigure", () => {
  it("shows the final text, and only that, to assistive technology", () => {
    const { container, getByText } = render(<CountFigure value={62677232} text="62,677,232" />);
    expect(getByText("62,677,232").classList.contains("figure-final")).toBe(true);
    const live = container.querySelector(".figure-live")!;
    expect(live.getAttribute("aria-hidden")).toBe("true");
    expect(live.textContent).toBe("");
  });

  it("reads as the final text with no motion: nothing is hidden or counting", () => {
    const { container } = render(<CountFigure value={5} text="5" />);
    expect(container.querySelector(".figure--counting")).toBeNull();
    expect(container.textContent).toBe("5");
  });
});
