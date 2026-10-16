import { REPO_URL } from "../content/timeline";
import { formatDate } from "../format";
import type { Limit } from "./types";

export function LimitsList({ limits }: { limits: Limit[] }) {
  return (
    <ul className="limits">
      {limits.map((limit) => {
        const source = limit.source;
        const href = "decision" in source ? `${REPO_URL}/blob/main/docs/decisions.md` : `${REPO_URL}/blob/main/${source.file}`;
        const label = "decision" in source ? `decisions.md, ${formatDate(source.decision.date)}` : source.file;
        return (
          <li key={limit.id}>
            {limit.text}
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
