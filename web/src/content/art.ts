import attributions from "../data/generated/attributions.json";

export type ArtRole = "night-print" | "day-scroll" | "washi-paper";
export type Asset = (typeof attributions.assets)[number];
export type Credit = (typeof attributions.credits)[number];

export const CREDITS: readonly Credit[] = attributions.credits;
export const LICENCE: string = attributions.licence;

export function asset(role: ArtRole): Asset {
  const found = attributions.assets.find((a) => a.role === role);
  if (!found) throw new Error(`no asset for role ${role}`);
  return found;
}
