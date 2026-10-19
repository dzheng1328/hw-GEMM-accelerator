import { describe, expect, it } from "vitest";
import { PROOF, PROOF_IDS, proofAttrs, proofTarget } from "./proof";

describe("proof targets", () => {
  it("names four unique ids that start with proof-", () => {
    expect(PROOF_IDS).toHaveLength(4);
    expect(new Set(PROOF_IDS).size).toBe(4);
    for (const id of PROOF_IDS) expect(id).toMatch(/^proof-[a-z]+$/);
  });

  it("finds a target by id and nothing for any other id", () => {
    expect(proofTarget("proof-cifar")).toBe(PROOF.cifar);
    expect(proofTarget("performance")).toBeUndefined();
    expect(proofTarget("")).toBeUndefined();
  });

  it("makes an element findable and focusable but not part of the tab order", () => {
    expect(proofAttrs("cifar")).toEqual({ id: "proof-cifar", tabIndex: -1, "data-proof": "" });
  });

  it("flashes the bars, not the figure, for the scaling target, and the target itself for the others", () => {
    expect(PROOF.scaling.flash).toBe('rect.bar[data-mesh="2x2"], rect.bar[data-mesh="4x4"]');
    expect(PROOF.stories.flash).toBeUndefined();
    expect(PROOF.cycles.flash).toBeUndefined();
    expect(PROOF.cifar.flash).toBeUndefined();
  });
});
