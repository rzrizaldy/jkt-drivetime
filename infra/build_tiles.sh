#!/usr/bin/env bash
# Download Geofabrik Indonesia/Java OSM extract, clip to Jabodetabek, place for Valhalla.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$ROOT/infra"
DATA_DIR="${VALHALLA_DATA_DIR:-$ROOT/valhalla_tiles}"
mkdir -p "$DATA_DIR"

PBF_REMOTE="https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
FULL_PBF="$DATA_DIR/java-latest.osm.pbf"
CLIP_PBF="$DATA_DIR/jabodetabek.osm.pbf"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if [[ ! -f "$FULL_PBF" ]]; then
  echo "Downloading $PBF_REMOTE (large)..."
  curl -L -o "$FULL_PBF.partial" "$PBF_REMOTE"
  mv "$FULL_PBF.partial" "$FULL_PBF"
fi

# Osmium: clip using bbox from jabodetabek.geojson (106.32,-6.78,107.22,-5.92)
if command -v osmium >/dev/null 2>&1; then
  echo "Clipping with osmium to $CLIP_PBF..."
  osmium extract -b 106.32,-6.78,107.22,-5.92 "$FULL_PBF" -o "$CLIP_PBF" --overwrite
else
  echo "osmium not found; copying full extract (slow tile build). Install osmium-tool for a smaller clip." >&2
  cp -f "$FULL_PBF" "$CLIP_PBF"
fi

echo "Placing PBF for gis-ops/valhalla docker (mount this dir as /custom_files)."
echo "Done. Output: $CLIP_PBF"
