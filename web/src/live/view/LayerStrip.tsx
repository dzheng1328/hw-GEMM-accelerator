import { formatInt } from "../../format";
import type { LayerRange } from "../sim/types";
import type { LayerSpan } from "../trace/layers";

/** The layer being worked on after `cycle` cycles: the one holding the last completed cycle. */
export function layerAtCycle(spans: LayerSpan[], cycle: number): number {
  const last = spans[spans.length - 1]!.end - 1;
  const c = Math.max(0, Math.min(cycle > 0 ? cycle - 1 : 0, last));
  for (let i = 0; i < spans.length; i++) if (c < spans[i]!.end) return i;
  return spans.length - 1;
}

export interface LayerStripProps {
  layers: LayerRange[];
  spans: LayerSpan[];
  cycle: number;
  total: number;
}

export function LayerStrip({ layers, spans, cycle, total }: LayerStripProps) {
  const current = layerAtCycle(spans, cycle);
  return (
    <div className="live-layer-block">
      <ol className="live-layers" aria-label="Network layers, widths proportional to their cycles">
        {layers.map((layer, i) => (
          <li
            key={layer.name}
            className={i === current ? "current" : undefined}
            aria-current={i === current ? "step" : undefined}
            style={{ flexGrow: Math.max(1, spans[i]!.end - spans[i]!.start) }}
          >
            {layer.name}
          </li>
        ))}
      </ol>
      <p className="live-cycle">
        <span className="live-cycle-current">{formatInt(cycle)}</span> <small>of</small>{" "}
        <span className="live-cycle-total">{formatInt(total)}</span> <small>cycles</small>
      </p>
    </div>
  );
}
