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


import cifar_reference


def naive_conv(x, w, stride, pad):
    n, c, h, wd = x.shape
    co, _, k, _ = w.shape
    ho, wo = (h + 2 * pad - k) // stride + 1, (wd + 2 * pad - k) // stride + 1
    out = np.zeros((n, co, ho, wo), dtype=np.int64)
    for b in range(n):
        for o in range(co):
            for oy in range(ho):
                for ox in range(wo):
                    for ci in range(c):
                        for ky in range(k):
                            for kx in range(k):
                                iy, ix = oy * stride + ky - pad, ox * stride + kx - pad
                                if 0 <= iy < h and 0 <= ix < wd:
                                    out[b, o, oy, ox] += int(x[b, ci, iy, ix]) * int(w[o, ci, ky, kx])
    return out


@pytest.mark.parametrize("stride,pad,k,size", [(1, 1, 3, 8), (2, 1, 3, 8), (1, 0, 8, 8)])
def test_conv_int_matches_naive(stride, pad, k, size):
    rng = np.random.default_rng(stride * 10 + k)
    x = rng.integers(-128, 128, (2, 4, size, size))
    w = rng.integers(-128, 128, (8, 4, k, k))
    assert np.array_equal(cifar_reference.conv_int(x, w, stride, pad), naive_conv(x, w, stride, pad))


def test_quantize_input_is_exact_and_pads_a_zero_channel():
    px = np.random.default_rng(1).integers(0, 256, (2, 3, 32, 32)).astype(np.uint8)
    q = cifar_reference.quantize_input(px)
    assert q.shape == (2, 4, 32, 32)
    assert np.array_equal(q[:, :3], px.astype(np.int64) - 128) and not q[:, 3].any()


import cifar_quantize


def test_group_weight_scales_per_group_and_per_tensor():
    W = np.zeros((16, 2, 3, 3))
    W[0, 0, 0, 0], W[9, 1, 2, 2] = 2.54, -1.27
    assert np.allclose(cifar_quantize.group_weight_scales(W, True)[[0, 7, 8, 15]], [0.02, 0.02, 0.01, 0.01])
    assert np.allclose(cifar_quantize.group_weight_scales(W, False), 0.02)


def test_dead_group_gets_a_valid_scale():
    W = np.zeros((16, 2, 3, 3))
    W[0, 0, 0, 0] = 1.0  # group 1 (channels 8..15) is all zero
    s = cifar_quantize.group_weight_scales(W, True)
    assert np.all(s > 0) and np.all(np.isfinite(s))
    out = cifar_quantize.quantize_layer(W, np.zeros(16), 0.01, 0.05, True, 2, 16, "t")
    assert not out["w"][8:].any() and len(out["m"]) == 2


def test_choose_bias_val_is_smallest_that_fits():
    assert cifar_quantize.choose_bias_val(np.array([100.0, -50.0]), "t") == 1
    assert cifar_quantize.choose_bias_val(np.array([1000.0]), "t") == 8
    assert cifar_quantize.choose_bias_val(np.zeros(4), "t") == 1


def test_choose_bias_val_rejects_unrepresentable_bias():
    with pytest.raises(ValueError, match="conv9"):
        cifar_quantize.choose_bias_val(np.array([127.0 * 127 * 2]), "conv9")


def test_activation_scale_rejects_dead_layer():
    with pytest.raises(ValueError, match="conv3"):
        cifar_quantize.activation_scale(np.zeros(1000), "conv3")


def test_quantize_layer_pads_and_encodes():
    rng = np.random.default_rng(2)
    W, b = rng.normal(size=(10, 3, 3, 3)), rng.normal(size=10)
    out = cifar_quantize.quantize_layer(W, b, 0.02, None, False, 4, 16, "fc")
    assert out["w"].shape == (16, 4, 3, 3) and out["w"].dtype == np.int8
    assert not out["w"][10:].any() and not out["w"][:, 3].any()
    assert out["bias"].shape == (16,) and "m" not in out
