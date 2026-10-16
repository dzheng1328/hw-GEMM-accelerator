import type { ReplayData, StepRecord, VocabFile } from "./types";

/** A tiny, fully specified run for component tests: 6 steps, 2 stories, 2 layers x 2 heads. */
export function fixtureData(): ReplayData {
  const vocab: VocabFile = {
    bos: 1,
    eos: 2,
    pieces: ["<unk>", "<s>", "</s>", "<0xE2>", "<0x82>", "<0xAC>", "▁Hi", "▁there", "<0x0A>", "!"],
  };
  const cycles = [100, 100, 100, 200, 200, 300];
  const steps: StepRecord[] = cycles.map((c, step) => {
    const weights = Math.round(c * 0.4);
    const attention = Math.round(c * 0.3);
    const vpu = Math.round(c * 0.2);
    return { step, cycles: c, weights, attention, vpu, other: c - weights - attention - vpu, tileBusy: [c] };
  });
  const probs = steps.map((_, step) =>
    [0, 1].map((layer) =>
      [0, 1].map((head) =>
        Array.from({ length: step + 1 }, (_, i) => ((layer * 3 + head * 2 + i * 7) % 5) * 20 + (i === step ? 7 : 0)),
      ),
    ),
  );
  return {
    steps,
    stories: [
      { tokens: [1, 6, 7, 9, 7, 9, 7], text: "Hi there! there! there", endStep: null },
      { tokens: [1, 6, 7, 1, 6, 7, 9], text: "Hi there", endStep: 2 },
    ],
    promptLength: 3,
    vocab,
    probs,
  };
}
