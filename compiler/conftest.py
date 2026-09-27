"""pytest: compiler modules import model/ modules flat, as testbenches do
through tb/common.mk's PYTHONPATH."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "model"))
