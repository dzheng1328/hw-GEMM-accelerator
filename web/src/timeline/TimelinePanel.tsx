import { useRef, useState } from "react";
import { PHASES, REPO_URL } from "../content/timeline";
import { formatDate } from "../format";
import type { LazyStatus } from "../replay/hooks";
import type { DecisionRecord, DecisionSection } from "./decisionTypes";
import { Inlines, MiniMarkdown } from "./MiniMarkdown";
import { skimSections } from "./skim";
import type { TimelineNode } from "./types";
import { useClipped } from "./useClipped";

const DECISIONS_URL = `${REPO_URL}/blob/main/docs/decisions.md`;

function SectionTitle({ section }: { section: DecisionSection }) {
  if (section.label === null) return null;
  return (
    <h4 className="tl-label">
      {section.label}
      {section.note ? <span className="tl-note"> - {section.note}</span> : null}
    </h4>
  );
}

/** One skim section, cut off at a fixed height with a fade; the whole text is always in the full record below. */
function SkimBlock({ section, onReadOn }: { section: DecisionSection; onReadOn: (() => void) | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const clipped = useClipped(ref);
  return (
    <div className="tl-skim">
      <SectionTitle section={section} />
      <div ref={ref} className={`tl-clip${clipped ? " is-clipped" : ""}`}>
        <MiniMarkdown source={section.body} />
      </div>
      {clipped && onReadOn ? (
        <button type="button" className="tl-more" onClick={onReadOn}>
          Read the full record
        </button>
      ) : null}
    </div>
  );
}

/** Shown instead of the record: while it loads (a fetch that stalls never fails) and when it cannot be shown. */
function Fallback({ status, date }: { status: LazyStatus; date: string }) {
  const failed = status === "error" || status === "ready";
  return (
    <p className="tl-msg">
      {failed ? "The decision record could not be shown here." : "Loading the decision record..."} It is the {date} entry in{" "}
      <a href={DECISIONS_URL} target="_blank" rel="noopener noreferrer">
        docs/decisions.md on GitHub
      </a>
      .
    </p>
  );
}

export interface TimelinePanelProps {
  node: TimelineNode;
  status: LazyStatus;
  record: DecisionRecord | undefined;
  deep: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onStep(delta: -1 | 1): void;
}

export function TimelinePanel({ node, status, record, deep, hasPrev, hasNext, onStep }: TimelinePanelProps) {
  // the visitor's own choice for the full record (null: follow Deep mode); it ends when the milestone or Deep mode changes,
  // so stepping through milestones never changes the panel height and Deep mode always starts with the record open
  const [choice, setChoice] = useState<boolean | null>(null);
  const [choiceFor, setChoiceFor] = useState(`${node.id}|${deep}`);
  if (choiceFor !== `${node.id}|${deep}`) {
    setChoiceFor(`${node.id}|${deep}`);
    setChoice(null);
  }
  const open = choice ?? deep;
  const skim = record ? skimSections(record.sections) : [];

  return (
    <article className="tl-panel" aria-label="Milestone detail">
      <div className="tl-body" aria-live="polite">
        <div className="tl-facts">
          <p className="tl-meta">
            <time dateTime={node.date}>{formatDate(node.date)}</time>
            <span className="tl-phase">{PHASES[node.phase]}</span>
          </p>
          <h3 className="tl-title">{node.title}</h3>
          <p className="tl-summary">{node.summary}</p>
          {node.metric ? (
            <p className="tl-metric">
              {node.metric.label}: {node.metric.before ? `${node.metric.before} \u2192 ` : ""}
              {node.metric.after}
            </p>
          ) : null}
          <p className="tl-prs">
            {node.prs.map((pr) => (
              <a key={pr} href={`${REPO_URL}/pull/${pr}`} target="_blank" rel="noopener noreferrer">
                #{pr}
              </a>
            ))}
          </p>
        </div>
        <div className="tl-skims">
          {record ? (
            skim.map((section) => (
              // once the full record is open, there is nothing left to read on to
              <SkimBlock key={`${node.id}-${section.label}`} section={section} onReadOn={open ? null : () => setChoice(true)} />
            ))
          ) : (
            <Fallback status={status} date={node.decision.date} />
          )}
        </div>
      </div>
      {record ? (
        <details
          className="tl-record"
          open={open}
          // the browser can open the element itself (find-in-page does), and the state must follow or the next click does nothing
          onToggle={(event) => {
            if (event.currentTarget.open !== open) setChoice(event.currentTarget.open);
          }}
        >
          <summary
            onClick={(event) => {
              event.preventDefault();
              setChoice(!open);
            }}
          >
            Context and options
          </summary>
          <div className="tl-record-body">
            <p className="tl-source">
              From{" "}
              <a href={DECISIONS_URL} target="_blank" rel="noopener noreferrer">
                docs/decisions.md
              </a>
              : <Inlines text={record.heading} />
            </p>
            {record.sections.map((section, i) => (
              <section key={i} className="tl-sec">
                <SectionTitle section={section} />
                <MiniMarkdown source={section.body} />
              </section>
            ))}
          </div>
        </details>
      ) : null}
      <div className="tl-steps">
        <button type="button" disabled={!hasPrev} onClick={() => onStep(-1)}>
          Previous milestone
        </button>
        <button type="button" disabled={!hasNext} onClick={() => onStep(1)}>
          Next milestone
        </button>
      </div>
    </article>
  );
}
