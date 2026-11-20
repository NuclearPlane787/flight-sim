"""v0.6.0 Part 2 step 2 (first half): the raw 250 m heights for the region, tile by tile.

For every l0 tile (512 cells of 250 m on Korea's lattice, origin -400 km / -400 km, tiles
<ti>_<tj>, possibly negative) whose area meets the fine box 29-40 N, 119-142 E, this computes
the area-average GLO-90 height of the tile's 516 x 516 cells, its 2-cell border included (the
borders are computed, not copied), exactly as bake_height.py does per cell: bake_height's own
resample() (3 x 3 sub-points per cell through to_geo, float64 sums) and sample_tiles()
(the float32 bilinear), with each source tile given its south/east/south-east edge by
bake_height's own load_tiles(). Only the 1-degree source tiles a tile touches are read, lazily,
with a small LRU. NaN where there's no source (sea).

v0.6.3: the tiles are region_tiles(): v0.6.0's 180 (box_tiles()) plus bake_region_tiles.EXTRA;
--tiles new bakes the 26 into /tmp/flight-sim/v063/bake/raw-h/, and out_path() reads either staging.

Output (staging, NOT data/): /tmp/flight-sim/v060/bake/raw-h/<ti>_<tj>.npy, float32
(516, 516), row 0 south, column 0 west: cell (li, lj) is lattice cell
(ti*512 - 2 + li, tj*512 - 2 + lj). Written to .tmp and renamed, so a file that exists is complete.
Water, the built-up filter and the flattening come later.

A tile is skipped (and reported) when any GLO-90 tile it needs isn't on disk yet: needed are
the 1-degree tiles its sub-points fall in, plus their S, E and SE neighbours (for the edges),
each only if it is land, i.e. listed in the bucket's tileList (/tmp/flight-sim/v060/lists/).

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I \
      tools/bake_region_height.py --tiles -6:12,-6:5      (ti range, tj range; inclusive)
  ... bake_region_height.py --plan        (list the tiles and what each is waiting for)
  ... bake_region_height.py --validate    (Korea's old square against data/terrain/l0)
  ... bake_region_height.py --quicklook   (the PNG in Claude outputs/flight-sim/)
"""
import argparse
import collections
import os
import re
import sys
import time
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# bake_common makes data/ and /tmp/flight-sim/bake folders when imported; this script writes
# neither, so the import runs with os.makedirs muted.
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None
try:
    import bake_common as bc
    import bake_height as bh
    import bake_region_tiles as rt
finally:
    os.makedirs = _makedirs

TILE, BORDER = 512, 2
S = TILE + 2 * BORDER
X0, Y0, CELL = bc.NAT['x0'], bc.NAT['y0'], bc.NAT['cell']
TSPAN = TILE * CELL
BOX = dict(lat0=29.0, lat1=40.0, lon0=119.0, lon1=142.0)
DEM90 = os.path.join(bc.RAW, 'dem90')
TILELIST = '/tmp/flight-sim/v060/lists/glo90_tileList.txt'
OUT = os.path.join(rt.STAGE, 'raw-h')         # v0.6.3: new tiles are written here; v0.6.0's are read from rt.STAGE_OLD
LOG = os.path.join(OUT, 'log.tsv')
PNG = os.path.join(bc.SHOTS, 'v063-bake-raw-heights.png')
SUB = 3


def src_name(la, lo):
    return f'Copernicus_DSM_COG_30_N{la:02d}_00_E{lo:03d}_00_DEM'


def land_keys():
    keys = set()
    with open(TILELIST) as f:
        for line in f:
            m = re.match(r'Copernicus_DSM_COG_30_([NS])(\d+)_00_([EW])(\d+)_00_DEM', line.strip())
            if m:
                la = int(m.group(2)) * (1 if m.group(1) == 'N' else -1)
                lo = int(m.group(4)) * (1 if m.group(3) == 'E' else -1)
                keys.add((la, lo))
    return keys


def src_path(key):
    return os.path.join(DEM90, src_name(*key) + '.tif')


