import type { EngineEvent, LiveRun, RunRequest, Stage } from "./engine";
import type { MeshKey } from "./types";

export interface Transport {
  post(request: RunRequest): void;
  onEvent(listener: (event: EngineEvent) => void): void;
  /** the worker itself failed (script error, crash), as opposed to a run failing inside it */
  onError(listener: (message: string) => void): void;
  close(): void;
}

export class SimError extends Error {
  override name = "SimError";
  constructor(
    message: string,
    /** true when the chip raised an error or Verilator aborted, as opposed to a loading or input problem */
    readonly fault: boolean,
  ) {
    super(message);
  }
}

/** The request was replaced by a newer one; its result must be ignored. */
export class SupersededError extends Error {
  override name = "SupersededError";
}

interface Pending {
  resolve(run: LiveRun): void;
  reject(error: Error): void;
  onStage?: (stage: Stage) => void;
}

export class SimClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly transport: Transport) {
    transport.onEvent((event) => this.handle(event));
    transport.onError((message) => {
      for (const p of this.pending.values()) p.reject(new SimError(`the simulator worker failed: ${message}`, false));
      this.pending.clear();
    });
  }

  /** Starts a run. Any earlier request still pending is rejected with SupersededError. */
  run(mesh: MeshKey, pixels: Uint8Array, onStage?: (stage: Stage) => void): Promise<LiveRun> {
    for (const p of this.pending.values()) p.reject(new SupersededError("replaced by a newer run"));
    this.pending.clear();
    const id = this.nextId++;
    return new Promise<LiveRun>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onStage });
      this.transport.post({ id, mesh, pixels });
    });
  }

  close(): void {
    this.transport.close();
  }

  private handle(event: EngineEvent): void {
    const p = this.pending.get(event.id);
    if (!p) return;
    if (event.kind === "stage") {
      p.onStage?.(event.stage);
      return;
    }
    this.pending.delete(event.id);
    if (event.kind === "done") p.resolve(event.run);
    else p.reject(new SimError(event.message, event.fault));
  }
}

/** A client backed by a real Web Worker (the worker script is bundled by Vite). */
export function createWorkerClient(): SimClient {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const transport: Transport = {
    post: (request) => worker.postMessage(request),
    onEvent: (listener) => {
      worker.onmessage = (message: MessageEvent<EngineEvent>) => listener(message.data);
    },
    onError: (listener) => {
      worker.onerror = (event) => listener(event.message || "unknown error");
      worker.onmessageerror = () => listener("a message could not be decoded");
    },
    close: () => worker.terminate(),
  };
  return new SimClient(transport);
}
