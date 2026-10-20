import { useMemo, useRef } from "react";
import { Sheet } from "../components/Sheet";
import { formatInt } from "../format";
import { sheetSlide, strokeWipe } from "../motion/primitives";
import { useMotion } from "../motion/useMotion";
import { useInView, useLazyData } from "../replay/hooks";
import { loadLmSteps } from "../replay/loadReplayData";
import { RibbonHead, RibbonSource, RibbonTableRoom } from "./RibbonChrome";
import { gridValues, KIND_LABELS, KINDS, noteX, ribbonData, total, VIEW, type RibbonData } from "./ribbonGeometry";

/**
 * Cycles per step across the whole story run, one stroke per step, drawn on a washi sheet. The plot holds only data;
 * the two totals sit under its two ends of the axis, with a note between them, and each kind of work is labelled at the
 * right edge with its first and last value.
 */
export function StrokeRibbon() {
  const sheet = useRef<HTMLElement>(null);
  const near = useInView(sheet, "100% 0px");
  const { status, data } = useLazyData(loadLmSteps, near);
  useMotion(sheet, (g, el) => sheetSlide(g, el as HTMLElement));

  const computed = useMemo(() => (data && data.length > 0 ? ribbonData(data) : null), [data]);

  // data that arrived empty is as unusable as data that failed to load; it must not read as "still loading"
  const failed = status === "error" || (status === "ready" && !computed);

  return (
    <Sheet as="figure" className="ribbon" ref={sheet}>
      <RibbonHead />
      {/* the frame reserves the plot's height before the data arrives, so nothing below it moves */}
      <div className="ribbon-frame" role="region" aria-label="Cycles per step chart. On a small screen it scrolls sideways." tabIndex={0}>
        {computed ? <Plot c={computed} /> : null}
        {failed ? (
          <p className="replay-error" role="alert">
            The per-step data could not be loaded. Reload to try again.
          </p>
        ) : null}
        {!computed && !failed ? <p className="replay-loading">Loading the per-step numbers...</p> : null}
      </div>
      {computed ? (
        <details className="ribbon-table">
          <summary>See the numbers</summary>
          <div className="ribbon-table-scroll" role="region" aria-label="Cycles per step, as numbers. On a small screen it scrolls sideways." tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Step</th>
                {KINDS.map((k) => (
                  <th scope="col" key={k}>
                    {KIND_LABELS[k]}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {computed.rows.map((r) => (
                <tr key={r.step}>
                  <th scope="row">{r.step}</th>
                  {KINDS.map((k) => (
                    <td key={k}>{formatInt(r[k])}</td>
                  ))}
                  <td>{formatInt(total(r))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </details>
      ) : (
        <RibbonTableRoom />
      )}
      <RibbonSource />
    </Sheet>
  );
}

function Plot({ c }: { c: RibbonData }) {
  const group = useRef<SVGGElement>(null);
  useMotion(group, (g, el) => strokeWipe(g, el));
  const { layout, labels, facts } = c;
  const underY = layout.y0 + 20;
  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      role="img"
      aria-label="Cycles per step across the story run, one stroke per step, split into weights, attention, vector unit and other. The numbers are in the table below."
      className="ribbon-svg"
    >
      {gridValues(layout.max).map((v) => {
        const y = layout.y0 - ((layout.y0 - layout.y1) * v) / layout.max;
        return (
          <g key={v}>
            <line x1={layout.x0} x2={layout.x1} y1={y} y2={y} className="grid" />
            <text x={layout.x0 - 8} y={y + 4} textAnchor="end" className="tick">
              {v === 0 ? "0" : `${v / 1000}k`}
            </text>
          </g>
        );
      })}
      <g ref={group}>
        {c.strokes.map((s, i) => (
          <g key={i}>
            {s.segments.map((seg) => (
              <rect key={seg.kind} className="seg" data-kind={seg.kind} x={s.x} y={seg.y} width={s.width} height={Math.max(seg.height, 0.35)} />
            ))}
          </g>
        ))}
      </g>
      <line x1={layout.x0} x2={layout.x1} y1={layout.y0 + 1} y2={layout.y0 + 1} className="lead" />
      <text x={layout.x0} y={underY} className="tick">
        step 0
      </text>
      <text x={layout.x1} y={underY} textAnchor="end" className="tick">
        step 255
      </text>

      <text x={layout.x0} y={underY + 74} className="figure-text" data-pair="first">
        {formatInt(facts.firstTotal)}
      </text>
      <text x={layout.x0 + 2} y={underY + 96} className="caption" data-pair="first">
        cycles for the first step
      </text>
      <text x={layout.x1} y={underY + 74} textAnchor="end" className="figure-text" data-pair="last">
        {formatInt(facts.lastTotal)}
      </text>
      <text x={layout.x1} y={underY + 96} textAnchor="end" className="caption" data-pair="last">
        cycles for the last step
      </text>
      <text x={noteX(facts.firstTotal, layout)} y={underY + 48} className="note strong" data-pair="note">
        {facts.weightsConstant ? "Weights cost the same every step." : "Weights change from step to step."}
      </text>
      <text x={noteX(facts.firstTotal, layout)} y={underY + 66} className="note" data-pair="note">
        {`Attention grows ${Math.round(facts.attentionRatio)}x as the`}
      </text>
      <text x={noteX(facts.firstTotal, layout)} y={underY + 84} className="note" data-pair="note">
        story gets longer.
      </text>

      {labels.map((l) => (
        <g key={l.kind}>
          <path d={`M${layout.x1 + 4} ${l.anchorY}L${layout.x1 + 30} ${l.labelY}`} className="lead" />
          <rect x={layout.x1 + 36} y={l.labelY - 13} width={10} height={10} className="swatch" data-kind={l.kind} />
          <text x={layout.x1 + 52} y={l.labelY - 3} className="label" data-pair={`label-${l.kind}`}>
            {KIND_LABELS[l.kind]}
          </text>
          <text x={layout.x1 + 52} y={l.labelY + 15} className="tick" data-pair={`label-${l.kind}`}>
            {l.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
