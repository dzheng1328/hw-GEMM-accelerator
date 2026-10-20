import { lazy, Suspense, useCallback, useState } from "react";
import { useLiveSession } from "../live/session/context";
import { ErrorBoundary } from "../live/view/ErrorBoundary";
import { MESH_KEYS, type MeshKey } from "../live/sim/types";
import { Section } from "../components/Section";
import { formatInt, formatPercent, formatRatio } from "../format";
import { CifarCard } from "./CifarCard";
import { CounterTable } from "./CounterTable";
import { performance } from "./data";
import { cifarFinding, cyclesBars, findMesh, lmFinding, speedupBars } from "./derive";
import { MeshBarChart } from "./MeshBarChart";
import { MeshDiagram } from "./MeshDiagram";
import { MeshSelector } from "./MeshSelector";
import { PortBars } from "./PortBars";
import { RibbonFallback } from "./RibbonChrome";

// below the fold, with its own data: its code stays out of the entry chunk
const StrokeRibbon = lazy(() => import("./StrokeRibbon").then((m) => ({ default: m.StrokeRibbon })));

const isBuilt = (mesh: string): mesh is MeshKey => (MESH_KEYS as readonly string[]).includes(mesh);

const { cifar, lm, floorFlitsPerImage } = performance;
// built once: the charts are memo()ed, which only helps if they are handed the same arrays every time
const SPEEDUP_BARS = speedupBars(cifar.meshes);
const CYCLES_BARS = cyclesBars(cifar.meshes, floorFlitsPerImage);

export function PerformanceSection() {
  const session = useLiveSession();
  const shared = session.state.mesh;
  /** counts changes of the shared mesh, so a view or a run line tied to one moment cannot come back when the mesh returns to an old value */
  const [change, setChange] = useState({ shared, n: 0 });
  if (change.shared !== shared) setChange({ shared, n: change.n + 1 });
  /** a mesh the chip has no build for (2x1, 3x3) can be looked at here, but it is not shared and never runs; it lasts until the shared mesh next changes */
  const [local, setLocal] = useState<{ mesh: string; n: number } | null>(null);
  const selected = local && local.n === change.n ? local.mesh : shared;
  /** the run a choice here started, so the line below the selector can talk about it; it belongs to that one change of the shared mesh */
  const [startedFor, setStartedFor] = useState<{ mesh: MeshKey; n: number } | null>(null);
  const { hasRun } = session.state;
  const { setMesh } = session;
  // stable between renders that do not change the mesh (the chart's memo() depends on it)
  const select = useCallback(
    (next: string) => {
      if (!isBuilt(next)) {
        setLocal({ mesh: next, n: change.n });
        return;
      }
      setLocal(null);
      setStartedFor(next !== shared && hasRun ? { mesh: next, n: change.n + 1 } : null);
      setMesh(next);
    },
    [change.n, hasRun, setMesh, shared],
  );
  const phase = session.state.phase;
  const showRun =
    startedFor !== null && startedFor.n === change.n && startedFor.mesh === shared && selected === shared && (phase.name === "running" || phase.name === "done");
  const watch = () =>
    document.querySelector(".hero-band")?.scrollIntoView({ block: "start", behavior: session.reduced ? "instant" : "smooth" });

  const mesh = findMesh(cifar.meshes, selected);
  const floor = formatInt(floorFlitsPerImage);

  return (
    <Section
      id="performance"
      title="Where the cycles go"
      headline="Adding tiles stopped helping at 2x2: one injection port caps CIFAR-10, and the story model stops for a different reason."
      drawer={{ summary: "Go deeper", body: <CounterTable /> }}
    >
      <MeshSelector meshes={cifar.meshes.map((m) => m.mesh)} selected={selected} onSelect={select} />
      {showRun ? (
        <p className="mesh-run-status">
          {phase.name === "done"
            ? `Ran ${session.imageLabel} on ${shared}: ${formatInt(phase.run.cycles)} cycles. `
            : `Running ${session.imageLabel} on ${shared}... `}
          <button type="button" className="link-button" onClick={watch}>
            Watch it
          </button>
        </p>
      ) : null}
      <div className="mesh-panel">
        <MeshDiagram mesh={mesh} />
        <div className="mesh-side">
          <dl className="mesh-stats">
            <div>
              <dt>Cycles per image</dt>
              <dd>{formatInt(mesh.cyclesPerUnit)}</dd>
            </div>
            <div>
              <dt>Speedup over 1x1</dt>
              <dd>{formatRatio(mesh.speedup)}</dd>
            </div>
            <div>
              <dt>MAC utilization per tile</dt>
              <dd>{formatPercent(mesh.macUtilization, 1)}</dd>
            </div>
          </dl>
          <p className="finding">{cifarFinding(findMesh(cifar.meshes, "4x4"), floorFlitsPerImage)}</p>
        </div>
      </div>
      <div className="chart-grid">
        <MeshBarChart
          title="Speedup over 1x1"
          bars={SPEEDUP_BARS}
          selected={selected}
          max={16}
          format={formatRatio}
          referenceLabel="linear in the tile count"
          onSelect={select}
          proofKey="scaling"
        />
        <MeshBarChart
          title="Cycles per CIFAR-10 image"
          bars={CYCLES_BARS}
          selected={selected}
          max={350000}
          format={formatInt}
          referenceLabel={`the ${floor}-flit injection floor`}
          onSelect={select}
        />
      </div>
      <PortBars
        rows={[
          { label: "CIFAR-10, 2x2", port: findMesh(cifar.meshes, "2x2").port, waitLabel: "WAIT/END stall" },
          { label: "Story model, 2x2", port: findMesh(lm.meshes, "2x2").port, waitLabel: "WAIT, END or VPU running" },
        ]}
      />
      <p className="finding">{lmFinding(findMesh(lm.meshes, "2x2"), findMesh(lm.meshes, "4x4"), lm.vpuCycles)}</p>
      {/* a chunk that fails to load (a redeploy removed the old file, the network dropped) must not unmount the page */}
      <ErrorBoundary
        fallback={
          <p className="replay-error" role="status">
            The chart could not load. Reload to try again.
          </p>
        }
      >
        <Suspense fallback={<RibbonFallback />}>
          <StrokeRibbon />
        </Suspense>
      </ErrorBoundary>
      <CifarCard />
    </Section>
  );
}
