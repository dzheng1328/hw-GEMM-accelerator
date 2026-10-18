import { useLiveSession } from "../live/session/context";
import { useRunPlayback } from "../live/session/RunPlaybackProvider";
import { MESH_KEYS } from "../live/sim/types";
import { MeshStage } from "../live/view/MeshStage";
import { isVerified } from "../live/view/Verdict";
import { heroStatus } from "./heroStatus";

/** The live chip at the top of the page: the shared stage, a mesh choice, Run or Replay, and one status line. */
export function HeroStage() {
  const session = useLiveSession();
  const rp = useRunPlayback();
  const { state, canRun, autoPending, examples } = session;
  const { phase, mesh, hasRun } = state;
  const running = phase.name === "running";
  const status = heroStatus({
    phase,
    hasRun,
    canRun,
    autoPending,
    examplesFailed: examples.status === "error",
    result: rp
      ? {
          broken: rp.trace === null,
          layerIndex: rp.layerIndex,
          layerCount: rp.entry.layers.length,
          layerName: rp.layerName,
          cycle: rp.playback.cycle,
          total: rp.run.cycles,
          finished: rp.finished,
          predicted: rp.predicted,
          verified: isVerified(rp.run, rp.golden),
        }
      : null,
  });
  const replay = rp !== null && rp.trace !== null;

  return (
    <div className="hero-stage" role="group" aria-label="Live chip">
      <MeshStage variant="hero" />
      <div className="hero-readout">
        <div className="hero-mesh" role="group" aria-label="Mesh size for the live chip">
          {MESH_KEYS.map((key) => (
            <button key={key} type="button" aria-pressed={key === mesh} onClick={() => session.setMesh(key)}>
              {key}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="hero-run"
          disabled={!canRun}
          aria-disabled={running || undefined}
          onClick={() => {
            if (running) return;
            if (replay) rp.playback.replay();
            else session.run();
          }}
        >
          {running ? "Running..." : replay ? "Replay" : "Run the chip"}
        </button>
        <p className="hero-status">{status}</p>
      </div>
    </div>
  );
}
