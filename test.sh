#!/usr/bin/env bash
# Run the cocotb + Icarus test suites (rtl/pe.v, rtl/systolic_array.v,
# rtl/skew_feeder.v via rtl/tile.v, rtl/gemm_sequencer.v via rtl/gemm_tile.v),
# from any directory, in any fresh shell (no need to `source .venv` or `cd`
# yourself first).
set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$REPO_ROOT/.venv/bin/activate"

cd "$REPO_ROOT/tb"
make "$@"

cd "$REPO_ROOT/tb/array"
make "$@"

cd "$REPO_ROOT/tb/tile"
make "$@"

cd "$REPO_ROOT/tb/gemm"
make "$@"

cd "$REPO_ROOT/tb/mnist"
make "$@"
