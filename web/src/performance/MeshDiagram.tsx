import { formatPercent } from "../format";
import { tilePosition, tileShade } from "./derive";
import type { MeshPerf } from "./types";

const TILE = 56;
const GAP = 8;
const PAD = 8;
const LABEL_H = 14;
const PORT_H = 10;
const LINK_H = 10;
const MAX_TINT = 0.45;

export function MeshDiagram({ mesh }: { mesh: MeshPerf }) {
  const gridW = mesh.width * TILE + (mesh.width - 1) * GAP;
  const gridH = mesh.height * TILE + (mesh.height - 1) * GAP;
  const top = PAD + LABEL_H + PORT_H + LINK_H;
  const width = gridW + 2 * PAD;
  const height = top + gridH + PAD;
  const label =
    `${mesh.mesh} mesh: the injection port at node (0,0) is ${formatPercent(mesh.cornerBusy, 1)} busy. ` +
    `Tile utilization, node by node: ${mesh.tileUtilization.map((u) => formatPercent(u, 1)).join(", ")}.`;

  return (
    <figure className="mesh-figure">
      <svg className="mesh-diagram" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <text className="port-text" x={PAD} y={PAD + 10}>
          Injection port: {formatPercent(mesh.cornerBusy, 1)} busy
        </text>
        <rect className="port-track" x={PAD} y={PAD + LABEL_H} width={gridW} height={PORT_H} rx={4} />
        <rect className="port-fill" x={PAD} y={PAD + LABEL_H} width={gridW * mesh.cornerBusy} height={PORT_H} rx={4} />
        <line className="port-link" x1={PAD + TILE / 2} x2={PAD + TILE / 2} y1={PAD + LABEL_H + PORT_H} y2={top} />
        {mesh.tileUtilization.map((utilization, index) => {
          const { x, y } = tilePosition(index, mesh.width);
          const px = PAD + x * (TILE + GAP);
          const py = top + y * (TILE + GAP);
          return (
            <g key={index} className="mesh-tile" data-index={index} data-x={x} data-y={y}>
              <rect className="tile-bg" x={px} y={py} width={TILE} height={TILE} rx={6} />
              <rect
                className="tile-fill"
                x={px}
                y={py}
                width={TILE}
                height={TILE}
                rx={6}
                fillOpacity={tileShade(utilization) * MAX_TINT}
              />
              <text className="tile-text" x={px + TILE / 2} y={py + TILE / 2 + 4}>
                {formatPercent(utilization, 0)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="counter-note">
        Each tile is shaded by its MAC utilization: the share of cycles it was fed a 64-MAC slot.
      </figcaption>
    </figure>
  );
}
