import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Color } from "three";
import type { CycleWindow } from "../playback/usePlayback";
import { newSummary, summarize, type Trace } from "../trace/trace";
import { usePalette } from "./palette";
import { paintIdle, paintRun, type SceneMaterials } from "./scenePaint";
import { SETTLE_MS, TILE, cameraFor, controllerCenter, fitFor, linkGeometry, settleAzimuth, tileCenter } from "./sceneLayout";

export interface MeshSceneProps {
  w: number;
  h: number;
  /** absent: the dim idle board, nothing glowing */
  trace?: Trace;
  /** what to show this frame; read every frame, so updating it does not re-render React */
  windowRef?: MutableRefObject<CycleWindow>;
  /** while playing the scene redraws every frame; otherwise only when `cycle` or something else it shows changes */
  playing: boolean;
  cycle: number;
  /** false (off screen) stops drawing altogether; default true */
  active?: boolean;
  /** ease the camera in from one side once, when the scene first appears; default false */
  settle?: boolean;
  /** called once, after the first frame has been drawn */
  onReady?: () => void;
  /** called when the GPU takes the drawing context away (a tab in the background, a driver reset); the scene does not come back by itself */
  onContextLost?: () => void;
}

/** The board is centred half a pitch left of the origin, because the controller block sits beside node 0. */
const BOARD_X = -0.85;

/** Drag sideways to swing the camera a little around the board; vertical swipes still scroll the page. */
function Rig({ distance, height, settle }: { distance: number; height: number; settle: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const fit = fitFor(aspect);
  const azimuth = useRef(0);
  const dragged = useRef(false);
  const settled = useRef(!settle);
  const born = useRef<number | null>(null);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; a: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, a: azimuth.current };
      dragged.current = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // a synthetic pointer cannot be captured; dragging still works without it
      }
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        azimuth.current = Math.max(-0.9, Math.min(0.9, drag.a - (e.clientX - drag.x) * 0.006));
        invalidate();
      }
    };
    const up = () => {
      drag = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl, invalidate]);
  // a different mesh needs a different camera distance, and a demand-driven canvas only redraws when asked
  useEffect(() => {
    invalidate();
  }, [invalidate, distance, height, fit]);
  useFrame(() => {
    if (!settled.current && !dragged.current) {
      born.current ??= performance.now();
      const elapsed = performance.now() - born.current;
      azimuth.current = settleAzimuth(elapsed);
      if (elapsed >= SETTLE_MS) settled.current = true;
      else invalidate();
    }
    const a = azimuth.current;
    camera.position.set(BOARD_X + (Math.sin(a) * distance) / fit, height / fit, (Math.cos(a) * distance) / fit);
    camera.lookAt(BOARD_X, 0, 0);
  });
  return null;
}

function Scene({ w, h, trace, windowRef, playing, cycle, active, onReady }: Omit<MeshSceneProps, "settle" | "active"> & { active: boolean }) {
  const palette = usePalette();
  const colors = useMemo(
    () => ({
      accent: new Color(palette.accent),
      controller: new Color(palette.controller),
      flit: palette.flit.map((c) => new Color(c)),
    }),
    [palette],
  );
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate, cycle, playing, colors, w, h, trace, active]);
  const nodes = w * h;
  const geoms = useMemo(() => linkGeometry(w, h), [w, h]);
  const controller = useMemo(() => controllerCenter(w, h), [w, h]);
  const node0 = useMemo(() => tileCenter(w, h, 0), [w, h]);
  const summary = useMemo(() => newSummary(nodes), [nodes]);
  const mats = useRef<SceneMaterials>({ tiles: [], links: [], controller: null, inject: null });
  const reported = useRef(false);

  useFrame(() => {
    if (!trace || !windowRef) paintIdle(mats.current);
    else {
      const win = windowRef.current;
      paintRun(mats.current, summarize(trace, win.from, win.to, summary), geoms, colors, nodes);
    }
    if (!reported.current) {
      reported.current = true;
      onReady?.();
    }
  });

  const boardW = w * 1.7 + 3.4;
  const boardD = h * 1.7 + 0.6;
  const boardX = BOARD_X;
  return (
    // keyed by the mesh, so a mesh change rebuilds the parts while the canvas and its GL context stay
    <group key={`${w}x${h}`}>
      <mesh position={[boardX, -0.12, 0]}>
        <boxGeometry args={[boardW, 0.1, boardD]} />
        <meshStandardMaterial color={palette.board} />
      </mesh>
      {Array.from({ length: nodes }, (_, n) => {
        const c = tileCenter(w, h, n);
        return (
          <mesh key={n} position={[c.x, 0.15, c.z]}>
            <boxGeometry args={[TILE, 0.3, TILE]} />
            <meshStandardMaterial
              ref={(m) => {
                mats.current.tiles[n] = m;
              }}
              color={palette.tile}
              emissive="#000000"
            />
          </mesh>
        );
      })}
      {geoms.map((g, i) => (
        <mesh key={g.link.id} position={[g.center.x, g.center.y, g.center.z]}>
          <boxGeometry args={g.axis === "x" ? [g.length, 0.07, 0.07] : [0.07, 0.07, g.length]} />
          <meshStandardMaterial
            ref={(m) => {
              mats.current.links[i] = m;
            }}
            color={palette.tile}
            emissive="#000000"
          />
        </mesh>
      ))}
      <mesh position={[controller.x, 0.2, controller.z]}>
        <boxGeometry args={[TILE * 0.9, 0.4, TILE * 1.4]} />
        <meshStandardMaterial
          ref={(m) => {
            mats.current.controller = m;
          }}
          color={palette.tile}
          emissive="#000000"
        />
      </mesh>
      <mesh position={[(controller.x + node0.x) / 2, 0.12, node0.z]}>
        <boxGeometry args={[node0.x - controller.x - TILE * 0.9, 0.09, 0.09]} />
        <meshStandardMaterial
          ref={(m) => {
            mats.current.inject = m;
          }}
          color={palette.tile}
          emissive="#000000"
        />
      </mesh>
    </group>
  );
}

export default function MeshScene({ w, h, trace, windowRef, playing, cycle, active = true, settle = false, onReady, onContextLost }: MeshSceneProps) {
  const camera = useMemo(() => cameraFor(w, h), [w, h]);
  return (
    <Canvas
      camera={{ position: camera.position, fov: camera.fov }}
      dpr={[1, 2]}
      frameloop={!active ? "never" : playing ? "always" : "demand"}
      onCreated={({ gl }) => {
        gl.domElement.dataset.sceneReady = "true";
        gl.domElement.addEventListener("webglcontextlost", () => onContextLost?.(), { once: true });
      }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 5]} intensity={1.2} />
      <Rig distance={camera.distance} height={camera.height} settle={settle} />
      <Scene w={w} h={h} trace={trace} windowRef={windowRef} playing={playing} cycle={cycle} active={active} onReady={onReady} />
    </Canvas>
  );
}
