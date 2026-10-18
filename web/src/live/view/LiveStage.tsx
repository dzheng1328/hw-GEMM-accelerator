import { useMemo } from "react";
import { formatInt, formatPercent } from "../../format";
import { PACE_SECONDS } from "../playback/usePlayback";
import { useLiveSession } from "../session/context";
import { useRunPlayback } from "../session/RunPlaybackProvider";
import { manifest, meshEntry } from "../sim/manifest";
import { summarize } from "../trace/trace";
import { Controls } from "./Controls";
import { LayerStrip } from "./LayerStrip";
import { Logits } from "./Logits";
import { MeshStage } from "./MeshStage";
import { describeActivity } from "./readout";
import { FLIT_LEGEND } from "./sceneLayout";
import { Verdict } from "./Verdict";

/** The Live section's picture of the shared run: the stage, then (once a run has finished) the layer strip, scores, check and playback controls. */
export function LiveStage() {
  const { state } = useLiveSession();
  const rp = useRunPlayback();
  const result = rp && rp.trace ? rp : null;
  const broken = rp !== null && rp.trace === null;
  const mesh = rp ? rp.run.mesh : state.mesh;
  const entry = meshEntry(mesh);
  const playback = rp?.playback;
  const trace = rp?.trace ?? null;
  const layerName = rp?.layerName;
  const readout = useMemo(
    () =>
      trace && playback && !playback.playing && layerName
        ? describeActivity(summarize(trace, playback.cycle - 1, playback.cycle), layerName)
        : "",
    [trace, playback, layerName],
  );
  const perFrame = result ? Math.max(1, Math.round(result.run.cycles / (PACE_SECONDS * 60))) : 0;
  const twoByTwo = meshEntry("2x2").cycles;

  return (
    <div className={result ? "live-result" : "live-idle"} data-mesh={mesh}>
      {broken ? (
        <p className="live-error" role="alert">
          This run's result could not be shown. Press Run to try again.
        </p>
      ) : null}
      <div className="live-stage">
        <div className="live-view">
          <MeshStage variant="inline" />
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
            processor, DMA and memories, where every flit enters.
            {result ? (
              <>
                {" "}
                At the default pace one frame covers about {formatInt(perFrame)} cycles, so this shows how active each part was over that window;
                slow the speed down to see single transfers.
              </>
            ) : null}
          </p>
          {result && result.run.mesh === "4x4" ? (
            <p className="live-note">
              Most of these 16 tiles are idle most of the time: every flit enters through node (0,0), and the repository's scaling study finds that
              one injection port is this network's bottleneck. That is why 4x4 takes {formatInt(result.entry.cycles)} cycles, only{" "}
              {formatPercent((twoByTwo - result.entry.cycles) / twoByTwo, 1)} fewer than the 2x2 mesh's {formatInt(twoByTwo)}.
            </p>
          ) : null}
        </div>
        <div className="live-side">
          {result ? (
            <>
              {result.spans ? (
                <LayerStrip layers={result.entry.layers} spans={result.spans} cycle={result.playback.cycle} total={result.run.cycles} />
              ) : (
                <p className="live-fallback">The layer view is unavailable for this run.</p>
              )}
              <Logits logits={result.run.logits} classNames={manifest.classNames} revealed={result.finished} />
              <Verdict run={result.run} golden={result.golden} />
            </>
          ) : (
            <>
              <LayerStrip layers={entry.layers} spans={null} cycle={0} total={entry.cycles} />
              <Logits logits={null} classNames={manifest.classNames} revealed={false} />
            </>
          )}
        </div>
      </div>
      {result ? (
        <>
          <Controls
            playing={result.playback.playing}
            atEnd={result.playback.atEnd}
            speed={result.playback.speed}
            cycle={result.playback.cycle}
            total={result.run.cycles}
            onToggle={result.playback.playing ? result.playback.pause : result.playback.play}
            onReplay={result.playback.replay}
            onStep={result.playback.step}
            onSeek={result.playback.seek}
            onSpeed={result.playback.setSpeed}
          />
          <p className="live-readout">{readout}</p>
        </>
      ) : null}
    </div>
  );
}
