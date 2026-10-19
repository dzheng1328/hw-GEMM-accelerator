// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { PROOF_IDS } from "./content/proof";
import { SECTIONS, kicker } from "./content/sections";

vi.mock("./replay/loadReplayData", () => ({ loadReplayData: () => new Promise(() => {}) }));
vi.mock("./live/view/loadExamples", () => ({ loadExamples: () => new Promise(() => {}) }));
vi.mock("./live/view/loadScene", () => ({ loadScene: () => new Promise(() => {}) }));
vi.mock("./live/view/webgl", () => ({ webglAvailable: () => true }));
vi.mock("./timeline/loadDecisions", () => ({ loadDecisions: () => new Promise(() => {}) }));

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("App", () => {
  it("renders the six titled sections, each with a closed drawer except the timeline, which has a rail instead", () => {
    const { container } = render(<App />);
    for (const id of ["replay", "live", "performance", "architecture", "verification", "built"]) {
      expect(container.querySelector(`section#${id} h2`)?.textContent?.length, id).toBeGreaterThan(0);
      if (id === "built") continue;
      expect(container.querySelector(`section#${id} details`)?.hasAttribute("open"), id).toBe(false);
    }
    expect(container.querySelector("section#built details")).toBeNull();
    expect(container.querySelector("section#built .rail")).not.toBeNull();
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

  it("has every proof target the hero tiles link to, in the right place", () => {
    const { container } = render(<App />);
    for (const id of PROOF_IDS) {
      const target = container.querySelector(`#${id}`);
      expect(target, id).not.toBeNull();
      expect(target!.getAttribute("tabindex"), id).toBe("-1");
      expect(target!.hasAttribute("data-proof"), id).toBe(true);
      // focus lands here, so a screen reader needs a name to say where it landed
      expect(target!.getAttribute("aria-label")?.length, `${id} accessible name`).toBeGreaterThan(5);
    }
    expect(container.querySelector("#proof-stories")!.closest("section")!.id).toBe("verification");
    expect(container.querySelector("#proof-stories h3")!.textContent).toBe("The story model on the chip");
    expect(container.querySelector("#proof-cycles")!.closest("section")!.id).toBe("performance");
    expect(container.querySelector("#proof-cycles")!.closest("details.drawer")).not.toBeNull();
    expect(container.querySelector("#proof-cycles caption")!.textContent).toContain("Story model, 256 steps");
    expect(container.querySelector("#proof-cifar")!.closest("section")!.id).toBe("performance");
    expect(container.querySelector("#proof-scaling h3")!.textContent).toBe("Speedup over 1x1");
    expect(container.querySelectorAll("#proof-scaling rect.bar[data-mesh='2x2'], #proof-scaling rect.bar[data-mesh='4x4']")).toHaveLength(2);
  });

  it("announces the run once: from one live region at the end of main, none in the hero or the Live section", () => {
    const { container } = render(<App />);
    expect(container.querySelector("main")!.lastElementChild!.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelectorAll(".hero-band [aria-live], #live [aria-live]")).toHaveLength(0);
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

describe("App opens on a section named in the URL", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
  });

  const scrolledIds = () => scrollIntoView.mock.contexts.map((el) => (el as HTMLElement).id);

  it("scrolls the section into view at once when the URL has its hash", () => {
    window.history.replaceState(null, "", "/#performance");
    render(<App />);
    expect(scrolledIds()).toEqual(["performance"]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
  });

  it("does the same in Deep mode", () => {
    window.history.replaceState(null, "", "/?deep=1#built");
    render(<App />);
    expect(scrolledIds()).toEqual(["built"]);
  });

  it("does nothing for no hash, an unknown hash, or the hash of something that is not a section", () => {
    for (const url of ["/", "/#nope", "/#main"]) {
      window.history.replaceState(null, "", url);
      render(<App />);
      cleanup();
    }
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
