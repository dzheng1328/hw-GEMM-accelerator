import type { MouseEvent as ReactMouseEvent } from "react";
import { proofTarget } from "../content/proof";
import { OPEN_DRAWER_EVENT } from "./drawerEvents";
import { pinSection } from "./pinSection";

export const FLASH_CLASS = "proof-flash";
/** How long the ring stays on a proof target, in ms. */
export const FLASH_MS = 1800;

let flashed: Element[] = [];
let flashTimer = 0;

function clearFlash(): void {
  window.clearTimeout(flashTimer);
  for (const element of flashed) element.classList.remove(FLASH_CLASS);
  flashed = [];
}

function flash(elements: Element[]): void {
  clearFlash();
  // a reflow between removing and adding the class restarts the animation when the same element rings again
  void document.documentElement.offsetWidth;
  for (const element of elements) element.classList.add(FLASH_CLASS);
  flashed = elements;
  flashTimer = window.setTimeout(clearFlash, FLASH_MS);
}

export interface JumpOptions {
  /** land at once instead of scrolling smoothly (a shared link on load) */
  instant?: boolean;
  /** add a history entry, so Back returns the visitor to where they were (a click) */
  push?: boolean;
}

/**
 * Takes the visitor to a proof target: opens the drawer it sits in, scrolls it below the sticky bar, holds it there
 * while content above it is still arriving, moves focus to it and rings it. Returns false when there is no such target.
 */
export function jumpToProof(id: string, { instant = false, push = false }: JumpOptions = {}): boolean {
  const spec = proofTarget(id);
  const target = document.getElementById(id);
  if (!spec || !target) return false;
  const drawer = target.closest<HTMLDetailsElement>("details.drawer");
  if (drawer && !drawer.open) drawer.dispatchEvent(new CustomEvent(OPEN_DRAWER_EVENT));
  if (push && window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
  target.scrollIntoView({ block: "start", behavior: instant ? "instant" : "auto" });
  const main = document.getElementById("main");
  if (main) pinSection(target, main);
  target.focus({ preventScroll: true });
  flash(spec.flash ? [...target.querySelectorAll(spec.flash)] : [target]);
  return true;
}

/** The click handler of a link whose href is a proof target; a modified click is left to the browser. */
export function onProofClick(id: string) {
  return (event: ReactMouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (jumpToProof(id, { push: true })) event.preventDefault();
  };
}
