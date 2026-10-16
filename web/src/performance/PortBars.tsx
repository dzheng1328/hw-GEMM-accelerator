import { memo } from "react";
import { formatInt, formatPercent } from "../format";
import { portSegments } from "./derive";
import type { MeshPerf } from "./types";

export interface PortRow {
  label: string;
  port: MeshPerf["port"];
  waitLabel: string;
}

export const PortBars = memo(function PortBars({ rows }: { rows: PortRow[] }) {
  return (
    <div className="port-rows">
      {rows.map((row) => {
        const segments = portSegments(row.port, row.waitLabel);
        return (
          <div key={row.label} className="port-row">
            <h3>{row.label}</h3>
            <div className="port-bar" role="img" aria-label={`${row.label}: ${segments.map((s) => `${s.label} ${formatPercent(s.share, 1)}`).join(", ")}`}>
              {segments.map((s) => (
                <span key={s.key} style={{ width: `${(s.share * 100).toFixed(2)}%`, background: `var(--port-${s.key})` }} />
              ))}
            </div>
            <ul className="port-legend">
              {segments.map((s) => (
                <li key={s.key}>
                  <span className="swatch" style={{ background: `var(--port-${s.key})` }} />
                  <span>{s.label}</span>
                  <span className="num">
                    {formatInt(s.cycles)} / {formatPercent(s.share, 1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
});
