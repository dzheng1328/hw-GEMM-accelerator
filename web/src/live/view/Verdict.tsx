import type { LiveRun } from "../sim/engine";

export function sameLogits(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Index of the first cell that differs, or -1. */
export function firstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

export interface VerdictProps {
  run: LiveRun;
  /** the Python golden logits, for a built-in example; null for an upload */
  golden: number[] | null;
}

/** The check mark. It compares the arrays itself and does not trust the engine's `match` flag. */
export function Verdict({ run, golden }: VerdictProps) {
  const reference = firstDifference(run.logits, run.reference);
  const goldenDiff = golden ? firstDifference(run.logits, golden) : -1;
  if (reference === -1 && goldenDiff === -1) {
    return (
      <p className="live-verdict" data-state="match" role="status">
        <span aria-hidden="true">{"✓"} </span>
        Verified: all {run.logits.length} output cells of the chip equal the TypeScript reference
        {golden ? " and the Python golden" : ""} for this image.
      </p>
    );
  }
  const where = reference !== -1 ? reference : goldenDiff;
  const other = reference !== -1 ? "the TypeScript reference" : "the Python golden";
  const theirs = reference !== -1 ? run.reference[where] : golden![where];
  return (
    <p className="live-verdict" data-state="mismatch" role="alert">
      Mismatch: the chip and {other} disagree at output cell {where} (chip {run.logits[where]}, other {theirs}). This should
      never happen; please report it.
    </p>
  );
}
