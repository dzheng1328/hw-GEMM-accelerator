import type { Manifest, MeshEntry, MeshKey } from "./types";

/** The Emscripten module built from web/sim-build/harness.py. */
export interface SimModule {
  HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _sim_init(): void;
  _sim_load(program: number, programWords: number, weights: number, weightWords: number): number;
  _sim_set_input(ptr: number, words: number): number;
  _sim_run(maxCycles: number): number;
  _sim_trace_ptr(): number;
  _sim_trace_bytes(): number;
  _sim_record_bytes(): number;
  _sim_copy_act(firstWord: number, count: number, dst: number): number;
  _sim_perf(index: number): number;
  _sim_free(): void;
}

export interface ChipAssets {
  createModule(): Promise<SimModule>;
  program: Uint8Array;
  weights: Uint8Array;
  entry: MeshEntry;
  output: Manifest["output"];
  inputBytes: number;
}

export interface RunCounters {
  /** the chip's own cycle counters (rtl/cmd_perf.v, rtl/node_perf.v) */
  runCycles: number;
  slotCycles: number;
  goCycles: number;
  busyCycles: number[];
}

export interface RunResult {
  mesh: MeshKey;
  cycles: number;
  /** all 16 raw int32 output cells; 10 are classes */
  logits: Int32Array;
  trace: Uint8Array;
  nodes: number;
  recordBytes: number;
  counters: RunCounters;
  simMs: number;
}

export class ChipFault extends Error {
  override name = "ChipFault";
}

const MAX_CYCLES = 2_000_000;

function put(m: SimModule, bytes: Uint8Array): number {
  const ptr = m._malloc(bytes.length);
  if (ptr === 0) throw new ChipFault("the simulator ran out of memory");
  m.HEAPU8.set(bytes, ptr);
  return ptr;
}

export class Chip {
  #broken = false;

  private constructor(
    readonly mesh: MeshKey,
    private readonly module: SimModule,
    private readonly assets: ChipAssets,
  ) {}

  static async open(mesh: MeshKey, assets: ChipAssets): Promise<Chip> {
    return new Chip(mesh, await assets.createModule(), assets);
  }

  /** True after a fault: the module may be aborted, so open a new Chip instead of reusing this one. */
  get broken(): boolean {
    return this.#broken;
  }

  /** Runs one packed image (see reference/pack.packInput) from reset to done. A fresh model is built each time. */
  run(image: Uint8Array): RunResult {
    const { module: m, assets } = this;
    if (this.#broken) throw new ChipFault("this chip stopped after an earlier fault; open a new one");
    if (image.length !== assets.inputBytes) {
      throw new RangeError(`expected ${assets.inputBytes} input bytes, got ${image.length}`);
    }
    const started = performance.now();
    const owned: number[] = [];
    try {
      m._sim_init();
      const program = put(m, assets.program);
      owned.push(program);
      const weights = put(m, assets.weights);
      owned.push(weights);
      const input = put(m, image);
      owned.push(input);
      if (m._sim_load(program, assets.program.length / 8, weights, assets.weights.length / 8) !== 0) {
        throw new ChipFault("the program or weights do not fit the chip's memories");
      }
      if (m._sim_set_input(input, image.length / 8) !== 0) throw new ChipFault("the image does not fit");
      const cycles = m._sim_run(MAX_CYCLES);
      if (cycles === -1) throw new ChipFault(`the chip raised error at program word ${m._sim_perf(3)}`);
      if (cycles < 0) throw new ChipFault(`the run did not finish within ${MAX_CYCLES} cycles`);

      const tracePtr = m._sim_trace_ptr();
      const trace = m.HEAPU8.slice(tracePtr, tracePtr + m._sim_trace_bytes());
      const { base, stride, logits: count } = assets.output;
      const span = (count - 1) * stride + 1;
      const dst = m._malloc(span * 8);
      owned.push(dst);
      if (m._sim_copy_act(base, span, dst) !== 0) throw new ChipFault("could not read the output cells");
      const words = new BigInt64Array(m.HEAPU8.slice(dst, dst + span * 8).buffer);
      const logits = new Int32Array(count);
      for (let c = 0; c < count; c++) {
        const v = Number(words[c * stride]);
        if (!Number.isSafeInteger(v) || v >= 2 ** 31 || v < -(2 ** 31)) throw new ChipFault(`logit ${c} is not an int32`);
        logits[c] = v;
      }
      const nodes = assets.entry.nodes;
      const result: RunResult = {
        mesh: this.mesh,
        cycles,
        logits,
        trace,
        nodes,
        recordBytes: m._sim_record_bytes(),
        counters: {
          runCycles: m._sim_perf(0),
          slotCycles: m._sim_perf(1),
          goCycles: m._sim_perf(2),
          busyCycles: Array.from({ length: nodes }, (_, i) => m._sim_perf(4 + i)),
        },
        simMs: performance.now() - started,
      };
      m._sim_free(); // everything needed has been copied out; do not keep the model and its trace resident
      return result;
    } catch (error) {
      this.#broken = true;
      if (error instanceof ChipFault) throw error;
      throw new ChipFault(`the simulation stopped: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (!this.#broken) for (const ptr of owned) m._free(ptr);
    }
  }
}
