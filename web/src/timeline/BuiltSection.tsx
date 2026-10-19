import { useContext, useRef, useState } from "react";
import { DeepContext } from "../components/deepContext";
import { Section } from "../components/Section";
import { TIMELINE } from "../content/timeline";
import type { DecisionsFile } from "./decisionTypes";
import { loadDecisions } from "./loadDecisions";
import { defaultNodeId, railNodes, resolveSelected, stepTarget } from "./rail";
import { TimelinePanel } from "./TimelinePanel";
import { TimelineRail } from "./TimelineRail";
import { useDecisions } from "./useDecisions";

export interface BuiltSectionProps {
  loadData?: () => Promise<DecisionsFile>;
}

export function BuiltSection({ loadData = loadDecisions }: BuiltSectionProps) {
  const deep = useContext(DeepContext);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState(() => defaultNodeId(TIMELINE));
  const ref = useRef<HTMLDivElement>(null);
  const { status, records } = useDecisions(ref, loadData);

  const all = deep || showAll;
  const nodes = railNodes(TIMELINE, all);
  const id = resolveSelected(nodes, TIMELINE, selected);
  // a selection the rail cannot show (Deep mode went off) is replaced by the one on screen, so it does not come back later
  if (id !== selected) setSelected(id);
  const node = TIMELINE.find((n) => n.id === id)!;
  const prev = stepTarget(nodes, id, -1);
  const next = stepTarget(nodes, id, 1);

  return (
    <Section
      id="built"
      title="How it was built"
      headline={`${TIMELINE.length} milestones across four phases, from one systolic array to a chip that writes stories.`}
    >
      <div className="tl" ref={ref}>
        <TimelineRail
          nodes={nodes}
          selectedId={id}
          onSelect={setSelected}
          total={TIMELINE.length}
          onShowAll={all ? undefined : () => setShowAll(true)}
        />
        <TimelinePanel
          node={node}
          status={status}
          record={records?.[id]}
          deep={deep}
          hasPrev={prev !== null}
          hasNext={next !== null}
          onStep={(delta) => {
            const target = delta === -1 ? prev : next;
            if (target) setSelected(target);
          }}
        />
      </div>
    </Section>
  );
}
