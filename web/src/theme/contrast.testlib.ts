export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  return [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)) as Rgb;
}

export function rgbToHex(rgb: readonly number[]): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

export function luminance(hex: string): number {
  const channel = (c8: number) => {
    const c = c8 / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** `fg` laid over `bg` at `alpha` (0 to 1), blended per channel in sRGB like a browser does. */
export function mixHex(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg);
  const g = hexToRgb(bg);
  return rgbToHex(f.map((c, i) => c * alpha + g[i]! * (1 - alpha)));
}
