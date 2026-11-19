"""v0.6.0 Part 2 step 3: the region's water, tile by tile, into STAGING (never data/).

For every l0 tile of bake_region_height.py's enumeration (180 tiles, ti -4..14, tj -3..7, 516 x 516
cells of 250 m on Korea's lattice with a 2-cell border):

  * the sea: OSM's land polygons (split, EPSG:4326; /tmp/flight-sim/v060/landpoly/, read with a
    bounding box per tile through a cached record-bbox index, never all at once), projected to
    the map frame and rasterised at 125 m (bake_geom.rasterize, pixel centres);
  * inland water: ESA WorldCover 2021's permanent water (class 80) as a 125 m majority (>= 72 of
    the pixel's 12 x 12 sub-points, about 10 m apart), minus the sea (only where the land
    polygons say land);
  * signed distances as bake_water.py makes them: bake_geom.signed_distance on the 125 m masks,
    bake_geom.block_mean 2 x 2 onto 250 m, bake_common.signed_to_u8(d, 20). R = sea (+ on land),
    G = inland water (+ outside water).

Each tile's transform runs over a window of MARGIN = 12 cells (3 km, past the 2,560 m saturation)
beyond its border, so the field is continuous across tiles: a cell's value depends only on the
masks within 3 km of it, and the masks are functions of the map position alone.

WorldCover is read by its 1024 x 1024 COG tiles for windows of a few thousand rows (a strip of
the tile at a time, with a small LRU), never whole. The 10 m sub-points come from to_geo at the
125 m pixel corners, interpolated bilinearly inside each pixel (the frame is smooth: well under a
centimetre off over 125 m).

Outputs:
  /tmp/flight-sim/v060/bake/water/<ti>_<tj>.npy   uint8 (516, 516, 2), row 0 south
  /tmp/flight-sim/v060/bake/wc/<ti>_<tj>.npz      the cover step's input: per 250 m cell of the
      520 x 520 window (border + 2) the counts of 576 sub-points in WorldCover's classes
      (forest 10+95, crop 40, grass 30, shrub 20, built 50, water 80, bare 60 + snow 70), and the 250 m land mask
      (sea_sd > 0 and water_sd > 0, as bake_cover's `land`)
Each written to .tmp and renamed; the water file is written last, so it existing means done.

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I \
      tools/bake_region_water.py --tiles priority|all|ti0:ti1,tj0:tj1 [--budget 17]
  ... --plan | --validate | --quicklook
"""
import argparse
import collections
import gzip
import os
import struct
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None          # bake_common makes data/ folders on import; not here
try:
    import bake_common as bc
    import bake_geom as bg
    import bake_region_height as brh
finally:
    os.makedirs = _makedirs

import shapely
import shapefile
from shapely.geometry import shape as to_shape

TILE, BORDER, S = brh.TILE, brh.BORDER, brh.S
X0, Y0, CELL = brh.X0, brh.Y0, brh.CELL
MARGIN = 12                     # cells of 250 m beyond the border (3,000 m)
W = S + 2 * MARGIN              # 540 cells in the window
PX = 125.0
NP = 2 * W                      # 1080 pixels of 125 m
SUB = 12                        # sub-points per 125 m pixel side (10.4 m apart)
EXT = 2                         # cover window: border + 2 cells (520)
CW = S + 2 * EXT

STAGE = '/tmp/flight-sim/v060/bake'
OUT = os.path.join(STAGE, 'water')
WCOUT = os.path.join(STAGE, 'wc')
LOG = os.path.join(OUT, 'log.tsv')
LANDPOLY = '/tmp/flight-sim/v060/landpoly/land-polygons-split-4326/land_polygons'
LPINDEX = '/tmp/flight-sim/v060/landpoly/bbox_index.npy'
WCDIR = os.path.join(bc.RAW, 'worldcover')
PNG = os.path.join(bc.SHOTS, 'v060-bake-water.png')

# WorldCover class -> category: 0 forest (10, 95), 1 crop (40), 2 grass (30), 3 shrub (20),
# 4 built (50), 5 water (80), 6 bare 60 + snow 70, 7 everything else (wetland 90, moss 100, no data; not counted)
CATS = ['forest', 'crop', 'grass', 'shrub', 'built', 'water', 'bare_snow']
NCAT = len(CATS)
LUT = np.full(256, 7, np.uint8)
LUT[10] = LUT[95] = 0
LUT[40], LUT[30], LUT[20], LUT[50], LUT[80] = 1, 2, 3, 4, 5
LUT[60] = LUT[70] = 6        # bare/sparse and snow/ice (kept out of the cover's fill)

