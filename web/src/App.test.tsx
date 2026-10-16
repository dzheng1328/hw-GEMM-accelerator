// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./replay/loadReplayData", () => ({ loadReplayData: () => new Promise(() => {}) }));

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("App", () => {
  it("renders the five titled sections, each with a closed drawer", () => {
    const { container } = render(<App />);
    for (const id of ["replay", "performance", "architecture", "verification", "built"]) {
      expect(container.querySelector(`section#${id} h2`)?.textContent?.length, id).toBeGreaterThan(0);
      expect(container.querySelector(`section#${id} details`)?.hasAttribute("open"), id).toBe(false);
    }
  });

  it("shows the hero strip above the sections", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll(".tile")).toHaveLength(4);
  });

  it("Deep mode opens all five drawers", () => {
    const { container, getByRole } = render(<App />);
    fireEvent.click(getByRole("button", { name: /deep mode/i }));
    expect(Array.from(container.querySelectorAll("details")).every((d) => d.open)).toBe(true);
    expect(container.querySelectorAll("details")).toHaveLength(5);
  });

  it("puts the new sections in order: performance second, built last", () => {
    const { container } = render(<App />);
    const ids = [...container.querySelectorAll("main > section")].map((s) => s.id);
    expect(ids).toEqual(["replay", "performance", "architecture", "verification", "built"]);
  });

  it("has one h1", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
