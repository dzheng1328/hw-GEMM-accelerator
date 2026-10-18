import { useEffect, useRef } from "react";
import { Section } from "../components/Section";
import summary from "../data/generated/summary.json";
import { formatInt, formatPercent } from "../format";
import { useInView } from "../replay/hooks";
import { useLiveSession } from "./session/context";
import { STAGE_TEXT, UNSUPPORTED } from "./session/messages";
import { manifest } from "./sim/manifest";
import { MESH_KEYS } from "./sim/types";
import { ImagePicker } from "./view/ImagePicker";
import { LiveStage } from "./view/LiveStage";
import { MeshChoice } from "./view/MeshChoice";

export function LiveSection() {
  const rootRef = useRef<HTMLDivElement>(null);
  const near = useInView(rootRef, "100% 0px");
  const session = useLiveSession();
  const { wantAssets, examples, pixels, canRun, state } = session;
  const { mesh, source, phase, notice } = state;
  useEffect(() => {
    if (near) wantAssets();
  }, [near, wantAssets]);

  const loaded = examples.data;
  const running = phase.name === "running";
  const accuracy = formatPercent(summary.cifar.int8Accuracy, 0);
  const images = summary.cifar.images;
  const classList = manifest.classNames.join(", ");

  return (
    <Section
      id="live"
      title="Run it live"
      headline="Pick an image and run it on the chip: the repository's RTL, compiled to WebAssembly, classifies it in your browser."
      drawer={{ summary: "Go deeper", body: <LiveDetails accuracy={accuracy} images={images} /> }}
    >
      <div ref={rootRef} className="live-root">
        <p className="live-note">
          This is <code>rtl/accel.v</code> compiled with Verilator to WebAssembly, not a model of it. When you press Run it simulates the whole
          network, and the picture is a replay of the signals that simulation recorded. Your image never leaves this page.
        </p>
        <ImagePicker
          examples={(loaded ?? []).map((e) => ({ name: e.name, pixels: e.pixels }))}
          loading={examples.status === "idle" || examples.status === "loading"}
          selected={source.kind === "example" ? source.index : null}
          uploadName={source.kind === "upload" ? source.name : null}
          onExample={session.selectExample}
          onUpload={(file) => void session.upload(file)}
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
          <MeshChoice value={mesh} onChange={session.setMesh} />
          <button
            type="button"
            className="live-run"
            disabled={!pixels || !canRun}
            aria-disabled={running || undefined}
            onClick={() => session.run()}
          >
            {running ? "Running..." : "Run on the chip"}
          </button>
        </div>
        {canRun ? null : (
          <p className="live-fallback">
            {UNSUPPORTED} The recorded numbers are in the details below: one image takes{" "}
            {MESH_KEYS.map((key) => `${formatInt(manifest.meshes[key]?.cycles ?? 0)} cycles on ${key}`).join(", ")}.
          </p>
        )}
        <p className="live-status" role="status">
          {phase.name === "running" ? STAGE_TEXT[phase.stage] : ""}
        </p>
        {phase.name === "error" ? (
          <p className="live-error" role="alert">
            {phase.fault ? "The chip stopped: " : ""}
            {phase.message}
          </p>
        ) : null}
        <LiveStage />
        <p className="live-limits">
          The classifier knows ten CIFAR-10 classes ({classList}) and scores about {accuracy} (measured on {images} test images, each 32x32).
          A photograph, or anything that is not one of those ten, still gets one of the ten answers, so read all ten bars and not only the
          winner. Large photos are cropped to a square and shrunk to 32x32 in your browser, which is not how CIFAR was made, so expect lower
          accuracy than that.
        </p>
      </div>
    </Section>
  );
}

function LiveDetails({ accuracy, images }: { accuracy: string; images: number }) {
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
        <li>The network was measured at {accuracy} on {images} test images, which are 32x32 CIFAR-10 pictures. Uploads are not.</li>
        <li>This is a simulation of the design, not silicon: it says nothing about clock speed, power or area.</li>
        <li>The 3D view shows recorded activity, windowed at the default pace; it is not drawn by the chip.</li>
        <li>The language-model story stays in the replay section above, because it is far too long to run here.</li>
      </ul>
    </div>
  );
}
