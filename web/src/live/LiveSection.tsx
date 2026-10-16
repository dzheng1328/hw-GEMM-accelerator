import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Section } from "../components/Section";
import summary from "../data/generated/summary.json";
import { formatInt, formatPercent } from "../format";
import { useInView, useLazyData, usePrefersReducedMotion } from "../replay/hooks";
import type { Scheduler } from "../replay/useClock";
import { centerCropResize } from "./reference/pack";
import { createWorkerClient, SimError, SupersededError, type SimClient } from "./sim/client";
import { manifest } from "./sim/manifest";
import { MESH_KEYS } from "./sim/types";
import { initialState, reducer } from "./state";
import { decodeImageFile, type DecodedImage } from "./view/decodeImage";
import { ImagePicker } from "./view/ImagePicker";
import { loadExamples as defaultLoadExamples, type LoadedExample } from "./view/loadExamples";
import { loadScene as defaultLoadScene, type SceneComponent } from "./view/loadScene";
import { MeshChoice } from "./view/MeshChoice";
import { RunView } from "./view/RunView";
import { webglAvailable } from "./view/webgl";

export interface SimLike {
  run: SimClient["run"];
  close(): void;
}

export interface LiveSectionProps {
  createClient?: () => SimLike;
  loadScene?: () => Promise<SceneComponent>;
  loadExamples?: () => Promise<LoadedExample[]>;
  decodeImage?: (file: File) => Promise<DecodedImage>;
  webgl?: () => boolean;
  scheduler?: Scheduler;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function defaultCreateClient(): SimLike {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    throw new SimError("This browser cannot run Web Workers or WebAssembly, so the chip cannot run here.", false);
  }
  return createWorkerClient();
}

const STAGE_TEXT = {
  starting: "Starting...",
  loading: "Loading the chip (about 1 MB the first time)...",
  simulating: "Simulating the chip...",
  checking: "Checking against the reference...",
} as const;

export function LiveSection({
  createClient = defaultCreateClient,
  loadScene = defaultLoadScene,
  loadExamples = defaultLoadExamples,
  decodeImage = decodeImageFile,
  webgl = webglAvailable,
  scheduler,
}: LiveSectionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const near = useInView(rootRef, "100% 0px");
  const reduced = usePrefersReducedMotion();
  const [hasWebgl] = useState(webgl);
  const examples = useLazyData(loadExamples, near);
  const scene = useLazyData(loadScene, near && hasWebgl);
  const [state, dispatch] = useReducer(reducer, initialState);
  const { mesh, source, phase, token, notice } = state;

  const tokenRef = useRef(0);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  const clientRef = useRef<SimLike | null>(null);
  useEffect(() => () => clientRef.current?.close(), []);
  const uploadSeq = useRef(0);

  const loaded = examples.data;
  const pixels = source.kind === "upload" ? source.pixels : loaded?.[source.index]?.pixels;
  const golden = source.kind === "example" ? (loaded?.[source.index]?.logits ?? null) : null;
  const running = phase.name === "running";

  const onRun = useCallback(async () => {
    if (!pixels) return;
    const mine = tokenRef.current + 1;
    dispatch({ type: "start" });
    try {
      clientRef.current ??= createClient();
      const run = await clientRef.current.run(mesh, pixels, (stage) => dispatch({ type: "stage", token: mine, stage }));
      dispatch({ type: "done", token: mine, run });
    } catch (error) {
      if (error instanceof SupersededError) return;
      dispatch({
        type: "failed",
        token: mine,
        message: error instanceof Error ? error.message : "The run failed.",
        fault: error instanceof SimError && error.fault,
      });
    }
  }, [pixels, mesh, createClient]);

  const onUpload = useCallback(
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
    [decodeImage],
  );

  const accuracy = formatPercent(summary.cifar.int8Accuracy, 0);
  const classList = manifest.classNames.join(", ");

  return (
    <Section
      id="live"
      title="Run it live"
      headline="Pick an image and run it on the chip: the repository's RTL, compiled to WebAssembly, classifies it in your browser."
      drawer={{ summary: "Go deeper", body: <LiveDetails accuracy={accuracy} /> }}
    >
      <div ref={rootRef} className="live-root">
        <p className="live-note">
          This is <code>rtl/accel.v</code> compiled with Verilator to WebAssembly, not a model of it. When you press Run it simulates the whole
          network, and the picture is a replay of the signals that simulation recorded. Your image never leaves this page.
        </p>
        <ImagePicker
          examples={(loaded ?? []).map((e) => ({ name: e.name, pixels: e.pixels }))}
          selected={source.kind === "example" ? source.index : null}
          uploadName={source.kind === "upload" ? source.name : null}
          onExample={(index) => {
            uploadSeq.current++;
            dispatch({ type: "selectExample", index });
          }}
          onUpload={onUpload}
        />
        {examples.status === "error" ? (
          <p className="live-notice" role="status">
            The built-in examples could not be loaded. You can still upload an image.
          </p>
        ) : null}
        {notice ? (
          <p className="live-notice" role="status">
            {notice}
          </p>
        ) : null}
        <div className="live-actions">
          <MeshChoice value={mesh} onChange={(m) => dispatch({ type: "selectMesh", mesh: m })} />
          <button type="button" className="live-run" disabled={!pixels || running} onClick={() => void onRun()}>
            {running ? "Running..." : "Run on the chip"}
          </button>
        </div>
        <p className="live-status" role="status">
          {phase.name === "running" ? STAGE_TEXT[phase.stage] : ""}
        </p>
        {phase.name === "error" ? (
          <p className="live-error" role="alert">
            {phase.fault ? "The chip stopped: " : ""}
            {phase.message}
          </p>
        ) : null}
        {phase.name === "done" ? (
          <RunView
            key={token}
            run={phase.run}
            golden={golden}
            classNames={manifest.classNames}
            Scene={scene.data ?? null}
            sceneStatus={scene.status}
            webgl={hasWebgl}
            reduced={reduced}
            scheduler={scheduler}
          />
        ) : null}
        <p className="live-limits">
          The classifier knows ten CIFAR-10 classes ({classList}) and scores about {accuracy} on 32x32 test images.
          A photograph, or anything that is not one of those ten, still gets one of the ten answers, so read all ten bars and not only the
          winner. Large photos are cropped to a square and shrunk to 32x32 in your browser, which is not how CIFAR was made, so expect lower
          accuracy than that.
        </p>
      </div>
    </Section>
  );
}

