import { memo } from "react";
import type { LaneState } from "./tokens";

export const Lane = memo(function Lane({ index, lane }: { index: number; lane: LaneState }) {
  return (
    <article className="lane" aria-label={`Story ${index + 1}`}>
      <h3>Story {index + 1}</h3>
      <p className="lane-text">
        {lane.chips
          .filter((chip) => chip.text !== "")
          .map((chip) => (
            <span key={chip.index} className={chip.kind === "prompt" ? "tok-prompt" : undefined}>
              {chip.text}
            </span>
          ))}
      </p>
      {lane.endedAtStep !== null ? <p className="lane-ended">Ended at step {lane.endedAtStep}</p> : null}
    </article>
  );
});
