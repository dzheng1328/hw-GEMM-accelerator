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
# OpenRAM's own docker/ + openram.mk `mount` target (with the
# FREEPDK45 mount dropped -- this project only uses sky130A).
#
# Requires Docker Desktop running, and a local sky130 PDK already fetched by
# volare (this repo's openlane/run_pe.sh is what originally fetched it).
#
# See .superpowers/sdd/2026-08-29-operand-mem-sram-macro/ for the design spec
# and Task 1/2's ruling/report on how these facts were confirmed.
#
# OPENRAM_COMMIT: pinned to a specific commit on OpenRAM's `stable` branch
# (not the floating branch name, and not the v1.2.48 release tag this was
# originally pinned to -- see Task 2's ruling) because three commits past
# v1.2.48 directly fix real bugs this macro's generation hit: a sky130 1rw
# LVS col_cap pin-order mismatch (ec28bc6dfdc02a5ae33b789721cb5ff1830904da),
# a sky130 1rw characterization address-bit-ordering crash
# (6d14626a75f82113b812a20141b2f352a2502112), and a spare-cols routing
# short-circuit fix (ed369f1af468110a230ffbde17e9159f2f021a4e). All three
# confirmed as real ancestors of this pinned commit via
# `git merge-base --is-ancestor`. The pinned PDK commits
# (sky130_fd_bd_sram, skywater-pdk) in this commit's Makefile are unchanged
# from v1.2.48's, so no new PDK fetch is implied by this bump.
OPENRAM_COMMIT="b2b069ce119d1488cbe6883b2240bceb5c7ce29a"
OPENRAM_SRC="$(pwd)/.openram-src"

# --- Step 1: clone (or update) OpenRAM source at the pinned commit ---
if [ -d "$OPENRAM_SRC/.git" ]; then
  echo "OpenRAM source already present at $OPENRAM_SRC -- updating to $OPENRAM_COMMIT"
  git -C "$OPENRAM_SRC" fetch --depth 1 origin "$OPENRAM_COMMIT"
  git -C "$OPENRAM_SRC" checkout "$OPENRAM_COMMIT"
else
  echo "Cloning OpenRAM into $OPENRAM_SRC and checking out $OPENRAM_COMMIT"
  git clone https://github.com/VLSIDA/OpenRAM.git "$OPENRAM_SRC"
  git -C "$OPENRAM_SRC" fetch --depth 1 origin "$OPENRAM_COMMIT"
  git -C "$OPENRAM_SRC" checkout "$OPENRAM_COMMIT"
fi

# --- Step 2: resolve the local sky130 PDK_ROOT dynamically (volare-managed) ---
VOLARE_SKY130_VERSIONS="$HOME/.volare/volare/sky130/versions"
VOLARE_PDK_ROOT="$(find "$VOLARE_SKY130_VERSIONS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)"
if [ -z "$VOLARE_PDK_ROOT" ]; then
  echo "ERROR: no sky130 PDK found under $VOLARE_SKY130_VERSIONS" >&2
  echo "openlane/run_pe.sh is what originally fetched this PDK via volare -- run it (or its PDK-fetch step) first." >&2
  exit 1
fi
echo "Using volare sky130A at $VOLARE_PDK_ROOT"

# --- Step 2b: assemble a local PDK_ROOT-shaped dir for OpenRAM's sky130-install ---
#
# OpenRAM's own bitcell library (sky130_fd_bd_sram) has no matching SPICE
# model out of the box -- its `make sky130-install` target (see
# .openram-src/Makefile at the pinned commit, and this task's ruling) populates
# technology/sky130/{gds_lib,mag_lib,sp_lib,...} inside the OpenRAM checkout
# from three PDK_ROOT-sibling dirs: sky130A (already have it via volare, just
# symlinked in -- not re-fetched), skywater-pdk (two submodules only), and
# sky130_fd_bd_sram (OpenRAM's own pinned bitcell mirror). This is a one-time
# setup per host; each step below is skipped if already present.
PDK_ROOT="$(pwd)/.pdk-root"
mkdir -p "$PDK_ROOT"

if [ ! -e "$PDK_ROOT/sky130A" ]; then
  echo "Symlinking sky130A into local PDK_ROOT ($PDK_ROOT/sky130A -> $VOLARE_PDK_ROOT/sky130A)"
  ln -s "$VOLARE_PDK_ROOT/sky130A" "$PDK_ROOT/sky130A"
fi

SKYWATER_PDK_COMMIT="f70d8ca46961ff92719d8870a18a076370b85f6c"
if [ ! -d "$PDK_ROOT/skywater-pdk/.git" ]; then
  echo "Cloning skywater-pdk at $SKYWATER_PDK_COMMIT (this can take several minutes)"
  git clone https://github.com/google/skywater-pdk.git "$PDK_ROOT/skywater-pdk"
  git -C "$PDK_ROOT/skywater-pdk" checkout "$SKYWATER_PDK_COMMIT"
  git -C "$PDK_ROOT/skywater-pdk" submodule update --init \
    libraries/sky130_fd_pr/latest libraries/sky130_fd_sc_hd/latest
else
  echo "skywater-pdk already present at $PDK_ROOT/skywater-pdk -- skipping clone"
fi

SKY130_FD_BD_SRAM_COMMIT="dd64256961317205343a3fd446908b42bafba388"
if [ ! -d "$PDK_ROOT/sky130_fd_bd_sram/.git" ]; then
  echo "Cloning sky130_fd_bd_sram at $SKY130_FD_BD_SRAM_COMMIT"
  git clone https://github.com/vlsida/sky130_fd_bd_sram.git "$PDK_ROOT/sky130_fd_bd_sram"
  git -C "$PDK_ROOT/sky130_fd_bd_sram" checkout "$SKY130_FD_BD_SRAM_COMMIT"
else
  echo "sky130_fd_bd_sram already present at $PDK_ROOT/sky130_fd_bd_sram -- skipping clone"
fi

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
  -v "$VOLARE_PDK_ROOT/sky130A":/pdk/sky130A:ro \
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
  bash -lc '
    set -e
    echo "Running make sky130-install (bitcell library setup; -B force-rebuild in this OpenRAM checkout makes this safe to re-run)..."
    cd /openram && PDK_ROOT=/pdk OPENRAM_HOME=/openram/compiler make sky130-install
    cd /workspace
    python3 /openram/sram_compiler.py /workspace/config_operand_bank.py
  '
