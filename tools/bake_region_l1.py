"""v0.6.0 Part 2 step 5: the 1 km level (l1) for the whole region, into STAGING (never data/).

The lattice: 1 km cells on Korea's origin (-400 km, -400 km), so l1 cell I covers l0 cells
4I..4I+3. A tile is 512 cells with a 2-cell border (516 x 516), named <ti>_<tj> (may be
negative), the same files as tools/cut_korea_tiles.mjs writes for l1:
  .h.i16   int16, 0.25 m units
  .w.rg8   uint8: R sea (128 + d/20 m, clamped), G inland (the same; 255 where none)
  .c.rgba8 uint8: R forest, G farm, B built-up, A 0
Row 0 south. Tiles cover the margin box 24-46 N, 112-148 E (briefs/V0-6-0.md decision 1), taken in
the map frame through bake_common.to_map over the box's edges.

Per l1 cell, from one of two sources (an l1 cell lies in exactly one l0 tile):
  - inside the 250 m data (its l0 tile is one of the region's l0 tiles, bake_region_height's
    region_tiles()): the rounded mean of its 4 x 4 l0 cells from the composed l0 tiles in
    /tmp/flight-sim/v060/bake/l0/ (a composed tile with no file is open sea), exactly as
    cut_korea_tiles.mjs makes Korea's l1 (Math.round: floor(mean + 0.5));
  - in the margin: heights from GLO-90 (bake_height's resample(): 4 x 4 sub-points a cell,
    250 m apart, bilinear), land cells with no source take the nearest sourced height; the sea
    from the OSM land polygons rasterised at 500 m, signed distances averaged to 1 km and
    encoded 128 + d/20 (saturating at 2,560 m); no inland water (G = 255); heights composed
    as bake_region_compose.compose_height (land >= 0.5 m, sea -5 to -40 m; no built-up
    filter at 1 km); cover by bake_cover.fill_rule with built-up from Natural Earth's
    ne_10m_urban_areas (rasterised at 250 m, averaged).
An l1 tile that needs a region l0 tile not yet composed (compose-state.json) waits: it's
skipped and reported, and a later run does it.

Output: /tmp/flight-sim/v060/bake/l1/<ti>_<tj>.{h.i16,w.rg8,c.rgba8}.gz; all-sea tiles get no
file. Resumable: /tmp/flight-sim/v060/bake/l1-state.json lists the tiles done.

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_l1.py
  ... --plan        (the extent, the tiles, which are margin-only and which wait)
  ... --force       (redo tiles already done)   --only ti_tj,...   --budget 17 (minutes)
  ... --quicklook   (Claude outputs/flight-sim/v060-bake-l1.png)
"""
import argparse
import gzip
import json
import os
import sys
import time

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None          # bake_common makes data/ folders on import; not here
try:
    import bake_common as bc
    import bake_geom as bg
    import bake_height as bh
    import bake_cover
    import bake_region_height as brh
    import bake_region_water as brw
    import bake_region_compose as brc
finally:
    os.makedirs = _makedirs

STAGE = '/tmp/flight-sim/v060/bake'
L0DIR = os.path.join(STAGE, 'l0')
COMPOSE_STATE = os.path.join(STAGE, 'compose-state.json')
OUT = os.path.join(STAGE, 'l1')
STATE = os.path.join(STAGE, 'l1-state.json')
URBAN = os.path.join(bc.RAW, 'ne', 'ne_10m_urban_areas.geojson')
PNG = os.path.join(bc.SHOTS, 'v060-bake-l1.png')

X0, Y0 = brh.X0, brh.Y0
T0 = brh.TILE                     # 512 l0 cells a tile
TILE, B = 512, 2
S = TILE + 2 * B                  # 516
CELL = 1000.0
F = 4                             # l0 cells per l1 cell
MBOX = dict(lat0=24.0, lat1=46.0, lon0=112.0, lon1=148.0)
FBOX = brh.BOX
WM = 4                            # margin window: l1 cells beyond the border (4 km) for the distances
WN = S + 2 * WM                   # 524 cells
PX = 500.0                        # the sea mask's pixels
SEA = brc.SEA