def have(key):
    return os.path.isfile(src_path(key))


class LazyTiles:
    """dict-like {(lat, lon): bordered array} for bake_height.sample_tiles. Each entry is
    built by bake_height.load_tiles() from the tile and its S, E, SE land neighbours, so its
    edge row/column are exactly what Korea's bake gave it when all of them were present."""

    def __init__(self, land, cap=12):
        self.land, self.cap = land, cap
        self.lru = collections.OrderedDict()
        self.reads = 0

    def get(self, key, default=None):
        if key not in self.land:
            return default
        if key in self.lru:
            self.lru.move_to_end(key)
            return self.lru[key]
        la, lo = key
        group = [k for k in (key, (la - 1, lo), (la, lo + 1), (la - 1, lo + 1)) if k in self.land]
        missing = [k for k in group if not have(k)]
        if missing:
            raise RuntimeError(f'source missing: {missing}')
        built = bh.load_tiles([src_path(k) for k in group])
        self.reads += len(group)
        a = built[key]
        assert a.shape[0] == a.shape[1], (key, a.shape)
        del built
        self.lru[key] = a
        while len(self.lru) > self.cap:
            self.lru.popitem(last=False)
        return a


def tile_origin(ti, tj):
    """Map coordinates of the SW corner of the tile's first (border) cell."""
    return X0 + (ti * TILE - BORDER) * CELL, Y0 + (tj * TILE - BORDER) * CELL


def tile_geo_bounds(ti, tj):
    """Lat/lon bounds of every sub-point of the tile's 516 x 516 cells (from its outline:
    the frame is smooth and the outline holds the extremes, padded a little)."""
    x0, y0 = tile_origin(ti, tj)
    e = (0.5 - 0.5 / SUB) * CELL
    lo_x, hi_x = x0 + 0.5 * CELL - e, x0 + (S - 0.5) * CELL + e
    lo_y, hi_y = y0 + 0.5 * CELL - e, y0 + (S - 0.5) * CELL + e
    t = np.linspace(0, 1, 257)
    xs = np.concatenate([lo_x + (hi_x - lo_x) * t, np.full(257, hi_x), hi_x - (hi_x - lo_x) * t, np.full(257, lo_x)])
    ys = np.concatenate([np.full(257, lo_y), lo_y + (hi_y - lo_y) * t, np.full(257, hi_y), hi_y - (hi_y - lo_y) * t])
    lat, lon = bc.to_geo(xs, ys)
    pad = 0.002
    return lat.min() - pad, lat.max() + pad, lon.min() - pad, lon.max() + pad


def needed_sources(ti, tj, land):
    la0, la1, lo0, lo1 = tile_geo_bounds(ti, tj)
    direct = {(la, lo) for la in range(int(np.floor(la0)), int(np.floor(la1)) + 1)
              for lo in range(int(np.floor(lo0)), int(np.floor(lo1)) + 1)} & land
    need = set(direct)
    for la, lo in direct:
        need |= {(la - 1, lo), (la, lo + 1), (la - 1, lo + 1)} & land
    return direct, need


def tile_meets_box(ti, tj):
    """The tile's core area (512 x 512 cells) meets the fine box (in the map frame)."""
    x0, y0 = X0 + ti * TSPAN, Y0 + tj * TSPAN
    g = np.linspace(0, 1, 65)
    X, Y = np.meshgrid(x0 + g * TSPAN, y0 + g * TSPAN)
    lat, lon = bc.to_geo(X, Y)
    if np.any((lat >= BOX['lat0']) & (lat <= BOX['lat1']) & (lon >= BOX['lon0']) & (lon <= BOX['lon1'])):
        return True
    # the box's outline inside the tile (a corner of the box poking into a tile)
    t = np.linspace(0, 1, 2001)
    la = np.concatenate([BOX['lat0'] + 0 * t, BOX['lat1'] + 0 * t,
                         BOX['lat0'] + (BOX['lat1'] - BOX['lat0']) * t, BOX['lat0'] + (BOX['lat1'] - BOX['lat0']) * t])
    lo = np.concatenate([BOX['lon0'] + (BOX['lon1'] - BOX['lon0']) * t, BOX['lon0'] + (BOX['lon1'] - BOX['lon0']) * t,
                         BOX['lon0'] + 0 * t, BOX['lon1'] + 0 * t])
    bx, by = bc.to_map(la, lo)
    return bool(np.any((bx >= x0) & (bx <= x0 + TSPAN) & (by >= y0) & (by <= y0 + TSPAN)))


