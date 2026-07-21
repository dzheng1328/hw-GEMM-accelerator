#!/usr/bin/env bash
# Fetch the sky130_fd_sc_hd typical-corner liberty file (~11 MB) into
# synth/lib/ (gitignored -- third-party PDK data is fetched, not committed).
# Source: the OpenROAD-flow-scripts repo, which vendors the assembled .lib
# (Google/SkyWater's own repo only holds per-cell .lib.json fragments, not
# the merged liberty -- found out via a 404 on the first attempt).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)/lib"
LIB="sky130_fd_sc_hd__tt_025C_1v80.lib"
mkdir -p "$DIR"
if [ -f "$DIR/$LIB" ]; then
  echo "already present: $DIR/$LIB"
  exit 0
fi
URL="https://raw.githubusercontent.com/The-OpenROAD-Project/OpenROAD-flow-scripts/master/flow/platforms/sky130hd/lib/$LIB"
echo "fetching $URL"
curl -fSL -o "$DIR/$LIB.tmp" "$URL"
mv "$DIR/$LIB.tmp" "$DIR/$LIB"
echo "fetched -> $DIR/$LIB ($(du -h "$DIR/$LIB" | cut -f1))"
