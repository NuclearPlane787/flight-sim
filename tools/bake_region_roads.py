"""v0.7.9 (briefs/V0-7-9.md part 3): the main roads, from OpenStreetMap (ODbL), for the city lights at night.

OSM's motorways, trunks, primary roads and motorway links, clipped to the region's map rectangle, simplified and
quantised, in one small gzipped file per 64 km cell of the region's lattice (cell (i, j) covers x0 + i*64 km .. +64 km,
x0/y0 the lattice origin from bake_common.lattice(); 64 km rather than 32 so that data/ holds about 40 % as many
files, each taking a disk block), so the game loads only the
cells near the camera. Written to a staging folder only: FS_ROADS_OUT (required); it refuses the game's data/.

Stages (each its own guarded command; filter skips an extract whose output exists, unless --force):
  filter  osmium tags-filter w/highway=motorway,trunk,primary,motorway_link, one pass per extract, into FS_ROADS_WORK
          (default /tmp/flight-sim/v079/lights/osm/<name>-roads.osm.pbf). The extracts are never read whole by Python.
  bake    pyosmium over the filtered files (node locations from the small files only), dedupe by way id, project
          (bake_common.to_map), clip, Douglas-Peucker to SIMPLIFY_M, cut at the 64 km cells, quantise to 1 m.

  python3 tools/cpu-guard.py --minutes 15 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_roads.py filter kanto
  FS_ROADS_OUT=/tmp/.../install python3 tools/cpu-guard.py --minutes 15 -- /tmp/flight-sim/venv/bin/python -I \
      tools/bake_region_roads.py bake            (FS_REGION=europe for Europe)

The format (little-endian), roads/<i>_<j>.bin.gz (gzip 9, mtime 0):
  header  u32 magic 'FSR1', u32 lineCount, u32 vertexCount
  lineCount records of 4 bytes: u8 class (0 motorway, 1 trunk, 2 primary, 3 motorway link), u8 flags (bit 0: one way,
      the vertices in the direction of travel), u16 nVerts (2..65535)
  then every line's vertices in record order: its first as u16 x, u16 y, metres east and north of the cell's south-west
      corner (0..64000), the rest as i16 dx, dy from the one before (a line cut at a cell's edge ends exactly on it, and
      the next cell's line starts there).
Only inside the cities: a vertex is kept where Natural Earth's urban areas (reference/raw/ne/ne_10m_urban_areas,
public domain), grown by URBAN_BUF_M, cover its 1 km cell; a road leaving town ends at its last vertex inside. Natural
Earth's roads aren't in reference/raw/, so the countryside's roads are left out (briefs/V0-7-9.md part 3).
roads.json: { version, credit, cell, quant, simplifyM, classes, x0, y0, tiles: { "<i>_<j>": { file, bytes, lines,
  vertices, km: [per class] } }, totals }.
"""
import gzip
import io
import json
import math
import os
import struct
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import DATA, EUROPE, RAW, REGION, lattice, to_map, outline_latlon

OSMIUM = '/opt/homebrew/bin/osmium'
WORK = os.environ.get('FS_ROADS_WORK') or os.path.join(RAW, 'osm-roads')   # the filtered extracts (reference/ is not in the repository)
OUT = os.environ.get('FS_ROADS_OUT') or ''
CELL = 64000.0
MAX_SEG_M = 30000.0   # a longer segment gets vertices added, so every delta fits an i16
SIMPLIFY_M = 12.0
URBAN_BUF_M = 2500.0
MASK_CELL = 1000.0
CLASSES = ['motorway', 'trunk', 'primary', 'motorway_link']
TAGS = 'w/highway=motorway,trunk,primary,motorway_link'
# Each region's extracts (reference/raw/osm/<name>-<date>.osm.pbf; South Korea's is reference/raw/south-korea-latest).
EAST_ASIA = ['south-korea', 'north-korea', 'china', 'kanto', 'kansai', 'chubu', 'kyushu', 'chugoku', 'tohoku',
             'hokkaido', 'far-eastern-fed-district']