def region_tiles():
    """v0.6.3: the region's l0 tiles, v0.6.0's 180 (box_tiles(), in their order) then
    bake_region_tiles.EXTRA (v0.6.3's 26, then v0.6.4's 10; any already listed kept once, as old)."""
    return old_tiles() + new_tiles()


def old_tiles():
    """v0.6.4: the tiles baked before this batch: v0.6.0's 180, then the earlier batches' extras."""
    old = box_tiles()
    have = set(old)
    for t in rt.OLD_EXTRA_TILES:
        if t not in have:
            old.append(t); have.add(t)
    return old


def new_tiles():
    """v0.6.4: this batch's tiles (bake_region_tiles.NEW_TILES), less any already old."""
    have = set(old_tiles())
    return [t for t in rt.NEW_TILES if t not in have]


_BOX_TILES = None


def box_tiles():
    """v0.6.0's enumeration: every tile meeting the box. The candidate range comes from the box's
    corners and edges. (Cached: it never changes.)"""
    global _BOX_TILES
    if _BOX_TILES is not None:
        return list(_BOX_TILES)
    t = np.linspace(0, 1, 2001)
    la = np.concatenate([BOX['lat0'] + 0 * t, BOX['lat1'] + 0 * t,
                         BOX['lat0'] + (BOX['lat1'] - BOX['lat0']) * t, BOX['lat0'] + (BOX['lat1'] - BOX['lat0']) * t])
    lo = np.concatenate([BOX['lon0'] + (BOX['lon1'] - BOX['lon0']) * t, BOX['lon0'] + (BOX['lon1'] - BOX['lon0']) * t,
                         BOX['lon0'] + 0 * t, BOX['lon1'] + 0 * t])
    bx, by = bc.to_map(la, lo)
    ti0, ti1 = int(np.floor((bx.min() - X0) / TSPAN)), int(np.floor((bx.max() - X0) / TSPAN))
    tj0, tj1 = int(np.floor((by.min() - Y0) / TSPAN)), int(np.floor((by.max() - Y0) / TSPAN))
    _BOX_TILES = [(ti, tj) for tj in range(tj0, tj1 + 1) for ti in range(ti0, ti1 + 1) if tile_meets_box(ti, tj)]
    return list(_BOX_TILES)


def out_path(ti, tj):
    """The staged raw heights (v0.6.3's staging, else v0.6.0's)."""
    return rt.find('raw-h', f'{ti}_{tj}.npy')


def write_path(ti, tj):
    return rt.new_path('raw-h', f'{ti}_{tj}.npy')


def done(ti, tj):
    p = out_path(ti, tj)
    if not os.path.isfile(p):
        return False
    try:
        a = np.load(p, mmap_mode='r')
        return a.shape == (S, S) and a.dtype == np.float32
    except Exception:
        return False


def bake_tile(ti, tj, tiles):
    x0, y0 = tile_origin(ti, tj)
    # bake_height.resample over this tile's 516 x 516 cells: cell centres x0 + (k + 0.5) * 250,
    # exactly Korea's lattice values (multiples of 125 m, exact in doubles).
    h = bh.resample(tiles, x0, y0, CELL, S, S, sub=SUB)
    p = write_path(ti, tj)
    with open(p + '.tmp', 'wb') as f:
        np.save(f, h.astype(np.float32))
    os.replace(p + '.tmp', p)
    return h


def parse_range(s):
    a, _, b = s.partition(':')
    return int(a), int(b if b else a)


