import { memo } from "react";
import { formatInt, formatPercent } from "../format";
import { CATEGORIES, CATEGORY_LABELS, shareAt } from "./categories";
import type { StepRecord } from "./types";

export const CycleBar = memo(function CycleBar({ step }: { step: StepRecord }) {
  const share = shareAt(step);
  const summary = CATEGORIES.map((c) => `${CATEGORY_LABELS[c]} ${formatPercent(share[c], 1)}`).join(", ");
  return (
    <div>
      <div className="cycle-bar" role="img" aria-label={`Step ${step.step}: ${summary}`}>
        {CATEGORIES.map((c) => (
          <span key={c} style={{ width: `${share[c] * 100}%`, background: `var(--cat-${c})` }} />
        ))}
      </div>
      <ul className="legend">
        {CATEGORIES.map((c) => (
          <li key={c}>
            <span className="swatch" style={{ background: `var(--cat-${c})` }} />
            <span>{CATEGORY_LABELS[c]}</span>
            <span className="num">
              {formatInt(step[c])} / {formatPercent(share[c], 1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
});
