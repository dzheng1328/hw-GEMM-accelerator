import type { Model } from "../reference/model";
import { runNetwork } from "../reference/network";
import { packInput } from "../reference/pack";
import { ChipFault, type Chip, type RunResult } from "./chip";
import type { MeshKey } from "./types";

export interface RunRequest {
  id: number;
  mesh: MeshKey;
  /** the 3072-byte channel-first image */
  pixels: Uint8Array;
}

export type Stage = "loading" | "simulating" | "checking";

export interface LiveRun extends RunResult {
  /** the TypeScript reference's 16 logits for the same image */
  reference: Int32Array;
  /** all 16 cells equal */
  match: boolean;
  refMs: number;
}

export type EngineEvent =
  | { id: number; kind: "stage"; stage: Stage }
  | { id: number; kind: "done"; run: LiveRun }
  | { id: number; kind: "error"; message: string; fault: boolean };

export interface EngineDeps {
  openChip(mesh: MeshKey): Promise<Chip>;
  loadModel(): Promise<Model>;
}

/**
 * Owns the chips and the reference model. Requests run one at a time, in order, and `run` never rejects.
 * A request still waiting when a newer one has arrived is skipped without an event: its caller was already
 * replaced, and a simulation cannot be cancelled once started, so running it would only delay the newest one.
 */
export class Engine {
  private readonly chips = new Map<MeshKey, Chip>();
  private model: Model | undefined;
  private readonly waiting: { request: RunRequest; resolve: () => void }[] = [];
  private draining = false;

  constructor(
    private readonly deps: EngineDeps,
    private readonly emit: (event: EngineEvent, transfer?: Transferable[]) => void,
  ) {}

  run(request: RunRequest): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiting.push({ request, resolve });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let next = this.waiting.shift(); next; next = this.waiting.shift()) {
        if (this.waiting.length === 0) await this.execute(next.request);
        next.resolve();
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute({ id, mesh, pixels }: RunRequest): Promise<void> {
    try {
      this.emit({ id, kind: "stage", stage: "loading" });
      const packed = packInput(pixels);
      let chip = this.chips.get(mesh);
      if (!chip || chip.broken) {
        chip = await this.deps.openChip(mesh);
        this.chips.set(mesh, chip);
      }
      this.model ??= await this.deps.loadModel();
      this.emit({ id, kind: "stage", stage: "simulating" });
      let result: RunResult;
      try {
        result = chip.run(packed);
      } catch (error) {
        this.chips.delete(mesh);
        throw error;
      }
      this.emit({ id, kind: "stage", stage: "checking" });
      const started = performance.now();
      const reference = runNetwork(this.model, pixels);
      const match = reference.length === result.logits.length && reference.every((v, i) => v === result.logits[i]);
      const run: LiveRun = { ...result, reference, match, refMs: performance.now() - started };
      this.emit({ id, kind: "done", run }, [result.trace.buffer]);
    } catch (error) {
      this.emit({
        id,
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        fault: error instanceof ChipFault,
      });
    }
  }
}
