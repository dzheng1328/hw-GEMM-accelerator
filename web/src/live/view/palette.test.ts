// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPalette, usePalette } from "./palette";
import { FLIT_LEGEND } from "./sceneLayout";

const VALUES: Record<string, Record<string, string>> = {
  dark: { "--accent": "#4cc3ff", "--surface": "#111922", "--border": "#243040", "--kind-control": "#ff9f43" },
  light: { "--accent": "#0a6aa1", "--surface": "#ffffff", "--border": "#c5d0db", "--kind-control": "#a84a00" },
};
for (const l of FLIT_LEGEND) {
  VALUES.dark![l.token] = "#111111";
  VALUES.light![l.token] = "#222222";
}

beforeEach(() => {
  document.documentElement.dataset.theme = "dark";
  vi.stubGlobal(
    "getComputedStyle",
    () => ({ getPropertyValue: (name: string) => VALUES[document.documentElement.dataset.theme ?? "dark"]![name] ?? "" }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scene palette", () => {
  it("reads the accent, the board, the tile edge, the controller and one color per flit type from the tokens", () => {
    const palette = readPalette();
    expect(palette.accent).toBe("#4cc3ff");
    expect(palette.board).toBe("#111922");
    expect(palette.tile).toBe("#243040");
    expect(palette.controller).toBe("#ff9f43");
    expect(palette.flit).toEqual(FLIT_LEGEND.map(() => "#111111"));
  });

  it("re-reads the tokens when data-theme changes, with no media query involved", async () => {
    const { result } = renderHook(() => usePalette());
    expect(result.current.accent).toBe("#4cc3ff");
    act(() => {
      document.documentElement.dataset.theme = "light";
    });
    await waitFor(() => expect(result.current.accent).toBe("#0a6aa1"));
    expect(result.current.board).toBe("#ffffff");
    expect(result.current.flit).toEqual(FLIT_LEGEND.map(() => "#222222"));
  });

  it("stops observing when unmounted", () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    renderHook(() => usePalette()).unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
