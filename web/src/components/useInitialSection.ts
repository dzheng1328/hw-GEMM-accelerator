import { useEffect } from "react";
import { PROOF_IDS } from "../content/proof";
import { SECTION_IDS } from "../content/sections";
import { pinSection } from "./pinSection";
import { jumpToProof } from "./proofJump";

/**
 * A client-rendered page has no content when the browser tries to honour a #section in the URL, so a shared link would
 * open on the hero. Once the sections exist, jump to the one named and hold it there while content above it arrives.
 * A #proof-... link does the same through the proof jump, which also opens the drawer the target sits in.
 */
export function useInitialSection(): void {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (PROOF_IDS.includes(id)) {
      // a drawer opens through React state, which cannot be flushed from inside an effect: jump on the next task
      const handle = window.setTimeout(() => jumpToProof(id, { instant: true }), 0);
      return () => window.clearTimeout(handle);
    }
    if (!SECTION_IDS.includes(id)) return undefined;
    const target = document.getElementById(id);
    const main = document.getElementById("main");
    if (!target || !main) return undefined;
    target.scrollIntoView({ block: "start", behavior: "instant" });
    pinSection(target, main);
    return undefined;
  }, []);
}
