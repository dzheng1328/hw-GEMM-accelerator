import { describe, expect, it } from "vitest";
import { b64, exampleEntries, extremeEntries } from "../sim/artifacts.testlib";
import { centerCropResize, INPUT_BYTES, packInput, PIXEL_BYTES } from "./pack";

describe("packInput", () => {
  it("equals the compiler's packed bytes for every example and extreme image", () => {
    for (const e of [...exampleEntries(), ...Object.values(extremeEntries())]) {
      expect(packInput(b64(e.pixels))).toEqual(b64(e.packed));
    }
  });
  it("makes pixel - 128 as int8 and a zero fourth channel", () => {
    const px = new Uint8Array(PIXEL_BYTES).fill(0);
    px[0] = 255;
    px[1] = 128;
    const out = packInput(px);
    expect(out.length).toBe(INPUT_BYTES);
    expect([out[0], out[1], out[2]]).toEqual([127, 0, 128]);
    expect(out.subarray(3072).every((b) => b === 0)).toBe(true);
  });
  it("rejects the wrong length", () => {
    expect(() => packInput(new Uint8Array(5))).toThrow(/3072/);
  });
});

function rgba(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out.set(pixel(x, y), (y * width + x) * 4);
  }
  return out;
}
const at = (out: Uint8Array, c: number, x: number, y: number) => out[c * 1024 + y * 32 + x];

describe("centerCropResize", () => {
  it("is the identity on a 32x32 opaque image, channel-first", () => {
    const src = rgba(32, 32, (x, y) => [x * 7, y * 7, (x + y) * 3, 255]);
    const out = centerCropResize(src, 32, 32);
    expect(out.length).toBe(PIXEL_BYTES);
    expect([at(out, 0, 5, 9), at(out, 1, 5, 9), at(out, 2, 5, 9)]).toEqual([35, 63, 42]);
  });
  it("keeps a solid colour solid at any size, including a non-integer ratio", () => {
    for (const side of [64, 33, 100]) {
      const out = centerCropResize(rgba(side, side, () => [10, 200, 90, 255]), side, side);
      for (let i = 0; i < 1024; i++) {
        expect([out[i], out[1024 + i], out[2048 + i]]).toEqual([10, 200, 90]);
      }
    }
  });
  it("averages each 2x2 block when halving", () => {
    const src = rgba(64, 64, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    const out = centerCropResize(src, 64, 64);
    expect(at(out, 0, 3, 3)).toBe(100);
  });
  it("crops a landscape image to its centre", () => {
    const src = rgba(96, 32, (x) => (x < 32 ? [255, 0, 0, 255] : x < 64 ? [0, 255, 0, 255] : [0, 0, 255, 255]));
    const out = centerCropResize(src, 96, 32);
    expect([at(out, 0, 0, 0), at(out, 1, 0, 0), at(out, 2, 31, 31)]).toEqual([0, 255, 0]);
  });
  it("crops a portrait image to its centre", () => {
    const src = rgba(32, 96, (_, y) => (y < 32 ? [255, 0, 0, 255] : y < 64 ? [0, 255, 0, 255] : [0, 0, 255, 255]));
    const out = centerCropResize(src, 32, 96);
    expect([at(out, 0, 16, 16), at(out, 1, 16, 16), at(out, 2, 16, 16)]).toEqual([0, 255, 0]);
  });
  it("puts fully transparent pixels on white, not black", () => {
    const out = centerCropResize(rgba(32, 32, () => [0, 0, 0, 0]), 32, 32);
    expect([at(out, 0, 4, 4), at(out, 1, 4, 4), at(out, 2, 4, 4)]).toEqual([255, 255, 255]);
  });
  it("blends half-transparent pixels with white", () => {
    const out = centerCropResize(rgba(32, 32, () => [0, 0, 0, 128]), 32, 32);
    expect(at(out, 0, 0, 0)).toBe(127);
  });
  it("rejects a buffer that does not match its size and a zero-sized image", () => {
    expect(() => centerCropResize(new Uint8ClampedArray(7), 2, 2)).toThrow(/image/);
    expect(() => centerCropResize(new Uint8ClampedArray(0), 0, 0)).toThrow(/image/);
  });
});
