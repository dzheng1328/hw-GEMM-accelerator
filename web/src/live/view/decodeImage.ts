export interface DecodedImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Longer sides are scaled down to this before the pixels are read, to bound memory for a large photograph. */
const MAX_SIDE = 1024;

/** Decodes an image file in the browser. Throws an Error whose message is fit to show the visitor. */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file could not be read as an image.");
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("That image has no pixels.");
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot read image pixels.");
    context.drawImage(bitmap, 0, 0, width, height);
    return { rgba: context.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bitmap.close();
  }
}
