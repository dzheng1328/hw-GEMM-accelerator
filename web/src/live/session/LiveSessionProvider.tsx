import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLazyData, usePrefersReducedMotion } from "../../replay/hooks";
import type { Scheduler } from "../../replay/useClock";
import { centerCropResize } from "../reference/pack";
import { createWorkerClient, SimError, SupersededError, type SimClient } from "../sim/client";
import { manifest } from "../sim/manifest";
import { initialState, reducer } from "../state";
import { decodeImageFile, type DecodedImage } from "../view/decodeImage";
import { loadExamples as defaultLoadExamples, type LoadedExample } from "../view/loadExamples";
import { loadScene as defaultLoadScene, type SceneComponent } from "../view/loadScene";
import { webglAvailable } from "../view/webgl";
import { LiveSessionContext, type LiveSession } from "./context";
import { browserIdle, saveDataOn, type IdleScheduler } from "./idle";
import { UNSUPPORTED } from "./messages";
import { RunPlaybackProvider } from "./RunPlaybackProvider";
import { useSyncedReducer } from "./useSyncedReducer";

export interface SimLike {
  run: SimClient["run"];
  close(): void;
}

export interface LiveSessionProviderProps {
  createClient?: () => SimLike;
  loadScene?: () => Promise<SceneComponent>;
  loadExamples?: () => Promise<LoadedExample[]>;
  decodeImage?: (file: File) => Promise<DecodedImage>;
  webgl?: () => boolean;
  /** whether this browser can run Web Workers and WebAssembly */
  supported?: () => boolean;
  saveData?: () => boolean;
  scheduler?: Scheduler;
  idle?: IdleScheduler;
  /** false turns the arrival auto-run off (tests of the Live section drive Run themselves) */
  autoRun?: boolean;
  children: ReactNode;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function simulationSupported(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

function defaultCreateClient(): SimLike {
  if (!simulationSupported()) throw new SimError(UNSUPPORTED, false);
  return createWorkerClient();
}

export function LiveSessionProvider({
  createClient = defaultCreateClient,
  loadScene = defaultLoadScene,
  loadExamples = defaultLoadExamples,
  decodeImage = decodeImageFile,
  webgl = webglAvailable,
  supported = simulationSupported,
  saveData = saveDataOn,
  scheduler,
  idle = browserIdle,
  autoRun = true,
  children,
}: LiveSessionProviderProps) {
  const reduced = usePrefersReducedMotion();
  const [hasWebgl] = useState(webgl);
  const [canRun] = useState(supported);
  const [dataSaver] = useState(saveData);
  const [wanted, setWanted] = useState(false);
  const examples = useLazyData(loadExamples, wanted);
  const scene = useLazyData(loadScene, wanted && hasWebgl);
  const [state, dispatch, latest] = useSyncedReducer(reducer, initialState);

  const loaded = examples.data;
  const { source } = state;
  const pixels = source.kind === "upload" ? source.pixels : loaded?.[source.index]?.pixels;
  const golden = source.kind === "example" ? (loaded?.[source.index]?.logits ?? null) : null;
  const imageLabel = source.kind === "upload" ? "your image" : `the ${loaded?.[source.index]?.name ?? "image"}`;

  const pixelsRef = useRef(pixels);
  useEffect(() => {
    pixelsRef.current = pixels;
  }, [pixels]);
  const clientRef = useRef<SimLike | null>(null);
  useEffect(() => () => clientRef.current?.close(), []);
  const uploadSeq = useRef(0);
  /** a run was asked for before the example images arrived; it starts when they do */
  const queuedRef = useRef(false);
  const firedRef = useRef(false);

  /** Runs the selected image on the selected mesh. A result is tagged with the token of its own `start`. */
  const start = useCallback(async () => {
    const pixelsNow = pixelsRef.current;
    if (!pixelsNow || !canRun) return;
    dispatch({ type: "start" });
    const mine = latest.current.token;
    try {
      clientRef.current ??= createClient();
      const run = await clientRef.current.run(latest.current.mesh, pixelsNow, (stage) => dispatch({ type: "stage", token: mine, stage }));
      dispatch({ type: "done", token: mine, run });
    } catch (error) {
      if (error instanceof SupersededError) return;
      if (error instanceof SimError && !error.fault) {
        // the worker may be gone (a failed load or a crash); the next run starts a fresh one
        clientRef.current?.close();
        clientRef.current = null;
      }
      dispatch({
        type: "failed",
        token: mine,
        message: error instanceof Error ? error.message : "The run failed.",
        fault: error instanceof SimError && error.fault,
      });
    }
  }, [canRun, createClient, dispatch, latest]);

  const run = useCallback(() => {
    if (!canRun || latest.current.phase.name === "running") return;
    if (pixelsRef.current) {
      void start();
      return;
    }
    queuedRef.current = true;
    setWanted(true);
  }, [canRun, latest, start]);

  useEffect(() => {
    if (!queuedRef.current || !pixels) return;
    queuedRef.current = false;
    if (latest.current.phase.name !== "running") void start();
  }, [pixels, start, latest]);

  const setMesh = useCallback(
    (mesh: Parameters<LiveSession["setMesh"]>[0]) => {
      if (latest.current.mesh === mesh) return;
      const rerun = latest.current.hasRun;
      dispatch({ type: "selectMesh", mesh });
      if (rerun) void start();
    },
    [dispatch, latest, start],
  );

  const selectExample = useCallback(
    (index: number) => {
      uploadSeq.current++;
      dispatch({ type: "selectExample", index });
    },
    [dispatch],
  );

  const upload = useCallback(
    async (file: File) => {
      const mine = ++uploadSeq.current;
      try {
        if (file.size === 0) throw new Error("That file is empty.");
        if (file.size > MAX_UPLOAD_BYTES) throw new Error("That file is larger than 25 MB.");
        const decoded = await decodeImage(file);
        if (mine !== uploadSeq.current) return;
        dispatch({ type: "upload", name: file.name, pixels: centerCropResize(decoded.rgba, decoded.width, decoded.height) });
      } catch (error) {
        if (mine !== uploadSeq.current) return;
        dispatch({ type: "uploadFailed", message: error instanceof Error ? error.message : "That file could not be used." });
      }
    },
    [decodeImage, dispatch],
  );

  const wantAssets = useCallback(() => setWanted(true), []);

  const eligible = autoRun && canRun && hasWebgl && !reduced && !dataSaver;
  useEffect(() => {
    if (!eligible || firedRef.current) return;
    return idle(() => {
      firedRef.current = true;
      if (latest.current.hasRun || queuedRef.current) return;
      run();
    });
  }, [eligible, idle, latest, run]);
  const autoPending = eligible && !state.hasRun && examples.status !== "error";

  const value = useMemo<LiveSession>(
    () => ({
      state,
      examples: { status: examples.status, data: examples.data },
      scene: { status: scene.status, data: scene.data },
      pixels,
      golden,
      imageLabel,
      canRun,
      hasWebgl,
      reduced,
      autoPending,
      setMesh,
      selectExample,
      upload,
      run,
      wantAssets,
    }),
    [state, examples.status, examples.data, scene.status, scene.data, pixels, golden, imageLabel, canRun, hasWebgl, reduced, autoPending, setMesh, selectExample, upload, run, wantAssets],
  );

  return (
    <LiveSessionContext.Provider value={value}>
      <RunPlaybackProvider
        run={state.phase.name === "done" ? state.phase.run : null}
        golden={golden}
        reduced={reduced}
        scheduler={scheduler}
        classNames={manifest.classNames}
      >
        {children}
      </RunPlaybackProvider>
    </LiveSessionContext.Provider>
  );
}
