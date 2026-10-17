// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { SECTIONS, kicker } from "./content/sections";

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

describe("App links out", () => {
  const hrefs = (container: HTMLElement, selector: string) =>
    [...container.querySelectorAll<HTMLAnchorElement>(`${selector} a`)].map((a) => a.getAttribute("href"));

  it("links to the source in the header", () => {
    const { container } = render(<App />);
    expect(hrefs(container, "header")).toContain("https://github.com/dzheng1328/hw-GEMM-accelerator");
  });

  it("ends with a footer linking the source, the license, the author profiles and an email, web links opening safely", () => {
    const { container } = render(<App />);
    const footer = container.querySelector("footer.site-footer");
    expect(footer, "footer").not.toBeNull();
    expect(footer?.previousElementSibling?.tagName).toBe("MAIN");
    expect(hrefs(container, "footer")).toEqual([
      "https://github.com/dzheng1328/hw-GEMM-accelerator",
      "https://github.com/dzheng1328/hw-GEMM-accelerator/blob/main/LICENSE",
      "https://github.com/dzheng1328",
      "https://www.linkedin.com/in/d-zheng",
      "mailto:davezheng1328@gmail.com",
    ]);
    for (const a of footer!.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(footer?.textContent).toContain("MIT");
  });
});

describe("App shell", () => {
  it("starts with a skip link, then the top bar, then main, then the footer", () => {
    const { container } = render(<App />);
    const top = [...container.children].map((el) => el.tagName + (el.id ? `#${el.id}` : "") + (el.className ? `.${String(el.className).split(" ")[0]}` : ""));
    expect(top).toEqual(["A.skip-link", "HEADER.topbar", "MAIN#main", "FOOTER.site-footer"]);
    expect(container.querySelector("a.skip-link")!.getAttribute("href")).toBe("#main");
  });

  it("renders the sections in the sections list, with matching titles and kickers", () => {
    const { container } = render(<App />);
    for (const meta of SECTIONS) {
      const section = container.querySelector(`main > section#${meta.id}`);
      expect(section, meta.id).not.toBeNull();
      expect(section!.querySelector("h2")!.textContent, meta.id).toBe(meta.title);
      expect(section!.querySelector(".kicker")!.textContent, meta.id).toBe(kicker(meta));
    }
  });

  it("keeps the hero band as the first thing in main, not counted as a section", () => {
    const { container } = render(<App />);
    expect(container.querySelector("main")!.firstElementChild!.classList.contains("hero-band")).toBe(true);
    expect(container.querySelectorAll("main > section")).toHaveLength(6);
  });

  it("links every top bar section link to a section that exists", () => {
    const { container } = render(<App />);
    for (const a of container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Sections"] a')) {
      expect(container.querySelector(a.getAttribute("href")!), a.textContent!).not.toBeNull();
    }
  });
});
