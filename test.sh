#!/usr/bin/env bash
# Run the cocotb + Icarus test suite for rtl/pe.v, from any directory,
# in any fresh shell (no need to `source .venv` or `cd tb` yourself first).
set -e
cd "$(dirname "$0")"
source .venv/bin/activate
cd tb
make "$@"
