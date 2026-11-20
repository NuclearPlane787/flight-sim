"""South Korea's mask for the local rules' blend (briefs/V0-6-0.md, Part 5 step 1, "Magnetic variation").

frame.js's magVar() is today's plane exactly inside south-korea.poly (Geofabrik's boundary of
Korea's OSM extract, the one the region's bake cut Korea with) and WMM2025 elsewhere, blended
across a band of about 50 km just outside the poly. The poly is git-ignored, so the game reads
this raster instead: the distance outside the poly, in the map frame (src/world/frame.js).

Encoding (data/krmask.u8.gz, header data/krmask.json):
  uint8, ny rows x nx, row 0 = south, cell-centred (value (i, j) is at x0 + (i + 0.5) * cell,
  y0 + (j + 0.5) * cell), 2 km cells over Korea's old 800 km square and the poly's box, plus
  60 km all round.
  value q = clip(floor((d - MARGIN) / UNIT), 0, 255), d the distance (m) from the cell centre to
  the poly (0 inside it), MARGIN 3,000 m, UNIT 200 m.
  At runtime (geo-rules.js krBlend()): D = bilinear(q) * UNIT, the blend weight
  w = smoothstep(min(D / BAND, 1)), BAND 47,000 m; outside the raster w = 1.

Why the weight is exactly 0 everywhere inside the poly: a bilinear sample reads the four cell
centres round the point, each at most cell * sqrt(2) = 2,828 m from it. For a point inside the
poly each of them is then at most 2,828 m outside it, under MARGIN, so all four store 0 and the
sample is 0 + (0 - 0) * u = 0 exactly. (So the plane also holds a cell or so outside the poly.)
The weight reaches 1 at d of about 50 km (MARGIN + BAND, the floor's 200 m at most later).
The raster's edge is at least 60 km from the poly, so its edge cells are all 255 and the
"outside the raster: 1" rule meets them without a step.

Run (from the game folder; about 10 s):
  python3 tools/cpu-guard.py --minutes 5 -- /tmp/flight-sim/venv/bin/python -I tools/bake_krmask.py
"""
import gzip
import json
import os
import sys

import numpy as np
import shapely

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
DATA = os.path.join(GAME, 'data')
POLY = os.path.join(GAME, 'reference', 'raw', 'osm', 'south-korea.poly')

CELL = 2000.0
PAD = 60000.0
MARGIN = 3000.0
UNIT = 200.0
BAND = 47000.0

sys.path.insert(0, HERE)
from bake_region_compose import read_poly, inside_poly  # noqa: E402  (map-frame rings, even-odd test)


def main():
    rings = read_poly()
    if len(rings) != 1:
        raise SystemExit(f'expected one ring in {POLY}, got {len(rings)}')
    ring = rings[0]
    poly = shapely.Polygon(ring)
    if not poly.is_valid:
        raise SystemExit('the poly is not a valid polygon')
    bx0, by0 = min(ring[:, 0].min(), -400000.0), min(ring[:, 1].min(), -400000.0)
    bx1, by1 = max(ring[:, 0].max(), 400000.0), max(ring[:, 1].max(), 400000.0)
    x0 = np.floor((bx0 - PAD) / CELL) * CELL
    y0 = np.floor((by0 - PAD) / CELL) * CELL
    nx = int(np.ceil((bx1 + PAD - x0) / CELL))
    ny = int(np.ceil((by1 + PAD - y0) / CELL))
    xs = x0 + (np.arange(nx) + 0.5) * CELL
    ys = y0 + (np.arange(ny) + 0.5) * CELL
    X, Y = np.meshgrid(xs, ys)
    pts = shapely.points(X.ravel(), Y.ravel())
    d = shapely.distance(poly, pts).reshape(ny, nx)          # 0 inside
    ins = inside_poly(X, Y, rings)                           # the compose bake's own test
    if np.any(d[ins] > 1e-6):
        raise SystemExit('a cell inside by the even-odd test has a distance outside')
    q = np.clip(np.floor((d - MARGIN) / UNIT), 0, 255).astype(np.uint8)
    # Checks: every inside cell and its 8 neighbours store 0; the edge is saturated.
    pad = np.pad(q, 1, mode='edge').astype(int)
    nb = np.zeros_like(q, dtype=int)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            nb = np.maximum(nb, pad[1 + dj:1 + dj + ny, 1 + di:1 + di + nx])
    if np.any(nb[ins] != 0):
        raise SystemExit('an inside cell has a non-zero neighbour')
    edge = np.concatenate([q[0], q[-1], q[:, 0], q[:, -1]])
    if np.any(edge != 255):
        raise SystemExit('the raster edge is not saturated')

    out = os.path.join(DATA, 'krmask.u8.gz')
    with gzip.GzipFile(out + '.tmp', 'wb', compresslevel=9, mtime=0) as f:
        f.write(np.ascontiguousarray(q).tobytes())
    os.replace(out + '.tmp', out)
    header = {
        'what': "South Korea's mask for the local rules' blend: the distance outside south-korea.poly "
                "(Geofabrik's boundary of Korea's OSM extract), from tools/bake_krmask.py",
        'type': 'uint8',
        'rowOrder': 'south first',
        'sampling': 'cell-centred: value (i, j) is at x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell',
        'encoding': 'q = clip(floor((d - marginM) / unitM), 0, 255), d the distance (m) outside the poly, 0 inside',
        'blend': 'w = smoothstep(min(bilinear(q) * unitM / bandM, 1)); w = 1 outside the raster; '
                 'w is exactly 0 everywhere inside the poly (marginM exceeds cell * sqrt(2))',
        'file': 'krmask.u8.gz',
        'frame': 'src/world/frame.js map metres',
        'marginM': MARGIN, 'unitM': UNIT, 'bandM': BAND,
        'x0': float(x0), 'y0': float(y0), 'cell': CELL, 'nx': nx, 'ny': ny,
        'insideCells': int(ins.sum()), 'zeroCells': int((q == 0).sum()),
    }
    with open(os.path.join(DATA, 'krmask.json'), 'w') as f:
        json.dump(header, f, indent=2)
        f.write('\n')
    print(f'krmask: {nx} x {ny} cells of {CELL:.0f} m from ({x0:.0f}, {y0:.0f}); '
          f'{header["insideCells"]} inside, {header["zeroCells"]} zero; {os.path.getsize(out)} bytes')


if __name__ == '__main__':
    main()
