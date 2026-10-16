import type { Stage } from "./types";

export function Stepper({
  stages,
  selected,
  onSelect,
  note,
}: {
  stages: Stage[];
  /** The selected block's id; the current step is the stage that names it, or none. */
  selected: string;
  onSelect(blockId: string): void;
  note: string;
}) {
  const index = stages.findIndex((stage) => stage.block === selected);
  const go = (i: number) => onSelect(stages[i]!.block);

  return (
    <div className="arch-stepper">
      <div className="arch-stepper-nav">
        <button type="button" disabled={index <= 0} onClick={() => go(index - 1)}>
          Previous
        </button>
        <button type="button" disabled={index === stages.length - 1} onClick={() => go(index + 1)}>
          Next
        </button>
      </div>
      <ol>
        {stages.map((stage, i) => (
          <li key={stage.block}>
            <button type="button" aria-current={i === index ? "step" : undefined} onClick={() => onSelect(stage.block)}>
              <span className="stage-n">{i + 1}</span>
              <span className="stage-title">{stage.title}</span>
              <span className="stage-text">{stage.text}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="counter-note">{note}</p>
    </div>
  );
}
