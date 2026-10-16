export interface ImageSize {
  width: number;
  height: number;
}

const tag = (b: Uint8Array, at: number, text: string): boolean => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
const be32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const le16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const le24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

function jpegSize(b: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at++;
      continue;
    }
    const length = (b[at + 2]! << 8) | b[at + 3]!;
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      if (at + 9 > b.length) return null;
      return { height: (b[at + 5]! << 8) | b[at + 6]!, width: (b[at + 7]! << 8) | b[at + 8]! };
    }
    at += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length >= 30 && tag(b, 12, "VP8X")) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  if (b.length >= 25 && tag(b, 12, "VP8L") && b[20] === 0x2f) {
    const bits = le16(b, 21) | (le16(b, 23) << 16);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (b.length >= 30 && tag(b, 12, "VP8 ") && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  return null;
}

/**
 * The pixel dimensions an image file declares in its header, for PNG, GIF, JPEG and WebP; null when the format is not
 * recognised or the header is cut short. It reads only the bytes it is given and never decodes the image.
 */
export function sniffImageSize(b: Uint8Array): ImageSize | null {
  if (b.length >= 24 && b[0] === 0x89 && tag(b, 1, "PNG") && tag(b, 12, "IHDR")) return { width: be32(b, 16), height: be32(b, 20) };
  if (b.length >= 10 && (tag(b, 0, "GIF87a") || tag(b, 0, "GIF89a"))) return { width: le16(b, 6), height: le16(b, 8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.length >= 12 && tag(b, 0, "RIFF") && tag(b, 8, "WEBP")) return webpSize(b);
  return null;
}
