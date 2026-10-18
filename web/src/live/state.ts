import type { LiveRun, Stage } from "./sim/engine";
import type { MeshKey } from "./sim/types";

export type Source = { kind: "example"; index: number } | { kind: "upload"; name: string; pixels: Uint8Array };

export type Phase =
  | { name: "idle" }
  | { name: "running"; stage: Stage | "starting" }
  | { name: "done"; run: LiveRun }
  | { name: "error"; message: string; fault: boolean };

export interface LiveState {
  mesh: MeshKey;
  source: Source;
  phase: Phase;
  /** bumped by anything that invalidates an in-flight run; a result must carry the token it started with */
  token: number;
  /** a problem with the last upload, shown beside the picker */
  notice: string | null;
  /** true once any run has started; a mesh change re-runs only after that */
  hasRun: boolean;
}

/** The first test image of the "cat" class: a good first run, and the one the spike measured. */
export const DEFAULT_EXAMPLE = 3;

export const initialState: LiveState = {
  mesh: "2x2",
  source: { kind: "example", index: DEFAULT_EXAMPLE },
  phase: { name: "idle" },
  token: 0,
  notice: null,
  hasRun: false,
};

export type Action =
  | { type: "selectMesh"; mesh: MeshKey }
  | { type: "selectExample"; index: number }
  | { type: "upload"; name: string; pixels: Uint8Array }
  | { type: "uploadFailed"; message: string }
  | { type: "start" }
  | { type: "stage"; token: number; stage: Stage }
  | { type: "done"; token: number; run: LiveRun }
  | { type: "failed"; token: number; message: string; fault: boolean };

const IDLE: Phase = { name: "idle" };

export function reducer(state: LiveState, action: Action): LiveState {
  switch (action.type) {
    case "selectMesh":
      return action.mesh === state.mesh ? state : { ...state, mesh: action.mesh, phase: IDLE, token: state.token + 1, notice: null };
    case "selectExample":
      if (state.source.kind === "example" && state.source.index === action.index) return state;
      return { ...state, source: { kind: "example", index: action.index }, phase: IDLE, token: state.token + 1, notice: null };
    case "upload":
      return { ...state, source: { kind: "upload", name: action.name, pixels: action.pixels }, phase: IDLE, token: state.token + 1, notice: null };
    case "uploadFailed":
      return { ...state, notice: action.message };
    case "start":
      return { ...state, phase: { name: "running", stage: "starting" }, token: state.token + 1, notice: null, hasRun: true };
    case "stage":
      if (action.token !== state.token || state.phase.name !== "running") return state;
      return { ...state, phase: { name: "running", stage: action.stage } };
    case "done":
      if (action.token !== state.token || state.phase.name !== "running") return state;
      return { ...state, phase: { name: "done", run: action.run } };
    case "failed":
      if (action.token !== state.token || state.phase.name !== "running") return state;
      return { ...state, phase: { name: "error", message: action.message, fault: action.fault } };
  }
}
