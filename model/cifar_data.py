"""Minimal, dependency-free CIFAR-10 loader (same approach as
mnist_data.py): downloads the official python-version archive once into
model/.cifar_cache/ and reads its pickled batches. Needed only by the
training, quantization, and full-test-set evaluation scripts, never by a
cocotb test."""

import pickle
import tarfile
import urllib.request
from pathlib import Path

import numpy as np

URL = "https://www.cs.toronto.edu/~kriz/cifar-10-python.tar.gz"
CACHE_DIR = Path(__file__).parent / ".cifar_cache"
ARCHIVE = CACHE_DIR / "cifar-10-python.tar.gz"
BATCH_DIR = CACHE_DIR / "cifar-10-batches-py"


def download(url: str, dest: Path) -> Path:
    """Download to a .part file and rename on success, so an interrupted
    download never leaves a truncated archive in the cache."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    try:
        urllib.request.urlretrieve(url, part)
        part.rename(dest)
    finally:
        part.unlink(missing_ok=True)
    return dest


def read_batch(path) -> tuple[np.ndarray, np.ndarray]:
    """One pickled batch -> (images uint8 (N, 3, 32, 32) CHW, labels uint8)."""
    with open(path, "rb") as f:
        d = pickle.load(f, encoding="bytes")
    images = np.asarray(d[b"data"], dtype=np.uint8).reshape(-1, 3, 32, 32)
    return images, np.asarray(d[b"labels"], dtype=np.uint8)


def load_cifar10():
    """(train_x, train_y, test_x, test_y); images uint8 (N, 3, 32, 32)."""
    if not BATCH_DIR.exists():
        with tarfile.open(download(URL, ARCHIVE)) as tar:
            tar.extractall(CACHE_DIR, filter="data")
    train = [read_batch(BATCH_DIR / f"data_batch_{i}") for i in range(1, 6)]
    test_x, test_y = read_batch(BATCH_DIR / "test_batch")
    return (np.concatenate([x for x, _ in train]), np.concatenate([y for _, y in train]), test_x, test_y)
