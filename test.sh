#!/usr/bin/env bash
# Run every cocotb test suite (rtl/pe.v, rtl/systolic_array.v, rtl/skew_feeder.v
# via rtl/tile.v, rtl/operand_mem.v, rtl/gemm_sequencer.v via rtl/gemm_tile.v,
# rtl/router.v, the two-node NoC via rtl/noc_pair.v, the 2x2 mesh via
# rtl/noc_mesh2x2.v, MNIST, the perf harness), from any directory, in any
# fresh shell (no need to `source .venv` or `cd` yourself first).
#
# Verilator by default; `SIM=icarus ./test.sh` runs the Icarus cross-check.
# Extra arguments are passed through to every `make` (e.g. `./test.sh WAVES=1`).
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
make collision-check "$@"

cd "$REPO_ROOT/tb/gemm"
make "$@"

cd "$REPO_ROOT/tb/router"
make "$@"

cd "$REPO_ROOT/tb/noc"
make "$@"

cd "$REPO_ROOT/tb/mesh"
make "$@"
make lint-noperf

cd "$REPO_ROOT/tb/mnist"
make "$@"

cd "$REPO_ROOT/tb/perf"
make "$@"

python -m pytest -q "$REPO_ROOT/tb/test_check_results.py" "$REPO_ROOT/tb/perf/test_perflib.py"
