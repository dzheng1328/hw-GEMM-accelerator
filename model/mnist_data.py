"""Minimal, dependency-free MNIST loader.

Downloads the raw idx-ubyte files directly (no torchvision), since MNIST is
needed exactly once, at training time, never at cocotb test time. Avoids
torchvision's own mirror-selection history of breakage and keeps the
project's dependency list minimal.
"""

import gzip
import struct
import urllib.request
from pathlib import Path

import numpy as np

MNIST_BASE = "https://ossci-datasets.s3.amazonaws.com/mnist/"
FILES = {
    "train_images": "train-images-idx3-ubyte.gz",
    "train_labels": "train-labels-idx1-ubyte.gz",
    "test_images": "t10k-images-idx3-ubyte.gz",
    "test_labels": "t10k-labels-idx1-ubyte.gz",
}

CACHE_DIR = Path(__file__).parent / ".mnist_cache"


def _download(name: str) -> Path:
    CACHE_DIR.mkdir(exist_ok=True)
    path = CACHE_DIR / FILES[name]
    if not path.exists():
        urllib.request.urlretrieve(MNIST_BASE + FILES[name], path)
    return path


def _read_images(path: Path) -> np.ndarray:
    with gzip.open(path, "rb") as f:
        magic, n, rows, cols = struct.unpack(">IIII", f.read(16))
        assert magic == 2051, f"bad magic number for images file: {magic}"
        buf = f.read(n * rows * cols)
        return np.frombuffer(buf, dtype=np.uint8).reshape(n, rows, cols).copy()


def _read_labels(path: Path) -> np.ndarray:
    with gzip.open(path, "rb") as f:
        magic, n = struct.unpack(">II", f.read(8))
        assert magic == 2049, f"bad magic number for labels file: {magic}"
        return np.frombuffer(f.read(n), dtype=np.uint8).copy()


def load_mnist():
    """Returns (train_images, train_labels, test_images, test_labels) as
    uint8 numpy arrays. Images are (N, 28, 28) with values in [0, 255]."""
    train_images = _read_images(_download("train_images"))
    train_labels = _read_labels(_download("train_labels"))
    test_images = _read_images(_download("test_images"))
    test_labels = _read_labels(_download("test_labels"))
    return train_images, train_labels, test_images, test_labels
