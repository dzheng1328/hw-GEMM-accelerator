import { memo } from "react";
import { formatPercent } from "../format";

const W = 256;
const H = 48;

export const AttentionSparkline = memo(function AttentionSparkline({ series, step }: { series: number[]; step: number }) {
  const n = series.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - v * H;
  const points = series.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const first = formatPercent(series[0] ?? 0, 0);
  const last = formatPercent(series[n - 1] ?? 0, 0);
  return (
    <figure className="sparkline-figure">
      <svg
        className="sparkline"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Attention's share of each step, from ${first} at step 0 to ${last} at step ${n - 1}. Now at step ${step}.`}
      >
        <polyline points={points} fill="none" stroke="var(--cat-attention)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <line x1={x(step)} x2={x(step)} y1={0} y2={H} stroke="var(--text)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="counter-note">
        Attention's share of each step's cycles: {first} at step 0, {last} at step {n - 1}.
      </figcaption>
    </figure>
  );
});
