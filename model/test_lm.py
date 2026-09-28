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


def test_load_tokens_memmaps_train_and_val_from_streamed_shards(tmp_path, monkeypatch):
    monkeypatch.setattr(tinystories_data, "TOK_DIR", tmp_path)
    fake_shards = [Path(f"data0{i}.json") for i in range(3)]
    monkeypatch.setattr(tinystories_data, "shard_paths", lambda: fake_shards)
    shards = [np.arange(i * 10, i * 10 + 10, dtype=np.uint16) for i in range(3)]
    for i, s in enumerate(shards):
        s.tofile(tmp_path / f"data0{i}.bin")
    # a leftover .part from an interrupted build must not be mistaken for the finished train.bin
    (tmp_path / "train.bin.part").write_bytes(b"stale, from an interrupted run")

    train = tinystories_data.load_tokens("train")
    val = tinystories_data.load_tokens("val")

    assert isinstance(train, np.memmap) and isinstance(val, np.memmap)
    assert np.array_equal(train, np.concatenate(shards[1:]))
    assert np.array_equal(val, shards[0])
    assert not (tmp_path / "train.bin.part").exists()


def test_sample_windows_are_contiguous_slices():
    tokens = np.arange(10_000, dtype=np.uint16)
    w = tinystories_data.sample_windows(tokens, 5, np.random.default_rng(1))
    assert w.shape == (5, lm_spec.CTX + 1) and w.dtype == np.int64
    assert (np.diff(w, axis=1) == 1).all()


import torch

import lm_net
import lm_train


def test_storynet_shapes_and_parameter_count():
    model = lm_net.StoryNet()
    n = sum(p.numel() for p in model.parameters())
    assert n == 278_528 + (2 * lm_spec.N_LAYERS + 1) * lm_spec.DIM  # weights + norm gains; tied output
    logits, loss = model(torch.zeros(2, 5, dtype=torch.long), torch.zeros(2, 5, dtype=torch.long))
    assert logits.shape == (2, 5, lm_spec.VOCAB) and loss.ndim == 0
    assert model.output.weight is model.tok_embeddings.weight


def test_rope_matches_complex_multiplication():
    cos, sin = lm_net.rope_cos_sin(16)
    x = torch.randn(1, 16, 2, lm_spec.HEAD_DIM)
    y = lm_net.apply_rope(x, cos[None, :, None, :], sin[None, :, None, :])
    xc = torch.view_as_complex(x.reshape(1, 16, 2, -1, 2).contiguous())
    ref = torch.view_as_real(xc * torch.polar(torch.ones_like(cos), torch.atan2(sin, cos))[None, :, None, :]).flatten(-2)
    assert torch.allclose(y, ref, atol=1e-5)


def test_storynet_is_causal():
    torch.manual_seed(0)
    model = lm_net.StoryNet().eval()
    a = torch.randint(0, lm_spec.VOCAB, (1, 12))
    b = a.clone()
    b[0, 8:] = (b[0, 8:] + 1) % lm_spec.VOCAB
    with torch.no_grad():
        la, lb = model(a)[0], model(b)[0]
    assert torch.allclose(la[0, :8], lb[0, :8], atol=1e-5) and not torch.allclose(la[0, 8:], lb[0, 8:])


def test_probe_path_equals_fast_path():
    torch.manual_seed(1)
    model = lm_net.StoryNet().eval()
    x = torch.randint(0, lm_spec.VOCAB, (2, 10))
    probe = lm_net.Probe()
    with torch.no_grad():
        fast, probed = model(x)[0], model(x, probe=probe)[0]
    assert torch.allclose(fast, probed, atol=1e-5)
    names = {"resid", "normf", "logits"} | {f"l{i}.{n}" for i in range(lm_spec.N_LAYERS)
                                           for n in ("norm1", "q", "k", "v", "score", "att", "norm2", "g", "u", "h")}
    assert set(probe.samples) == names


