"""v0.6.0 Part 2 step 3 (its last sentence) and Part 4 steps 2-3: the region's coastline for the
path map, the NDs and the setup's mini map: data/coast-region.json. data/coast.json (Korea's,
bake_water.py) stays as it is for the flag off.

The land: OpenStreetMap's land polygons (split, EPSG:4326, /tmp/flight-sim/v060/landpoly/), read
with a bounding box per block (bake_region_water.py's record-bbox index), never all at once. The
region (region.js's REGION_EXTENT, x -1,600..2,110 km, y -1,338..1,284 km in map metres) is cut
into blocks of 512 km. For each block, the records it touches are projected to the map frame,
clipped to the block (+2 km), and unioned on a 1 m grid (the split's overlaps dissolve), and
the result is cached (/tmp/flight-sim/v060/map-work/blocks/<bi>_<bj>.wkb; resumable).

Then six levels of detail, each simplified per block and cut into square cells so the screens
draw only the cells in view and a big island (Honshu) is never traced whole:

  level  tolerance                   cell     smallest island kept
  0      80 m (250 m outside FINE)   64 km    0.04 km2 (0.5 km2 outside FINE)
  1      200 m (250 m outside FINE)  64 km    0.1 km2 (0.5 km2 outside FINE)
  2      400 m                       128 km   0.5 km2
  3      800 m                       128 km   2 km2
  4      1.5 km                      256 km   8 km2
  5      6 km                        none     100 km2

Korea's file has four (common.js TOLS: 0, 400, 1500, 6000); the region's two in between (200 m
and 800 m) keep the NDs' busiest views (the Seto Inland Sea at 20 and 80 nm) from tracing three
times the points they need. The last level is not cut (one cell, the whole extent: the blocks pre-simplified at 300 m, unioned, then
simplified), so the setup's mini map, which strokes the land's rings as they are (traceRings),
shows no cell edges at the region's scale. Each cell's pieces are exact cuts (clip_by_rect), so the land fills without seams and the
screens stroke a ring's edges except those on its cell's edge (common.js, traceCoastLines()).
The screens pick the coarsest level whose tolerance is at most 1.5 px (common.js lod()), as for
Korea's file.

Inland water: the big lakes and the widest rivers, from the region's water tiles (WorldCover's
permanent water minus the sea, bake_region_water.py's G channel, 250 m), as polygons of 20 km2
or more, simplified at 150 m, outside Korea's old square; inside it, coast.json's own water rings
(OSM), clipped to the square. Filled only, never stroked.

Output (ints, metres, map frame):
  { "v": 2, "kind": "region",
    "extent": [x0, y0, x1, y1],            the region's rectangle (= the cells' grid origin x0, y0)
    "levels": [ { "tol": 80, "cell": 64000,
                  "rings": [ [ci, cj, size, x, y, dx, dy, dx, dy, ...], ... ] }, ... ],
    "water": [ [x, y, dx, dy, ...], ... ] }   rings, delta coded, not closed
  ci, cj: the ring's cell (its box = the cell cut by the extent); size: the bounding size (m) of the
  island the piece was cut from (the screens' small-island filter); then the ring, delta coded,
  not closed. Holes are rings too (the screens fill even-odd).

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_coast.py
  ... --blocks-only   (stage 1 only)    ... --stats   (the written file's numbers)
  ... --water-only    (v0.6.1: the inland water again, the written file's land levels kept as they are)
"""
import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None          # bake_common makes data/ folders on import; not here
try:
    import bake_common as bc
    import bake_geom as bg
finally:
    os.makedirs = _makedirs

import shapely
import shapefile
from rasterio import features
from shapely.geometry import box, shape as to_shape

