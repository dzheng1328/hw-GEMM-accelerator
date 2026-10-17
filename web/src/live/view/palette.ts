import { useEffect, useState } from "react";
import { FLIT_LEGEND } from "./sceneLayout";

export interface Palette {
  board: string;
  tile: string;
  accent: string;
  controller: string;
  flit: string[];
}

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    board: get("--surface", "#121922"),
    tile: get("--border", "#2a3644"),
    accent: get("--accent", "#4cc3ff"),
    controller: get("--kind-control", "#ff9f43"),
    flit: FLIT_LEGEND.map((l) => get(l.token, "#4cc3ff")),
  };
}

/** The theme is the data-theme attribute on <html> (the page never follows the operating system), so that is what is observed. */
export function usePalette(): Palette {
  const [palette, setPalette] = useState(readPalette);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}
