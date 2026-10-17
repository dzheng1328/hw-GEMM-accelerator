import { useState } from "react";
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

const DEFAULT_MESH = "4x4";

export function PerformanceSection() {
  const { cifar, lm, floorFlitsPerImage } = performance;
  const [selected, setSelected] = useState(DEFAULT_MESH);
  const mesh = findMesh(cifar.meshes, selected);
  const floor = formatInt(floorFlitsPerImage);

  return (
    <Section
      id="performance"
      title="Where the cycles go"
      headline="Adding tiles stopped helping at 2x2: one injection port caps CIFAR-10, and the story model stops for a different reason."
      drawer={{ summary: "Go deeper", body: <CounterTable /> }}
    >
      <MeshSelector meshes={cifar.meshes.map((m) => m.mesh)} selected={selected} onSelect={setSelected} />
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
          bars={speedupBars(cifar.meshes)}
          selected={selected}
          max={16}
          format={formatRatio}
          referenceLabel="linear in the tile count"
        />
        <MeshBarChart
          title="Cycles per CIFAR-10 image"
          bars={cyclesBars(cifar.meshes, floorFlitsPerImage)}
          selected={selected}
          max={350000}
          format={formatInt}
          referenceLabel={`the ${floor}-flit injection floor`}
        />
      </div>
      <PortBars
        rows={[
          { label: "CIFAR-10, 2x2", port: findMesh(cifar.meshes, "2x2").port, waitLabel: "WAIT/END stall" },
          { label: "Story model, 2x2", port: findMesh(lm.meshes, "2x2").port, waitLabel: "WAIT, END or VPU running" },
        ]}
      />
      <p className="finding">{lmFinding(findMesh(lm.meshes, "2x2"), findMesh(lm.meshes, "4x4"), lm.vpuCycles)}</p>
      <CifarCard />
    </Section>
  );
}
