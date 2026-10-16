import { REPO_URL } from "../content/timeline";
import { formatDate } from "../format";
import type { TimelineNode } from "./types";

export function TimelineList({ nodes, className }: { nodes: TimelineNode[]; className: string }) {
  return (
    <ol className={className}>
      {nodes.map((n) => (
        <li key={n.id}>
          <time className="t-date" dateTime={n.date}>
            {formatDate(n.date)}
          </time>
          <h3 className="t-title">{n.title}</h3>
          <p className="t-summary">{n.summary}</p>
          {n.metric ? (
            <span className="t-metric">
              {n.metric.label}: {n.metric.before ? `${n.metric.before} \u2192 ` : ""}
              {n.metric.after}
            </span>
          ) : null}
          <p className="t-prs">
            {n.prs.map((pr) => (
              <a key={pr} href={`${REPO_URL}/pull/${pr}`} target="_blank" rel="noopener noreferrer">
                #{pr}
              </a>
            ))}
          </p>
        </li>
      ))}
    </ol>
  );
}
