// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./replay/loadReplayData", () => ({ loadReplayData: () => new Promise(() => {}) }));
vi.mock("./live/view/loadExamples", () => ({ loadExamples: () => new Promise(() => {}) }));
vi.mock("./live/view/loadScene", () => ({ loadScene: () => new Promise(() => {}) }));
vi.mock("./live/view/webgl", () => ({ webglAvailable: () => true }));

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("App", () => {
  it("renders the six titled sections, each with a closed drawer", () => {
    const { container } = render(<App />);
    for (const id of ["replay", "live", "performance", "architecture", "verification", "built"]) {
      expect(container.querySelector(`section#${id} h2`)?.textContent?.length, id).toBeGreaterThan(0);
      expect(container.querySelector(`section#${id} details`)?.hasAttribute("open"), id).toBe(false);
    }
  });

  it("shows the hero strip above the sections", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll(".tile")).toHaveLength(4);
  });

  it("Deep mode opens all six drawers", () => {
    const { container, getByRole } = render(<App />);
    fireEvent.click(getByRole("button", { name: /deep mode/i }));
    expect(Array.from(container.querySelectorAll("details")).every((d) => d.open)).toBe(true);
    expect(container.querySelectorAll("details")).toHaveLength(6);
  });

  it("puts the sections in order: the live demo second, built last", () => {
    const { container } = render(<App />);
    const ids = [...container.querySelectorAll("main > section")].map((s) => s.id);
    expect(ids).toEqual(["replay", "live", "performance", "architecture", "verification", "built"]);
  });

  it("has no placeholder left on the page", () => {
    const { container } = render(<App />);
    expect(container.textContent).not.toContain("Under construction");
  });

  it("renders the chip diagram and both ladders", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll("section#architecture .arch-block")).toHaveLength(12);
    expect(container.querySelectorAll("section#verification .ladder")).toHaveLength(2);
  });

  it("has one h1", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
