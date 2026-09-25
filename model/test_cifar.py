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
