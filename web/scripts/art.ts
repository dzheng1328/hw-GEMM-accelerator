export interface MetObject {
  objectID: number;
  isPublicDomain: boolean;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  creditLine: string;
  objectURL: string;
  primaryImage: string;
}

export interface Trim {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The pipeline only ever touches public-domain objects: anything else stops the run. */
export function assertPublicDomain(obj: MetObject): void {
  if (obj.isPublicDomain !== true) throw new Error(`Met object ${obj.objectID} (${obj.title}) is not public domain`);
  if (!obj.primaryImage) throw new Error(`Met object ${obj.objectID} has no primaryImage`);
}

export function trimRegion(width: number, height: number, trim: Trim): { left: number; top: number; width: number; height: number } {
  const w = Math.round(width * (1 - trim.left - trim.right));
  const h = Math.round(height * (1 - trim.top - trim.bottom));
  if (w <= 0 || h <= 0) throw new Error("the trim leaves nothing of the image");
  return { left: Math.round(width * trim.left), top: Math.round(height * trim.top), width: w, height: h };
}

/** Relative luminance of an sRGB colour, 0 to 1. */
export function luminance01(r: number, g: number, b: number): number {
  const channel = (c8: number) => {
    const c = c8 / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The colour of the pixel at luminance percentile `p` (0 darkest, 1 brightest) in a packed RGB buffer. */
export function percentileColor(rgb: Uint8Array, p: number): [number, number, number] {
  const count = Math.floor(rgb.length / 3);
  const order = Array.from({ length: count }, (_, i) => i);
  const lum = (i: number) => luminance01(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
  order.sort((a, b) => lum(a) - lum(b));
  const i = order[Math.min(count - 1, Math.max(0, Math.floor(p * (count - 1))))]!;
  return [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
}

/**
 * The flattest bright square in a greyscale image: the plainest paper, with no ink in it.
 * Windows step by a quarter of their size; a window needs a mean of at least `minMean`.
 */
export function findPaperRegion(gray: Uint8Array, width: number, height: number, win: number, minMean = 170): { x: number; y: number; size: number } {
  const step = Math.max(1, Math.floor(win / 4));
  let best: { x: number; y: number; size: number; variance: number } | null = null;
  for (let y = 0; y + win <= height; y += step) {
    for (let x = 0; x + win <= width; x += step) {
      let sum = 0;
      let sumSq = 0;
      for (let yy = 0; yy < win; yy++) {
        for (let xx = 0; xx < win; xx++) {
          const v = gray[(y + yy) * width + x + xx]!;
          sum += v;
          sumSq += v * v;
        }
      }
      const n = win * win;
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      if (mean >= minMean && (!best || variance < best.variance)) best = { x, y, size: win, variance };
    }
  }
  if (!best) throw new Error("no window of the image is plain bright paper");
  return { x: best.x, y: best.y, size: best.size };
}

/** Encodes at the highest quality (from `start` down to `floor`) that fits `maxBytes`. */
export async function encodeWithinBudget(
  encode: (quality: number) => Promise<Buffer>,
  maxBytes: number,
  start = 82,
  floor = 50,
  step = 4,
): Promise<{ buffer: Buffer; quality: number }> {
  for (let quality = start; quality >= floor; quality -= step) {
    const buffer = await encode(quality);
    if (buffer.length <= maxBytes) return { buffer, quality };
  }
  throw new Error(`could not fit ${maxBytes} bytes even at quality ${floor}: the budget is too small for this image`);
}