def test_accumulate_grads_matches_one_full_batch_backward():
    torch.manual_seed(0)
    model = lm_net.StoryNet()
    windows = torch.randint(0, lm_spec.VOCAB, (lm_train.BATCH_SIZE, 17))  # short context, fast

    model.zero_grad(set_to_none=True)
    mean_loss = lm_train.accumulate_grads(model, windows)
    accum_grads = {n: p.grad.clone() for n, p in model.named_parameters()}

    model.zero_grad(set_to_none=True)
    _, full_loss = model(windows[:, :-1], windows[:, 1:])
    full_loss.backward()

    assert abs(mean_loss - full_loss.item()) < 1e-6
    for n, p in model.named_parameters():
        assert torch.allclose(accum_grads[n], p.grad, atol=1e-6), n


def _tiny_train_data(monkeypatch):
    # A short context keeps these tests fast; StoryNet.forward slices its RoPE
    # table to the sequence length, so shrinking lm_net's/tinystories_data's
    # module-level CTX (not lm_spec's) is enough -- no other shapes depend on it.
    monkeypatch.setattr(lm_net, "CTX", 16)
    monkeypatch.setattr(tinystories_data, "CTX", 16)
    train_tokens = np.arange(20_000, dtype=np.uint16) % lm_spec.VOCAB
    val_windows = tinystories_data.sample_windows(
        np.arange(2_000, dtype=np.uint16) % lm_spec.VOCAB, 4, np.random.default_rng(1)
    )
    return train_tokens, val_windows


def test_resume_gives_bit_identical_weights_to_an_uninterrupted_run(tmp_path, monkeypatch):
    train_tokens, val_windows = _tiny_train_data(monkeypatch)

    straight_dir = tmp_path / "straight"
    lm_train.train(6, device="cpu", train_tokens=train_tokens, val_windows=val_windows, out_dir=straight_dir)

    # Pause after 3 iterations by flipping the same module flag the SIGTERM/SIGINT handler sets.
    resumed_dir = tmp_path / "resumed"
    orig_accumulate_grads = lm_train.accumulate_grads
    calls = {"n": 0}

    def stop_after_three(model, w):
        calls["n"] += 1
        loss = orig_accumulate_grads(model, w)
        if calls["n"] == 3:
            lm_train._STOP = True
        return loss

    # Direct assignment (not monkeypatch.setattr): monkeypatch.undo() would also
    # revert the CTX patches from _tiny_train_data, which must stay in effect
    # for the resume call below.
    # try/finally: a failing assertion below must not leak the patched accumulate_grads
    # or a stuck _STOP=True into later tests.
    lm_train.accumulate_grads = stop_after_three
    try:
        log = lm_train.train(6, device="cpu", train_tokens=train_tokens, val_windows=val_windows, out_dir=resumed_dir)
        assert log == [] and lm_train._STOP is True
    finally:
        lm_train.accumulate_grads = orig_accumulate_grads
        lm_train._STOP = False

    lm_train.train(6, device="cpu", train_tokens=train_tokens, val_windows=val_windows, out_dir=resumed_dir, resume=True)

    straight_weights = torch.load(straight_dir / "lm_float.pt", weights_only=True)
    resumed_weights = torch.load(resumed_dir / "lm_float.pt", weights_only=True)
    assert straight_weights.keys() == resumed_weights.keys()
    for k in straight_weights:
        assert torch.equal(straight_weights[k], resumed_weights[k]), k


def test_resume_with_different_total_iters_raises(tmp_path, monkeypatch):
    train_tokens, val_windows = _tiny_train_data(monkeypatch)
    out_dir = tmp_path / "run"
    lm_train.train(2, device="cpu", train_tokens=train_tokens, val_windows=val_windows, out_dir=out_dir)
    with pytest.raises(SystemExit):
        lm_train.train(3, device="cpu", train_tokens=train_tokens, val_windows=val_windows, out_dir=out_dir, resume=True)
