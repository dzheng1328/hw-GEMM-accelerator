import { formatInt } from "../../format";

export interface LogitsProps {
  /** 16 output cells; the first classNames.length are the classes */
  logits: ArrayLike<number> | null;
  classNames: string[];
  /** the bars and numbers appear once the run has ended */
  revealed: boolean;
}

export function Logits({ logits, classNames, revealed }: LogitsProps) {
  const values = logits ? classNames.map((_, c) => logits[c]!) : null;
  const shown = revealed && values !== null;
  let best = -1;
  let min = 0;
  let max = 0;
  if (shown) {
    best = 0;
    for (let c = 1; c < values.length; c++) if (values[c]! > values[best]!) best = c;
    min = Math.min(...values);
    max = Math.max(...values);
  }
  return (
    <ol className="live-logits" aria-label="Class scores (logits)">
      {classNames.map((name, c) => {
        const winner = shown && c === best;
        const width = shown && max > min ? ((values[c]! - min) / (max - min)) * 100 : 0;
        return (
          <li key={name} className={winner ? "winner" : undefined} aria-current={winner ? "true" : undefined}>
            <span className="logit-name">{name}</span>
            <span className="logit-bar" aria-hidden="true">
              <span style={{ width: `${width}%` }} />
            </span>
            <span className="logit-value">{shown ? formatInt(values[c]!) : "-"}</span>
            {winner ? <span className="sr-only"> (predicted)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
