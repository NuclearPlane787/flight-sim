"""v0.6.0 Part 2 step 4: the region's land cover from ESA WorldCover 2021, tile by tile, into
STAGING (never data/).

Input: bake_region_water.py's per-tile counts (/tmp/flight-sim/v060/bake/wc/<ti>_<tj>.npz: for
each 250 m cell of the 520 x 520 window, border + 2, the count of its 576 sub-points, about 10 m
apart, reached through the frame's to_geo, in WorldCover's classes, and the 250 m land mask
sea_sd > 0 and water_sd > 0), and the raw heights (/tmp/flight-sim/v060/bake/raw-h/, the window's
extra cells taken from the neighbouring tiles' cores, NaN -> 30 m as bake_cover does).

v0.6.3: inputs through bake_region_tiles.find() (v0.6.3 staging, else v0.6.0's); new tiles are
written to /tmp/flight-sim/v063/bake/cover/ (--tiles new).

Per cell, as area fractions of its footprint:
  R forest  tree cover (10) + mangroves (95)
  G farm    cropland (40), plus grassland (30) and shrubland (20) on the flat
  B urban   built-up (50)
  A 0       (bake_cover.py leaves A at 0)
"On the flat" is bake_cover.fill_rule's own test: not (slope > 6 deg or height > 250 m), the slope
from np.gradient of the raw heights at 250 m. What's left of a land cell (bare 60, snow 70,
wetland 90, moss 100, grass and shrub on the steep, no data) is filled by bake_cover.fill_rule
itself (but not bare/sparse 60 or snow/ice 70: see below): next to built-up land (3 x 3 mean urban > 0.25) urban, on the steep forest, on the flat
70 % farm 30 % forest. Permanent water (80), bare/sparse (60) and snow/ice (70) inside a land
cell are NOT filled (water isn't land cover, the water layer draws it; bare rock and snow would
otherwise turn Fuji's cone and the summits into forest), so such cells sum to less than 255. Cells that aren't land
are 0, as bake_cover's np.where(land, a, 0).

The window's extra 2 cells make the slope and the 3 x 3 filter in the 2-cell border exactly the
neighbouring tile's, so the borders match the neighbours' cores bit for bit.

Output: /tmp/flight-sim/v060/bake/cover/<ti>_<tj>.npy  uint8 (516, 516, 4), row 0 south.

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I \
      tools/bake_region_cover.py --tiles priority|all|ti0:ti1,tj0:tj1
  ... --validate | --seams | --quicklook
"""
import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None
try:
    import bake_common as bc
    import bake_cover as bcov
    import bake_region_height as brh
    import bake_region_water as brw
    import bake_region_tiles as rt
finally:
    os.makedirs = _makedirs

TILE, BORDER, S = brh.TILE, brh.BORDER, brh.S
CELL = brh.CELL
EXT, CW = brw.EXT, brw.CW
NSUB = 4 * brw.SUB * brw.SUB          # 576 sub-points a 250 m cell
STAGE = brw.STAGE
OUT = os.path.join(STAGE, 'cover')
LOG = os.path.join(OUT, 'log.tsv')
PNG = os.path.join(bc.SHOTS, 'v070-bake-cover.png' if bc.EUROPE else 'v063-bake-cover.png')


def out_path(ti, tj):
    return rt.find('cover', f'{ti}_{tj}.npy')


def done(ti, tj):
    p = out_path(ti, tj)
    if not os.path.isfile(p):
        return False
    try:
        a = np.load(p, mmap_mode='r')
        return a.shape == (S, S, 4) and a.dtype == np.uint8
    except Exception:
        return False


class Heights:
    """Raw heights of any lattice cells, from the tiles' cores (an LRU of loaded tiles)."""

    def __init__(self):
        self.cache = {}

    def tile(self, ti, tj):
        k = (ti, tj)
        if k not in self.cache:
            p = brh.out_path(ti, tj)
            self.cache[k] = np.load(p) if os.path.exists(p) else None
            if len(self.cache) > 16:
                self.cache.pop(next(iter(self.cache)))
        return self.cache[k]

    def window(self, gi0, gj0, n):
        out = np.full((n, n), np.nan, np.float32)
        gi = gi0 + np.arange(n)
        gj = gj0 + np.arange(n)
        ti = np.floor_divide(gi, TILE)
        tj = np.floor_divide(gj, TILE)
        for a in np.unique(tj):
            for b in np.unique(ti):
                t = self.tile(int(b), int(a))
                if t is None:
                    continue
                rs = np.nonzero(tj == a)[0]
                cs = np.nonzero(ti == b)[0]
                out[np.ix_(rs, cs)] = t[np.ix_(gj[rs] - a * TILE + BORDER, gi[cs] - b * TILE + BORDER)]
        return out


