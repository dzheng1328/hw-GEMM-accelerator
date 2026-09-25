#!/usr/bin/env bash
# Run every cocotb test suite (rtl/pe.v, rtl/systolic_array.v, rtl/skew_feeder.v
# via rtl/tile.v, rtl/operand_mem.v, rtl/gemm_sequencer.v via rtl/gemm_tile.v,
# rtl/router.v, rtl/requant.v, the two-node NoC via rtl/noc_pair.v, the WxH mesh via
# rtl/noc_mesh.v at 2x2 and 4x3, MNIST, the perf harness), from any directory, in any
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

cd "$REPO_ROOT/tb/requant"
make "$@"

cd "$REPO_ROOT/tb/noc"
make "$@"

cd "$REPO_ROOT/tb/mesh"
make "$@"
make MESH_W=4 MESH_H=3 MESH_AW=3 "$@"
make size-check "$@"
make lint-configs

cd "$REPO_ROOT/tb/mnist"
make "$@"

cd "$REPO_ROOT/tb/perf"
make "$@"

python -m pytest -q "$REPO_ROOT/tb/test_check_results.py" "$REPO_ROOT/tb/perf/test_perflib.py" \
    "$REPO_ROOT/model/test_fixedpoint.py"
