"""Minimal, dependency-free CIFAR-10 loader (same approach as
mnist_data.py): downloads the official python-version archive once into
model/.cifar_cache/ and reads its pickled batches. Needed only by the
training, quantization, and full-test-set evaluation scripts, never by a
cocotb test."""

import hashlib
import pickle
import shutil
import tarfile
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

URL = "https://www.cs.toronto.edu/~kriz/cifar-10-python.tar.gz"
ARCHIVE_MD5 = "c58f30108f718f92721af3b95e74349a"  # published on the dataset page
READ_TIMEOUT_S = 60
MAX_STALLED_ATTEMPTS = 3
CACHE_DIR = Path(__file__).parent / ".cifar_cache"
ARCHIVE = CACHE_DIR / "cifar-10-python.tar.gz"
BATCH_DIR = CACHE_DIR / "cifar-10-batches-py"


def download(url: str, dest: Path, md5: str | None = None) -> Path:
    """Download `url` to `dest` robustly: reads time out instead of hanging
    on a stalled connection, the transfer resumes with an HTTP Range
    request after each failure for as long as attempts keep making
    progress, and the finished file must match `md5` before it is renamed
    into place. On failure nothing is left in the cache."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    part.unlink(missing_ok=True)
    try:
        stalled = 0
        while True:
            have = part.stat().st_size if part.exists() else 0
            req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
            try:
                with urllib.request.urlopen(req, timeout=READ_TIMEOUT_S) as resp:
                    resumed = have and getattr(resp, "status", 200) == 206
                    with open(part, "ab" if resumed else "wb") as f:
                        shutil.copyfileobj(resp, f, 1 << 20)
                break
            except urllib.error.HTTPError:
                raise
            except OSError:  # timeouts, resets, refused or missing sources
                progressed = part.exists() and part.stat().st_size > have
                stalled = 0 if progressed else stalled + 1
                if stalled >= MAX_STALLED_ATTEMPTS:
                    raise
        if md5 is not None:
            digest = hashlib.md5(part.read_bytes()).hexdigest()
            if digest != md5:
                raise ValueError(f"MD5 mismatch for {url}: got {digest}, expected {md5}")
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
        with tarfile.open(download(URL, ARCHIVE, ARCHIVE_MD5)) as tar:
            tar.extractall(CACHE_DIR, filter="data")
    train = [read_batch(BATCH_DIR / f"data_batch_{i}") for i in range(1, 6)]
    test_x, test_y = read_batch(BATCH_DIR / "test_batch")
    return (np.concatenate([x for x, _ in train]), np.concatenate([y for _, y in train]), test_x, test_y)
