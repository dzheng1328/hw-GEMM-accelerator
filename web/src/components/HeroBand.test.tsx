// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TestSession } from "../live/session/testSession.testlib";
import { HeroBand } from "./HeroBand";

afterEach(cleanup);

describe("HeroBand", () => {
  it("holds the page's one h1 and the tagline", () => {
    const { container } = render(<TestSession><HeroBand /></TestSession>);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("hw-GEMM accelerator");
    expect(container.querySelector(".tagline")!.textContent).toContain("systolic GEMM accelerator");
  });

  it("puts the live stage and the four headline tiles inside the .hero-display slot", () => {
    const { container } = render(<TestSession><HeroBand /></TestSession>);
    const slot = container.querySelector(".hero-band .hero-display")!;
    expect(slot).not.toBeNull();
    expect(slot.querySelector(".hero-stage")).not.toBeNull();
    expect(slot.querySelectorAll(".tile")).toHaveLength(4);
    expect(slot.firstElementChild!.classList.contains("hero-stage")).toBe(true);
  });
});
