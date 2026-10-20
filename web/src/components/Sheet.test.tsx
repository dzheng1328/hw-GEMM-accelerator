// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet } from "./Sheet";

afterEach(cleanup);

describe("Sheet", () => {
  it("renders a plain div with the sheet class and its children", () => {
    const { container } = render(<Sheet className="mine">hello</Sheet>);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("sheet")).toBe(true);
    expect(el.classList.contains("mine")).toBe(true);
    expect(el.classList.contains("sheet-scroll")).toBe(false);
    expect(el.textContent).toBe("hello");
    expect(el.hasAttribute("tabindex")).toBe(false);
  });

  it("can be a section or a figure", () => {
    expect(render(<Sheet as="section">x</Sheet>).container.firstElementChild!.tagName).toBe("SECTION");
    cleanup();
    expect(render(<Sheet as="figure">x</Sheet>).container.firstElementChild!.tagName).toBe("FIGURE");
  });

  it("makes a scrolling sheet a named, focusable region", () => {
    const { container } = render(
      <Sheet scroll label="The timeline">
        long
      </Sheet>,
    );
    const el = container.firstElementChild!;
    expect(el.classList.contains("sheet-scroll")).toBe(true);
    expect(el.getAttribute("role")).toBe("region");
    expect(el.getAttribute("aria-label")).toBe("The timeline");
    expect(el.getAttribute("tabindex")).toBe("0");
  });

  it("passes other attributes through", () => {
    const { container } = render(<Sheet id="x" data-proof="">y</Sheet>);
    expect(container.firstElementChild!.id).toBe("x");
    expect(container.firstElementChild!.hasAttribute("data-proof")).toBe(true);
  });

  it("hands its element to a ref", () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(<Sheet ref={ref}>z</Sheet>);
    expect(ref.current).toBe(container.firstElementChild);
  });
});
