#!/usr/bin/env bash
# Run the cocotb + Icarus test suites (rtl/pe.v and rtl/systolic_array.v),
# from any directory, in any fresh shell (no need to `source .venv` or `cd`
# yourself first).
set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$REPO_ROOT/.venv/bin/activate"

cd "$REPO_ROOT/tb"
make "$@"

cd "$REPO_ROOT/tb/array"
make "$@"
