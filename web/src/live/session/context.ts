import { createContext, useContext } from "react";
import type { LazyStatus } from "../../replay/hooks";
import type { LiveState } from "../state";
import type { MeshKey } from "../sim/types";
import type { LoadedExample } from "../view/loadExamples";
import type { SceneComponent } from "../view/loadScene";

export interface Lazy<T> {
  status: LazyStatus;
  data: T | undefined;
}

export interface LiveSession {
  state: LiveState;
  examples: Lazy<LoadedExample[]>;
  scene: Lazy<SceneComponent>;
  /** the selected image's 3072 bytes, once known */
  pixels: Uint8Array | undefined;
  /** the Python golden logits for a built-in example, else null */
  golden: number[] | null;
  /** "the cat" or "your image" */
  imageLabel: string;
  canRun: boolean;
  hasWebgl: boolean;
  reduced: boolean;
  /** a run will start by itself once the chip has loaded: the arrival auto-run, or a Run pressed before the example images arrived */
  autoPending: boolean;
  setMesh(mesh: MeshKey): void;
  selectExample(index: number): void;
  upload(file: File): Promise<void>;
  /** starts a run now, or as soon as the example images have loaded */
  run(): void;
  /** starts loading the examples and the 3D chunk; idempotent */
  wantAssets(): void;
}

export const LiveSessionContext = createContext<LiveSession | null>(null);

export function useLiveSession(): LiveSession {
  const session = useContext(LiveSessionContext);
  if (!session) throw new Error("useLiveSession needs a LiveSessionProvider above it");
  return session;
}
