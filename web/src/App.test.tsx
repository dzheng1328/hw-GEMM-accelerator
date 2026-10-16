// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("App", () => {
  it("renders the four titled sections, each with a closed drawer", () => {
    const { container } = render(<App />);
    for (const id of ["replay", "performance", "architecture", "verification"]) {
      expect(container.querySelector(`section#${id} h2`)?.textContent?.length, id).toBeGreaterThan(0);
      expect(container.querySelector(`section#${id} details`)?.hasAttribute("open"), id).toBe(false);
    }
  });

  it("shows the hero strip above the sections", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll(".tile")).toHaveLength(4);
  });

  it("Deep mode opens all four drawers", () => {
    const { container, getByRole } = render(<App />);
    fireEvent.click(getByRole("button", { name: /deep mode/i }));
    expect(Array.from(container.querySelectorAll("details")).every((d) => d.open)).toBe(true);
    expect(container.querySelectorAll("details")).toHaveLength(4);
  });

  it("has one h1", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
