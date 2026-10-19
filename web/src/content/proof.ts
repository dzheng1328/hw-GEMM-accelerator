export type ProofKey = "stories" | "cycles" | "cifar" | "scaling";

export interface ProofTarget {
  id: string;
  /** a selector, inside the target, for the elements that flash; the target itself flashes when absent */
  flash?: string;
}

/** The evidence each hero number links to. A tile's claim is only as good as the element its link lands on. */
export const PROOF: Record<ProofKey, ProofTarget> = {
  stories: { id: "proof-stories" },
  cycles: { id: "proof-cycles" },
  cifar: { id: "proof-cifar" },
  scaling: { id: "proof-scaling", flash: 'rect.bar[data-mesh="2x2"], rect.bar[data-mesh="4x4"]' },
};

export const PROOF_IDS: readonly string[] = Object.values(PROOF).map((target) => target.id);

export function proofTarget(id: string): ProofTarget | undefined {
  return Object.values(PROOF).find((target) => target.id === id);
}

/** The attributes a proof target carries: findable by id, focusable by a jump, never a tab stop. */
export function proofAttrs(key: ProofKey): { id: string; tabIndex: number; "data-proof": string } {
  return { id: PROOF[key].id, tabIndex: -1, "data-proof": "" };
}
