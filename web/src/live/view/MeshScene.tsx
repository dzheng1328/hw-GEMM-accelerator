import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { MeshStandardMaterial } from "three";
import type { CycleWindow } from "../playback/usePlayback";
import { NO_TYPE, newSummary, summarize, type Trace } from "../trace/trace";
import { FLIT_LEGEND, TILE, cameraFor, controllerCenter, glow, linkGeometry, tileCenter } from "./sceneLayout";

export interface MeshSceneProps {
  w: number;
  h: number;
  trace: Trace;
  /** what to show this frame; read every frame, so updating it does not re-render React */
  windowRef: MutableRefObject<CycleWindow>;
  onReady?: () => void;
}

/** The board is centred half a pitch left of the origin, because the controller block sits beside node 0. */
const BOARD_X = -0.85;

interface Palette {
  board: string;
  tile: string;
  accent: string;
  controller: string;
  flit: string[];
}

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    board: get("--surface", "#121922"),
    tile: get("--border", "#2a3644"),
    accent: get("--accent", "#4cc3ff"),
    controller: get("--kind-control", "#ff9f43"),
    flit: FLIT_LEGEND.map((l) => get(l.token, "#4cc3ff")),
  };
}

function usePalette(): Palette {
  const [palette, setPalette] = useState(readPalette);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setPalette(readPalette());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return palette;
}

/** Drag sideways to swing the camera a little around the board; vertical swipes still scroll the page. */
function Rig({ distance, height }: { distance: number; height: number }) {
  const { camera, gl } = useThree();
  const azimuth = useRef(0);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; a: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, a: azimuth.current };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // a synthetic pointer cannot be captured; dragging still works without it
      }
    };
    const move = (e: PointerEvent) => {
      if (drag) azimuth.current = Math.max(-0.9, Math.min(0.9, drag.a - (e.clientX - drag.x) * 0.006));
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
  }, [gl]);
  useFrame(() => {
    const a = azimuth.current;
    camera.position.set(BOARD_X + Math.sin(a) * distance, height, Math.cos(a) * distance);
    camera.lookAt(BOARD_X, 0, 0);
  });
  return null;
}

function Scene({ w, h, trace, windowRef }: Omit<MeshSceneProps, "onReady">) {
  const palette = usePalette();
  const nodes = w * h;
  const geoms = useMemo(() => linkGeometry(w, h), [w, h]);
  const controller = useMemo(() => controllerCenter(w, h), [w, h]);
  const node0 = useMemo(() => tileCenter(w, h, 0), [w, h]);
  const summary = useRef(newSummary(nodes));
  const tileMats = useRef<(MeshStandardMaterial | null)[]>([]);
  const linkMats = useRef<(MeshStandardMaterial | null)[]>([]);
  const controllerMat = useRef<MeshStandardMaterial | null>(null);
  const injectMat = useRef<MeshStandardMaterial | null>(null);

  useFrame(() => {
    const win = windowRef.current;
    const s = summarize(trace, win.from, win.to, summary.current);
    for (let n = 0; n < nodes; n++) tileMats.current[n]?.emissive.set(palette.accent).multiplyScalar(glow(s.tiles[n]!));
    geoms.forEach((g, i) => {
      const material = linkMats.current[i];
      if (!material) return;
      const type = s.linkType[g.link.id]!;
      if (type === NO_TYPE) material.emissive.set("#000000");
      else material.emissive.set(palette.flit[type]!).multiplyScalar(glow(s.links[g.link.id]!));
    });
    const busy = Math.max(s.dma, s.sequencer);
    controllerMat.current?.emissive.set(palette.controller).multiplyScalar(glow(busy));
    const injectType = s.injectType[0]!;
    if (injectType === NO_TYPE) injectMat.current?.emissive.set("#000000");
    else injectMat.current?.emissive.set(palette.flit[injectType]!).multiplyScalar(glow(s.inject[0]!));
  });

  const boardW = w * 1.7 + 3.4;
  const boardD = h * 1.7 + 0.6;
  const boardX = BOARD_X;
  return (
    <>
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
                tileMats.current[n] = m;
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
              linkMats.current[i] = m;
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
            controllerMat.current = m;
          }}
          color={palette.tile}
          emissive="#000000"
        />
      </mesh>
      <mesh position={[(controller.x + node0.x) / 2, 0.12, node0.z]}>
        <boxGeometry args={[node0.x - controller.x - TILE * 0.9, 0.09, 0.09]} />
        <meshStandardMaterial
          ref={(m) => {
            injectMat.current = m;
          }}
          color={palette.tile}
          emissive="#000000"
        />
      </mesh>
    </>
  );
}

export default function MeshScene({ w, h, trace, windowRef, onReady }: MeshSceneProps) {
  const camera = useMemo(() => cameraFor(w, h), [w, h]);
  return (
    <Canvas
      camera={{ position: camera.position, fov: camera.fov }}
      dpr={[1, 2]}
      onCreated={({ gl }) => {
        gl.domElement.dataset.sceneReady = "true";
        onReady?.();
      }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 5]} intensity={1.2} />
      <Rig distance={camera.distance} height={camera.height} />
      <Scene w={w} h={h} trace={trace} windowRef={windowRef} />
    </Canvas>
  );
}
