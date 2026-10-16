export interface Layer {
  name: string;
  cin: number;
  cout: number;
  ksize: number;
  stride: number;
  pad: number;
  /** int8, [cout][cin][ksize][ksize] */
  weights: Int8Array;
  biasRows: number;
  /** int8, [biasRows][cout]; the bias is the column sums times biasVal */
  bias: Int8Array;
  biasVal: number;
  /** requantization multiplier and shift per group of 8 output channels; empty for the last layer */
  m: number[];
  sh: number[];
}

export interface Model {
  layers: Layer[];
}

export function decodeBase64(b64: string): Uint8Array {
  const text = atob(b64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

interface RawLayer {
  name: string;
  cin: number;
  cout: number;
  ksize: number;
  stride: number;
  pad: number;
  weights: string;
  biasRows: number;
  bias: string;
  biasVal: number;
  m: number[];
  sh: number[];
}

const LAYER_COUNT = 6;

export function parseModel(json: unknown): Model {
  const raw = (json as { layers?: RawLayer[] }).layers;
  if (!Array.isArray(raw) || raw.length !== LAYER_COUNT) {
    throw new Error(`the model must have ${LAYER_COUNT} layers`);
  }
  const layers = raw.map((r, i): Layer => {
    const weights = new Int8Array(decodeBase64(r.weights).buffer);
    const bias = new Int8Array(decodeBase64(r.bias).buffer);
    if (weights.length !== r.cout * r.cin * r.ksize * r.ksize) {
      throw new Error(`${r.name}: ${weights.length} weights do not fit ${r.cout}x${r.cin}x${r.ksize}x${r.ksize}`);
    }
    if (bias.length !== r.biasRows * r.cout) throw new Error(`${r.name}: bias size does not fit ${r.biasRows}x${r.cout}`);
    const groups = i === LAYER_COUNT - 1 ? 0 : r.cout / 8;
    if (r.m.length !== groups || r.sh.length !== groups) throw new Error(`${r.name}: expected ${groups} requant groups`);
    return { ...r, weights, bias };
  });
  return { layers };
}
