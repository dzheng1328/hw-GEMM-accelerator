export const IMAGE_SIDE = 32;
export const PIXEL_BYTES = 3 * IMAGE_SIDE * IMAGE_SIDE;
export const INPUT_BYTES = 4 * IMAGE_SIDE * IMAGE_SIDE;

/** The chip's input bytes: pixel - 128 as int8, channel-first, plus a zero fourth channel (compiler/lower.pack_inputs). */
export function packInput(pixels: Uint8Array): Uint8Array {
  if (pixels.length !== PIXEL_BYTES) throw new Error(`expected ${PIXEL_BYTES} pixel bytes, got ${pixels.length}`);
  const out = new Uint8Array(INPUT_BYTES);
  for (let i = 0; i < PIXEL_BYTES; i++) out[i] = (pixels[i]! - 128) & 0xff;
  return out;
}

/**
 * Centre-crops an RGBA image to a square and area-averages it to 32x32, channel-first.
 * Transparency is composited on white. Pure, so it is testable without a canvas.
 */
export function centerCropResize(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (!(width >= 1 && height >= 1) || rgba.length !== width * height * 4) throw new Error("bad image buffer");
  const side = Math.min(width, height);
  const x0 = Math.floor((width - side) / 2);
  const y0 = Math.floor((height - side) / 2);
  const scale = side / IMAGE_SIDE;
  const out = new Uint8Array(PIXEL_BYTES);
  const plane = IMAGE_SIDE * IMAGE_SIDE;
  for (let oy = 0; oy < IMAGE_SIDE; oy++) {
    const sy0 = oy * scale;
    const sy1 = sy0 + scale;
    for (let ox = 0; ox < IMAGE_SIDE; ox++) {
      const sx0 = ox * scale;
      const sx1 = sx0 + scale;
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let iy = Math.floor(sy0); iy < Math.ceil(sy1); iy++) {
        const wy = Math.min(iy + 1, sy1) - Math.max(iy, sy0);
        for (let ix = Math.floor(sx0); ix < Math.ceil(sx1); ix++) {
          const wgt = wy * (Math.min(ix + 1, sx1) - Math.max(ix, sx0));
          const i = ((y0 + iy) * width + (x0 + ix)) * 4;
          const a = rgba[i + 3]!;
          const white = 255 * (255 - a);
          r += wgt * (rgba[i]! * a + white);
          g += wgt * (rgba[i + 1]! * a + white);
          b += wgt * (rgba[i + 2]! * a + white);
          weight += wgt;
        }
      }
      const k = oy * IMAGE_SIDE + ox;
      const norm = weight * 255;
      out[k] = Math.round(r / norm);
      out[plane + k] = Math.round(g / norm);
      out[2 * plane + k] = Math.round(b / norm);
    }
  }
  return out;
}