EUROPE_SRC = ['greater-london', 'ile-de-france', 'hessen', 'surrey', 'west-sussex', 'england-east', 'england-south-west',
              'cheshire', 'greater-manchester', 'scotland', 'ireland-and-northern-ireland', 'belgium', 'noord-holland',
              'duesseldorf-regbez', 'koeln-regbez', 'rheinland-pfalz', 'oberbayern', 'hamburg', 'brandenburg',
              'switzerland', 'austria', 'czech-republic', 'denmark', 'nord-ovest', 'nord-est', 'centro', 'sud',
              'rhone-alpes', 'provence-alpes-cote-d-azur', 'midi-pyrenees', 'pays-de-la-loire', 'madrid', 'cataluna',
              'aragon', 'andalucia', 'galicia', 'portugal']
SOURCES = EUROPE_SRC if EUROPE else EAST_ASIA


def refuse_data(path):
    """The game's data/ is the lead's to install into: never write there."""
    p = os.path.realpath(path)
    d = os.path.realpath(DATA)
    if not path or p == d or p.startswith(d + os.sep):
        sys.exit(f"bake_region_roads: stopped, nothing written. FS_ROADS_OUT must be a staging folder outside the game's "
                 f"data/ (got {path!r}).")


def extract_path(name):
    if name == 'south-korea':
        return os.path.join(RAW, 'south-korea-latest.osm.pbf')
    d = os.path.join(RAW, 'osm')
    hits = sorted(f for f in os.listdir(d) if f.startswith(name + '-') and f.endswith('.osm.pbf')
                  and f[len(name) + 1:-8].isdigit())
    return os.path.join(d, hits[-1]) if hits else None


def filtered_path(name):
    return os.path.join(WORK, name + '-roads.osm.pbf')


def stage_filter(names, force=False):
    os.makedirs(WORK, exist_ok=True)
    for n in names:
        src, out = extract_path(n), filtered_path(n)
        if not src:
            print('no extract', n); continue
        if os.path.exists(out) and not force:
            print('have', out); continue
        subprocess.run([OSMIUM, 'tags-filter', '--overwrite', '-o', out + '.tmp.pbf', src, TAGS], check=True)
        os.replace(out + '.tmp.pbf', out)
        print('filtered', n, os.path.getsize(out))


def region_rect():
    """The map rectangle the roads are kept in: East Asia's 1 km extent, or Europe's outline's box."""
    if EUROPE:
        la, lo = outline_latlon()
        x, y = to_map(la, lo)
        return float(x.min()), float(y.min()), float(x.max()), float(y.max())
    return -1600000.0, -1338000.0, 2110000.0, 1284000.0


def read_ways(names):
    import osmium
    ways = {}

    class H(osmium.SimpleHandler):
        def way(self, w):
            if w.id in ways:
                return
            hw = w.tags.get('highway')
            if hw not in CLASSES:
                return
            try:
                pts = [(n.lat, n.lon) for n in w.nodes]
                ids = (w.nodes[0].ref, w.nodes[len(w.nodes) - 1].ref)
            except osmium.InvalidLocationError:
                return   # (a way cut by the extract's edge: another extract has it whole, or it is left out)
            if len(pts) < 2:
                return
            ow = w.tags.get('oneway', '')
            cls = CLASSES.index(hw)
            one = ow in ('yes', '1', 'true', '-1') or (cls in (0, 3) and ow != 'no')
            if ow == '-1':
                pts.reverse(); ids = ids[::-1]
            ways[w.id] = (cls, one, np.array(pts, dtype=np.float64), ids)

    for n in names:
        p = filtered_path(n)
        if not os.path.exists(p):
            print('missing filtered extract', n, '(run the filter stage)'); continue
        before = len(ways)
        H().apply_file(p, locations=True, idx='flex_mem')
        print('read', n, len(ways) - before, 'ways', flush=True)
    return ways


