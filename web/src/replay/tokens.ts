import type { VocabFile } from "./types";

export type ChipKind = "prompt" | "generated";

export interface Chip {
  /** Position in the story's token list. */
  index: number;
  id: number;
  /** Display text. Empty for BOS, EOS, unk and the unfinished part of a multi-byte character. */
  text: string;
  kind: ChipKind;
}

export interface LaneState {
  chips: Chip[];
  /** The step that sampled the BOS ending this story, or null while it has not ended. */
  endedAtStep: number | null;
}

const BYTE_PIECE = /^<0x([0-9A-F]{2})>$/;
const UNK = 0;
const decoder = new TextDecoder("utf-8");

function byteOf(piece: string): number | null {
  const m = BYTE_PIECE.exec(piece);
  return m ? parseInt(m[1]!, 16) : null;
}

/** How many bytes the UTF-8 character that starts with this byte has. */
function sequenceLength(lead: number): number {
  if (lead >= 0xc0 && lead < 0xe0) return 2;
  if (lead >= 0xe0 && lead < 0xf0) return 3;
  if (lead >= 0xf0 && lead < 0xf8) return 4;
  return 1;
}

/**
 * One chip per token, decoded like model/lm_tok.py: "▁" is a space, "<0xNN>" pieces are raw
 * bytes, BOS, EOS and unk show nothing, and the space the tokenizer puts before the first word
 * is dropped. A multi-byte character is shown on the chip of its last byte, and nothing is shown
 * for it before that, so a half character never appears.
 */
export function chipsFor(vocab: VocabFile, ids: readonly number[], promptLength: number): Chip[] {
  const chips: Chip[] = [];
  let pending: number[] = [];
  let pendingChips: Chip[] = [];

  // Another token interrupted a byte run: the sequence is invalid, so it shows the replacement character.
  const interrupt = () => {
    if (pending.length > 0) {
      pendingChips[pendingChips.length - 1]!.text = decoder.decode(Uint8Array.from(pending));
    }
    pending = [];
    pendingChips = [];
  };

  ids.forEach((id, index) => {
    const chip: Chip = { index, id, text: "", kind: index < promptLength ? "prompt" : "generated" };
    chips.push(chip);
    if (id === vocab.bos || id === vocab.eos || id === UNK) {
      interrupt();
      return;
    }
    const piece = vocab.pieces[id] ?? "";
    const byte = byteOf(piece);
    if (byte === null) {
      interrupt();
      chip.text = piece.replaceAll("▁", " ");
      return;
    }
    pending.push(byte);
    pendingChips.push(chip);
    if (pending.length >= sequenceLength(pending[0]!)) {
      chip.text = decoder.decode(Uint8Array.from(pending));
      pending = [];
      pendingChips = [];
    }
  });
  // A byte run still open at the end of the tokens is unfinished, not invalid: it shows nothing until its last byte arrives.

  const first = chips.find((c) => c.text !== "");
  if (first && first.text.startsWith(" ")) first.text = first.text.slice(1);
  return chips;
}

/** The lane of one story at `step`: tokens 0..step+1, cut at the story's second BOS. */
export function laneAt(
  story: { tokens: number[] },
  vocab: VocabFile,
  promptLength: number,
  step: number,
): LaneState {
  const visible = story.tokens.slice(0, step + 2);
  const second = visible.findIndex((id, i) => i > 0 && id === vocab.bos);
  const shown = second === -1 ? visible : visible.slice(0, second);
  return { chips: chipsFor(vocab, shown, promptLength), endedAtStep: second === -1 ? null : second - 1 };
}

/** Chips for attention positions 0..step, including tokens after a second BOS. */
export function overlayChips(
  story: { tokens: number[] },
  vocab: VocabFile,
  promptLength: number,
  step: number,
): Chip[] {
  return chipsFor(vocab, story.tokens.slice(0, step + 1), promptLength);
}
