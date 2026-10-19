import type { RefObject } from "react";
import { useInView, useLazyData, type LazyStatus } from "../replay/hooks";
import type { DecisionRecord, DecisionsFile } from "./decisionTypes";

/** Loads the decision records once the element is within one screen of the viewport, and only then. */
export function useDecisions(
  ref: RefObject<Element | null>,
  load: () => Promise<DecisionsFile>,
): { status: LazyStatus; records: Record<string, DecisionRecord> | undefined } {
  const near = useInView(ref, "100% 0px");
  const { status, data } = useLazyData(load, near);
  return { status, records: data?.records };
}
