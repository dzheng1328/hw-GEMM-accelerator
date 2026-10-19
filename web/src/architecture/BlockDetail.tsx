import { REPO_URL } from "../content/timeline";
import type { BlockLive } from "./blockStates";
import { KIND_LABEL, type Block, type NumberSource } from "./types";

function sourceNote(source: NumberSource): string {
  return "perf" in source
    ? "from performance.json, regenerated from docs/perf"
    : `from docs/decisions.md, ${source.decision.date}`;
}

export function BlockDetail({ block, live = null }: { block: Block; live?: BlockLive | null }) {
  return (
    <div className="arch-detail">
      <div aria-live="polite">
        <h3 className="arch-detail-title">{block.name}</h3>
        <p className="arch-kind">
          <span className="swatch" style={{ background: `var(--kind-${block.kind})` }} />
          {KIND_LABEL[block.kind]}
        </p>
        <p>{block.role}</p>
        <dl className="arch-facts">
          <div>
            <dt>RTL</dt>
            <dd>
              <ul>
                {block.rtl.map((file) => (
                  <li key={file}>
                    <a href={`${REPO_URL}/blob/main/${file}`} target="_blank" rel="noopener noreferrer">
                      {file}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>Tests</dt>
            <dd>
              <ul>
                {block.suites.map((suite) => (
                  <li key={suite.dir}>
                    <a href={`${REPO_URL}/tree/main/${suite.dir}`} target="_blank" rel="noopener noreferrer">
                      {suite.dir}
                    </a>
                    {suite.targets.map((target) => (
                      <code key={target}>make {target}</code>
                    ))}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>{block.number.label}</dt>
            <dd className="arch-number">
              {block.number.value}
              <span className="arch-source">{sourceNote(block.number.source)}</span>
            </dd>
          </div>
        </dl>
      </div>
      {live ? (
        <div className="arch-live-row">
          <h4>In this run</h4>
          <p>{live.detail}</p>
        </div>
      ) : null}
    </div>
  );
}