def cmd_bake(args):
    os.makedirs(OUT, exist_ok=True)
    land = land_keys()
    todo = region_tiles()
    if args.tiles == 'new':
        todo = new_tiles()
    elif args.tiles != 'all':
        ri, rj = args.tiles.split(',')
        (i0, i1), (j0, j1) = parse_range(ri), parse_range(rj)
        todo = [(ti, tj) for ti, tj in todo if i0 <= ti <= i1 and j0 <= tj <= j1]
    tiles = LazyTiles(land)
    t_start = time.time()
    n_done = n_skip_done = n_wait = 0
    waiting = {}
    for ti, tj in todo:
        if done(ti, tj):
            n_skip_done += 1
            continue
        if time.time() - t_start > args.budget * 60:
            print(f'budget of {args.budget} min reached; stopping (resumable)')
            break
        direct, need = needed_sources(ti, tj, land)
        missing = sorted(k for k in need if not have(k))
        if missing:
            n_wait += 1
            waiting[(ti, tj)] = missing
            continue
        t0 = time.time()
        h = bake_tile(ti, tj, tiles)
        dt = time.time() - t0
        nan = int(np.isnan(h).sum())
        mx = float(np.nanmax(h)) if nan < h.size else float('nan')
        mn = float(np.nanmin(h)) if nan < h.size else float('nan')
        line = f'{ti}_{tj}\t{dt:.1f}s\tsources {len(direct)}\tnan {nan}\tmin {mn:.1f}\tmax {mx:.1f}'
        print(line, flush=True)
        with open(LOG, 'a') as f:
            f.write(time.strftime('%H:%M:%S') + '\t' + line + '\n')
        n_done += 1
    print(f'baked {n_done}, already done {n_skip_done}, waiting for sources {n_wait}, '
          f'of {len(todo)} in range; source reads {tiles.reads}; {time.time() - t_start:.0f} s')
    for k, v in waiting.items():
        print(f'  waiting {k[0]}_{k[1]}: ' + ', '.join(f'N{a}E{b}' for a, b in v))


def cmd_plan(args):
    land = land_keys()
    todo = region_tiles()
    tis = [t[0] for t in todo]
    tjs = [t[1] for t in todo]
    print(f'{len(todo)} tiles meet the box; ti {min(tis)}..{max(tis)}, tj {min(tjs)}..{max(tjs)}')
    nd = nw = 0
    for ti, tj in todo:
        direct, need = needed_sources(ti, tj, land)
        missing = sorted(k for k in need if not have(k))
        st = 'done' if done(ti, tj) else ('WAIT ' + ' '.join(f'N{a}E{b}' for a, b in missing) if missing else 'ready')
        nd += st == 'done'
        nw += st.startswith('WAIT')
        if args.verbose or st != 'done':
            print(f'{ti}_{tj}: {len(direct)} land sources ({len(need)} with edges): {st}')
    print(f'done {nd}, waiting {nw}, ready {len(todo) - nd - nw}')


def _dilate(m, r):
    """Boolean dilation by a (2r+1) square, numpy only."""
    out = m.copy()
    p = np.pad(m, r)
    n = m.shape[0]
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= p[r + dy:r + dy + n, r + dx:r + dx + m.shape[1]]
    return out


