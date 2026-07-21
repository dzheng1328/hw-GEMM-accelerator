#!/usr/bin/env bash
# Fetch the sky130_fd_sc_hd typical-corner liberty file (~11 MB) into
# synth/lib/ (gitignored -- third-party PDK data is fetched, not committed).
# Source: Google/SkyWater's official sky130 standard-cell repo on GitHub.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)/lib"
LIB="sky130_fd_sc_hd__tt_025C_1v80.lib"
mkdir -p "$DIR"
if [ -f "$DIR/$LIB" ]; then
  echo "already present: $DIR/$LIB"
  exit 0
fi
for BR in main master; do
  URL="https://raw.githubusercontent.com/google/skywater-pdk-libs-sky130_fd_sc_hd/$BR/timing/$LIB"
  echo "trying $URL"
  if curl -fSL -o "$DIR/$LIB.tmp" "$URL"; then
    mv "$DIR/$LIB.tmp" "$DIR/$LIB"
    echo "fetched -> $DIR/$LIB ($(du -h "$DIR/$LIB" | cut -f1))"
    exit 0
  fi
done
echo "FAILED to fetch $LIB from either branch" >&2
exit 1