def merge_ways(ways):
    """Join ways of the same class and direction rule end to end where exactly two of them meet at a node (OSM
    splits a road at every bridge, junction and change of tag): fewer, longer lines, so fewer pieces in the game. A
    one-way line joins only head to tail; a two-way line may be turned round. Returns [(cls, one, latlon array)]."""
    groups = {}
    for wid in sorted(ways):
        cls, one, ll, ids = ways[wid]
        groups.setdefault((cls, one), []).append([ll, ids[0], ids[1]])
    out = []
    for (cls, one), lst in sorted(groups.items()):
        ends = {}
        for k, (ll, a, b) in enumerate(lst):
            ends.setdefault(a, []).append(k); ends.setdefault(b, []).append(k)
        used = [False] * len(lst)
        def other(node, k):
            e = ends.get(node, [])
            if len(e) != 2 or e[0] == e[1]:
                return None
            j = e[1] if e[0] == k else e[0]
            return None if used[j] else j
        for k in range(len(lst)):
            if used[k]:
                continue
            used[k] = True
            k0 = k
            ll, a, b = lst[k]
            chain = [ll]
            # forward from b
            node = b
            while True:
                j = other(node, k)
                if j is None:
                    break
                lj, aj, bj = lst[j]
                if aj == node:
                    chain.append(lj[1:]); node = bj
                elif not one and bj == node:
                    chain.append(lj[::-1][1:]); node = aj
                else:
                    break
                used[j] = True; k = j
            # backward from a (fk: the chain's first way)
            node, head, fk = a, [], k0
            while fk is not None:
                j = other(node, fk)
                if j is None:
                    break
                lj, aj, bj = lst[j]
                if bj == node:
                    head.insert(0, lj[:-1]); node = aj
                elif not one and aj == node:
                    head.insert(0, lj[::-1][:-1]); node = bj
                else:
                    break
                used[j] = True; fk = j
            out.append((cls, one, np.concatenate(head + chain)))
    return out


def dp(x, y, tol):
    """Douglas-Peucker on one polyline (numpy, iterative). Returns the kept indices' mask."""
    n = len(x)
    keep = np.zeros(n, bool); keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        dx, dy = x[b] - x[a], y[b] - y[a]
        L = math.hypot(dx, dy)
        sx, sy = x[a + 1:b] - x[a], y[a + 1:b] - y[a]
        d = np.abs(sx * dy - sy * dx) / L if L > 1e-9 else np.hypot(sx, sy)
        k = int(np.argmax(d))
        if d[k] > tol:
            m = a + 1 + k
            keep[m] = True
            stack.append((a, m)); stack.append((m, b))
    return keep


def cut_cells(x, y, x0, y0):
    """Cut a polyline at the 64 km cells' edges: [(i, j, xs, ys)], each piece inside one cell, the cut points on the
    edge shared by both pieces."""
    pieces = []
    cur, ci = None, None
    for k in range(len(x) - 1):
        ax, ay, bx, by = x[k], y[k], x[k + 1], y[k + 1]
        ts = [0.0, 1.0]
        for (a, b, o) in ((ax, bx, x0), (ay, by, y0)):
            if a == b:
                continue
            lo, hi = sorted(((a - o) / CELL, (b - o) / CELL))
            for g in range(int(math.floor(lo)) + 1, int(math.ceil(hi))):
                t = ((o + g * CELL) - a) / (b - a)
                if 0 < t < 1:
                    ts.append(t)
        ts = sorted(set(ts))
        for t0, t1 in zip(ts[:-1], ts[1:]):
            px0, py0 = ax + (bx - ax) * t0, ay + (by - ay) * t0
            px1, py1 = ax + (bx - ax) * t1, ay + (by - ay) * t1
            tm = (t0 + t1) / 2
            mx, my = ax + (bx - ax) * tm, ay + (by - ay) * tm
            cell = (int(math.floor((mx - x0) / CELL)), int(math.floor((my - y0) / CELL)))
            if cell != ci:
                if cur and len(cur[0]) >= 2:
                    pieces.append((ci[0], ci[1], cur[0], cur[1]))
                cur, ci = ([px0], [py0]), cell
            cur[0].append(px1); cur[1].append(py1)
    if cur and len(cur[0]) >= 2:
        pieces.append((ci[0], ci[1], cur[0], cur[1]))
    return pieces


