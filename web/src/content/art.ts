// named imports, so the bundler keeps only the keys used (the credits, the licence and the asset list)
import { assets, credits, licence } from "../data/generated/attributions.json";

export type ArtRole = "night-print" | "day-scroll" | "washi-paper";
export type Asset = (typeof assets)[number];
export type Credit = (typeof credits)[number];

export const CREDITS: readonly Credit[] = credits;
export const LICENCE: string = licence;

export function asset(role: ArtRole): Asset {
  const found = assets.find((a) => a.role === role);
  if (!found) throw new Error(`no asset for role ${role}`);
  return found;
}

/** The tiny blur preview of a full-bleed print (the paper crop has none). */
export function blurOf(role: "night-print" | "day-scroll"): string {
  const blur = (asset(role) as { blur?: string }).blur;
  if (!blur) throw new Error(`${role} has no blur preview in attributions.json`);
  return blur;
}
