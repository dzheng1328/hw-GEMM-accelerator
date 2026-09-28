"""pytest for the 4.3 story model side (4.3b). Nothing here downloads the
dataset or trains: tests use synthetic data, a tiny tokenizer trained in a
temp dir, and (once frozen) model/lm_quantized.npz."""

import json
from pathlib import Path

import numpy as np
import pytest

import download
import lm_spec
import lm_tok
import tinystories_data


def test_sha256_mismatch_leaves_no_cache_file(tmp_path):
    src = tmp_path / "src.bin"
    src.write_bytes(b"not the archive")
    dest = tmp_path / "cache" / "a.tar.gz"
    with pytest.raises(ValueError, match="sha256 mismatch"):
        download.download(src.as_uri(), dest, sha256="0" * 64)
    assert not dest.exists() and not dest.with_name(dest.name + ".part").exists()


def test_read_stories_strips_whitespace(tmp_path):
    shard = tmp_path / "data07.json"
    shard.write_text(json.dumps([{"story": "  Once there was a cat.\n"}, {"story": "Tom ran."}]))
    assert tinystories_data.read_stories(shard) == ["Once there was a cat.", "Tom ran."]


@pytest.fixture(scope="module")
def tiny_sp(tmp_path_factory):
    import sentencepiece as spm

    d = tmp_path_factory.mktemp("spm")
    words = ["cat", "dog", "ran", "sat", "the", "a", "happy", "big", "sun", "tree", "Lily", "Tom"]
    rng = np.random.default_rng(0)
    text = d / "text.txt"
    text.write_text("\n".join(" ".join(rng.choice(words, 8)) + "." for _ in range(2000)))
    spm.SentencePieceTrainer.train(**tinystories_data.spm_options(str(text), str(d / "tiny"), vocab_size=300))
    return spm.SentencePieceProcessor(model_file=str(d / "tiny.model"))


def test_encode_story_prepends_bos_only(tiny_sp):
    ids = tinystories_data.encode_story(tiny_sp, "the cat sat.")
    assert ids[0] == lm_spec.BOS and lm_spec.BOS not in ids[1:] and lm_spec.EOS not in ids


def test_decode_matches_sentencepiece(tiny_sp):
    pieces = [tiny_sp.id_to_piece(i) for i in range(tiny_sp.get_piece_size())]
    for s in ["the cat sat.", "Lily ran to the big tree.", "Tom é 7"]:  # é and 7 exercise byte fallback / digits
        ids = tinystories_data.encode_story(tiny_sp, s)
        assert lm_tok.decode(pieces, ids) == tiny_sp.decode(ids[1:])


def test_decode_splits_stories_at_bos(tiny_sp):
    pieces = [tiny_sp.id_to_piece(i) for i in range(tiny_sp.get_piece_size())]
    ids = tinystories_data.encode_story(tiny_sp, "the cat sat.") + tinystories_data.encode_story(tiny_sp, "Tom ran.")
    assert lm_tok.decode(pieces, ids) == "the cat sat."


def test_leftover_part_file_is_not_counted_as_a_finished_shard(tmp_path, monkeypatch):
    monkeypatch.setattr(tinystories_data, "TOK_DIR", tmp_path)
    (tmp_path / "data03.bin.part").write_bytes(b"partial, from an interrupted run")
    assert not tinystories_data._shard_bin_done(Path("data03.json"))
    (tmp_path / "data03.bin").write_bytes(b"whole file, written by a completed rename")
    assert tinystories_data._shard_bin_done(Path("data03.json"))


def test_sample_windows_are_contiguous_slices():
    tokens = np.arange(10_000, dtype=np.uint16)
    w = tinystories_data.sample_windows(tokens, 5, np.random.default_rng(1))
    assert w.shape == (5, lm_spec.CTX + 1) and w.dtype == np.int64
    assert (np.diff(w, axis=1) == 1).all()
