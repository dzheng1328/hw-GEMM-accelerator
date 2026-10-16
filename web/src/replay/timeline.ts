export interface Timeline {
  stepCycles: number[];
  /** Cycles completed at the end of each step. */
  cumulative: number[];
  /** Playback seconds (at 1x) at which each step starts. */
  start: number[];
  /** Playback seconds (at 1x) at which each step ends. */
  end: number[];
  totalSeconds: number;
  totalCycles: number;
}

export function buildTimeline(stepCycles: number[], totalSeconds: number): Timeline {
  const totalCycles = stepCycles.reduce((a, b) => a + b, 0);
  if (stepCycles.length === 0 || totalCycles <= 0) {
    throw new Error("a timeline needs at least one step with cycles");
  }
  const cumulative: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let done = 0;
  for (const cycles of stepCycles) {
    start.push((totalSeconds * done) / totalCycles);
    done += cycles;
    cumulative.push(done);
    end.push((totalSeconds * done) / totalCycles);
  }
  return { stepCycles, cumulative, start, end, totalSeconds, totalCycles };
}

/** The step playing at `elapsed` seconds: the first step whose end is after `elapsed`, clamped. */
export function stepAt(t: Timeline, elapsed: number): number {
  const last = t.end.length - 1;
  if (elapsed <= 0) return 0;
  if (elapsed >= t.end[last]!) return last;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (elapsed < t.end[mid]!) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Cumulative cycles at `elapsed` seconds, interpolated linearly inside a step. */
export function cyclesAt(t: Timeline, elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= t.totalSeconds) return t.totalCycles;
  const k = stepAt(t, elapsed);
  const before = k === 0 ? 0 : t.cumulative[k - 1]!;
  const span = t.end[k]! - t.start[k]!;
  return before + ((elapsed - t.start[k]!) / span) * t.stepCycles[k]!;
}
