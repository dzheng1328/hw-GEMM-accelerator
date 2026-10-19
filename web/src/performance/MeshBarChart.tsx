import { memo } from "react";
import { proofAttrs, type ProofKey } from "../content/proof";
import type { Bar } from "./derive";

const W = 320;
const H = 200;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 22;
const PAD_B = 22;

export interface MeshBarChartProps {
  title: string;
  bars: Bar[];
  selected: string;
  /** The value at the top of the plot. */
  max: number;
  format(value: number): string;
  referenceLabel: string;
  /** when given, a transparent button over each bar's slot chooses that mesh */
  onSelect?(mesh: string): void;
  /** marks the figure as the target of a hero tile link */
  proofKey?: ProofKey;
}

export const MeshBarChart = memo(function MeshBarChart({ title, bars, selected, max, format, referenceLabel, onSelect, proofKey }: MeshBarChartProps) {
  const n = bars.length;
  const slot = (W - PAD_L - PAD_R) / n;
  const barWidth = slot * 0.55;
  const plotH = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH * (1 - Math.min(v, max) / max);
  const cx = (i: number) => PAD_L + slot * i + slot / 2;
  const label =
    `${title}: ${bars.map((b) => `${b.mesh} ${format(b.value)}`).join(", ")}. ` +
    `Reference, ${referenceLabel}: ${bars.map((b) => format(b.reference)).join(", ")}.`;

  return (
    <figure className="chart-figure" {...(proofKey ? proofAttrs(proofKey) : {})}>
      <h3>{title}</h3>
      <div className="bar-chart-wrap">
        <svg className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
          {bars.map((b, i) => (
            <rect
              key={b.mesh}
              className={b.mesh === selected ? "bar bar-selected" : "bar"}
              data-mesh={b.mesh}
              x={cx(i) - barWidth / 2}
              y={y(b.value)}
              width={barWidth}
              height={H - PAD_B - y(b.value)}
            />
          ))}
          <polyline className="ref-line" points={bars.map((b, i) => `${cx(i).toFixed(1)},${y(b.reference).toFixed(1)}`).join(" ")} />
          {bars.map((b, i) => (
            <g key={b.mesh}>
              <text className="bar-label" x={cx(i)} y={y(b.value) - 4}>
                {format(b.value)}
              </text>
              <text className="bar-mesh" x={cx(i)} y={H - 8}>
                {b.mesh}
              </text>
            </g>
          ))}
        </svg>
        {onSelect ? (
          <div className="bar-hits">
            {bars.map((b, i) => (
              <button
                key={b.mesh}
                type="button"
                aria-pressed={b.mesh === selected}
                aria-label={`Select ${b.mesh} - ${title}`}
                style={{ left: `${((PAD_L + slot * i) / W) * 100}%`, width: `${(slot / W) * 100}%` }}
                onClick={() => onSelect(b.mesh)}
              />
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="counter-note">Dashed line: {referenceLabel}.</figcaption>
    </figure>
  );
});
