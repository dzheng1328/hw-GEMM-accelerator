import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from "react";
import { formatInt } from "../../format";
import type { Scheduler } from "../../replay/useClock";
import { usePlayback, type Playback } from "../playback/usePlayback";
import { argmax10 } from "../reference/network";
import type { LiveRun } from "../sim/engine";
import { meshEntry } from "../sim/manifest";
import type { MeshEntry } from "../sim/types";
import { layerSpans, type LayerSpan } from "../trace/layers";
import { Trace } from "../trace/trace";
import { layerAtCycle } from "../view/LayerStrip";

export interface RunPlayback {
  run: LiveRun;
  entry: MeshEntry;
  /** null when the recorded trace could not be decoded */
  trace: Trace | null;
  /** null when the layers could not be mapped */
  spans: LayerSpan[] | null;
  playback: Playback;
  /** null when there are no spans */
  layerIndex: number | null;
  layerName: string;
  finished: boolean;
  predicted: string;
  golden: number[] | null;
}

const RunPlaybackContext = createContext<RunPlayback | null>(null);

/** The finished run being shown and its playback clock, or null when there is none. */
export function useRunPlayback(): RunPlayback | null {
  return useContext(RunPlaybackContext);
}

export interface RunPlaybackProviderProps {
  run: LiveRun | null;
  golden: number[] | null;
  reduced: boolean;
  scheduler?: Scheduler;
  classNames: string[];
  children: ReactNode;
}

/**
 * Stays mounted for the page's life, so the views below it never remount when a run comes and goes.
 * One playback clock serves every view of the run; it is reset to the start when the run goes away.
 */
export function RunPlaybackProvider({ run, golden, reduced, scheduler, classNames, children }: RunPlaybackProviderProps) {
  const total = run?.cycles ?? 0;
  const playback = usePlayback(total, scheduler, 0);
  const { play, seek } = playback;

  // a layout effect, so a run appears already at the start (or, with reduced motion, at its end) and never flashes the wrong state
  useLayoutEffect(() => {
    // no run: rest at the start. Reduced motion shows the end of a run paused; it can also be switched on during a run.
    if (!run) seek(0);
    else if (reduced) seek(total);
    else play();
  }, [run, reduced, play, seek, total]);

  const entry = run ? meshEntry(run.mesh) : null;
  const trace = useMemo(() => {
    if (!run) return null;
    try {
      return new Trace(run.trace, run.nodes);
    } catch {
      return null;
    }
  }, [run]);
  const spans = useMemo(() => {
    if (!trace || !entry) return null;
    try {
      return layerSpans(trace, entry.layers);
    } catch {
      return null;
    }
  }, [trace, entry]);

  let value: RunPlayback | null = null;
  if (run && entry) {
    const layerIndex = spans ? layerAtCycle(spans, playback.cycle) : null;
    value = {
      run,
      entry,
      trace,
      spans,
      playback,
      layerIndex,
      layerName: layerIndex !== null ? entry.layers[layerIndex]!.name : "the network",
      finished: playback.atEnd,
      predicted: classNames[argmax10(run.logits)]!,
      golden,
    };
  }
  return <RunPlaybackContext.Provider value={value}>{children}</RunPlaybackContext.Provider>;
}

/** The page's one polite live region for the run; render it once. */
export function RunAnnouncer() {
  const rp = useRunPlayback();
  let text = "";
  if (rp) {
    const { playback, layerName, predicted, finished } = rp;
    text = finished
      ? `Run finished. Predicted ${predicted}.`
      : playback.playing
        ? `Playing, ${layerName}`
        : `Paused at cycle ${formatInt(playback.cycle)} in ${layerName}`;
  }
  return (
    <p className="sr-only" aria-live="polite">
      {text}
    </p>
  );
}
