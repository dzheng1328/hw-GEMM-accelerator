import { useLiveSession } from "../live/session/context";
import { useRunPlayback } from "../live/session/RunPlaybackProvider";
import { stripView } from "./stripView";

/** Under the chip diagram: where the shared run is, and a way to make the diagram move whenever the visitor arrives. */
export function RunStrip() {
  const session = useLiveSession();
  const rp = useRunPlayback();
  const view = stripView({
    canRun: session.canRun,
    phase: session.state.phase,
    autoPending: session.autoPending,
    result: rp
      ? {
          broken: rp.trace === null,
          mesh: rp.run.mesh,
          cycle: rp.playback.cycle,
          total: rp.run.cycles,
          layerIndex: rp.layerIndex,
          layerCount: rp.entry.layers.length,
        }
      : null,
  });
  const replay = rp !== null && rp.trace !== null;

  return (
    <div className="arch-run">
      <p className="arch-run-status">{view.text}</p>
      {view.button ? (
        <button
          type="button"
          className="hero-run"
          aria-disabled={view.button === "Running..." || undefined}
          onClick={() => {
            if (view.button === "Running...") return;
            if (replay) rp.playback.replay();
            else session.run();
          }}
        >
          {view.button}
        </button>
      ) : null}
    </div>
  );
}
