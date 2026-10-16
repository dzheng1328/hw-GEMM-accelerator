import { formatInt, formatPercent } from "../format";
import { performance } from "./data";
import { findMesh } from "./derive";

export function CifarCard() {
  const { accuracy, meshes } = performance.cifar;
  const stats: [string, string][] = [
    ["int8 accuracy, 128 images", formatPercent(accuracy.int8)],
    ["Float model, same images", formatPercent(accuracy.float)],
    ["Chip agrees with float", formatPercent(accuracy.agreement)],
    ["Cycles per image, 2x2", formatInt(findMesh(meshes, "2x2").cyclesPerUnit)],
    ["Cycles per image, 1x1", formatInt(findMesh(meshes, "1x1").cyclesPerUnit)],
  ];
  return (
    <dl className="stat-grid" aria-label="CIFAR-10 on the chip">
      {stats.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
