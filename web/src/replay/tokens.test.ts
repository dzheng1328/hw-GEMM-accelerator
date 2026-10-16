import { describe, expect, it } from "vitest";
import { chipsFor, laneAt, overlayChips } from "./tokens";
import type { VocabFile } from "./types";

// ids: 0 unk, 1 BOS, 2 EOS, 3 0xE2, 4 0x82, 5 0xAC (together the euro sign), 6 " Hi", 7 " there", 8 newline, 9 "!"
const vocab: VocabFile = {
  bos: 1,
  eos: 2,
  pieces: ["<unk>", "<s>", "</s>", "<0xE2>", "<0x82>", "<0xAC>", "▁Hi", "▁there", "<0x0A>", "!"],
};
const text = (chips: { text: string }[]) => chips.map((c) => c.text).join("");

describe("laneAt", () => {
  const story = { tokens: [1, 6, 7, 9, 7, 9, 7] };

  it("has emitted token s + 1 at step s", () => {
    expect(laneAt(story, vocab, 3, 0).chips.map((c) => c.id)).toEqual([1, 6]);
    expect(laneAt(story, vocab, 3, 3).chips.map((c) => c.id)).toEqual([1, 6, 7, 9, 7]);
    expect(laneAt(story, vocab, 3, 5).chips).toHaveLength(7);
  });

  it("does not reveal more than the story has", () => {
    expect(laneAt(story, vocab, 3, 50).chips).toHaveLength(7);
  });

  it("marks the first promptLength tokens as prompt and the rest as generated", () => {
    const kinds = laneAt(story, vocab, 3, 5).chips.map((c) => c.kind);
    expect(kinds).toEqual(["prompt", "prompt", "prompt", "generated", "generated", "generated", "generated"]);
  });

  it("shows no text for BOS and drops the space before the first word", () => {
    const lane = laneAt(story, vocab, 3, 1); // tokens 0..2: BOS, " Hi", " there"
    expect(lane.chips[0]!.text).toBe("");
    expect(text(lane.chips)).toBe("Hi there");
  });

  it("skips EOS and unk tokens", () => {
    expect(text(laneAt({ tokens: [1, 6, 2, 0, 7] }, vocab, 3, 5).chips)).toBe("Hi there");
  });

  it("renders a newline byte piece as a newline", () => {
    expect(text(laneAt({ tokens: [1, 6, 8, 7] }, vocab, 3, 5).chips)).toBe("Hi\n there");
  });

  it("joins byte pieces into one character on the last piece", () => {
    const chips = laneAt({ tokens: [1, 6, 3, 4, 5, 7] }, vocab, 3, 5).chips;
    expect(chips.map((c) => c.text)).toEqual(["", "Hi", "", "", "€", " there"]);
  });

  it("shows nothing for a byte run that is not finished yet, never a half character", () => {
    const partial = laneAt({ tokens: [1, 6, 3, 4, 5] }, vocab, 3, 1).chips; // step 1 shows tokens 0..2
    expect(text(partial)).toBe("Hi");
    const two = laneAt({ tokens: [1, 6, 3, 4, 5] }, vocab, 3, 2).chips; // step 2 shows tokens 0..3
    expect(text(two)).toBe("Hi");
    const done = laneAt({ tokens: [1, 6, 3, 4, 5] }, vocab, 3, 3).chips; // step 3 shows tokens 0..4
    expect(text(done)).toBe("Hi€");
  });

  it("shows the replacement character only when a byte run is interrupted by another token", () => {
    const interrupted = laneAt({ tokens: [1, 6, 3, 4, 7] }, vocab, 3, 3).chips; // 0xE2 0x82 then " there"
    expect(text(interrupted)).toBe("Hi\uFFFD there");
  });

  it("stops at a second BOS and reports the step that sampled it", () => {
    const two = { tokens: [1, 6, 7, 1, 6, 7, 9] };
    const early = laneAt(two, vocab, 3, 1);
    expect(early.endedAtStep).toBeNull();
    const at = laneAt(two, vocab, 3, 2);
    expect(at.chips.map((c) => c.id)).toEqual([1, 6, 7]);
    expect(at.endedAtStep).toBe(2);
    const later = laneAt(two, vocab, 3, 5);
    expect(later.chips.map((c) => c.id)).toEqual([1, 6, 7]);
    expect(later.endedAtStep).toBe(2);
  });

  it("never reports an end for a story with no second BOS", () => {
    expect(laneAt(story, vocab, 3, 5).endedAtStep).toBeNull();
  });
});

describe("overlayChips", () => {
  it("covers positions 0..step including tokens after a second BOS", () => {
    const two = { tokens: [1, 6, 7, 1, 6, 7, 9] };
    const chips = overlayChips(two, vocab, 3, 4);
    expect(chips.map((c) => c.id)).toEqual([1, 6, 7, 1, 6]);
    expect(chips.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("chipsFor", () => {
  it("is empty for no tokens", () => {
    expect(chipsFor(vocab, [], 3)).toEqual([]);
  });
});