def box_outline(bx, n=2001):
    t = np.linspace(0, 1, n)
    la = np.concatenate([bx['lat0'] + 0 * t, bx['lat1'] + 0 * t,
                         bx['lat0'] + (bx['lat1'] - bx['lat0']) * t, bx['lat0'] + (bx['lat1'] - bx['lat0']) * t])
    lo = np.concatenate([bx['lon0'] + (bx['lon1'] - bx['lon0']) * t, bx['lon0'] + (bx['lon1'] - bx['lon0']) * t,
                         bx['lon0'] + 0 * t, bx['lon1'] + 0 * t])
    return bc.to_map(la, lo)


def extent():
    """The margin box's bounding rectangle in l1 cells (half-open)."""
    x, y = box_outline(MBOX)
    return (int(np.floor((x.min() - X0) / CELL)), int(np.floor((y.min() - Y0) / CELL)),
            int(np.ceil((x.max() - X0) / CELL)), int(np.ceil((y.max() - Y0) / CELL)))


def all_tiles():
    i0, j0, i1, j1 = extent()
    return [(ti, tj) for tj in range(j0 // TILE, (j1 - 1) // TILE + 1)
            for ti in range(i0 // TILE, (i1 - 1) // TILE + 1)]


def l0_tiles_touched(ti, tj):
    """The l0 tiles under this l1 tile's 516 x 516 cells."""
    g0, g1 = (ti * TILE - B) * F, (ti * TILE + TILE + B) * F - 1
    h0, h1 = (tj * TILE - B) * F, (tj * TILE + TILE + B) * F - 1
    return {(a, b) for a in range(g0 // T0, g1 // T0 + 1) for b in range(h0 // T0, h1 // T0 + 1)}


def compose_done():
    try:
        return {tuple(t) for t in json.load(open(COMPOSE_STATE))['done']}
    except Exception:
        return set()


def load_state():
    try:
        return json.load(open(STATE))
    except Exception:
        return {'done': [], 'files': []}


def save_state(st):
    json.dump(st, open(STATE + '.tmp', 'w')); os.replace(STATE + '.tmp', STATE)


# ------------------------------------------------------------------ the fine part (from l0)
def read_l0(ti, tj):
    p = os.path.join(L0DIR, f'{ti}_{tj}')
    if not os.path.exists(p + '.h.i16.gz'):
        return None
    rd = lambda suf, dt, sh: np.frombuffer(gzip.open(p + suf).read(), dt).reshape(sh)
    return (rd('.h.i16.gz', '<i2', (brh.S, brh.S)), rd('.w.rg8.gz', np.uint8, (brh.S, brh.S, 2)),
            rd('.c.rgba8.gz', np.uint8, (brh.S, brh.S, 4)))


def rmean(a):
    """(n*4, n*4, ...) -> (n, n, ...): Math.round(mean of 4 x 4), as cut_korea_tiles.mjs."""
    n = a.shape[0] // F
    s = a.astype(np.int64).reshape((n, F, n, F) + a.shape[2:]).sum(axis=(1, 3))
    return np.floor(s / (F * F) + 0.5).astype(np.int64)


def fine_part(ti, tj, region):
    """The l0 mosaic under the tile (2064 x 2064 l0 cells), averaged; and the mask of l1 cells
    that come from l0."""
    n = S * F
    gx0, gy0 = (ti * TILE - B) * F, (tj * TILE - B) * F
    h = np.full((n, n), SEA['h'], np.int16)
    w = np.empty((n, n, 2), np.uint8); w[..., 0] = SEA['w'][0]; w[..., 1] = SEA['w'][1]
    c = np.zeros((n, n, 4), np.uint8)
    m = np.zeros((n, n), bool)
    for (a, b) in l0_tiles_touched(ti, tj):
        if (a, b) not in region:
            continue
        # this l0 tile's core cells: global a*512 .. a*512+511
        ox, oy = a * T0 - gx0, b * T0 - gy0
        sx0, sy0 = max(0, -ox), max(0, -oy)
        sx1, sy1 = min(T0, n - ox), min(T0, n - oy)
        if sx1 <= sx0 or sy1 <= sy0:
            continue
        m[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = True
        t = read_l0(a, b)
        if t is None:
            continue               # composed open sea
        th, tw, tc = t
        cs = (slice(brh.BORDER + sy0, brh.BORDER + sy1), slice(brh.BORDER + sx0, brh.BORDER + sx1))
        h[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = th[cs]
        w[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = tw[cs]
        c[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = tc[cs]
    mask = m.reshape(S, F, S, F).any(axis=(1, 3))
    return rmean(h).astype('<i2'), rmean(w).astype(np.uint8), rmean(c).astype(np.uint8), mask


# ------------------------------------------------------------------ the margin part
class Dem(brh.LazyTiles):
    """bake_region_height's lazy GLO-90 reader, but a missing source tile (beyond what was
    fetched) is simply no data."""

    def __init__(self):
        land = {k for k in brh.land_keys() if brh.have(k)}
        super().__init__(land, cap=64)


def window_geo_bounds(x0, y0, span):
    t = np.linspace(0, 1, 257)
    xs = np.concatenate([x0 + span * t, np.full(257, x0 + span), x0 + span * t, np.full(257, x0)])
    ys = np.concatenate([np.full(257, y0), y0 + span * t, np.full(257, y0 + span), y0 + span * t])
    lat, lon = bc.to_geo(xs, ys)
    return lon.min() - 0.02, lat.min() - 0.02, lon.max() + 0.02, lat.max() + 0.02


class Urban:
    def __init__(self, bounds):
        import shapely
        from shapely.geometry import shape as to_shape
        lon0, lat0, lon1, lat1 = bounds
        with open(URBAN) as f:
            fc = json.load(f)
        self.geoms = []
        for ft in fc['features']:
            g = to_shape(ft['geometry'])
            a, b, c, d = g.bounds
            if c < lon0 or a > lon1 or d < lat0 or b > lat1:
                continue
            if not g.is_valid:
                g = shapely.make_valid(g)
            self.geoms.append(bg.project(g))
        del fc

    def fraction(self, x0, y0, n):
        """Built-up fraction of n x n 1 km cells (from 250 m pixels)."""
        r = bg.rasterize(self.geoms, x0, y0, CELL / F, n * F, n * F)
        return r.reshape(n, F, n, F).mean(axis=(1, 3)).astype(np.float32)


def margin_part(ti, tj, dem, lp, urban):
    x0, y0 = X0 + (ti * TILE - B) * CELL, Y0 + (tj * TILE - B) * CELL
    t0 = time.time()
    raw = bh.resample(dem, x0, y0, CELL, S, S, sub=F, rows_per_chunk=64)
    t1 = time.time()
    wx0, wy0 = x0 - WM * CELL, y0 - WM * CELL
    npx = int(WN * CELL / PX)
    geoms = lp.query(*window_geo_bounds(wx0, wy0, WN * CELL))
    land_m = bg.rasterize(geoms, wx0, wy0, PX, npx, npx) if geoms else np.zeros((npx, npx), np.uint8)
    del geoms
    sea_sd = bg.block_mean(bg.signed_distance(land_m, PX), int(CELL / PX)).astype(np.float32)
    sea_sd = sea_sd[WM:WM + S, WM:WM + S]
    t2 = time.time()
    sea8 = bc.signed_to_u8(sea_sd, 20)
    sd = (sea8.astype(np.float32) - 128) * 20.0        # as compose reads it back from the byte
    land = sd > 0
    # land with no source: the nearest sourced height (beyond the fetched GLO-90 tiles)
    nan = np.isnan(raw)
    if nan.all():
        raw = np.full(raw.shape, 30.0, np.float32)
    elif (nan & land).any():
        idx = ndimage.distance_transform_edt(nan, return_distances=False, return_indices=True)
        raw = raw[idx[0], idx[1]]
    h = brc.compose_height(raw, sd, np.full(sd.shape, 1e4, np.float32), None)
    urb = urban.fraction(x0, y0, S)
    zero = np.zeros(sd.shape, np.float32)
    fo, fa, ur = bake_cover.fill_rule(zero, zero, urb * land, h, land, CELL)
    c = np.zeros((S, S, 4), np.uint8)
    for k, a in enumerate((fo, fa, ur)):
        c[..., k] = np.clip(np.round(np.where(land, a, 0) * 255), 0, 255)
    w = np.stack([sea8, np.full(sea8.shape, 255, np.uint8)], -1)
    return bc.height_to_i16(h), w, c, dict(t_h=round(t1 - t0, 1), t_sea=round(t2 - t1, 1),
                                           t_all=round(time.time() - t0, 1), land=int(land.sum()))


def write(name, h, w, c):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    size = 0
    for suf, a in (('.h.i16.gz', h.astype('<i2')), ('.w.rg8.gz', w.astype(np.uint8)), ('.c.rgba8.gz', c.astype(np.uint8))):
        raw = np.ascontiguousarray(a).tobytes()
        if not (os.path.exists(p + suf) and gzip.open(p + suf).read() == raw):
            with gzip.open(p + suf + '.tmp', 'wb', compresslevel=9) as f:
                f.write(raw)
            os.replace(p + suf + '.tmp', p + suf)
        size += os.path.getsize(p + suf)
    return size


def plan():
    region = set(brh.region_tiles())
    cdone = compose_done()
    rows = []
    for t in all_tiles():
        touched = l0_tiles_touched(*t) & region
        pending = sorted(touched - cdone)
        rows.append((t, len(touched), pending))
    return region, rows


def cmd_bake(args):
    region, rows = plan()
    st = load_state()
    done = {tuple(t) for t in st['done']}
    only = None
    if args.only:
        only = {tuple(int(v) for v in s.split('_')) for s in args.only.split(',')}
    # margin-only tiles first, the fine-box ones last
    rows.sort(key=lambda r: (r[1] > 0, r[0][1], r[0][0]))
    todo = [r for r in rows if (args.force or r[0] not in done) and (only is None or r[0] in only)]
    if not todo:
        print('nothing to do'); return
    t0 = time.time()
    dem = Dem()
    lp = brw.LandPolys()
    i0, j0, i1, j1 = extent()
    ux0, uy0 = X0 + (i0 - 600) * CELL, Y0 + (j0 - 600) * CELL
    urban = Urban(window_geo_bounds(ux0, uy0, (max(i1 - i0, j1 - j0) + 1200) * CELL))
    print(f'urban polygons: {len(urban.geoms)}  ({time.time() - t0:.0f} s setup)')
    for (t, nfine, pending) in todo:
        name = f'{t[0]}_{t[1]}'
        if pending:
            print(f'{name}: waits for l0 {pending[:6]}{"..." if len(pending) > 6 else ""} ({len(pending)})'); continue
        if time.time() - t0 > args.budget * 60:
            print('budget reached; re-run to resume'); break
        ts = time.time()
        fh, fw, fc, fmask = fine_part(*t, region) if nfine else (None, None, None, np.zeros((S, S), bool))
        stats = {}
        if fmask.all():
            h, w, c = fh, fw, fc
        else:
            mh, mw, mc, stats = margin_part(*t, dem, lp, urban)
            if fmask.any():
                h = np.where(fmask, fh, mh).astype('<i2')
                w = np.where(fmask[..., None], fw, mw).astype(np.uint8)
                c = np.where(fmask[..., None], fc, mc).astype(np.uint8)
            else:
                h, w, c = mh, mw, mc
        sea = (h == SEA['h']).all() and (w[..., 0] == SEA['w'][0]).all() and (w[..., 1] == SEA['w'][1]).all() and not c.any()
        if sea:
            if name in st['files']:
                st['files'].remove(name)
            print(f'{name}: open sea (no file)  {time.time() - ts:.0f} s')
        else:
            size = write(name, h, w, c)
            if name not in st['files']:
                st['files'].append(name)
            print(f'{name}: written, {size / 1e6:.2f} MB, fine cells {int(fmask.sum())}, {stats}  {time.time() - ts:.0f} s', flush=True)
        if t not in done:
            st['done'].append(list(t)); done.add(t)
        save_state(st)
    print(f'{time.time() - t0:.0f} s, dem reads {dem.reads}')


def cmd_plan(args):
    region, rows = plan()
    st = load_state()
    done = {tuple(t) for t in st['done']}
    i0, j0, i1, j1 = extent()
    print(f'l1 extent (l1 cells, half-open): i0={i0} j0={j0} i1={i1} j1={j1}  ({i1 - i0} x {j1 - j0} km)')
    print(f'{len(rows)} candidate tiles; l0 region {len(region)} tiles, composed {len(compose_done() & region)}')
    for t, nf, pend in rows:
        print(f'  {t[0]}_{t[1]}: {"fine " + str(nf) if nf else "margin"}{" waits " + str(len(pend)) if pend else ""}'
              f'{" done" if t in done else ""}{" file" if f"{t[0]}_{t[1]}" in st["files"] else ""}')
    print('files:', sorted(st['files'], key=lambda s: tuple(int(v) for v in s.split('_')[::-1])))


def cmd_quicklook(args):
    """Whole extent at 2 km a pixel: hillshaded heights, sea by depth byte, built-up red,
    forest green; the fine box (yellow) and the l0 region's edge (magenta) outlined."""
    i0, j0, i1, j1 = extent()
    st = load_state()
    k = 2
    nx, ny = (i1 - i0) // k, (j1 - j0) // k
    H = np.full((ny, nx), np.nan, np.float32)
    W = np.zeros((ny, nx), np.uint8)
    C = np.zeros((ny, nx, 3), np.uint8)
    have = np.zeros((ny, nx), bool)
    for name in st['files']:
        ti, tj = (int(v) for v in name.split('_'))
        p = os.path.join(OUT, name)
        h = np.frombuffer(gzip.open(p + '.h.i16.gz').read(), '<i2').reshape(S, S)[B:B + TILE, B:B + TILE]
        w = np.frombuffer(gzip.open(p + '.w.rg8.gz').read(), np.uint8).reshape(S, S, 2)[B:B + TILE, B:B + TILE]
        c = np.frombuffer(gzip.open(p + '.c.rgba8.gz').read(), np.uint8).reshape(S, S, 4)[B:B + TILE, B:B + TILE]
        gi0, gj0 = ti * TILE - i0, tj * TILE - j0
        for jj in range(0, TILE, k):
            r = (gj0 + jj) // k
            if not 0 <= r < ny:
                continue
            cols = np.arange(0, TILE, k)
            cc = (gi0 + cols) // k
            ok = (cc >= 0) & (cc < nx)
            H[r, cc[ok]] = h[jj, cols[ok]] * 0.25
            W[r, cc[ok]] = w[jj, cols[ok], 0]
            C[r, cc[ok]] = c[jj, cols[ok], :3]
            have[r, cc[ok]] = True
    W[~have] = SEA['w'][0]
    land = have & (W > 128)
    Hl = np.where(land, H, 0)
    gy, gx = np.gradient(Hl, k * CELL)
    shade = np.clip(0.75 + (-gx + gy) * 8, 0.35, 1.3)
    e = np.clip(Hl / 3000, 0, 1)
    base = np.stack([90 + 120 * e, 140 + 40 * e - 60 * e * e, 80 + 100 * e], -1)
    fr = C[..., 0:1] / 255.0
    base = base * (1 - 0.35 * fr) + np.array([40, 110, 50]) * 0.35 * fr
    ur = C[..., 2:3] / 255.0
    base = base * (1 - 0.8 * ur) + np.array([230, 60, 50]) * 0.8 * ur
    rgb = base * shade[..., None]
    depth = np.clip((128 - W.astype(np.float32)) / 128, 0, 1)[..., None]
    seac = np.array([70, 120, 190]) * (1 - depth) + np.array([20, 40, 100]) * depth
    rgb = np.where(land[..., None], rgb, seac)
    # tiles with no file are open sea (the store's `sea` values): drawn as deep sea
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    def burn(x, y, col):
        cx = ((x - X0) / CELL - i0) / k
        cy = ((y - Y0) / CELL - j0) / k
        ok = (cx >= 0) & (cx < nx) & (cy >= 0) & (cy < ny)
        rgb[cy[ok].astype(int), cx[ok].astype(int)] = col
    region = brh.region_tiles()
    rs = set(region)
    for (a, b) in region:   # the l0 region's outer edges
        x0, y0 = X0 + a * brh.TSPAN, Y0 + b * brh.TSPAN
        t = np.linspace(0, brh.TSPAN, 400)
        for (da, db, xs, ys) in ((-1, 0, x0 + 0 * t, y0 + t), (1, 0, x0 + brh.TSPAN + 0 * t, y0 + t),
                                 (0, -1, x0 + t, y0 + 0 * t), (0, 1, x0 + t, y0 + brh.TSPAN + 0 * t)):
            if (a + da, b + db) not in rs:
                burn(xs, ys, (255, 0, 255))
    burn(*box_outline(FBOX, 6000), (255, 230, 0))
    bc.write_png(PNG, bc.south_up_to_image(rgb))
    print(f'{PNG}: {nx} x {ny} px, {k} km a pixel')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--quicklook', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--budget', type=float, default=17.0)
    args = ap.parse_args()
    if args.plan:
        cmd_plan(args)
    elif args.quicklook:
        cmd_quicklook(args)
    else:
        cmd_bake(args)


if __name__ == '__main__':
    main()