def bake_tile(ti, tj, hs):
    z = np.load(brw.wc_path(ti, tj))
    cnt = z['counts'].astype(np.float32) / NSUB
    land = z['land'].astype(bool)
    forest, crop, grass, shrub, built, water, bare = cnt
    keep = water + bare      # permanent water, bare/sparse and snow/ice: not filled
    dem = hs.window(ti * TILE - BORDER - EXT, tj * TILE - BORDER - EXT, CW)
    h = np.where(np.isnan(dem), 30, dem)
    # bake_cover.fill_rule's steep test, on the same gradient
    gy, gx = np.gradient(np.where(land, h, 0), CELL)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    steep = (slope > 6) | (h > 250)
    farm = crop + np.where(steep, 0, grass + shrub)
    # water, bare and snow are passed in with the forest so fill_rule doesn't fill them, then
    # taken out again
    f2, farm2, urban2 = bcov.fill_rule(forest + keep, farm, built, h, land, CELL)
    f2 = f2 - keep
    cover = np.zeros((CW, CW, 4), np.uint8)
    for k, a in enumerate((f2, farm2, urban2)):
        cover[..., k] = np.clip(np.round(np.where(land, a, 0) * 255), 0, 255)
    cover = cover[EXT:EXT + S, EXT:EXT + S]
    p = rt.new_path('cover', f'{ti}_{tj}.npy')
    with open(p + '.tmp', 'wb') as f:
        np.save(f, np.ascontiguousarray(cover))
    os.replace(p + '.tmp', p)
    return cover


def cmd_bake(args):
    os.makedirs(OUT, exist_ok=True)
    todo = brw.select(args.tiles)
    hs = Heights()
    t_start = time.time()
    nd = ns = nw = 0
    for ti, tj in todo:
        if done(ti, tj):
            ns += 1
            continue
        if not brw.done(ti, tj):
            nw += 1
            continue
        if time.time() - t_start > args.budget * 60:
            print(f'budget of {args.budget} min reached; stopping (resumable)')
            break
        t0 = time.time()
        c = bake_tile(ti, tj, hs)
        line = (f'{ti}_{tj}\t{time.time() - t0:.1f}s\tmean R {c[..., 0].mean():.1f} G {c[..., 1].mean():.1f} '
                f'B {c[..., 2].mean():.1f}')
        print(line, flush=True)
        with open(LOG, 'a') as f:
            f.write(time.strftime('%H:%M:%S') + '\t' + line + '\n')
        nd += 1
    print(f'baked {nd}, already done {ns}, waiting for water {nw}, of {len(todo)}; {time.time() - t_start:.0f} s')


def cmd_seams(args):
    tiles = [t for t in brh.region_tiles() if done(*t)]
    have = set(tiles)
    n = bad = 0
    for ti, tj in tiles:
        a = np.load(out_path(ti, tj))
        for (di, dj) in ((1, 0), (0, 1)):
            if (ti + di, tj + dj) not in have:
                continue
            b = np.load(out_path(ti + di, tj + dj))
            x, y = (a[:, 512:516], b[:, 0:4]) if di else (a[512:516], b[0:4])
            n += x.size
            bad += int((x != y).sum())
    print(f'seams: {n} overlapping values, {bad} differ')


