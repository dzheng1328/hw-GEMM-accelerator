"""pytest for model/export_vocab.py: the vocabulary file the portfolio app decodes tokens with."""

import json

import numpy as np
import pytest

import export_vocab
import lm_spec


def test_writes_every_piece_in_id_order(tmp_path):
    out = tmp_path / "vocab.json"
    export_vocab.export(export_vocab.NPZ, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    q = np.load(export_vocab.NPZ)
    assert data["pieces"] == [str(p) for p in q["vocab"]]
    assert len(data["pieces"]) == lm_spec.VOCAB
    assert data["bos"] == lm_spec.BOS and data["pieces"][data["bos"]] == "<s>"
    assert data["eos"] == lm_spec.EOS and data["pieces"][data["eos"]] == "</s>"
    assert data["pieces"][3] == "<0x00>"


def test_rejects_a_vocabulary_of_the_wrong_size(tmp_path):
    bad = tmp_path / "bad.npz"
    np.savez(bad, vocab=np.array(["<unk>", "<s>", "</s>"]))
    with pytest.raises(ValueError, match="512"):
        export_vocab.export(bad, tmp_path / "out.json")


def test_the_committed_file_is_fresh(tmp_path):
    out = tmp_path / "vocab.json"
    export_vocab.export(export_vocab.NPZ, out)
    assert out.read_text(encoding="utf-8") == export_vocab.OUT.read_text(encoding="utf-8"), (
        "docs/perf/lm_vocab.json is stale: run `python model/export_vocab.py` and commit the result"
    )
