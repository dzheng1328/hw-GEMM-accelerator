#!/usr/bin/env bash
# Runs rtl/pe.v through OpenLane 2's full place-and-route flow via the
# Docker backend. Requires Docker Desktop running (see Task 1, Step 4).
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
openlane --dockerized openlane/pe/config.json
