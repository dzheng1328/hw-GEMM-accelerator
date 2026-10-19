import { Section } from "../components/Section";
import { CLAIM, LADDERS, LAYERS, LIMITS, REPRODUCE, SUITES } from "../content/verification";
import { LadderView } from "./LadderView";
import { LimitsList } from "./LimitsList";
import { SuiteTable } from "./SuiteTable";

export function VerificationSection() {
  return (
    <Section
      id="verification"
      title="Why you can believe it"
      headline="Model, integer reference, golden executor and RTL agree bit for bit, and here is what that does and does not cover."
      drawer={{
        summary: "Go deeper",
        body: (
          <div>
            <SuiteTable suites={SUITES} layers={LAYERS} />
            <h3>Reproduce it</h3>
            <ul className="reproduce">
              {REPRODUCE.map((r) => (
                <li key={r.command.text}>
                  <code>{r.command.text}</code> {r.says}
                </li>
              ))}
            </ul>
          </div>
        ),
      }}
    >
      <div className="ladder-grid">
        {LADDERS.map((ladder) => (
          <LadderView key={ladder.id} ladder={ladder} proofKey={ladder.id === "lm" ? "stories" : undefined} />
        ))}
      </div>
      <p className="claim">{CLAIM.text}</p>
      <h3>What this is not</h3>
      <LimitsList limits={LIMITS} />
    </Section>
  );
}