def cmd_validate(args):
    """Korea's old square (ti, tj in 0..6) against Korea's raw bake: nat_dem.npy if it exists,
    else data/terrain/l0 (height x 0.25) on land cells away from water, built-up cover and the
    airports. Read-only on data/."""
    import gzip
    import json
    nat = os.path.join(bc.CACHE, 'nat_dem.npy')
    natdem = np.load(nat, mmap_mode='r') if os.path.exists(nat) else None
    l0 = os.path.join(bc.DATA, 'terrain', 'l0')

    def rd(p, dt, shape):
        with gzip.open(p, 'rb') as f:
            return np.frombuffer(f.read(), dtype=dt).reshape(shape)
    aps = []
    for a in ('RKSS', 'RKSI', 'RKPC'):
        with open(os.path.join(bc.DATA, 'airports', a + '.json')) as f:
            aps.append(json.load(f)['origin'])
    print('reference:', 'nat_dem.npy' if natdem is not None else 'data/terrain/l0 heights x 0.25')
    all_d = []
    all_raw = []
    all_eq = []
    rows = []
    for tj in range(7):
        for ti in range(7):
            if not done(ti, tj):
                continue
            raw = np.load(out_path(ti, tj))
            name = f'{ti}_{tj}'
            gi = ti * TILE - BORDER + np.arange(S)
            gj = tj * TILE - BORDER + np.arange(S)
            inside = ((gi >= 0) & (gi < 3200))[None, :] & ((gj >= 0) & (gj < 3200))[:, None]
            if natdem is not None:
                ci, cj = np.clip(gi, 0, 3199), np.clip(gj, 0, 3199)
                ref = np.asarray(natdem[np.ix_(cj, ci)], np.float32)
                ok = inside & ~np.isnan(ref) & ~np.isnan(raw)
                d = raw[ok] - ref[ok]
                d_raw = d
            else:
                hp = os.path.join(l0, name + '.h.i16.gz')
                if not os.path.exists(hp):
                    rows.append(f'{name}: no l0 file (open sea); raw NaN cells {int(np.isnan(raw).sum())} of {S*S}')
                    continue
                hi = rd(hp, '<i2', (S, S))
                h = hi.astype(np.float32) * 0.25
                w = rd(os.path.join(l0, name + '.w.rg8.gz'), np.uint8, (S, S, 2))
                c = rd(os.path.join(l0, name + '.c.rgba8.gz'), np.uint8, (S, S, 4))
                # land at least 1 km from the sea and from inland water (128 + d/20 >= 178)
                landfar = (w[..., 0] >= 178) & (w[..., 1] >= 178)
                urban = _dilate(c[..., 2] > 0, 2)
                X = X0 + (gi + 0.5) * CELL
                Y = Y0 + (gj + 0.5) * CELL
                near_ap = np.zeros((S, S), bool)
                for ox, oy in aps:
                    near_ap |= ((X[None, :] - ox) ** 2 + (Y[:, None] - oy) ** 2) < 8000.0 ** 2
                ok = inside & landfar & ~urban & ~near_ap & ~np.isnan(raw)
                d = raw[ok] - h[ok]
                eq = bc.height_to_i16(raw[ok]) == hi[ok]
                all_eq.append(eq)
                # the same without the urban exclusion, to show the built-up filter's effect
                ok2 = inside & landfar & ~near_ap & ~np.isnan(raw)
                d_raw = raw[ok2] - h[ok2]
                nan_land = int((inside & landfar & np.isnan(raw)).sum())
            if d.size == 0:
                rows.append(f'{name}: no comparable cells')
                continue
            ad = np.abs(d)
            rows.append(f'{name}: n {d.size:7d}  max|d| {ad.max():8.3f}  mean|d| {ad.mean():.4f}  '
                        f'mean d {d.mean():+.4f}  >0.125 {int((ad > 0.1251).sum()):6d}  >1 m {int((ad > 1).sum()):5d}'
                        + (f'  i16 equal {100 * eq.mean():.4f} %' if natdem is None else '')
                        + (f'  | incl. built-up: n {d_raw.size} max|d| {np.abs(d_raw).max():.2f} mean|d| {np.abs(d_raw).mean():.4f}'
                           if natdem is None else '')
                        + (f'  land-but-NaN {nan_land}' if natdem is None else ''))
            all_d.append(d)
            all_raw.append(d_raw)
    for r in rows:
        print(r)
    if all_d:
        d = np.concatenate(all_d)
        ad = np.abs(d)
        q = np.percentile(ad, [50, 99, 99.9, 99.99])
        print(f'ALL (land, away from water/built-up/airports): n {d.size}  max|d| {ad.max():.3f}  '
              f'mean|d| {ad.mean():.4f}  mean d {d.mean():+.4f}  p50/p99/p99.9/p99.99 '
              + '/'.join(f'{v:.3f}' for v in q)
              + f'  within 0.125 m (int16 rounding): {100 * (ad <= 0.1251).mean():.3f} %')
        if all_eq:
            eq = np.concatenate(all_eq)
            print(f'ALL: height_to_i16(raw) == data l0 int16 on {100 * eq.mean():.4f} % of those cells '
                  f'({int((~eq).sum())} differ)')
        dr = np.abs(np.concatenate(all_raw))
        print(f'ALL incl. built-up: n {dr.size}  max|d| {dr.max():.2f}  mean|d| {dr.mean():.4f}  '
              f'within 0.125 m: {100 * (dr <= 0.1251).mean():.3f} %')


