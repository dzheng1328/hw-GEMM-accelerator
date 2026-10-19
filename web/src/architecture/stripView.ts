import { formatInt } from "../format";
import { STAGE_TEXT, UNSUPPORTED } from "../live/session/messages";
import type { Phase } from "../live/state";

export type StripButton = "Run the chip" | "Replay" | "Running...";

export interface StripView {
  text: string;
  button: StripButton | null;
}

export interface StripInput {
  canRun: boolean;
  phase: Phase;
  autoPending: boolean;
  /** the finished run being shown; null when there is none */
  result: null | {
    broken: boolean;
    mesh: string;
    cycle: number;
    total: number;
    layerIndex: number | null;
    layerCount: number;
  };
}

/** The line and the button under the chip diagram. The wording matches the hero's where the situation is the same. */
export function stripView({ canRun, phase, autoPending, result }: StripInput): StripView {
  if (!canRun) return { text: UNSUPPORTED, button: null };
  if (phase.name === "running") return { text: STAGE_TEXT[phase.stage], button: "Running..." };
  if (phase.name === "error") {
    return { text: `${phase.fault ? "The chip stopped: " : ""}${phase.message}`, button: "Run the chip" };
  }
  if (phase.name === "done" && result) {
    if (result.broken) return { text: "Block activity is unavailable for this run.", button: "Run the chip" };
    const where = `${result.mesh} mesh - cycle ${formatInt(result.cycle)} of ${formatInt(result.total)}`;
    const layer = result.layerIndex === null ? "" : ` - layer ${result.layerIndex + 1} of ${result.layerCount}`;
    return { text: `${where}${layer}`, button: "Replay" };
  }
  if (autoPending) return { text: "Loading the chip...", button: "Run the chip" };
  return { text: "Run the chip to see this light up.", button: "Run the chip" };
}
