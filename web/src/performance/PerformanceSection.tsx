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
      <MeshDiagram mesh={mesh} />
      <p className="mesh-stats">
        {mesh.mesh}: {formatInt(mesh.cyclesPerUnit)} cycles per image, {formatRatio(mesh.speedup)} over 1x1,{" "}
        {formatPercent(mesh.macUtilization, 1)} MAC utilization per tile
      </p>
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
      <p className="finding">{cifarFinding(findMesh(cifar.meshes, "4x4"), floorFlitsPerImage)}</p>
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
