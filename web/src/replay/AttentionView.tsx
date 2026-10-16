import { Fragment, memo, useState } from "react";
import { headWeights, layerHeadSummary, normalizeForOverlay } from "./attention";
import { overlayChips } from "./tokens";
import type { ReplayData } from "./types";

interface Selection {
  layer: number;
  head: number;
}

function areaPoints(weights: number[]): string {
  const norm = normalizeForOverlay(weights);
  const n = norm.length;
  const points = norm.map((v, i) => `${n === 1 ? 50 : (i / (n - 1)) * 100},${(24 - v * 24).toFixed(2)}`);
  return `0,24 ${points.join(" ")} 100,24`;
}

/** The two channels of an overlay chip for a strength in 0..1: a tint capped at 45% (so text keeps AA contrast) and an underline from 0 to 3 px. */
export function overlayStyle(strength: number): { background: string; boxShadow: string } {
  return {
    background: `color-mix(in srgb, var(--cat-attention) ${Math.round(strength * 45)}%, transparent)`,
    boxShadow: `inset 0 -${(3 * strength).toFixed(1)}px 0 var(--cat-attention)`,
  };
}

export const AttentionView = memo(function AttentionView({ data, step }: { data: ReplayData; step: number }) {
  const [selected, setSelected] = useState<Selection>({ layer: 0, head: 0 });
  const peaks = layerHeadSummary(data.probs, step);
  const heads = peaks[0]?.length ?? 0;
  const weights = headWeights(data.probs, step, selected.layer, selected.head);
  const norm = normalizeForOverlay(weights);
  const chips = overlayChips(data.stories[0]!, data.vocab, data.promptLength, step);
  const peak = peaks[selected.layer]![selected.head]!;
  const peakChip = chips[peak];
  const peakText = peakChip ? (peakChip.id === data.vocab.bos ? "BOS" : peakChip.text.trim() || "(no text)") : "";

  return (
    <div className="attn">
      <p className="attn-note">
        Story 0 only. The weights are integers from 0 to 127 taken from model/lm_reference.py, which is bit-exact with
        the RTL by the verification ladder. Pick a head to paint its weights over the story.
      </p>
      <div
        className="head-grid"
        role="group"
        aria-label="Attention heads"
        style={{ gridTemplateColumns: `2rem repeat(${heads}, minmax(0, 1fr))` }}
      >
        <span />
        {Array.from({ length: heads }, (_, h) => (
          <span key={h} className="head-label">
            H{h + 1}
          </span>
        ))}
        {peaks.map((row, l) => (
          <Fragment key={l}>
            <span className="head-label">L{l + 1}</span>
            {row.map((p, h) => (
              <button
                key={h}
                type="button"
                className="head-cell"
                aria-pressed={selected.layer === l && selected.head === h}
                aria-label={`Layer ${l + 1}, head ${h + 1}: strongest at position ${p}`}
                onClick={() => setSelected({ layer: l, head: h })}
              >
                <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                  <polygon className="area" points={areaPoints(headWeights(data.probs, step, l, h))} />
                </svg>
                <span className="peak">@{p}</span>
              </button>
            ))}
          </Fragment>
        ))}
      </div>
      <p className="overlay-caption">
        Layer {selected.layer + 1}, head {selected.head + 1} at step {step}: strongest at position {peak}
        {peakText ? ` (${peakText})` : ""}.
      </p>
      <p className="overlay">
        {chips.map((chip, i) => {
          const isBos = chip.id === data.vocab.bos;
          const a = norm[i] ?? 0;
          return (
            <span
              key={chip.index}
              className={isBos ? "otok otok-bos" : "otok"}
              title={`position ${i}: weight ${(weights[i] ?? 0).toFixed(3)}`}
              data-strength={a.toFixed(2)}
              style={overlayStyle(a)}
            >
              {isBos ? "BOS" : chip.text === "" ? "·" : chip.text}
            </span>
          );
        })}
      </p>
    </div>
  );
});
