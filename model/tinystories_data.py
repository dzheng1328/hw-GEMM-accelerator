"""TinyStories for the 4.3 story model (spec section 1): llama2.c's
`TinyStories_all_data.tar.gz` (50 JSON shards; shard 0 is validation, as in
llama2.c), a 512-token SentencePiece BPE tokenizer trained on shards 1-10
with llama2.c's options, and every shard pretokenized to uint16 with BOS
before each story. Cache: model/.tinystories_cache/ (gitignored); only the
tokenizer model (model/tok512.model) is committed."""

import json
import os
import shutil
import tarfile
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from download import download
from lm_spec import BOS, CTX, VOCAB

URL = "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStories_all_data.tar.gz"
ARCHIVE_SHA256 = "26cf7605aca15bc4ea6fa637256400d9d01317b28ed296172b2d1dd160cd7699"  # Hugging Face LFS oid
CACHE_DIR = Path(__file__).parent / ".tinystories_cache"
ARCHIVE = CACHE_DIR / "TinyStories_all_data.tar.gz"
SHARD_DIR = CACHE_DIR / "shards"
TOK_DIR = CACHE_DIR / "tok512"
TOKENIZER_PATH = Path(__file__).parent / "tok512.model"
VAL_SHARD = 0
TOKENIZER_SHARDS = range(1, 11)
EVAL_SEED = 1234


def shard_paths() -> list[Path]:
    if not SHARD_DIR.exists():
        part = SHARD_DIR.with_name(SHARD_DIR.name + ".part")
        if part.exists():
            shutil.rmtree(part)
        with tarfile.open(download(URL, ARCHIVE, sha256=ARCHIVE_SHA256)) as tar:
            tar.extractall(part, filter="data")
        part.rename(SHARD_DIR)
    return sorted(SHARD_DIR.glob("data*.json"))


def read_stories(path: Path) -> list[str]:
    with open(path) as f:
        return [d["story"].strip() for d in json.load(f)]


def spm_options(input_path: str, prefix: str, vocab_size: int = VOCAB) -> dict:
    """llama2.c's tokenizer options (tinystories.py train_vocab)."""
    return dict(
        input=input_path, model_prefix=prefix, model_type="bpe", vocab_size=vocab_size,
        self_test_sample_size=0, input_format="text", character_coverage=1.0,
        num_threads=os.cpu_count(), split_digits=True, allow_whitespace_only_pieces=True,
        byte_fallback=True, unk_surface=r" \342\201\207 ", normalization_rule_name="identity",
        input_sentence_size=200_000, shuffle_input_sentence=True,
    )


def train_tokenizer() -> Path:
    import sentencepiece as spm

    shards = shard_paths()
    text = CACHE_DIR / "tokenizer_text.txt"
    with open(text, "w") as f:
        for i in TOKENIZER_SHARDS:
            for story in read_stories(shards[i]):
                f.write(story + "\n")
    prefix = CACHE_DIR / "tok512"
    spm.SentencePieceTrainer.train(**spm_options(str(text), str(prefix)))
    TOKENIZER_PATH.write_bytes(prefix.with_suffix(".model").read_bytes())
    return TOKENIZER_PATH


def encode_story(sp, text: str) -> list[int]:
    return [BOS] + sp.encode(text)


def _pretokenize_shard(path: Path) -> None:
    import sentencepiece as spm

    sp = spm.SentencePieceProcessor(model_file=str(TOKENIZER_PATH))
    ids = np.concatenate([np.array(encode_story(sp, s), dtype=np.uint16) for s in read_stories(path)])
    part = TOK_DIR / f"{path.stem}.bin.part"
    ids.tofile(part)
    part.rename(TOK_DIR / f"{path.stem}.bin")


def _shard_bin_done(path: Path) -> bool:
    """A shard's pretokenized .bin is only ever created by renaming from a
    completed .bin.part, so a leftover .part (interrupted run) never counts
    as done -- only the final, whole-file .bin name does."""
    return (TOK_DIR / f"{path.stem}.bin").exists()


def pretokenize() -> None:
    TOK_DIR.mkdir(parents=True, exist_ok=True)
    for stale in TOK_DIR.glob("*.bin.part"):
        stale.unlink()
    todo = [p for p in shard_paths() if not _shard_bin_done(p)]
    with Pool() as pool:
        pool.map(_pretokenize_shard, todo)


def _build_tokens_bin(dest: Path, shards: list[Path]) -> None:
    """Stream `shards` into dest, one shard at a time (never more than one in
    RAM), then rename into place atomically -- same convention as the
    per-shard .bin writes in _pretokenize_shard."""
    part = dest.with_name(dest.name + ".part")
    with open(part, "wb") as out:
        for shard in shards:
            with open(shard, "rb") as src:
                shutil.copyfileobj(src, out, 1 << 20)
    part.rename(dest)


def load_tokens(split: str) -> np.memmap:
    """All training shards (1-49) concatenated, or the validation shard (0),
    as a read-only memmap over a cached train.bin / val.bin (built once by
    streaming the per-shard .bin files, never held fully in RAM)."""
    paths = sorted(TOK_DIR.glob("data*.bin"))
    if len(paths) != len(shard_paths()):
        raise FileNotFoundError("run `python model/tinystories_data.py` to pretokenize first")
    dest = TOK_DIR / ("val.bin" if split == "val" else "train.bin")
    if not dest.exists():
        shards = [paths[VAL_SHARD]] if split == "val" else paths[:VAL_SHARD] + paths[VAL_SHARD + 1 :]
        _build_tokens_bin(dest, shards)
    return np.memmap(dest, dtype=np.uint16, mode="r")


def sample_windows(tokens: np.ndarray, n: int, rng: np.random.Generator) -> np.ndarray:
    starts = rng.integers(0, len(tokens) - CTX - 1, n)
    return np.stack([tokens[s : s + CTX + 1] for s in starts]).astype(np.int64)


def eval_windows(n: int) -> np.ndarray:
    """The fixed validation windows every loss comparison uses."""
    return sample_windows(load_tokens("val"), n, np.random.default_rng(EVAL_SEED))


if __name__ == "__main__":
    if not TOKENIZER_PATH.exists():
        print(f"trained {train_tokenizer()}")
    pretokenize()
    print(f"train tokens {len(load_tokens('train')):,}; val tokens {len(load_tokens('val')):,}")
