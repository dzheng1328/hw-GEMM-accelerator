"""Robust dataset download shared by the CIFAR-10 and TinyStories loaders:
reads time out instead of hanging, transfers resume with HTTP Range
requests while attempts keep making progress, and the finished file must
match its published hash before it is renamed into place."""

import hashlib
import shutil
import urllib.error
import urllib.request
from pathlib import Path

READ_TIMEOUT_S = 60
MAX_STALLED_ATTEMPTS = 3


def file_digest(path: Path, algo: str) -> str:
    h = hashlib.new(algo)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, md5: str | None = None, sha256: str | None = None) -> Path:
    """Download `url` to `dest`; on failure nothing is left in the cache."""
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
        for algo, want in (("md5", md5), ("sha256", sha256)):
            if want is not None and (got := file_digest(part, algo)) != want:
                raise ValueError(f"{algo} mismatch for {url}: got {got}, expected {want}")
        part.rename(dest)
    finally:
        part.unlink(missing_ok=True)
    return dest
