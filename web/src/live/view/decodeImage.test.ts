import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeImageFile, MAX_PIXELS } from "./decodeImage";

afterEach(() => vi.unstubAllGlobals());

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const pngHeader = (w: number, h: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), 0x49, 0x48, 0x44, 0x52, ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0]);

describe("decodeImageFile", () => {
  it("refuses an image with too many pixels before the browser decodes it", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const side = Math.ceil(Math.sqrt(MAX_PIXELS)) + 1;
    const file = new File([pngHeader(side, side)], "bomb.png", { type: "image/png" });
    await expect(decodeImageFile(file)).rejects.toThrow(/megapixels/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("lets an image of ordinary size through to the decoder", async () => {
    const decode = vi.fn().mockRejectedValue(new Error("stub"));
    vi.stubGlobal("createImageBitmap", decode);
    const file = new File([pngHeader(4000, 3000)], "photo.png", { type: "image/png" });
    await expect(decodeImageFile(file)).rejects.toThrow(/could not be read/);
    expect(decode).toHaveBeenCalledOnce();
  });
});
