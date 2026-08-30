#!/usr/bin/env bash
# Runs OpenRAM (Docker-backed, vlsida/openram-ubuntu) to generate the sky130
# single-port 64x64 SRAM macro used for operand_mem's a_ram/b_ram banks.
#
# vlsida/openram-ubuntu:latest is a toolchain-only image (magic/netgen/
# ngspice/klayout + python3.8) -- it does NOT bundle OpenRAM itself, and
# OPENRAM_HOME/OPENRAM_TECH are empty by default in the container (confirmed
# via `docker run --rm vlsida/openram-ubuntu:latest bash -lc 'echo
# $OPENRAM_HOME $OPENRAM_TECH'`). So this script clones OpenRAM's own source
# (which provides compiler/, technology/, and sram_compiler.py) and mounts it
# into the container, following the real intended invocation shown in
# OpenRAM's own docker/ + openram.mk `mount` target at tag v1.2.48 (with the
# FREEPDK45 mount dropped -- this project only uses sky130A).
#
# Requires Docker Desktop running, and a local sky130 PDK already fetched by
# volare (this repo's openlane/run_pe.sh is what originally fetched it).
#
# See .superpowers/sdd/2026-08-29-operand-mem-sram-macro/ for the design spec
# and Task 1's ruling/report on how these facts were confirmed.
set -euo pipefail
cd "$(dirname "$0")"

OPENRAM_TAG="v1.2.48"
OPENRAM_SRC="$(pwd)/.openram-src"

# --- Step 1: clone (or update) OpenRAM source at the pinned release tag ---
if [ -d "$OPENRAM_SRC/.git" ]; then
  echo "OpenRAM source already present at $OPENRAM_SRC -- updating to $OPENRAM_TAG"
  git -C "$OPENRAM_SRC" fetch --tags --depth 1 origin "$OPENRAM_TAG"
  git -C "$OPENRAM_SRC" checkout "$OPENRAM_TAG"
else
  echo "Cloning OpenRAM at $OPENRAM_TAG into $OPENRAM_SRC"
  git clone --branch "$OPENRAM_TAG" --depth 1 https://github.com/VLSIDA/OpenRAM.git "$OPENRAM_SRC"
fi

# --- Step 2: resolve the local sky130 PDK_ROOT dynamically (volare-managed) ---
VOLARE_SKY130_VERSIONS="$HOME/.volare/volare/sky130/versions"
PDK_ROOT="$(find "$VOLARE_SKY130_VERSIONS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)"
if [ -z "$PDK_ROOT" ]; then
  echo "ERROR: no sky130 PDK found under $VOLARE_SKY130_VERSIONS" >&2
  echo "openlane/run_pe.sh is what originally fetched this PDK via volare -- run it (or its PDK-fetch step) first." >&2
  exit 1
fi
echo "Using PDK_ROOT=$PDK_ROOT"

# --- Step 3: pull the OpenRAM toolchain image ---
docker pull vlsida/openram-ubuntu:latest

# --- Step 4: run the container with the real mount/env pattern ---
#
# --user $(id -u):$(id -g) needs /etc/passwd and /etc/group entries for that
# uid/gid to resolve inside the container (OpenRAM's setup_paths() calls
# getpass.getuser(), which does a getpwuid() lookup). OpenRAM's own
# openram.mk mounts the HOST's real /etc/passwd/-group read-only for this.
# That breaks on a macOS host, though: macOS resolves regular user accounts
# via Directory Services, not the flat /etc/passwd file, so the host file
# has no entry for a normal user's uid (confirmed: `grep ":$(id -u):"
# /etc/passwd` on macOS finds nothing even though `id` reports a real uid).
# Generate small synthetic passwd/group files with just the current
# uid/gid instead -- this is what the mount is actually for, and it works
# on both macOS and Linux hosts.
PASSWD_FILE="$(mktemp)"
GROUP_FILE="$(mktemp)"
trap 'rm -f "$PASSWD_FILE" "$GROUP_FILE"' EXIT
printf '%s:x:%s:%s:%s:/tmp:/bin/bash\n' "$(id -un)" "$(id -u)" "$(id -g)" "$(id -un)" > "$PASSWD_FILE"
printf '%s:x:%s:\n' "$(id -gn)" "$(id -g)" > "$GROUP_FILE"

docker run --rm \
  -v "$OPENRAM_SRC":/openram \
  -v "$PDK_ROOT":/pdk \
  -e PDK_ROOT=/pdk \
  -e PDKPATH=/pdk/sky130A \
  -e OPENRAM_HOME=/openram/compiler \
  -e OPENRAM_TECH=/openram/technology \
  -e PYTHONPATH=/openram/compiler \
  -v "$PASSWD_FILE":/etc/passwd:ro \
  -v "$GROUP_FILE":/etc/group:ro \
  --user "$(id -u)":"$(id -g)" \
  -v "$(pwd)":/workspace \
  -w /workspace \
  vlsida/openram-ubuntu:latest \
  bash -lc 'python3 /openram/sram_compiler.py /workspace/config_operand_bank.py'
