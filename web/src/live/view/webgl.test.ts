import { afterEach, describe, expect, it, vi } from "vitest";
import { webglAvailable } from "./webgl";

afterEach(() => vi.unstubAllGlobals());

function stubCanvas(context: unknown) {
  vi.stubGlobal("document", { createElement: () => ({ getContext: (kind: string) => (kind === "webgl2" ? context : null) }) });
}

describe("webglAvailable", () => {
  it("is true when a context can be made, and gives the probe's context back to the browser", () => {
    const loseContext = vi.fn();
    stubCanvas({ getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null) });
    expect(webglAvailable()).toBe(true);
    // browsers allow about sixteen live contexts; the probe must not hold one for the life of the page
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("is still true when the context has no WEBGL_lose_context extension", () => {
    stubCanvas({ getExtension: () => null });
    expect(webglAvailable()).toBe(true);
  });

  it("is false when no context can be made, or the browser throws", () => {
    stubCanvas(null);
    expect(webglAvailable()).toBe(false);
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("no canvas");
      },
    });
    expect(webglAvailable()).toBe(false);
  });
});
