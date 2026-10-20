// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrintLayer } from "./PrintLayer";

afterEach(cleanup);

describe("PrintLayer", () => {
  it("is a decorative fixed layer, hidden from assistive technology", () => {
    const { container } = render(<PrintLayer />);
    const layer = container.querySelector(".print-layer")!;
    expect(layer).not.toBeNull();
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.hasAttribute("data-print")).toBe(true);
    expect(layer.textContent).toBe("");
  });

  it("hands both blur previews to the css as custom properties", () => {
    const { container } = render(<PrintLayer />);
    const layer = container.querySelector<HTMLElement>(".print-layer")!;
    expect(layer.style.getPropertyValue("--print-blur-night")).toMatch(/^url\("data:image\/webp;base64,/);
    expect(layer.style.getPropertyValue("--print-blur-day")).toMatch(/^url\("data:image\/webp;base64,/);
  });
});
