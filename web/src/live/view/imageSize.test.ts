import { describe, expect, it } from "vitest";
import { sniffImageSize } from "./imageSize";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >> 8) & 255];
const u24le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

const png = (w: number, h: number) =>
  new Uint8Array([0x89, ...ascii("PNG\r\n\x1a\n"), ...u32be(13), ...ascii("IHDR"), ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0]);
const gif = (w: number, h: number) => new Uint8Array([...ascii("GIF89a"), ...u16le(w), ...u16le(h), 0, 0, 0]);
const jpeg = (w: number, h: number, withApp = true) =>
  new Uint8Array([
    0xff, 0xd8,
    ...(withApp ? [0xff, 0xe1, 0x00, 0x06, 1, 2, 3, 4] : []), // an APP1 segment (EXIF) before the frame header
    0xff, 0xc2, 0x00, 0x11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);
const webpExtended = (w: number, h: number) =>
  new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
const webpLossless = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8L"), 5, 0, 0, 0, 0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255]);
};
const webpLossy = (w: number, h: number) =>
  new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 "), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h)]);

describe("sniffImageSize", () => {
  it("reads PNG, GIF, JPEG and WebP dimensions from the header", () => {
    expect(sniffImageSize(png(3000, 2000))).toEqual({ width: 3000, height: 2000 });
    expect(sniffImageSize(gif(640, 480))).toEqual({ width: 640, height: 480 });
    expect(sniffImageSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 });
    expect(sniffImageSize(jpeg(1024, 768, false))).toEqual({ width: 1024, height: 768 });
    expect(sniffImageSize(webpExtended(5000, 4000))).toEqual({ width: 5000, height: 4000 });
    expect(sniffImageSize(webpLossless(320, 200))).toEqual({ width: 320, height: 200 });
    expect(sniffImageSize(webpLossy(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it("returns null for anything else, truncated headers and empty input, instead of guessing", () => {
    expect(sniffImageSize(new Uint8Array(0))).toBeNull();
    expect(sniffImageSize(new Uint8Array(ascii("not an image at all")))).toBeNull();
    expect(sniffImageSize(png(10, 10).subarray(0, 20))).toBeNull();
    expect(sniffImageSize(jpeg(10, 10).subarray(0, 12))).toBeNull();
  });
});