function LiveDetails({ accuracy }: { accuracy: string }) {
  return (
    <div className="live-details">
      <h3>How the chip gets into the page</h3>
      <p>
        Verilator turns <code>rtl/accel.v</code> into C++, a small generated harness drives it, and Emscripten builds one WebAssembly module per
        mesh. The built files are committed with the hash of every source they came from, and a test fails if the RTL changes without a rebuild.
        The simulation runs in a Web Worker, to completion, then the page replays what it recorded.
      </p>
      <table className="live-table">
        <caption>One image on each mesh (the cycle count does not depend on the image)</caption>
        <thead>
          <tr>
            <th scope="col">Mesh</th>
            <th scope="col">Tiles</th>
            <th scope="col">Cycles</th>
            <th scope="col">Recorded trace</th>
          </tr>
        </thead>
        <tbody>
          {MESH_KEYS.map((key) => {
            const entry = manifest.meshes[key];
            if (!entry) return null;
            return (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>{entry.nodes}</td>
                <td>{formatInt(entry.cycles)}</td>
                <td>{(entry.cycles * entry.recordBytes / 1e6).toFixed(1)} MB</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>What is recorded each cycle</h3>
      <p>
        Which tiles are busy, which of the four output links and the injection port carried a flit and what type it was (OPERAND, GO, RESULT or
        RESULT8), where a RESULT was delivered, the command processor's program address, and whether the DMA and the write-back were busy. The
        program address is how the layer strip knows which of the six layers is running.
      </p>
      <h3>What the check proves</h3>
      <p>
        The page runs the same image through an independent TypeScript implementation of the integer network and compares all 16 output cells
        with the chip's. For the built-in examples it also compares with the Python reference's logits, which were produced by the repository's own
        NumPy model. A check mark means exact equality, never "close".
      </p>
      <h3>Limits</h3>
      <ul>
        <li>The network was measured at {accuracy} on its test images, which are 32x32 CIFAR-10 pictures. Uploads are not.</li>
        <li>This is a simulation of the design, not silicon: it says nothing about clock speed, power or area.</li>
        <li>The 3D view shows recorded activity, windowed at the default pace; it is not drawn by the chip.</li>
        <li>The language-model story stays in the replay section above, because it is far too long to run here.</li>
      </ul>
    </div>
  );
}
