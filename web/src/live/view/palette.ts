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
    board: get("--surface", "#141f3b"),
    tile: get("--scene-tile", "#5a6b91"),
    accent: get("--accent", "#dfbd62"),
    controller: get("--kind-control", "#e8a05a"),
    flit: FLIT_LEGEND.map((l) => get(l.token, "#8fb3e8")),
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
