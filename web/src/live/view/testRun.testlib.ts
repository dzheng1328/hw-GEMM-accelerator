// Test-only: a small synthetic run for component tests, so they need no WebAssembly.
import type { LiveRun } from "../sim/engine";
import { meshEntry } from "../sim/manifest";
import type { MeshKey } from "../sim/types";

const PER_LAYER = 40;

export function makeRun(mesh: MeshKey = "2x2", opts: { mismatch?: boolean; predicted?: number } = {}): LiveRun {
  const entry = meshEntry(mesh);
  const rb = entry.recordBytes;
  const cycles = PER_LAYER * entry.layers.length;
  const trace = new Uint8Array(cycles * rb);
  const view = new DataView(trace.buffer);
  entry.layers.forEach((layer, i) => {
    for (let k = 0; k < PER_LAYER; k++) {
      const c = i * PER_LAYER + k;
      view.setUint16(c * rb, 1, true); // node 0 busy
      view.setUint16(c * rb + 2, layer.pcStart, true);
    }
  });
  const logits = new Int32Array(16).fill(-1000);
  logits[opts.predicted ?? 3] = 5000;
  const reference = Int32Array.from(logits);
  if (opts.mismatch) reference[2] = reference[2]! + 1;
  return {
    mesh,
    cycles,
    logits,
    trace,
    nodes: entry.nodes,
    recordBytes: rb,
    counters: { runCycles: cycles, slotCycles: 0, goCycles: 0, busyCycles: Array.from({ length: entry.nodes }, () => 0) },
    simMs: 1,
    reference,
    match: !opts.mismatch,
    refMs: 1,
  };
}
