// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CREDITS } from "../content/art";
import { SiteFooter } from "./SiteFooter";

afterEach(cleanup);

describe("SiteFooter image credits", () => {
  it("credits every artwork from the generated attributions, with a link to the museum page", () => {
    const { container } = render(<SiteFooter />);
    const list = container.querySelector(".credits")!;
    expect(list).not.toBeNull();
    for (const credit of CREDITS) {
      const link = [...list.querySelectorAll("a")].find((a) => a.getAttribute("href") === credit.objectUrl);
      expect(link, credit.title).toBeDefined();
      expect(list.textContent).toContain(credit.title);
      expect(list.textContent).toContain(credit.artist);
    }
  });

  it("states the licence", () => {
    expect(render(<SiteFooter />).container.textContent).toContain("Open Access");
  });
});
