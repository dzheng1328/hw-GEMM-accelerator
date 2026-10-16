import { useEffect, useMemo } from "react";
import { formatInt, formatPercent } from "../../format";
import type { LazyStatus } from "../../replay/hooks";
import type { Scheduler } from "../../replay/useClock";
import { PACE_SECONDS, usePlayback } from "../playback/usePlayback";
import { argmax10 } from "../reference/network";
import type { LiveRun } from "../sim/engine";
import { meshEntry } from "../sim/manifest";
import { layerSpans } from "../trace/layers";
import { Trace, summarize } from "../trace/trace";
import { Controls } from "./Controls";
import { LayerStrip, layerAtCycle } from "./LayerStrip";
import { Logits } from "./Logits";
import type { SceneComponent } from "./loadScene";
import type { MeshSceneProps } from "./MeshScene";
import { describeActivity } from "./readout";
import { FLIT_LEGEND } from "./sceneLayout";
import { Verdict } from "./Verdict";

export interface RunViewProps {
  run: LiveRun;
  golden: number[] | null;
  classNames: string[];
  Scene: SceneComponent | null;
  sceneStatus: LazyStatus;
  webgl: boolean;
  reduced: boolean;
  scheduler?: Scheduler;
}

/** One finished run: the scene, the layer strip, the logits, the check and the playback controls. Keyed by run. */
export function RunView({ run, golden, classNames, Scene, sceneStatus, webgl, reduced, scheduler }: RunViewProps) {
  const entry = meshEntry(run.mesh);
  const trace = useMemo(() => new Trace(run.trace, run.nodes), [run]);
  const spans = useMemo(() => {
    try {
      return layerSpans(trace, entry.layers);
    } catch {
      return null;
    }
  }, [trace, entry]);
  const playback = usePlayback(run.cycles, scheduler, reduced ? run.cycles : 0);
  const { play } = playback;
  useEffect(() => {
    if (!reduced) play();
  }, [reduced, play]);

  const layerName = spans ? entry.layers[layerAtCycle(spans, playback.cycle)]!.name : "the network";
  const finished = playback.atEnd;
  const predicted = classNames[argmax10(run.logits)]!;
  const readout = useMemo(
    () => (playback.playing ? "" : describeActivity(summarize(trace, playback.cycle - 1, playback.cycle), layerName)),
    [trace, playback.cycle, playback.playing, layerName],
  );
  const announcement = finished
    ? `Run finished. Predicted ${predicted}.`
    : playback.playing
      ? `Playing, ${layerName}`
      : `Paused at cycle ${formatInt(playback.cycle)} in ${layerName}`;
  const perFrame = Math.max(1, Math.round(run.cycles / (PACE_SECONDS * 60)));
  const twoByTwo = meshEntry("2x2").cycles;

  return (
    <div className="live-result" data-mesh={run.mesh}>
      <div className="live-stage">
        <div className="live-view">
          <SceneArea run={run} trace={trace} windowRef={playback.windowRef} Scene={Scene} status={sceneStatus} webgl={webgl} />
          <ul className="live-legend" aria-label="Legend">
            {FLIT_LEGEND.map((item) => (
              <li key={item.type}>
                <span className="swatch" style={{ background: `var(${item.token})` }} aria-hidden="true" />
                {item.label}
              </li>
            ))}
          </ul>
          <p className="live-note">
            A tile glows while its systolic array is busy, and a link glows while flits cross it. The block at the left is the command
            processor, DMA and memories, where every flit enters. At the default pace one frame covers about {formatInt(perFrame)} cycles, so
            this shows how active each part was over that window; slow the speed down to see single transfers.
          </p>
          {run.mesh === "4x4" ? (
            <p className="live-note">
              Most of these 16 tiles are idle most of the time: every flit enters through node (0,0), and the repository's scaling study finds that
              one injection port is this network's bottleneck. That is why 4x4 takes {formatInt(entry.cycles)} cycles, only{" "}
              {formatPercent((twoByTwo - entry.cycles) / twoByTwo, 1)} fewer than the 2x2 mesh's {formatInt(twoByTwo)}.
            </p>
          ) : null}
        </div>
        <div className="live-side">
          {spans ? (
            <LayerStrip layers={entry.layers} spans={spans} cycle={playback.cycle} total={run.cycles} />
          ) : (
            <p className="live-fallback">The layer view is unavailable for this run.</p>
          )}
          <Logits logits={run.logits} classNames={classNames} revealed={finished} />
          <Verdict run={run} golden={golden} />
        </div>
      </div>
      <Controls
        playing={playback.playing}
        atEnd={playback.atEnd}
        speed={playback.speed}
        cycle={playback.cycle}
        total={run.cycles}
        onToggle={playback.playing ? playback.pause : playback.play}
        onReplay={playback.replay}
        onStep={playback.step}
        onSeek={playback.seek}
        onSpeed={playback.setSpeed}
      />
      <p className="live-readout">{readout}</p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function SceneArea({
  run,
  trace,
  windowRef,
  Scene,
  status,
  webgl,
}: {
  run: LiveRun;
  trace: Trace;
  windowRef: MeshSceneProps["windowRef"];
  Scene: SceneComponent | null;
  status: LazyStatus;
  webgl: boolean;
}) {
  const { w, h } = meshEntry(run.mesh);
  if (!webgl) {
    return (
      <p className="live-fallback">
        This browser cannot draw the 3D view (WebGL is unavailable). The layer strip, the scores and the check beside it still come from the
        same run.
      </p>
    );
  }
  if (status === "error") return <p className="live-fallback">The 3D view could not be loaded. The rest of this run is unaffected.</p>;
  if (!Scene) return <p className="live-fallback">Loading the 3D view...</p>;
  return (
    <div className="live-scene" role="img" aria-label={`3D view of the ${w} by ${h} mesh: ${w * h} tiles, the links between them, and the command processor`}>
      <Scene w={w} h={h} trace={trace} windowRef={windowRef} />
    </div>
  );
}