def runs_of(inside):
    """The runs [a, b) of a polyline's kept vertices, two or more long (a road leaving the kept area ends at its last
    vertex inside)."""
    runs, s = [], None
    for k, v in enumerate(inside):
        if v and s is None:
            s = k
        elif not v and s is not None:
            if k - s >= 2: runs.append((s, k))
            s = None
    if s is not None and len(inside) - s >= 2:
        runs.append((s, len(inside)))
    return runs


def urban_mask(rect):
    """A 1 km raster over rect: True where a grown Natural Earth urban area covers the cell's centre."""
    import shapely
    from shapely.geometry import Polygon
    x0, y0, x1, y1 = rect
    nx, ny = int(math.ceil((x1 - x0) / MASK_CELL)), int(math.ceil((y1 - y0) / MASK_CELL))
    mask = np.zeros((ny, nx), bool)
    with open(os.path.join(RAW, 'ne', 'ne_10m_urban_areas.geojson')) as f:
        feats = json.load(f)['features']
    n = 0
    for ft in feats:
        g = ft['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            ring = np.array(poly[0], dtype=np.float64)
            if EUROPE and not (-12 < ring[:, 0].mean() < 21 and 34 < ring[:, 1].mean() < 60):
                continue
            if not EUROPE and not (110 < ring[:, 0].mean() < 150 and 25 < ring[:, 1].mean() < 50):
                continue
            mx, my = to_map(ring[:, 1], ring[:, 0])
            if mx.max() < x0 or mx.min() > x1 or my.max() < y0 or my.min() > y1:
                continue
            P = Polygon(np.column_stack([mx, my]))
            if not P.is_valid:
                P = P.buffer(0)
            P = P.buffer(URBAN_BUF_M, 8)
            bx0, by0, bx1, by1 = P.bounds
            i0, i1 = max(0, int((bx0 - x0) // MASK_CELL)), min(nx - 1, int((bx1 - x0) // MASK_CELL))
            j0, j1 = max(0, int((by0 - y0) // MASK_CELL)), min(ny - 1, int((by1 - y0) // MASK_CELL))
            if i1 < i0 or j1 < j0:
                continue
            cx = x0 + (np.arange(i0, i1 + 1) + 0.5) * MASK_CELL
            cy = y0 + (np.arange(j0, j1 + 1) + 0.5) * MASK_CELL
            X, Y = np.meshgrid(cx, cy)
            mask[j0:j1 + 1, i0:i1 + 1] |= shapely.contains_xy(P, X, Y)
            n += 1
    print('urban mask', n, 'areas', int(mask.sum()), 'km2 cells', flush=True)
    return mask


def stage_bake():
    refuse_data(OUT)
    L = lattice()
    X0, Y0 = L['x0'], L['y0']
    rect = region_rect()
    mask = urban_mask(rect)
    mny, mnx = mask.shape
    ways = read_ways(SOURCES)
    cells = {}
    km = np.zeros(4)
    merged = merge_ways(ways)
    print('merged', len(ways), 'ways into', len(merged), 'lines', flush=True)
    for cls, one, ll in merged:
        x, y = to_map(ll[:, 0], ll[:, 1])
        mi = np.clip(((x - rect[0]) // MASK_CELL).astype(np.int64), 0, mnx - 1)
        mj = np.clip(((y - rect[1]) // MASK_CELL).astype(np.int64), 0, mny - 1)
        ok = mask[mj, mi] & (x >= rect[0]) & (x <= rect[2]) & (y >= rect[1]) & (y <= rect[3])
        for a, b in runs_of(ok):
            xs, ys = x[a:b], y[a:b]
            m = dp(xs, ys, SIMPLIFY_M)
            xs, ys = xs[m], ys[m]
            km[cls] += float(np.sum(np.hypot(np.diff(xs), np.diff(ys)))) / 1000
            seg = np.hypot(np.diff(xs), np.diff(ys))
            if seg.size and seg.max() > MAX_SEG_M:
                nx_, ny_ = [xs[0]], [ys[0]]
                for k in range(len(seg)):
                    q = int(math.ceil(seg[k] / MAX_SEG_M))
                    for t in range(1, q + 1):
                        nx_.append(xs[k] + (xs[k + 1] - xs[k]) * t / q); ny_.append(ys[k] + (ys[k + 1] - ys[k]) * t / q)
                xs, ys = np.array(nx_), np.array(ny_)
            for (i, j, px, py) in cut_cells(xs, ys, X0, Y0):
                qx = np.clip(np.round(np.array(px) - (X0 + i * CELL)), 0, CELL).astype(np.uint16)
                qy = np.clip(np.round(np.array(py) - (Y0 + j * CELL)), 0, CELL).astype(np.uint16)
                # Drop repeated vertices after quantising.
                keep = np.ones(len(qx), bool)
                keep[1:] = (qx[1:] != qx[:-1]) | (qy[1:] != qy[:-1])
                qx, qy = qx[keep], qy[keep]
                if len(qx) < 2:
                    continue
                for s in range(0, len(qx) - 1, 65534):   # (never in practice: a line inside 64 km)
                    cells.setdefault((i, j), []).append((cls, 1 if one else 0, qx[s:s + 65535], qy[s:s + 65535]))
    os.makedirs(os.path.join(OUT, 'roads'), exist_ok=True)
    index = {'version': 1, 'credit': '© OpenStreetMap contributors (ODbL)', 'region': REGION, 'cell': CELL, 'quant': 1,
             'simplifyM': SIMPLIFY_M, 'urbanBufM': URBAN_BUF_M, 'classes': CLASSES, 'x0': X0, 'y0': Y0, 'tiles': {}}
    tot_b = tot_l = tot_v = 0
    for (i, j) in sorted(cells):
        lines = cells[(i, j)]
        nv = sum(len(l[2]) for l in lines)
        buf = io.BytesIO()
        buf.write(b'FSR1' + struct.pack('<II', len(lines), nv))
        for cls, fl, qx, qy in lines:
            buf.write(struct.pack('<BBH', cls, fl, len(qx)))
        tkm = [0.0] * 4
        for cls, fl, qx, qy in lines:
            buf.write(struct.pack('<HH', int(qx[0]), int(qy[0])))
            d = np.empty((len(qx) - 1) * 2, '<i2')
            d[0::2] = np.diff(qx.astype(np.int32)); d[1::2] = np.diff(qy.astype(np.int32))
            buf.write(d.tobytes())
            tkm[cls] += float(np.sum(np.hypot(np.diff(qx.astype(float)), np.diff(qy.astype(float))))) / 1000
        name = f'{i}_{j}.bin.gz'
        gz = io.BytesIO()
        with gzip.GzipFile(fileobj=gz, mode='wb', compresslevel=9, mtime=0) as g:
            g.write(buf.getvalue())
        data = gz.getvalue()
        with open(os.path.join(OUT, 'roads', name), 'wb') as f:
            f.write(data)
        index['tiles'][f'{i}_{j}'] = {'file': name, 'bytes': len(data), 'lines': len(lines), 'vertices': nv,
                                      'km': [round(k, 1) for k in tkm]}
        tot_b += len(data); tot_l += len(lines); tot_v += nv
    index['totals'] = {'tiles': len(cells), 'bytes': tot_b, 'lines': tot_l, 'vertices': tot_v,
                       'km': [round(k, 1) for k in km]}
    with open(os.path.join(OUT, 'roads', 'roads.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    print('baked', REGION, json.dumps(index['totals']))


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] not in ('filter', 'bake'):
        sys.exit(__doc__)
    if a[0] == 'filter':
        stage_filter([n for n in a[1:] if not n.startswith('--')] or SOURCES, force='--force' in a)
    else:
        stage_bake()
