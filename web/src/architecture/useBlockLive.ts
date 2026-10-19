import { useRunPlayback } from "../live/session/RunPlaybackProvider";
import { blockStates, litWindow, type BlockLive } from "./blockStates";

/** The live state of every diagram block at the shared run's current cycle, or null when there is no run to read. */
export function useBlockLive(): Record<string, BlockLive> | null {
  const rp = useRunPlayback();
  if (!rp || !rp.trace || !rp.activity) return null;
  const { activity, trace, playback, entry } = rp;
  const cycle = Math.min(playback.cycle, trace.cycles);
  const span = litWindow(playback.speed, trace.cycles);
  return blockStates({
    now: activity.countsAt(cycle),
    before: activity.countsAt(Math.max(0, cycle - span)),
    cycle,
    total: trace.cycles,
    playing: playback.playing,
    // the address after the last completed cycle; nothing has run at cycle 0, whatever the first record says
    pc: cycle === 0 ? 0 : trace.pc(cycle - 1),
    programEnd: entry.layers[entry.layers.length - 1]!.pcEnd,
    nodes: trace.nodes,
  });
}
