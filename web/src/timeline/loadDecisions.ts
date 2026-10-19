import decisionsUrl from "../data/generated/decisions.json?url&no-inline";
import type { DecisionsFile } from "./decisionTypes";

/** Fetches the generated decision records. Like the replay data, it is a hashed asset and not part of the JS bundle. */
export async function loadDecisions(): Promise<DecisionsFile> {
  const response = await fetch(decisionsUrl);
  if (!response.ok) throw new Error(`${decisionsUrl}: HTTP ${response.status}`);
  return (await response.json()) as DecisionsFile;
}
