"""Detokenize story tokens from the vocabulary pieces alone, so testbenches
and reports need no sentencepiece import. Mirrors llama2.c's run.c decode:
'▁' is a space, '<0xNN>' pieces are raw bytes, a story ends at the next
BOS, and the space SentencePiece adds before the first word is dropped."""

from lm_spec import BOS, EOS

UNK = 0


def decode(pieces, ids) -> str:
    """Text of the story that starts at ids[0] (a BOS) or at the first token."""
    ids = list(ids)
    if ids and ids[0] == BOS:
        ids = ids[1:]
    out = bytearray()
    for i in ids:
        if i == BOS:
            break
        if i in (EOS, UNK):
            continue
        p = pieces[i]
        if len(p) == 6 and p.startswith("<0x") and p.endswith(">"):
            out.append(int(p[3:5], 16))
        else:
            out += p.replace("▁", " ").encode()
    text = out.decode("utf-8", errors="replace")
    return text[1:] if text.startswith(" ") else text
