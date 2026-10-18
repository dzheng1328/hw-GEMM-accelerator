import { useCallback, useRef, useState } from "react";
import { useLiveSession } from "../session/context";
import { useRunPlayback } from "../session/RunPlaybackProvider";
import { meshEntry } from "../sim/manifest";
import { ErrorBoundary } from "./ErrorBoundary";
import { MeshBoard } from "./MeshBoard";
import { useOnScreen } from "./useOnScreen";

export type StageVariant = "hero" | "inline";

const NO_WEBGL =
  "This browser cannot draw the 3D view (WebGL is unavailable). The layer strip, the scores and the check beside it still come from the same run.";
const NOT_LOADED = "The 3D view could not be loaded. The rest of this run is unaffected.";
const NOT_SHOWN = "The 3D view could not be shown. The rest of this run is unaffected.";

/**
 * The chip as a picture: the SVG board from first paint, the 3D scene on top of it once it has drawn, and the run's
 * activity on that scene. The hero and the Live section both draw it from the one shared run; only the on-screen
 * one renders frames. The box has a fixed shape, so nothing moves when the 3D scene arrives.
 */
export function MeshStage({ variant }: { variant: StageVariant }) {
  const { state, scene, hasWebgl, reduced } = useLiveSession();
  const rp = useRunPlayback();
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(ref);
  const [ready, setReady] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const onCrash = useCallback(() => setCrashed(true), []);

  const mesh = rp ? rp.run.mesh : state.mesh;
  const { w, h } = meshEntry(mesh);
  const Scene = scene.data;
  const showScene = hasWebgl && Scene !== undefined && !crashed;
  const label = `3D view of the ${w} by ${h} mesh: ${w * h} tiles, the links between them, and the command processor`;
  const note = variant === "hero" ? null : !hasWebgl ? NO_WEBGL : scene.status === "error" ? NOT_LOADED : crashed ? NOT_SHOWN : null;

  return (
    <>
      <div
        ref={ref}
        className={variant === "hero" ? "hero-stage-view" : "live-scene"}
        role="img"
        aria-label={label}
        data-ready={showScene && ready ? "true" : undefined}
      >
        <MeshBoard w={w} h={h} />
        {showScene ? (
          <div className="stage-canvas">
            <ErrorBoundary fallback={null} onError={onCrash}>
              <Scene
                w={w}
                h={h}
                trace={rp?.trace ?? undefined}
                windowRef={rp?.trace ? rp.playback.windowRef : undefined}
                playing={rp?.playback.playing ?? false}
                cycle={rp?.playback.cycle ?? 0}
                active={onScreen}
                settle={variant === "hero" && !reduced}
                onReady={onReady}
              />
            </ErrorBoundary>
          </div>
        ) : null}
      </div>
      {note ? <p className="live-fallback">{note}</p> : null}
    </>
  );
}
