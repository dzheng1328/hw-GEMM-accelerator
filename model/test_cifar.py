"""pytest for the CIFAR-10 model side (4.2a). Nothing here downloads
the dataset or trains: tests use synthetic data and the frozen npz."""

import pickle

import numpy as np
import pytest

import cifar_data


def test_read_batch_is_chw_uint8(tmp_path):
    raw = np.arange(2 * 3072, dtype=np.uint8).reshape(2, 3072)
    path = tmp_path / "batch"
    with open(path, "wb") as f:
        pickle.dump({b"data": raw, b"labels": [3, 7]}, f)
    images, labels = cifar_data.read_batch(path)
    assert images.shape == (2, 3, 32, 32) and images.dtype == np.uint8
    # The archive stores 1024 R, then 1024 G, then 1024 B values, row-major.
    assert images[1, 2, 0, 5] == raw[1, 2048 + 5]
    assert labels.tolist() == [3, 7]


def test_interrupted_download_leaves_no_cache_file(tmp_path):
    missing = (tmp_path / "nope.tar.gz").as_uri()
    dest = tmp_path / "cache" / "cifar.tar.gz"
    with pytest.raises(Exception):
        cifar_data.download(missing, dest)
    assert not dest.exists()
    assert not dest.with_name(dest.name + ".part").exists()


import torch

import cifar_net


def test_layer_table_matches_spec():
    shapes = [(l.cin, l.cout, l.ksize, l.stride, l.pad) for l in cifar_net.LAYERS]
    assert shapes == [(3, 16, 3, 1, 1), (16, 32, 3, 2, 1), (32, 32, 3, 1, 1),
                      (32, 64, 3, 2, 1), (64, 64, 3, 1, 1), (64, 10, 8, 1, 0)]
    out = cifar_net.CifarNet()(torch.zeros(2, 3, 32, 32))
    assert out.shape == (2, 10)


def test_fold_bn_preserves_eval_outputs():
    torch.manual_seed(0)
    conv = torch.nn.Conv2d(4, 8, 3, padding=1, bias=False)
    bn = torch.nn.BatchNorm2d(8)
    bn.running_mean.uniform_(-1, 1)
    bn.running_var.uniform_(0.5, 2)
    bn.weight.data.uniform_(0.5, 1.5)
    bn.bias.data.uniform_(-1, 1)
    bn.eval()
    x = torch.randn(3, 4, 8, 8)
    W, b = cifar_net.fold_bn(conv.weight, bn)
    folded = torch.nn.functional.conv2d(x.double(), torch.from_numpy(W), torch.from_numpy(b), padding=1)
    assert torch.allclose(folded, bn(conv(x)).double(), atol=1e-5)


def test_to_input_is_exact_offset():
    px = np.array([[[[0, 128, 255]]]], dtype=np.uint8)
    assert cifar_net.to_input(px).flatten().tolist() == [-1.0, 0.0, 127 / 128]


def test_download_rejects_a_checksum_mismatch(tmp_path):
    src = tmp_path / "src.bin"
    src.write_bytes(b"not the archive")
    dest = tmp_path / "cache" / "archive.tar.gz"
    with pytest.raises(ValueError, match="MD5"):
        cifar_data.download(src.as_uri(), dest, md5="0" * 32)
    assert not dest.exists()
    assert not dest.with_name(dest.name + ".part").exists()


def test_download_accepts_a_matching_checksum(tmp_path):
    src = tmp_path / "src.bin"
    src.write_bytes(b"payload")
    dest = tmp_path / "cache" / "archive.tar.gz"
    cifar_data.download(src.as_uri(), dest, md5="321c3cf486ed509164edec1e1981fec8")
    assert dest.read_bytes() == b"payload"
