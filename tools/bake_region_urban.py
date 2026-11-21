"""v0.6.3 Part 4 (briefs/V0-6-3.md): the path map's city areas and names, data/urban-region.json.

Shane, 2026-11-20: "Major cities show as distinct urban regions with their English names appearing
in that area, like google maps. No detailed streets or design is necessary."

The areas: the bake's own built-up cover (the B channel of the tiles' .c.rgba8, a share of each
cell), read from data/terrain: the 250 m tiles (r0) wherever the manifest's l0 level covers, the
1 km tiles (r1, whose built-up is Natural Earth's urban areas) in the margin. Both go onto one
500 m grid over the region (region.js's REGION_EXTENT), which is smoothed (a Gaussian of SIGMA
cells), cut at THRESHOLD, closed, cleaned of specks under MIN_KM2, polygonised (rasterio), rounded
(a buffer out and back), simplified, and its corners cut twice (Chaikin), so no stair of the grid shows close in. Holes under HOLE_KM2 are filled. What is left are a few
thousand rings: a city reads as one shape, a town as a dot of a shape, a village not at all.

The names: Natural Earth's ne_10m_populated_places_simple (public domain; reference/raw/ne/),
every place inside the region, its ASCII name (Osaka, Kobe), with FIXES for the few the file
misspells, its population (pop_max) and its place in the map frame. The screen picks by
population and zoom (src/ui/common.js, pickPlaces()).

Output (ints, metres, the map frame):
  { "v": 1, "kind": "urban", "extent": [x0, y0, x1, y1], "cell": 500,
    "credit": "...",
    "urban":  [ [size, x, y, dx, dy, ...], ... ]    rings, delta coded after the first point,
                                                    size = the larger side of the ring's box;
                                                    outer rings and the holes kept, filled even-odd
    "places": [ [name, x, y, pop], ... ]            by population, largest first }

  python3 tools/cpu-guard.py --minutes 10 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_urban.py
      (into staging, /tmp/flight-sim/v063/bake/urban-region.json; bake it after the tiles it reads are in data/)
  ... --to-data     (writes data/urban-region.json, once the staged one is looked at)
  ... --quicklook   (also writes Claude outputs/flight-sim/v063-bake-urban.png)
  ... --out <file>  (anywhere else)
"""
import gzip
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_common as bc  # noqa: E402

EXTENT = (-1600000, -1338000, 2110000, 1284000)   # region.js REGION_EXTENT
CELL = 500
STAGING = '/tmp/flight-sim/v063/bake'
# v0.7.0, Europe: its rectangle (the outline's bounding box) and staging; the tiles and the manifest are
# read from staging (bake_europe_manifest.py's manifest.json, l0/, l1/), the places kept inside the outline.
MANIFEST, DIRS = bc.MANIFEST, None
if bc.EUROPE:
    EXTENT = (-1377000, -1330000, 1422000, 1425000)
    STAGING = '/tmp/flight-sim/v070/bake'
    MANIFEST = os.path.join(STAGING, 'manifest.json')
    DIRS = {'terrain/r0/': os.path.join(STAGING, 'l0'), 'terrain/r1/': os.path.join(STAGING, 'l1')}


def tile_dir(d):
    return DIRS[d] if DIRS else os.path.join(bc.DATA, d)
SIGMA = 1.6          # cells
THRESHOLD = 0.30     # the smoothed built-up share that counts as city
MIN_KM2 = 6.0        # smaller shapes are dropped
HOLE_KM2 = 4.0       # smaller holes are filled
ROUND_M = 450        # the buffer out and back
SIMPLIFY_M = 260      # first, to turn the 500 m grid's stairs into slopes
CHAIKIN = 2           # then corner cutting, this many times, so no stair or sharp corner is left
FINAL_M = 70          # and a last light simplification
FIXES = {'Shenyeng': 'Shenyang', 'Songnam': 'Seongnam', "Puch'on": 'Bucheon', 'Mudangiang': 'Mudanjiang', 'Yingkow': 'Yingkou', 'Hyeson': 'Hyesan', 'Jinxi': 'Huludao'}
CREDIT = 'City areas: the game\'s land cover (ESA WorldCover 2021, CC BY 4.0; Natural Earth urban areas in the margin). Names: Natural Earth populated places (public domain).'


