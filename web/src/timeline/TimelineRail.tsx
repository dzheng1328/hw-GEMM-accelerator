import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { PHASES } from "../content/timeline";
import { formatDate } from "../format";
import { usePrefersReducedMotion } from "../replay/hooks";
import { keyTarget, phaseBands, railDate, type RailKey } from "./rail";
import type { TimelineNode } from "./types";

const KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "Home", "End"]);

export interface TimelineRailProps {
  /** the milestones shown, oldest first */
  nodes: TimelineNode[];
  selectedId: string;
  onSelect(id: string): void;
  /** how many milestones there are in all */
  total: number;
  /** omitted when every milestone is already shown */
  onShowAll?(): void;
}

export function TimelineRail({ nodes, selectedId, onSelect, total, onShowAll }: TimelineRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);
  const reduced = usePrefersReducedMotion();
  const bands = phaseBands(nodes);
  const style = { "--rail-n": nodes.length } as CSSProperties;

  // keep the selected dot in view by scrolling the rail itself, never the page
  useEffect(() => {
    const strip = scrollRef.current;
    const dot = strip?.querySelector<HTMLElement>(`[data-node="${selectedId}"]`);
    if (!strip || !dot || typeof strip.scrollTo !== "function") return;
    const left = dot.offsetLeft - (strip.clientWidth - dot.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: reduced ? "instant" : "smooth" });
  }, [selectedId, nodes.length, reduced]);

  // an arrow key changes the selection, and the focus follows it to the new dot
  useLayoutEffect(() => {
    if (focusAfter.current !== selectedId) return;
    focusAfter.current = null;
    scrollRef.current?.querySelector<HTMLElement>(`[data-node="${selectedId}"]`)?.focus({ preventScroll: true });
  }, [selectedId]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!KEYS.has(event.key)) return;
    event.preventDefault();
    const id = keyTarget(nodes, selectedId, event.key as RailKey);
    focusAfter.current = id;
    onSelect(id);
  };

  return (
    <div className="rail" role="group" aria-label="Milestones">
      <div className="rail-scroll" ref={scrollRef}>
        <div className="rail-bands" aria-hidden="true" style={style}>
          {bands.map((band) => (
            <span key={band.phase} className="rail-band" style={{ gridColumn: `${band.start} / span ${band.count}` }} title={PHASES[band.phase]}>
              Phase {band.phase}
            </span>
          ))}
        </div>
        <ol className="rail-dots" style={style} onKeyDown={onKeyDown}>
          {nodes.map((n) => {
            const selected = n.id === selectedId;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  data-node={n.id}
                  aria-pressed={selected}
                  aria-label={`${formatDate(n.date)}: ${n.title}`}
                  tabIndex={selected ? 0 : -1}
                  className={`rail-dot${selected ? " is-selected" : ""}${n.headline ? "" : " is-minor"}`}
                  onClick={() => onSelect(n.id)}
                >
                  <span className="rail-mark" aria-hidden="true" />
                  <span className="rail-date" aria-hidden="true">
                    {railDate(n.date)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="rail-foot">
        <span>
          {nodes.length} of {total} milestones
        </span>
        {onShowAll ? (
          <button type="button" className="rail-more" onClick={onShowAll}>
            Show all {total}
          </button>
        ) : null}
      </p>
    </div>
  );
}
