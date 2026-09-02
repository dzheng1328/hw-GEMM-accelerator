#!/usr/bin/env bash
# Run the cocotb + Icarus test suites (rtl/pe.v, rtl/systolic_array.v,
# rtl/skew_feeder.v via rtl/tile.v, rtl/operand_mem.v, rtl/gemm_sequencer.v via
# rtl/gemm_tile.v, rtl/router.v, the two-node NoC via rtl/noc_pair.v, the 2x2
# mesh via rtl/noc_mesh2x2.v),
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

cd "$REPO_ROOT/tb/operand_mem"
make "$@"

cd "$REPO_ROOT/tb/gemm"
make "$@"

cd "$REPO_ROOT/tb/router"
make "$@"

cd "$REPO_ROOT/tb/noc"
make "$@"

cd "$REPO_ROOT/tb/mesh"
make "$@"

cd "$REPO_ROOT/tb/mnist"
make "$@"
