import { formatInt } from "../format";
import { STAGE_TEXT, UNSUPPORTED } from "../live/session/messages";
import type { Phase } from "../live/state";

export interface HeroStatusInput {
  phase: Phase;
  hasRun: boolean;
  canRun: boolean;
  autoPending: boolean;
  examplesFailed: boolean;
  /** the finished run being shown; null when there is none */
  result: null | {
    broken: boolean;
    layerIndex: number | null;
    layerCount: number;
    layerName: string;
    cycle: number;
    total: number;
    finished: boolean;
    predicted: string;
    verified: boolean;
  };
}

/** The one line under the hero stage. */
export function heroStatus({ phase, hasRun, canRun, autoPending, examplesFailed, result }: HeroStatusInput): string {
  if (!canRun) return UNSUPPORTED;
  if (phase.name === "running") return STAGE_TEXT[phase.stage];
  if (phase.name === "error") return `${phase.fault ? "The chip stopped: " : ""}${phase.message}`;
  if (phase.name === "done" && result) {
    if (result.broken) return "The result could not be shown. Press Run to try again.";
    if (result.finished) {
      return `Predicted: ${result.predicted} - ${result.verified ? "checked against the reference" : "the check against the reference FAILED"}`;
    }
    const where = `cycle ${formatInt(result.cycle)} of ${formatInt(result.total)}`;
    return result.layerIndex === null ? where : `Layer ${result.layerIndex + 1} of ${result.layerCount}: ${result.layerName} - ${where}`;
  }
  if (autoPending) return "Loading the chip...";
  if (examplesFailed) return "The example images could not be loaded. You can still upload one below.";
  if (hasRun) return "Ready - press Run";
  return "Press Run to watch the chip classify an image.";
}
