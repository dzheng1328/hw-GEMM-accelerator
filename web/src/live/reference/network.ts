import type { Layer, Model } from "./model";
import { PIXEL_BYTES } from "./pack";

export const LOGITS = 16;
export const CLASSES = 10;
const GROUP = 8;
const SIDE = 32;
const INPUT_CHANNELS = 4;

/**
 * model/fixedpoint.requant with ReLU: q = clamp(0, 127, (acc * m + 2^(sh-1)) >> sh), the shift a floor.
 * BigInt keeps it exact for every shift the format allows, which a double would not.
 */
export function requant(acc: number, m: number, sh: number): number {
  const half = sh > 0 ? 1n << BigInt(sh - 1) : 0n;
  const v = (BigInt(acc) * BigInt(m) + half) >> BigInt(sh);
  if (v < 0n) return 0;
  return v > 127n ? 127 : Number(v);
}

interface ConvOut {
  acc: Float64Array;
  ho: number;
  wo: number;
}

function conv(layer: Layer, x: Int32Array, h: number, w: number): ConvOut {
  const { cin, cout, ksize: k, stride, pad } = layer;
  const ho = Math.floor((h + 2 * pad - k) / stride) + 1;
  const wo = Math.floor((w + 2 * pad - k) / stride) + 1;
  const acc = new Float64Array(cout * ho * wo);
  for (let co = 0; co < cout; co++) {
    for (let oy = 0; oy < ho; oy++) {
      for (let ox = 0; ox < wo; ox++) {
        let sum = 0;
        for (let ci = 0; ci < cin; ci++) {
          for (let ky = 0; ky < k; ky++) {
            const y = oy * stride + ky - pad;
            if (y < 0 || y >= h) continue;
            for (let kx = 0; kx < k; kx++) {
              const xx = ox * stride + kx - pad;
              if (xx < 0 || xx >= w) continue;
              sum += x[(ci * h + y) * w + xx]! * layer.weights[((co * cin + ci) * k + ky) * k + kx]!;
            }
          }
        }
        acc[(co * ho + oy) * wo + ox] = sum;
      }
    }
  }
  return { acc, ho, wo };
}

function addBias(layer: Layer, out: ConvOut): void {
  const { cout, biasRows, bias, biasVal } = layer;
  const plane = out.ho * out.wo;
  for (let co = 0; co < cout; co++) {
    let rows = 0;
    for (let r = 0; r < biasRows; r++) rows += bias[r * cout + co]!;
    for (let i = 0; i < plane; i++) out.acc[co * plane + i]! += rows * biasVal;
  }
  for (const v of out.acc) {
    if (v >= 2 ** 31 || v < -(2 ** 31)) throw new Error(`${layer.name}: accumulator outside int32`);
  }
}

/** The CIFAR-10 int8 network of model/cifar_reference.py: 16 raw int32 logits (10 classes, 6 padding cells). */
export function runNetwork(model: Model, pixels: Uint8Array): Int32Array {
  if (pixels.length !== PIXEL_BYTES) throw new Error(`expected ${PIXEL_BYTES} pixel bytes, got ${pixels.length}`);
  let x = new Int32Array(INPUT_CHANNELS * SIDE * SIDE); // the fourth channel stays zero
  for (let i = 0; i < PIXEL_BYTES; i++) x[i] = pixels[i]! - 128;
  let h = SIDE;
  let w = SIDE;
  for (const [i, layer] of model.layers.entries()) {
    const out = conv(layer, x, h, w);
    addBias(layer, out);
    if (i === model.layers.length - 1) return Int32Array.from(out.acc);
    const plane = out.ho * out.wo;
    const next = new Int32Array(layer.cout * plane);
    for (let co = 0; co < layer.cout; co++) {
      const g = Math.floor(co / GROUP);
      for (let p = 0; p < plane; p++) next[co * plane + p] = requant(out.acc[co * plane + p]!, layer.m[g]!, layer.sh[g]!);
    }
    x = next;
    h = out.ho;
    w = out.wo;
  }
  throw new Error("the model has no layers");
}

/** Index of the largest of the 10 real logits, the first on a tie (numpy argmax). */
export function argmax10(logits: ArrayLike<number>): number {
  let best = 0;
  for (let c = 1; c < CLASSES; c++) if (logits[c]! > logits[best]!) best = c;
  return best;
}
