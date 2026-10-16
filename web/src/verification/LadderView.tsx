import { REPO_URL } from "../content/timeline";
import { ladderEvidence } from "./evidence";
import type { Ladder } from "./types";

const DOWN = "▼";

export function LadderView({ ladder }: { ladder: Ladder }) {
  return (
    <figure className="ladder">
      <h3>{ladder.title}</h3>
      <ol className="rungs">
        {ladder.rungs.map((rung, i) => (
          <li key={rung.id} className="rung">
            {i > 0 ? (
              <p className="rung-connector">
                {DOWN} {rung.bitExact ? "bit-exact against the rung above" : "compared by validation loss, not bit-exact"}
              </p>
            ) : null}
            <div className="rung-card">
              <h4>{rung.name}</h4>
              <p>{rung.proves}</p>
              <p className="rung-files">
                {rung.files.map((file, j) => (
                  <span key={file}>
                    {j > 0 ? ", " : ""}
                    <a href={`${REPO_URL}/blob/main/${file}`} target="_blank" rel="noopener noreferrer">
                      {file}
                    </a>
                  </span>
                ))}
              </p>
              {rung.command ? (
                <p className="rung-command">
                  <code>{rung.command.text}</code>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="counter-note">{ladderEvidence(ladder.id)}</figcaption>
    </figure>
  );
}