REGION = (-1600000, -1338000, 2110000, 1284000)
FINE = (-912000, -784000, 1520000, 624000)
KOREA = (-400000, -400000, 400000, 400000)
BLOCK = 512000
NBX = int(np.ceil((REGION[2] - REGION[0]) / BLOCK))
NBY = int(np.ceil((REGION[3] - REGION[1]) / BLOCK))
LEVELS = [  # tol (fine, margin), cell, min area (fine, margin) m2
    dict(tol=(80, 250), cell=64000, area=(40000, 500000)),
    dict(tol=(200, 250), cell=64000, area=(100000, 500000)),
    dict(tol=(400, 400), cell=128000, area=(500000, 500000)),
    dict(tol=(800, 800), cell=128000, area=(2e6, 2e6)),
    dict(tol=(1500, 1500), cell=256000, area=(8e6, 8e6)),
    dict(tol=(6000, 6000), cell=None, area=(1e8, 1e8)),   # uncut: one cell, the whole extent
]
WHOLE = 4096000                 # level 3's one cell (>= the extent's width and height)
WORK = '/tmp/flight-sim/v060/map-work'
BLOCKS = os.path.join(WORK, 'blocks')
LANDPOLY = '/tmp/flight-sim/v060/landpoly/land-polygons-split-4326/land_polygons'
LPINDEX = '/tmp/flight-sim/v060/landpoly/bbox_index.npy'
WATER_TILES = '/tmp/flight-sim/v060/bake/water'
OUT = os.path.join(bc.DATA, 'coast-region.json')
KOREA_COAST = os.path.join(bc.DATA, 'coast.json')


def block_rect(bi, bj):
    x0, y0 = REGION[0] + bi * BLOCK, REGION[1] + bj * BLOCK
    return x0, y0, x0 + BLOCK, y0 + BLOCK


def geo_bbox(x0, y0, x1, y1, pad=0.05):
    t = np.linspace(0, 1, 33)
    xs = np.concatenate([x0 + (x1 - x0) * t, np.full_like(t, x1), x1 - (x1 - x0) * t, np.full_like(t, x0)])
    ys = np.concatenate([np.full_like(t, y0), y0 + (y1 - y0) * t, np.full_like(t, y1), y1 - (y1 - y0) * t])
    lat, lon = bc.to_geo(xs, ys)
    return lon.min() - pad, lat.min() - pad, lon.max() + pad, lat.max() + pad


def block_path(bi, bj):
    return os.path.join(BLOCKS, f'{bi}_{bj}.wkb')


def bake_block(bi, bj, idx, reader):
    p = block_path(bi, bj)
    if os.path.exists(p):
        return None
    x0, y0, x1, y1 = block_rect(bi, bj)
    m = 2000
    lon0, lat0, lon1, lat1 = geo_bbox(x0 - m, y0 - m, x1 + m, y1 + m)
    sel = (idx[:, 1] <= lon1) & (idx[:, 3] >= lon0) & (idx[:, 2] <= lat1) & (idx[:, 4] >= lat0)
    t0 = time.time()
    geoms, pts = [], 0
    for k in idx[sel, 0].astype(int):
        g = to_shape(reader.shape(int(k)).__geo_interface__)
        if not g.is_valid:
            g = shapely.make_valid(g)
        g = shapely.clip_by_rect(bg.project(g), x0 - m, y0 - m, x1 + m, y1 + m)
        if not g.is_empty:
            pts += shapely.get_num_coordinates(g)
            geoms.append(g)
    u = shapely.union_all(geoms, grid_size=1.0) if geoms else shapely.Polygon()
    os.makedirs(BLOCKS, exist_ok=True)
    with open(p + '.tmp', 'wb') as f:
        f.write(shapely.to_wkb(u))
    os.replace(p + '.tmp', p)
    return dict(records=int(sel.sum()), pts=int(pts), out=int(shapely.get_num_coordinates(u)), s=time.time() - t0)


def load_block(bi, bj):
    with open(block_path(bi, bj), 'rb') as f:
        return shapely.from_wkb(f.read())


