import type { LayerRange } from "../sim/types";
import type { Trace } from "./trace";

export interface LayerSpan {
  /** first cycle of the layer and one past its last */
  start: number;
  end: number;
}

/** The layer whose program range holds `pc`. The ranges tile the program, so this is a linear scan of six entries. */
export function layerAt(layers: LayerRange[], pc: number): number {
  for (let i = 0; i < layers.length; i++) if (pc < layers[i]!.pcEnd) return i;
  return layers.length - 1;
}

/** The cycles each layer occupied, from the program read address. Throws if the address ever moves back a layer. */
export function layerSpans(trace: Trace, layers: LayerRange[]): LayerSpan[] {
  if (trace.cycles === 0) throw new Error("cannot map layers on an empty trace");
  const spans: LayerSpan[] = layers.map(() => ({ start: -1, end: -1 }));
  let current = -1;
  for (let c = 0; c < trace.cycles; c++) {
    const layer = layerAt(layers, trace.pc(c));
    if (layer < current) throw new Error(`the program address moved back into ${layers[layer]!.name} at cycle ${c}`);
    if (layer !== current) {
      if (current >= 0) spans[current]!.end = c;
      spans[layer]!.start = c;
      current = layer;
    }
  }
  spans[current]!.end = trace.cycles;
  for (const [i, s] of spans.entries()) if (s.start < 0) throw new Error(`layer ${layers[i]!.name} was never reached`);
  return spans;
}
