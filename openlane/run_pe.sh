#!/usr/bin/env bash
# Runs rtl/pe.v through OpenLane 2's full place-and-route flow via the
# Docker backend. Requires Docker Desktop running and openlane installed in
# .venv (see docs/superpowers/specs/2026-08-11-openlane-pe-pnr-design.md).
# --docker-no-tty must precede --dockerized: without it, OpenLane passes
# `-t` to `docker run`, which fails outright ("the input device is not a
# TTY") when there is no controlling terminal (e.g. run in background/nohup).
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
openlane --docker-no-tty --dockerized openlane/pe/config.json