def cmd_quicklook(args):
    """All raw tiles done, mosaicked at 1/4 (1 km pixels), hillshade x colour ramp. Dark blue: NaN
    (no source tile); mid blue: exactly 0 m (sea inside a source tile); dark grey: not baked."""
    todo = [t for t in region_tiles() if done(*t)]
    if not todo:
        print('no tiles yet')
        return
    f = args.step
    tis = [t[0] for t in region_tiles()]
    tjs = [t[1] for t in region_tiles()]
    ti0, ti1, tj0, tj1 = min(tis), max(tis), min(tjs), max(tjs)
    n = TILE // f
    W, H = (ti1 - ti0 + 1) * n, (tj1 - tj0 + 1) * n
    mos = np.full((H, W), np.nan, np.float32)
    have_t = np.zeros((H, W), bool)
    for ti, tj in todo:
        a = np.load(out_path(ti, tj), mmap_mode='r')[BORDER:BORDER + TILE, BORDER:BORDER + TILE]
        # block mean of f x f (NaN-aware)
        b = np.asarray(a, np.float32).reshape(n, f, n, f)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)   # all-sea blocks: NaN
            m = np.nanmean(b, axis=(1, 3))
        r0, c0 = (tj - tj0) * n, (ti - ti0) * n
        mos[r0:r0 + n, c0:c0 + n] = m
        have_t[r0:r0 + n, c0:c0 + n] = True
    hz = np.where(np.isnan(mos), 0, mos)
    cs = CELL * f
    gy, gx = np.gradient(hz, cs)
    az, alt = np.radians(315), np.radians(45)
    # row 0 is south: the north-facing gradient is +gy
    slope = np.arctan(2.0 * np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(0.35 + 0.65 * shade, 0, 1)
    stops = np.array([0, 50, 200, 500, 1000, 2000, 3800], float)
    cols = np.array([[70, 120, 60], [110, 150, 80], [170, 170, 100], [180, 140, 90],
                     [150, 110, 80], [200, 190, 180], [255, 255, 255]], float)
    rgb = np.stack([np.interp(np.clip(hz, 0, 3800), stops, cols[:, k]) for k in range(3)], -1) * shade[..., None]
    sea = np.isnan(mos) & have_t
    rgb[sea] = [40, 70, 120]
    rgb[~have_t] = [25, 25, 25]
    rgb[(hz < 0) & ~np.isnan(mos)] = [60, 110, 160]   # below 0 m in the source
    rgb[(mos == 0)] = [55, 95, 140]                     # exactly 0 m: the source tiles' own sea
    img = bc.south_up_to_image(np.clip(rgb, 0, 255).astype(np.uint8))
    bc.write_png(PNG, img)
    print(f'{PNG}: {W} x {H} px ({cs:.0f} m a pixel), {len(todo)} tiles, ti {ti0}..{ti1}, tj {tj0}..{tj1}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', default=None, help="'all', 'new' (this batch's: v0.6.4's 10) or 'ti0:ti1,tj0:tj1' (inclusive)")
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--validate', action='store_true')
    ap.add_argument('--quicklook', action='store_true')
    ap.add_argument('--step', type=int, default=4, help='quick-look downsampling (cells a pixel)')
    ap.add_argument('--budget', type=float, default=17.0, help='minutes before no new tile starts')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()
    if args.plan:
        cmd_plan(args)
    elif args.validate:
        cmd_validate(args)
    elif args.quicklook:
        cmd_quicklook(args)
    elif args.tiles:
        cmd_bake(args)
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