AIRPORTS = {  # lat, lon (published reference points, rounded)
    'Pudong': (31.143, 121.805), 'Hongqiao': (31.198, 121.336), 'Haneda': (35.553, 139.781),
    'Narita': (35.765, 140.386), 'Kansai': (34.427, 135.244), 'Fukuoka': (33.586, 130.451),
    'Qingdao': (36.362, 120.088),
}


# ------------------------------------------------------------------ the land polygons
def lp_index():
    """(n, 5) float64: record number, minx, miny, maxx, maxy (lon/lat), from the .shx offsets and
    each record's header in the .shp (36 bytes a record; built once, cached)."""
    if os.path.exists(LPINDEX):
        return np.load(LPINDEX)
    with open(LANDPOLY + '.shx', 'rb') as f:
        f.seek(100)
        sx = np.frombuffer(f.read(), '>i4').reshape(-1, 2)
    offs = sx[:, 0].astype(np.int64) * 2
    out = np.empty((len(offs), 5))
    with open(LANDPOLY + '.shp', 'rb') as f:
        for k, o in enumerate(offs):
            f.seek(o + 8)
            b = f.read(36)
            out[k, 0] = k
            out[k, 1:] = struct.unpack('<4d', b[4:36])
    np.save(LPINDEX + '.tmp.npy', out)
    os.replace(LPINDEX + '.tmp.npy', LPINDEX)
    return out


class LandPolys:
    def __init__(self):
        self.idx = lp_index()
        self.r = shapefile.Reader(LANDPOLY)

    def query(self, lon0, lat0, lon1, lat1):
        i = self.idx
        sel = (i[:, 1] <= lon1) & (i[:, 3] >= lon0) & (i[:, 2] <= lat1) & (i[:, 4] >= lat0)
        geoms = []
        for k in i[sel, 0].astype(int):
            g = to_shape(self.r.shape(int(k)).__geo_interface__)
            if not g.is_valid:
                g = shapely.make_valid(g)
            geoms.append(bg.project(g))
        return geoms


# ------------------------------------------------------------------ WorldCover reader
D = 1.0 / 12000                  # 10 m pixels: 12,000 a degree


