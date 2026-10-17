// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeroBand } from "./HeroBand";

afterEach(cleanup);

describe("HeroBand", () => {
  it("holds the page's one h1 and the tagline", () => {
    const { container } = render(<HeroBand />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("hw-GEMM accelerator");
    expect(container.querySelector(".tagline")!.textContent).toContain("systolic GEMM accelerator");
  });

  it("puts the four headline tiles inside the .hero-display slot that sub-project B will fill", () => {
    const { container } = render(<HeroBand />);
    const slot = container.querySelector(".hero-band .hero-display")!;
    expect(slot).not.toBeNull();
    expect(slot.querySelectorAll(".tile")).toHaveLength(4);
  });
});