def cmd_validate(args):
    """Inside South Korea, land cells in both: the new cover against data/terrain/l0's (OSM
    polygons + building density + the fill rule). Read-only on data/."""
    o_all, n_all, rows = [], [], []
    for tj in range(7):
        for ti in range(7):
            if not done(ti, tj):
                continue
            name = f'{ti}_{tj}'
            old = brw.read_l0(name, 'c.rgba8', (S, S, 4))
            ow = brw.read_l0(name, 'w.rg8', (S, S, 2))
            if old is None:
                continue
            sk = brw.sk_cells(ti, tj)
            nw = np.load(brw.out_path(ti, tj))
            m = sk & (ow[..., 0] > 128) & (ow[..., 1] > 128) & (nw[..., 0] > 128) & (nw[..., 1] > 128)
            if not m.any():
                continue
            new = np.load(out_path(ti, tj))
            o_all.append(old[m][:, :3].astype(np.float32) / 255)
            n_all.append(new[m][:, :3].astype(np.float32) / 255)
    if not o_all:
        print('nothing to compare')
        return
    o, n = np.concatenate(o_all), np.concatenate(n_all)
    print(f'South Korea, land in both: {len(o)} cells')
    for k, nm in enumerate(('forest R', 'farm G', 'urban B')):
        r = np.corrcoef(o[:, k], n[:, k])[0, 1]
        print(f'  {nm}: old mean {o[:, k].mean():.3f}, new mean {n[:, k].mean():.3f}, r {r:.3f}, '
              f'mean |d| {np.abs(o[:, k] - n[:, k]).mean():.3f}')
    # built-up at coarser scales (the cities' extent rather than 250 m detail)
    for f in (4, 8):
        oo, nn = [], []
        for tj in range(7):
            for ti in range(7):
                if not done(ti, tj):
                    continue
                old = brw.read_l0(f'{ti}_{tj}', 'c.rgba8', (S, S, 4))
                if old is None:
                    continue
                sk = brw.sk_cells(ti, tj)[2:514, 2:514]
                new = np.load(out_path(ti, tj))[2:514, 2:514, 2].astype(np.float32)
                ob = old[2:514, 2:514, 2].astype(np.float32)
                q = 512 // f
                ok = sk.reshape(q, f, q, f).all(axis=(1, 3))
                oo.append(ob.reshape(q, f, q, f).mean(axis=(1, 3))[ok])
                nn.append(new.reshape(q, f, q, f).mean(axis=(1, 3))[ok])
        oo, nn = np.concatenate(oo), np.concatenate(nn)
        print(f'  urban B at {f * 250 / 1000:g} km blocks: r {np.corrcoef(oo, nn)[0, 1]:.3f} (n {oo.size})')
    ob, nb = o[:, 2] > 0.5, n[:, 2] > 0.5
    print(f'  urban > 0.5: old {ob.sum()}, new {nb.sum()}, both {(ob & nb).sum()}, '
          f'IoU {(ob & nb).sum() / max(1, (ob | nb).sum()):.3f}')


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
        c = np.load(out_path(ti, tj))[BORDER:BORDER + TILE, BORDER:BORDER + TILE, :3].astype(np.float32) / 255
        c = c.reshape(n, f, n, f, 3).mean(axis=(1, 3))
        w = np.load(brw.out_path(ti, tj))[BORDER:BORDER + TILE:f, BORDER:BORDER + TILE:f]
        fo, fa, ur = c[..., 0:1], c[..., 1:2], c[..., 2:3]
        rest = np.clip(1 - fo - fa - ur, 0, 1)
        img = (fo * np.array([30, 110, 40]) + fa * np.array([215, 200, 90]) + ur * np.array([230, 40, 60])
               + rest * np.array([150, 140, 125]))
        img = np.where((w[..., 0] <= 128)[..., None], np.array([30, 60, 110]), img)
        img = np.where(((w[..., 1] < 128) & (w[..., 0] > 128))[..., None], np.array([60, 150, 230]), img)
        r0, c0 = (tj - tj0) * n, (ti - ti0) * n
        rgb[r0:r0 + n, c0:c0 + n] = np.clip(img, 0, 255).astype(np.uint8)
    bc.write_png(PNG, bc.south_up_to_image(rgb))
    print(f'{PNG}: {Wd} x {H} px, {f * CELL:.0f} m a pixel')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles')
    ap.add_argument('--budget', type=float, default=17.0)
    ap.add_argument('--validate', action='store_true')
    ap.add_argument('--seams', action='store_true')
    ap.add_argument('--quicklook', action='store_true')
    ap.add_argument('--step', type=int, default=4)
    a = ap.parse_args()
    if a.validate:
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
