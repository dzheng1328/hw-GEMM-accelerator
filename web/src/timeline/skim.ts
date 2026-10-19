import type { DecisionSection } from "./decisionTypes";

/**
 * What the skim layer shows of a decision record: the choice and what came of it. Entries are not uniform (some have no
 * Decision, some no Result), so when neither exists the first section after Context stands in.
 */
export function skimSections(sections: DecisionSection[]): DecisionSection[] {
  const picked = sections.filter((section) => section.label === "Decision" || section.label === "Result");
  if (picked.length > 0) return picked;
  const next = sections.find((section) => section.label !== null && section.label !== "Context");
  return next ? [next] : [];
}
