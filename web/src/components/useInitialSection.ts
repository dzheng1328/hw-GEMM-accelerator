import { useEffect } from "react";
import { SECTION_IDS } from "../content/sections";
import { pinSection } from "./pinSection";

/**
 * A client-rendered page has no content when the browser tries to honour a #section in the URL, so a shared link would
 * open on the hero. Once the sections exist, jump to the one named and hold it there while content above it arrives.
 */
export function useInitialSection(): void {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!SECTION_IDS.includes(id)) return;
    const target = document.getElementById(id);
    const main = document.getElementById("main");
    if (!target || !main) return;
    target.scrollIntoView({ block: "start", behavior: "instant" });
    pinSection(target, main);
  }, []);
}