def polys_of(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    if g.geom_type in ('MultiPolygon', 'GeometryCollection'):
        out = []
        for q in g.geoms:
            out.extend(polys_of(q))
        return out
    return []


def overlaps(a, b):
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def encode(ci, cj, size, coords):
    c = np.round(np.asarray(coords)[:-1]).astype(np.int64)   # drop the closing point
    # drop repeated points after rounding
    keep = np.ones(len(c), bool)
    keep[1:] = np.any(c[1:] != c[:-1], axis=1)
    c = c[keep]
    if len(c) < 3:
        return None
    d = c.copy()
    d[1:] -= c[:-1]
    return [int(ci), int(cj), int(size)] + d.ravel().tolist()


def whole_rings(L, blocks):
    pre = [b.simplify(300, preserve_topology=True) for b in blocks.values() if not b.is_empty]
    u = shapely.clip_by_rect(shapely.union_all(pre, grid_size=1.0), *REGION)
    s = u.simplify(L['tol'][0], preserve_topology=True)
    rings, verts = [], 0
    for p in polys_of(s):
        if p.area < L['area'][0]:
            continue
        pb = p.bounds
        size = max(pb[2] - pb[0], pb[3] - pb[1])
        for ring in [p.exterior, *p.interiors]:
            e = encode(0, 0, size, ring.coords)
            if e:
                rings.append(e)
                verts += (len(e) - 3) // 2
    return rings, verts


def level_rings(L, blocks):
    cell = L['cell']
    if cell is None:
        return whole_rings(L, blocks)
    rings, verts = [], 0
    for (bi, bj), g in blocks.items():
        if g.is_empty:
            continue
        bx0, by0, bx1, by1 = block_rect(bi, bj)
        simp = {}
        n = BLOCK // cell
        for a in range(n):
            for b in range(n):
                cx0, cy0 = bx0 + a * cell, by0 + b * cell
                r = (max(cx0, REGION[0]), max(cy0, REGION[1]), min(cx0 + cell, REGION[2]), min(cy0 + cell, REGION[3]))
                if r[0] >= r[2] or r[1] >= r[3]:
                    continue
                fine = 0 if overlaps(r, FINE) else 1
                if fine not in simp:
                    s = g.simplify(L['tol'][fine], preserve_topology=True)
                    ps = [p for p in polys_of(s) if p.area >= L['area'][fine]]
                    simp[fine] = [(p, p.bounds) for p in ps]
                ci, cj = (r[0] - REGION[0]) // cell, (r[1] - REGION[1]) // cell
                for p, pb in simp[fine]:
                    if not overlaps(pb, r):
                        continue
                    size = max(pb[2] - pb[0], pb[3] - pb[1])
                    piece = p if (pb[0] >= r[0] and pb[1] >= r[1] and pb[2] <= r[2] and pb[3] <= r[3]) \
                        else shapely.clip_by_rect(p, *r)
                    for q in polys_of(piece):
                        for ring in [q.exterior, *q.interiors]:
                            e = encode(ci, cj, size, ring.coords)
                            if e:
                                rings.append(e)
                                verts += (len(e) - 3) // 2
    return rings, verts


def lakes():
    """Inland water rings: WorldCover's (the water tiles) outside Korea's square, coast.json's inside."""
    gs = []
    for name in sorted(os.listdir(WATER_TILES)):
        if not name.endswith('.npy') or name.count('_') != 1:
            continue
        try:
            ti, tj = (int(v) for v in name[:-4].split('_'))
        except ValueError:
            continue
        a = np.load(os.path.join(WATER_TILES, name), mmap_mode='r')
        if a.shape != (516, 516, 2):
            continue
        m = (np.asarray(a[2:514, 2:514, 1]) < 128).astype(np.uint8)
        if not m.any():
            continue
        x0 = bc.NAT['x0'] + ti * 512 * 250.0
        y0 = bc.NAT['y0'] + tj * 512 * 250.0
        tr = bg.transform_for(x0, y0, 250.0, 512)
        x1, y1 = x0 + 512 * 250.0, y0 + 512 * 250.0
        for geom, v in features.shapes(m[::-1].copy(), mask=m[::-1].copy() > 0, transform=tr):
            g = to_shape(geom)
            # v0.6.1: a piece that touches its tile's edge may be part of a lake or a wide river cut
            # small by that edge: keep it whatever its area (filtered after the union, below), or the
            # water ends in a straight line on the tile's edge (the seam at x = -528 km).
            gb = g.bounds
            edge = gb[0] <= x0 + 1 or gb[1] <= y0 + 1 or gb[2] >= x1 - 1 or gb[3] >= y1 - 1
            if edge or g.area >= 250000:
                gs.append(g)
    u = shapely.union_all(gs, grid_size=1.0) if gs else shapely.Polygon()
    u = shapely.MultiPolygon([p for p in polys_of(u) if p.area >= 250000])
    sq = box(*KOREA)
    out = []
    def put(ring):
        e = encode(0, 0, 0, ring.coords)
        if e:
            out.append(e[3:])
    for p in polys_of(u):
        if p.area < 20e6:
            continue
        s = p.simplify(150, preserve_topology=True).difference(sq)
        for q in polys_of(s):
            if q.area < 2e6:
                continue
            for ring in [q.exterior, *q.interiors]:
                put(ring)
    n_wc = len(out)
    with open(KOREA_COAST) as f:
        kw = json.load(f).get('water', [])
    for r in kw:
        g = shapely.Polygon(r)
        if not g.is_valid:
            g = shapely.make_valid(g)
        for q in polys_of(shapely.clip_by_rect(g, *KOREA)):
            put(q.exterior)
    return out, n_wc


def stats():
    with open(OUT) as f:
        d = json.load(f)
    print(f'{OUT}: {os.path.getsize(OUT) / 1e6:.2f} MB')
    for k, L in enumerate(d['levels']):
        v = sum((len(r) - 3) // 2 for r in L['rings'])
        print(f'  level {k}: tol {L["tol"]} m, cell {L["cell"] // 1000} km, {len(L["rings"])} rings, {v} vertices')
    print(f'  water: {len(d["water"])} rings, {sum(len(r) // 2 for r in d["water"])} vertices')


def water_only():
    """Bake the inland water again into the written file; its land levels stay as they are, byte for byte."""
    with open(OUT) as f:
        out = json.load(f)
    water, n_wc = lakes()
    print(f'water: {len(water)} rings ({n_wc} from WorldCover outside Korea\'s square)', flush=True)
    out['water'] = water
    with open(OUT + '.tmp', 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    os.replace(OUT + '.tmp', OUT)
    stats()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--blocks-only', action='store_true')
    ap.add_argument('--stats', action='store_true')
    ap.add_argument('--water-only', action='store_true')
    args = ap.parse_args()
    if args.stats:
        return stats()
    if args.water_only:
        return water_only()
    idx = np.load(LPINDEX)
    reader = shapefile.Reader(LANDPOLY)
    t0 = time.time()
    for bj in range(NBY):
        for bi in range(NBX):
            r = bake_block(bi, bj, idx, reader)
            if r:
                print(f'block {bi},{bj}: {r}', flush=True)
    print(f'blocks done in {time.time() - t0:.0f} s', flush=True)
    if args.blocks_only:
        return
    blocks = {(bi, bj): load_block(bi, bj) for bj in range(NBY) for bi in range(NBX)}
    levels = []
    for k, L in enumerate(LEVELS):
        t1 = time.time()
        rings, verts = level_rings(L, blocks)
        print(f'level {k}: {len(rings)} rings, {verts} vertices, {time.time() - t1:.0f} s', flush=True)
        levels.append(dict(tol=L['tol'][0], cell=L['cell'] or WHOLE, rings=rings))
    water, n_wc = lakes()
    print(f'water: {len(water)} rings ({n_wc} from WorldCover outside Korea\'s square)', flush=True)
    out = dict(v=2, kind='region', extent=list(REGION), levels=levels, water=water)
    with open(OUT + '.tmp', 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    os.replace(OUT + '.tmp', OUT)
    stats()


if __name__ == '__main__':
    main()
