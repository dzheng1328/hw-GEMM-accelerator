import { PHASES, TIMELINE } from "../content/timeline";
import { Section } from "../components/Section";
import { TimelineList } from "./TimelineList";
import type { Phase } from "./types";

const PHASE_ORDER: Phase[] = [1, 2, 3, 4];

export function BuiltSection() {
  return (
    <Section
      id="built"
      title="How it was built"
      headline={`${TIMELINE.length} milestones across four phases, from one systolic array to a chip that writes stories.`}
      drawer={{
        summary: "Go deeper",
        body: (
          <div>
            {PHASE_ORDER.map((phase) => (
              <div key={phase}>
                <h3 className="phase-heading">{PHASES[phase]}</h3>
                <TimelineList nodes={TIMELINE.filter((n) => n.phase === phase)} className="timeline timeline-all" />
              </div>
            ))}
          </div>
        ),
      }}
    >
      <TimelineList nodes={TIMELINE.filter((n) => n.headline)} className="timeline timeline-skim" />
    </Section>
  );
}
