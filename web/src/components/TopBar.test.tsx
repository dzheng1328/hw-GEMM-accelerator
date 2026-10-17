// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPO_URL } from "../content/timeline";
import { SECTIONS } from "../content/sections";
import { TopBar, centerOffset, type TopBarProps } from "./TopBar";

const props = (over: Partial<TopBarProps> = {}): TopBarProps => ({
  active: null,
  deep: false,
  onDeepChange: () => {},
  theme: "dark",
  onThemeToggle: () => {},
  ...over,
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(cleanup);

describe("TopBar", () => {
  it("lists exactly the sections, in order, as links to their ids", () => {
    const { getByRole } = render(<TopBar {...props()} />);
    const links = within(getByRole("navigation", { name: "Sections" })).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(SECTIONS.map((s) => s.label));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(SECTIONS.map((s) => `#${s.id}`));
  });

  it("marks only the active section with aria-current, and none over the hero", () => {
    const { getByRole, rerender } = render(<TopBar {...props()} />);
    const current = () =>
      within(getByRole("navigation", { name: "Sections" }))
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "location")
        .map((a) => a.textContent);
    expect(current()).toEqual([]);
    rerender(<TopBar {...props({ active: "performance" })} />);
    expect(current()).toEqual(["Performance"]);
    rerender(<TopBar {...props({ active: "built" })} />);
    expect(current()).toEqual(["Built"]);
  });

  it("is a header landmark with the wordmark first, then the section links, then GitHub, Deep mode and the theme toggle", () => {
    const { container } = render(<TopBar {...props()} />);
    const header = container.querySelector("header.topbar")!;
    const order = [...header.querySelectorAll("a, button")].map((el) => el.textContent || el.getAttribute("aria-label"));
    expect(order).toEqual(["hw-GEMM", ...SECTIONS.map((s) => s.label), "GitHub", "Deep mode", "Switch to light theme"]);
  });

  it("links to the repository and opens it safely", () => {
    const { getByRole } = render(<TopBar {...props()} />);
    const link = getByRole("link", { name: "GitHub" });
    expect(link.getAttribute("href")).toBe(REPO_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the Deep mode button working, with its pressed state", () => {
    const onDeepChange = vi.fn();
    const { getByRole, rerender } = render(<TopBar {...props({ onDeepChange })} />);
    expect(getByRole("button", { name: "Deep mode" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(getByRole("button", { name: "Deep mode" }));
    expect(onDeepChange).toHaveBeenCalledWith(true);
    rerender(<TopBar {...props({ deep: true, onDeepChange })} />);
    expect(getByRole("button", { name: "Deep mode" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("names the theme the toggle will switch to, and calls back when pressed", () => {
    const onThemeToggle = vi.fn();
    const { getByRole, rerender } = render(<TopBar {...props({ onThemeToggle })} />);
    fireEvent.click(getByRole("button", { name: "Switch to light theme" }));
    expect(onThemeToggle).toHaveBeenCalledTimes(1);
    rerender(<TopBar {...props({ theme: "light", onThemeToggle })} />);
    expect(getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
  });

  it("scrolls to the top from the wordmark and clears the hash but keeps ?deep=1", () => {
    window.history.replaceState(null, "", "/?deep=1#performance");
    const { getByRole } = render(<TopBar {...props({ deep: true })} />);
    fireEvent.click(getByRole("link", { name: "hw-GEMM" }));
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?deep=1");
  });
});

describe("centerOffset", () => {
  it("puts the link in the middle of the strip", () => {
    expect(centerOffset(300, 80, 390)).toBe(145);
  });

  it("never scrolls to a negative offset", () => {
    expect(centerOffset(10, 80, 390)).toBe(0);
  });
});
