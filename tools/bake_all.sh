#!/bin/bash
# Runs the whole bake, one guarded command per step (each well under 20 min and 3 GB).
# Needs: /tmp/flight-sim/venv (numpy, tifffile, imagecodecs, osmium, shapely, scipy,
# rasterio), osmium-tool (brew install osmium-tool), and the inputs in reference/raw/.
# Optional edge tiles (North Korea north of 39 N, Kyushu south of 33 N), same URL pattern:
#   mkdir -p /tmp/flight-sim/bake/dem90extra && cd /tmp/flight-sim/bake/dem90extra
#   for lat in 32 39; do for lon in 123 124 125 126 127 128 129 130 131; do
#     t=Copernicus_DSM_COG_30_N${lat}_00_E${lon}_00_DEM
#     curl -fsS -o $t.tif https://copernicus-dem-90m.s3.eu-central-1.amazonaws.com/$t/$t.tif || rm -f $t.tif
#   done; done
# Usage (from games/flight-sim/): tools/bake_all.sh [--fresh]   (--fresh drops the caches)
set -e
cd "$(dirname "$0")/.."
PY="/tmp/flight-sim/venv/bin/python -I"
G="python3 tools/cpu-guard.py"
if [ "$1" = "--fresh" ]; then rm -f /tmp/flight-sim/bake/geom_*.pkl /tmp/flight-sim/bake/*.rec; fi
$G --label bake-height    -- $PY tools/bake_height.py
$G --label bake-osm-nat   -- $PY tools/bake_osm_extract.py national
$G --label bake-osm-bld   -- $PY tools/bake_osm_extract.py buildings
$G --label bake-osm-apt   -- $PY tools/bake_osm_extract.py airports
$G --label bake-water     -- $PY tools/bake_water.py
$G --label bake-airports  -- $PY tools/bake_airports.py
$G --label bake-cover     -- $PY tools/bake_cover.py
$G --label bake-patches   -- $PY tools/bake_patches.py
$G --label bake-quicklook -- $PY tools/bake_quicklook.py height water cover patches spots