class WorldCover:
    """Global pixel (row from 90 N, col from 180 W) -> class, read by COG tiles (1024^2), LRU."""

    def __init__(self, cap=400):
        import tifffile
        self.tf = tifffile
        self.files = {}
        for n in os.listdir(WCDIR):
            if n.endswith('_Map.tif'):
                t = n.split('_')[5]          # N36E126
                la, lo = int(t[1:3]), int(t[4:7])
                self.files[(la, lo)] = os.path.join(WCDIR, n)
        self.open = {}
        self.lru = collections.OrderedDict()
        self.cap = cap
        self.decoded = 0

    def _page(self, key):
        if key not in self.open:
            t = self.tf.TiffFile(self.files[key])
            self.open[key] = (t, t.pages[0])
        return self.open[key]

    def _tile(self, key, tr, tc):
        k = (key, tr, tc)
        if k in self.lru:
            self.lru.move_to_end(k)
            return self.lru[k]
        t, p = self._page(key)
        ntc = (p.shape[1] + p.tilewidth - 1) // p.tilewidth
        idx = tr * ntc + tc
        fh = t.filehandle
        fh.seek(p.dataoffsets[idx])
        data = fh.read(p.databytecounts[idx])
        seg, _, shp = p.decode(data, idx)
        a = np.asarray(seg).reshape(shp[-3], shp[-2]) if seg is not None else np.zeros((1024, 1024), np.uint8)
        full = np.zeros((p.tilelength, p.tilewidth), np.uint8)
        full[:a.shape[0], :a.shape[1]] = a
        self.decoded += 1
        self.lru[k] = full
        while len(self.lru) > self.cap:
            self.lru.popitem(last=False)
        return full

    def window(self, r0, r1, c0, c1):
        """Classes of global pixels rows r0..r1-1, cols c0..c1-1 (0 where no tile: open sea)."""
        out = np.zeros((r1 - r0, c1 - c0), np.uint8)
        # WorldCover tiles are 3 deg: lat top = 90 - 3 * k... named by their SOUTH edge
        la_hi = int(np.floor((90 - r0 * D) + 1e-9))
        la_lo = int(np.floor(90 - r1 * D))
        lo_lo = int(np.floor(c0 * D - 180))
        lo_hi = int(np.floor(c1 * D - 180))
        for la in range((la_lo // 3) * 3, la_hi + 1, 3):
            for lo in range((lo_lo // 3) * 3, lo_hi + 1, 3):
                if (la, lo) not in self.files:
                    continue
                tr0 = (90 - (la + 3)) * 12000        # global row of the tile's top
                tc0 = (lo + 180) * 12000
                a0, a1 = max(r0, tr0), min(r1, tr0 + 36000)
                b0, b1 = max(c0, tc0), min(c1, tc0 + 36000)
                if a0 >= a1 or b0 >= b1:
                    continue
                for tr in range((a0 - tr0) // 1024, (a1 - 1 - tr0) // 1024 + 1):
                    for tc in range((b0 - tc0) // 1024, (b1 - 1 - tc0) // 1024 + 1):
                        g = self._tile((la, lo), tr, tc)
                        gr0, gc0 = tr0 + tr * 1024, tc0 + tc * 1024
                        y0, y1 = max(a0, gr0), min(a1, gr0 + 1024)
                        x0, x1 = max(b0, gc0), min(b1, gc0 + 1024)
                        if y0 < y1 and x0 < x1:
                            out[y0 - r0:y1 - r0, x0 - c0:x1 - c0] = g[y0 - gr0:y1 - gr0, x0 - gc0:x1 - gc0]
        return out


def window_origin(ti, tj):
    return X0 + (ti * TILE - BORDER - MARGIN) * CELL, Y0 + (tj * TILE - BORDER - MARGIN) * CELL


def wc_counts(wc, ti, tj, strip=40):
    """(6, NP, NP) uint8: per 125 m pixel of the window, the count of its 144 sub-points in each
    category. Row 0 south."""
    x0, y0 = window_origin(ti, tj)
    xs = x0 + np.arange(NP + 1) * PX
    ys = y0 + np.arange(NP + 1) * PX
    X, Y = np.meshgrid(xs, ys)
    lat, lon = bc.to_geo(X, Y)
    GR = (90.0 - lat) * 12000.0          # fractional global pixel coordinates at the corners
    GC = (lon + 180.0) * 12000.0
    del X, Y, lat, lon
    u = (np.arange(SUB) + 0.5) / SUB
    out = np.zeros((NCAT, NP, NP), np.uint8)
    for r0 in range(0, NP, strip):
        r1 = min(NP, r0 + strip)
        n = r1 - r0

        def interp(G):
            c00, c01 = G[r0:r1, :-1], G[r0:r1, 1:]          # (n, NP) south corners
            c10, c11 = G[r0 + 1:r1 + 1, :-1], G[r0 + 1:r1 + 1, 1:]
            v = u[None, :, None, None]                       # northward fraction
            w = u[None, None, None, :]                       # eastward fraction
            s = c00[:, None, :, None] * (1 - w) + c01[:, None, :, None] * w
            t = c10[:, None, :, None] * (1 - w) + c11[:, None, :, None] * w
            return s * (1 - v) + t * v                       # (n, SUB, NP, SUB)
        gr = np.floor(interp(GR)).astype(np.int64)
        gc = np.floor(interp(GC)).astype(np.int64)
        ra, rb, ca, cb = int(gr.min()), int(gr.max()) + 1, int(gc.min()), int(gc.max()) + 1
        win = wc.window(ra, rb, ca, cb)
        gr -= ra
        gc -= ca
        cat = LUT[win[gr, gc]]
        del gr, gc
        for k in range(NCAT):
            out[k, r0:r1] = (cat == k).sum(axis=(1, 3), dtype=np.uint16).astype(np.uint8)
        del cat, win
    return out


def geo_bounds_window(ti, tj):
    x0, y0 = window_origin(ti, tj)
    span = W * CELL
    t = np.linspace(0, 1, 129)
    xs = np.concatenate([x0 + span * t, np.full(129, x0 + span), x0 + span * t, np.full(129, x0)])
    ys = np.concatenate([np.full(129, y0), y0 + span * t, np.full(129, y0 + span), y0 + span * t])
    lat, lon = bc.to_geo(xs, ys)
    pad = 0.01
    return lon.min() - pad, lat.min() - pad, lon.max() + pad, lat.max() + pad


# ------------------------------------------------------------------ one tile
def out_path(ti, tj):
    return os.path.join(OUT, f'{ti}_{tj}.npy')


def wc_path(ti, tj):
    return os.path.join(WCOUT, f'{ti}_{tj}.npz')


def done(ti, tj):
    p = out_path(ti, tj)
    if not (os.path.isfile(p) and os.path.isfile(wc_path(ti, tj))):
        return False
    try:
        a = np.load(p, mmap_mode='r')
        if not (a.shape == (S, S, 2) and a.dtype == np.uint8):
            return False
        with np.load(wc_path(ti, tj)) as z:      # the cover's counts must have every category
            return z['counts'].shape[0] == NCAT
    except Exception:
        return False


def bake_tile(ti, tj, lp, wc):
    t0 = time.time()
    x0, y0 = window_origin(ti, tj)
    geoms = lp.query(*geo_bounds_window(ti, tj))
    land_m = bg.rasterize(geoms, x0, y0, PX, NP, NP) if geoms else np.zeros((NP, NP), np.uint8)
    t1 = time.time()
    cnt = wc_counts(wc, ti, tj)
    t2 = time.time()
    inland_m = (cnt[5] >= (SUB * SUB + 1) // 2) & (land_m > 0)
    sea_sd = bg.block_mean(bg.signed_distance(land_m, PX), 2).astype(np.float32)
    water_sd = bg.block_mean(-bg.signed_distance(inland_m, PX), 2).astype(np.float32)
    m = MARGIN
    rg = np.stack([bc.signed_to_u8(sea_sd[m:m + S, m:m + S], 20),
                   bc.signed_to_u8(water_sd[m:m + S, m:m + S], 20)], -1)
    # the cover step's input: 250 m counts over the 520 window (border + 2)
    e = MARGIN - EXT
    c250 = cnt.astype(np.uint16).reshape(NCAT, W, 2, W, 2).sum(axis=(2, 4))[:, e:e + CW, e:e + CW]
    land250 = ((sea_sd > 0) & (water_sd > 0))[e:e + CW, e:e + CW]
    os.makedirs(WCOUT, exist_ok=True)
    wp = wc_path(ti, tj)
    with open(wp + '.tmp', 'wb') as f:
        np.savez_compressed(f, counts=c250, land=land250)
    os.replace(wp + '.tmp', wp)
    p = out_path(ti, tj)
    with open(p + '.tmp', 'wb') as f:
        np.save(f, rg)
    os.replace(p + '.tmp', p)
    return dict(polys=len(geoms), t_land=t1 - t0, t_wc=t2 - t1, t_all=time.time() - t0,
                land=int((rg[..., 0] > 128).sum()), inland=int((rg[..., 1] < 128).sum()))


def tile_of(lat, lon):
    x, y = bc.to_map(lat, lon)
    return int(np.floor((x - X0) / brh.TSPAN)), int(np.floor((y - Y0) / brh.TSPAN)), float(x), float(y)


def priority_order(tiles):
    """Tiles within 20 km of a new airport, then Korea's old square (0..6), then the rest."""
    first = []
    for la, lo in AIRPORTS.values():
        x, y = bc.to_map(la, lo)
        for ti, tj in tiles:
            cx0, cy0 = X0 + ti * brh.TSPAN, Y0 + tj * brh.TSPAN
            dx = max(cx0 - x, 0, x - (cx0 + brh.TSPAN))
            dy = max(cy0 - y, 0, y - (cy0 + brh.TSPAN))
            if np.hypot(dx, dy) < 20000 and (ti, tj) not in first:
                first.append((ti, tj))
    old = [t for t in tiles if 0 <= t[0] <= 6 and 0 <= t[1] <= 6 and t not in first]
    rest = [t for t in tiles if t not in first and t not in old]
    return first + old + rest


def select(spec):
    tiles = brh.region_tiles()
    if spec == 'all':
        return tiles
    if spec == 'priority':
        return priority_order(tiles)
    ri, rj = spec.split(',')
    (i0, i1), (j0, j1) = brh.parse_range(ri), brh.parse_range(rj)
    return [(ti, tj) for ti, tj in tiles if i0 <= ti <= i1 and j0 <= tj <= j1]


def cmd_bake(args):
    os.makedirs(OUT, exist_ok=True)
    todo = select(args.tiles)
    lp, wc = LandPolys(), WorldCover()
    t_start = time.time()
    nd = ns = 0
    for ti, tj in todo:
        if done(ti, tj):
            ns += 1
            continue
        if time.time() - t_start > args.budget * 60:
            print(f'budget of {args.budget} min reached; stopping (resumable)')
            break
        r = bake_tile(ti, tj, lp, wc)
        line = (f'{ti}_{tj}\t{r["t_all"]:.1f}s\tland {r["t_land"]:.1f}s wc {r["t_wc"]:.1f}s\tpolys {r["polys"]}'
                f'\tland cells {r["land"]}\tinland cells {r["inland"]}')
        print(line, flush=True)
        with open(LOG, 'a') as f:
            f.write(time.strftime('%H:%M:%S') + '\t' + line + '\n')
        nd += 1
    print(f'baked {nd}, already done {ns}, of {len(todo)}; WorldCover tiles decoded {wc.decoded}; '
          f'{time.time() - t_start:.0f} s')


def cmd_plan(args):
    tiles = brh.region_tiles()
    d = [t for t in tiles if done(*t)]
    print(f'{len(d)} of {len(tiles)} done')
    print('priority order head:', priority_order(tiles)[:30])


# ------------------------------------------------------------------ validation and quick-look
def poly_rings():
    rings, cur = [], []
    with open(os.path.join(bc.RAW, 'osm', 'south-korea.poly')) as f:
        lines = [l.strip() for l in f]
    for l in lines[1:]:
        if l == 'END':
            if cur:
                rings.append(np.array(cur))
                cur = []
            continue
        parts = l.split()
        if len(parts) == 2:
            try:
                cur.append((float(parts[0]), float(parts[1])))
            except ValueError:
                pass
    return rings


def sk_cells(ti, tj):
    from shapely.geometry import Polygon
    polys = [bg.project(Polygon(r)) for r in poly_rings() if len(r) >= 4]
    x0, y0 = brh.tile_origin(ti, tj)
    return bg.rasterize(polys, x0, y0, CELL, S, S) > 0


def read_l0(name, layer, shape):
    p = os.path.join(bc.DATA, 'terrain', 'l0', f'{name}.{layer}.gz')
    if not os.path.exists(p):
        return None
    with gzip.open(p, 'rb') as f:
        return np.frombuffer(f.read(), np.uint8).reshape(shape)


def cmd_validate(args):
    """Inside South Korea: the new water against Korea's data/terrain/l0 (OSM coastline + OSM
    water polygons). Read-only on data/."""
    rows, dsea, dwat, agree_s, agree_w = [], [], [], [], []
    for tj in range(7):
        for ti in range(7):
            if not done(ti, tj):
                continue
            name = f'{ti}_{tj}'
            old = read_l0(name, 'w.rg8', (S, S, 2))
            if old is None:
                continue
            sk = sk_cells(ti, tj)
            if not sk.any():
                continue
            new = np.load(out_path(ti, tj))
            o = (old.astype(np.float32) - 128) * 20
            n = (new.astype(np.float32) - 128) * 20
            # coastline position: where both are within the unsaturated band and near the coast
            band = sk & (np.abs(o[..., 0]) < 1500) & (np.abs(n[..., 0]) < 2500)
            dsea.append(n[..., 0][band] - o[..., 0][band])
            agree_s.append(((o[..., 0] > 0) == (n[..., 0] > 0))[sk])
            bandw = sk & (np.abs(o[..., 1]) < 1500) & (np.abs(n[..., 1]) < 2500)
            dwat.append(n[..., 1][bandw] - o[..., 1][bandw])
            agree_w.append(((o[..., 1] > 0) == (n[..., 1] > 0))[sk])
            rows.append(f'{name}: SK cells {int(sk.sum())}, sea-sign agreement {100 * agree_s[-1].mean():.2f} %, '
                        f'inland-sign agreement {100 * agree_w[-1].mean():.2f} %, coast band n {int(band.sum())} '
                        f'median |dd| {np.median(np.abs(dsea[-1])) if dsea[-1].size else float("nan"):.0f} m')
    for r in rows:
        print(r)
    if dsea:
        d = np.concatenate(dsea)
        a = np.abs(d)
        print(f'SEA distance, new - old, cells with |old| < 1500 m (n {d.size}): mean {d.mean():+.1f} m, '
              f'median |d| {np.median(a):.0f} m, p90 {np.percentile(a, 90):.0f} m, p99 {np.percentile(a, 99):.0f} m; '
              f'within 125 m {100 * (a <= 125).mean():.1f} %, within 250 m {100 * (a <= 250).mean():.1f} %')
        s = np.concatenate(agree_s)
        print(f'SEA land/sea sign agrees on {100 * s.mean():.3f} % of {s.size} SK cells')
        dw = np.concatenate(dwat)
        aw = np.abs(dw)
        print(f'INLAND distance, new - old, cells with |old| < 1500 m (n {dw.size}): mean {dw.mean():+.1f} m, '
              f'median |d| {np.median(aw):.0f} m, p90 {np.percentile(aw, 90):.0f} m')
        w = np.concatenate(agree_w)
        print(f'INLAND water sign agrees on {100 * w.mean():.3f} % of {w.size} SK cells')


def cmd_seams(args):
    """Every pair of neighbouring done tiles: the 4-cell overlap (each border vs the other's core)."""
    tiles = [t for t in brh.region_tiles() if done(*t)]
    have = set(tiles)
    n = bad = 0
    for ti, tj in tiles:
        a = np.load(out_path(ti, tj))
        if (ti + 1, tj) in have:
            b = np.load(out_path(ti + 1, tj))
            # a's columns 512..515 are b's columns 0..3
            x, y = a[:, 512:516], b[:, 0:4]
            n += x.size
            bad += int((x != y).sum())
        if (ti, tj + 1) in have:
            b = np.load(out_path(ti, tj + 1))
            x, y = a[512:516], b[0:4]
            n += x.size
            bad += int((x != y).sum())
    print(f'seams: {n} overlapping values, {bad} differ')


def cmd_quicklook(args):
    f = args.step
    tiles = brh.region_tiles()
    tis, tjs = [t[0] for t in tiles], [t[1] for t in tiles]
    ti0, ti1, tj0, tj1 = min(tis), max(tis), min(tjs), max(tjs)
    n = TILE // f
    Wd, H = (ti1 - ti0 + 1) * n, (tj1 - tj0 + 1) * n
    rgb = np.full((H, Wd, 3), 25, np.uint8)
    for ti, tj in tiles:
        if not done(ti, tj):
            continue
        a = np.load(out_path(ti, tj))[BORDER:BORDER + TILE:f, BORDER:BORDER + TILE:f].astype(np.float32)
        sea, wat = a[..., 0], a[..., 1]
        img = np.zeros(sea.shape + (3,), np.float32)
        # land: light, shaded by distance to the coast; sea: blue, darker offshore
        t = np.clip((sea - 128) / 127, 0, 1)
        img[:] = np.stack([200 - 60 * t, 190 - 40 * t, 150 - 40 * t], -1)
        s = np.clip((128 - sea) / 128, 0, 1)
        seac = np.stack([70 - 40 * s, 120 - 60 * s, 190 - 70 * s], -1)
        img = np.where((sea <= 128)[..., None], seac, img)
        img = np.where(((wat < 128) & (sea > 128))[..., None], np.array([30, 160, 255], np.float32), img)
        r0, c0 = (tj - tj0) * n, (ti - ti0) * n
        rgb[r0:r0 + n, c0:c0 + n] = np.clip(img, 0, 255).astype(np.uint8)
    bc.write_png(PNG, bc.south_up_to_image(rgb))
    print(f'{PNG}: {Wd} x {H} px, {f * CELL:.0f} m a pixel')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles')
    ap.add_argument('--budget', type=float, default=17.0)
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--validate', action='store_true')
    ap.add_argument('--seams', action='store_true')
    ap.add_argument('--quicklook', action='store_true')
    ap.add_argument('--step', type=int, default=4)
    a = ap.parse_args()
    if a.plan:
        cmd_plan(a)
    elif a.validate:
        cmd_validate(a)
    elif a.seams:
        cmd_seams(a)
    elif a.quicklook:
        cmd_quicklook(a)
    elif a.tiles:
        cmd_bake(a)
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