def tile_layer(path, n=516, ch=4):
    with gzip.open(path, 'rb') as f:
        return np.frombuffer(f.read(), dtype=np.uint8).reshape(n, n, ch)


def built_grid():
    """The built-up share (0..1, float32) on the 500 m grid, row 0 south."""
    m = json.load(open(MANIFEST))
    T = m['tilesRegion']
    l0, l1 = T['levels'][0], T['levels'][1]
    nx, ny = (EXTENT[2] - EXTENT[0]) // CELL, (EXTENT[3] - EXTENT[1]) // CELL
    g = np.zeros((ny, nx), np.float32)

    def put(block, x, y):
        """block: (h, w) at 500 m whose south-west corner is at map (x, y)."""
        i, j = int(round((x - EXTENT[0]) / CELL)), int(round((y - EXTENT[1]) / CELL))
        h, w = block.shape
        i0, j0, i1, j1 = max(i, 0), max(j, 0), min(i + w, nx), min(j + h, ny)
        if i1 > i0 and j1 > j0:
            g[j0:j1, i0:i1] = block[j0 - j:j1 - j, i0 - i:i1 - i]

    # The 1 km level first, each cell twice each way.
    b, ts, cell = l1['border'], l1['tile'], l1['cell']
    for name in l1['tiles']:
        ti, tj = map(int, name.split('_'))
        c = tile_layer(os.path.join(tile_dir(l1['dir']), name + '.c.rgba8.gz'), ts + 2 * b)[b:-b, b:-b, 2]
        put(np.repeat(np.repeat(c, 2, 0), 2, 1).astype(np.float32) / 255, T['x0'] + ti * ts * cell, T['y0'] + tj * ts * cell)
    # Then the 250 m level over it, wherever it covers (a covered tile with no file is open sea).
    b, ts, cell = l0['border'], l0['tile'], l0['cell']
    have = set(l0['tiles'])
    for name in l0.get('covered', l0['tiles']):
        ti, tj = map(int, name.split('_'))
        if name in have:
            c = tile_layer(os.path.join(tile_dir(l0['dir']), name + '.c.rgba8.gz'), ts + 2 * b)[b:-b, b:-b, 2].astype(np.float32) / 255
            c = c.reshape(ts // 2, 2, ts // 2, 2).mean(axis=(1, 3))
        else:
            c = np.zeros((ts // 2, ts // 2), np.float32)
        put(c, T['x0'] + ti * ts * cell, T['y0'] + tj * ts * cell)
    return g


def urban_rings(g):
    from scipy import ndimage as ndi
    from rasterio import features
    from rasterio.transform import Affine
    from shapely.geometry import shape, Polygon

    s = ndi.gaussian_filter(g, SIGMA, mode='constant')
    mask = s >= THRESHOLD
    mask = ndi.binary_closing(mask, iterations=1)
    lab, n = ndi.label(mask)
    areas = ndi.sum_labels(np.ones_like(lab, np.float32), lab, index=np.arange(1, n + 1)) * (CELL / 1000) ** 2
    keep = np.zeros(n + 1, bool)
    keep[1:] = areas >= MIN_KM2
    mask = keep[lab]
    tr = Affine(CELL, 0, EXTENT[0], 0, CELL, EXTENT[1])   # row 0 is the south row: y grows with the row
    rings = []
    for geom, val in features.shapes(mask.astype(np.uint8), mask=mask, connectivity=4, transform=tr):
        if not val:
            continue
        p = shape(geom).buffer(ROUND_M, join_style='round').buffer(-ROUND_M, join_style='round').simplify(SIMPLIFY_M)
        for poly in getattr(p, 'geoms', [p]):
            if poly.is_empty or poly.area < MIN_KM2 * 1e6:
                continue
            rings.append(list(poly.exterior.coords)[:-1])
            for hole in poly.interiors:
                if Polygon(hole).area >= HOLE_KM2 * 1e6:
                    rings.append(list(hole.coords)[:-1])
    def chaikin(r):
        # Corner cutting on a closed ring: each corner becomes two points a quarter of the way along its sides.
        for _ in range(CHAIKIN):
            n, q = len(r), []
            for i in range(n):
                (ax, ay), (bx, by) = r[i], r[(i + 1) % n]
                q.append((0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by))
                q.append((0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by))
            r = q
        s = Polygon(r).simplify(FINAL_M)
        return list(s.exterior.coords)[:-1] if s.geom_type == 'Polygon' and not s.is_empty else r

    out = []
    for r in rings:
        if len(r) >= 4:
            r = chaikin(r)
        pts = [(int(round(x)), int(round(y))) for x, y in r]
        pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        if len(pts) < 3:
            continue
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        row = [max(max(xs) - min(xs), max(ys) - min(ys)), pts[0][0], pts[0][1]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            row += [bx - ax, by - ay]
        out.append(row)
    out.sort(key=lambda r: -r[0])
    return out, mask


def places():
    g = json.load(open(os.path.join(bc.RAW, 'ne', 'ne_10m_populated_places_simple.geojson')))
    rows = []
    inside = None
    if bc.EUROPE:
        from shapely.geometry import Point, Polygon
        la, lo = bc.outline_latlon(0.25)
        ring = Polygon(np.stack([lo, la], 1))
        inside = lambda lat, lon: ring.contains(Point(lon, lat))
    for f in g['features']:
        p = f['properties']
        lon, lat = f['geometry']['coordinates']
        x, y = bc.to_map(lat, lon)
        x, y = float(x), float(y)
        if not (EXTENT[0] < x < EXTENT[2] and EXTENT[1] < y < EXTENT[3]):
            continue
        if inside is not None and not inside(lat, lon):
            continue
        name = p.get('nameascii') or p.get('name') or ''
        name = FIXES.get(name, name)
        if not name:
            continue
        rows.append([name, int(round(x)), int(round(y)), int(p.get('pop_max') or 0)])
    rows.sort(key=lambda r: (-r[3], r[0]))
    return rows


def main():
    # Staging by default (the bake's rule: never straight into data/); --to-data writes data/urban-region.json.
    os.makedirs(STAGING, exist_ok=True)
    out = os.path.join(bc.DATA if '--to-data' in sys.argv else STAGING, 'urban-region.json')
    if '--out' in sys.argv:
        out = sys.argv[sys.argv.index('--out') + 1]
    g = built_grid()
    rings, mask = urban_rings(g)
    pl = places()
    doc = {'v': 1, 'kind': 'urban', 'extent': list(EXTENT), 'cell': CELL, 'credit': CREDIT, 'urban': rings, 'places': pl}
    with open(out + '.tmp', 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    os.replace(out + '.tmp', out)
    pts = sum((len(r) - 1) // 2 for r in rings)
    print(f'{out}: {os.path.getsize(out)} bytes, {len(rings)} rings, {pts} points, {len(pl)} places; '
          f'city cells {int(mask.sum())} ({mask.sum() * (CELL / 1000) ** 2:.0f} km2)')
    if '--quicklook' in sys.argv:
        # One pixel per 2 km: land cover's built share in grey, the city mask in amber.
        k = 4
        h, w = mask.shape[0] // k * k, mask.shape[1] // k * k
        a = g[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3))
        mm = mask[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3))
        img = np.zeros((h // k, w // k, 3), np.uint8)
        img[..., 0] = np.clip(40 + a * 400 + mm * 215, 0, 255)
        img[..., 1] = np.clip(40 + a * 400 + mm * 150, 0, 255)
        img[..., 2] = np.clip(40 + a * 400, 0, 255)
        bc.write_png(os.path.join(bc.SHOTS, 'v070-bake-urban.png' if bc.EUROPE else 'v063-bake-urban.png'), bc.south_up_to_image(img))


if __name__ == '__main__':
    main()
