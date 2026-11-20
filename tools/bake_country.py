"""The country raster (briefs/V0-6-0.md, Part 2 step 8): about 2 km cells in the map frame over the
margin box (24-46 N, 112-148 E), each the country its centre falls in, from Natural Earth's
ne_10m_admin_0_countries (public domain), and the sea taking its nearest land cell's country
(close to the FIR boundaries: the Korea-Japan median, the Yellow Sea).

Codes: 0 sea, 1 KR, 2 KP, 3 JP, 4 CN, 5 other. Each byte is
  low 3 bits  the country (1-5): the land's own, or for the sea its nearest land's
  bit 3 (8)   set where the cell is sea
so `byte & 7` is the answer for anything that needs "whose is it", and `byte & 8` says sea.
(0 alone would mean sea with no land anywhere: it never occurs.)

How: the countries' rings go into the map frame (toMap of every vertex; Natural Earth's 10 m
vertices are dense enough that straight edges in the map frame are fine), then an even-odd
scanline fill by cell centre per country. The sea's nearest land is a jump flood (exact to a
cell or so, which is what 2 km cells are anyway) in map metres.

Outputs:
  data/country.u8.gz   uint8, ny rows x nx, row 0 = south, cell-centred
  data/country.json    the header
  Claude outputs/flight-sim/v060-bake-country.png   the quick-look (north up)

Run (from the game folder):
  python3 tools/cpu-guard.py --minutes 10 -- /tmp/flight-sim/venv/bin/python -I tools/bake_country.py
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import DATA, RAW, SHOTS, to_geo, to_map, write_gz, write_png  # noqa: E402

SRC = os.path.join(RAW, 'ne', 'ne_10m_admin_0_countries.geojson')
GRID = dict(x0=-1600000.0, y0=-1340000.0, cell=2000.0, nx=1855, ny=1315)
CODES = {'KOR': 1, 'PRK': 2, 'JPN': 3, 'CHN': 4}
NAMES = ['sea', 'KR', 'KP', 'JP', 'CN', 'other']
SEA = 8
# The geographic box to take polygons from (a little past the margin box).
BOX = (20.0, 50.0, 105.0, 155.0)   # lat0, lat1, lon0, lon1


def rings_of(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        for ring in poly:
            yield np.asarray(ring, dtype=np.float64)


def fill_rings(rings, gr):
    """Even-odd fill of map-frame rings by cell centre. Returns a bool (ny, nx) mask."""
    x0, y0, c, nx, ny = gr['x0'], gr['y0'], gr['cell'], gr['nx'], gr['ny']
    acc = np.zeros((ny, nx + 1), dtype=np.int32)
    rows_all, xs_all = [], []
    for r in rings:
        xa, ya = r[:-1, 0], r[:-1, 1]
        xb, yb = r[1:, 0], r[1:, 1]
        # row j's centre is y0 + (j + 0.5) c; an edge crosses it when the centre lies in
        # [min(ya, yb), max(ya, yb)) (half-open, so shared vertices count once)
        lo = np.minimum(ya, yb); hi = np.maximum(ya, yb)
        j0 = np.ceil((lo - y0) / c - 0.5).astype(np.int64)
        j1 = np.ceil((hi - y0) / c - 0.5).astype(np.int64)   # exclusive
        j0 = np.clip(j0, 0, ny); j1 = np.clip(j1, 0, ny)
        cnt = j1 - j0
        keep = cnt > 0
        if not keep.any():
            continue
        xa, ya, xb, yb, j0, cnt = xa[keep], ya[keep], xb[keep], yb[keep], j0[keep], cnt[keep]
        e = np.repeat(np.arange(len(cnt)), cnt)
        off = np.arange(cnt.sum()) - np.repeat(np.cumsum(cnt) - cnt, cnt)
        j = j0[e] + off
        yc = y0 + (j + 0.5) * c
        t = (yc - ya[e]) / (yb[e] - ya[e])
        rows_all.append(j); xs_all.append(xa[e] + t * (xb[e] - xa[e]))
    if not rows_all:
        return np.zeros((ny, nx), bool)
    j = np.concatenate(rows_all); x = np.concatenate(xs_all)
    o = np.lexsort((x, j)); j, x = j[o], x[o]
    # pair up crossings within each row (even-odd): every row has an even count
    starts = np.r_[0, np.flatnonzero(np.diff(j)) + 1]
    rank = np.arange(len(j)) - np.repeat(starts, np.diff(np.r_[starts, len(j)]))
    assert (np.bincount(j, minlength=ny) % 2 == 0).all(), 'odd crossing count: an open ring?'
    on, off_ = rank % 2 == 0, rank % 2 == 1
    # columns whose centre x0 + (i + 0.5) c lies in [xin, xout)
    ci = np.clip(np.ceil((x - x0) / c - 0.5).astype(np.int64), 0, nx)
    np.add.at(acc, (j[on], ci[on]), 1)
    np.add.at(acc, (j[off_], ci[off_]), -1)
    return np.cumsum(acc, axis=1)[:, :nx] > 0


def jump_flood(label):
    """label: (ny, nx) uint8, 0 = unlabelled. Every 0 takes its nearest labelled cell's label."""
    ny, nx = label.shape
    INF = np.int32(1 << 30)
    jj, ii = np.mgrid[0:ny, 0:nx].astype(np.int32)
    sy = np.where(label > 0, jj, -1).astype(np.int32)
    sx = np.where(label > 0, ii, -1).astype(np.int32)

    def d2(sy_, sx_):
        dy = (sy_ - jj).astype(np.int64); dx = (sx_ - ii).astype(np.int64)
        return np.where(sy_ >= 0, dy * dy + dx * dx, np.int64(INF) * INF)

    best = d2(sy, sx)
    k = 1 << int(np.ceil(np.log2(max(ny, nx))))
    steps = []
    while k >= 1:
        k //= 2
        if k: steps.append(k)
    steps += [2, 1, 1]   # JFA+2: clean up the rare misses
    for k in steps:
        for dy in (-k, 0, k):
            for dx in (-k, 0, k):
                if dy == 0 and dx == 0:
                    continue
                # candidate seed = the seed held by the cell at (j + dy, i + dx)
                csy = np.full_like(sy, -1); csx = np.full_like(sx, -1)
                ys_d = slice(max(0, -dy), ny - max(0, dy)); ys_s = slice(max(0, dy), ny - max(0, -dy))
                xs_d = slice(max(0, -dx), nx - max(0, dx)); xs_s = slice(max(0, dx), nx - max(0, -dx))
                csy[ys_d, xs_d] = sy[ys_s, xs_s]; csx[ys_d, xs_d] = sx[ys_s, xs_s]
                cd = d2(csy, csx)
                better = cd < best
                sy = np.where(better, csy, sy); sx = np.where(better, csx, sx); best = np.where(better, cd, best)
    assert (sy >= 0).all()
    return label[sy, sx]


def main():
    gr = GRID
    with open(SRC) as f:
        feats = json.load(f)['features']
    land = np.zeros((gr['ny'], gr['nx']), np.uint8)
    lat0, lat1, lon0, lon1 = BOX
    used = []
    # "other" first, then the four, so a shared border cell goes to the named country
    feats.sort(key=lambda ft: ft['properties']['ADM0_A3'] in CODES)
    for ft in feats:
        a3 = ft['properties']['ADM0_A3']
        rings = []
        for r in rings_of(ft['geometry']):
            if r[:, 1].max() < lat0 or r[:, 1].min() > lat1 or r[:, 0].max() < lon0 or r[:, 0].min() > lon1:
                continue
            x, y = to_map(r[:, 1], r[:, 0])
            rings.append(np.stack([x, y], 1))
        if not rings:
            continue
        mask = fill_rings(rings, gr)
        if mask.any():
            land[mask] = CODES.get(a3, 5)
            used.append(f'{a3}:{int(mask.sum())}')
    print('countries filled (cells):', ' '.join(used))
    sea = land == 0
    owner = jump_flood(land)
    out = (owner | np.where(sea, SEA, 0)).astype(np.uint8)
    write_gz(os.path.join(DATA, 'country.u8.gz'), out)
    header = dict(
        source='Natural Earth ne_10m_admin_0_countries (public domain)',
        codes={str(i): n for i, n in enumerate(NAMES)},
        encoding='byte & 7 = country (1 KR, 2 KP, 3 JP, 4 CN, 5 other; the sea takes its nearest '
                 'land cell\'s); byte & 8 = sea. 0 would be sea with no country (never occurs).',
        type='uint8', rowOrder='south first',
        sampling='cell-centred: value (i, j) is at x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell',
        file='country.u8.gz', frame='src/world/frame.js map metres',
        covers='24-46 N, 112-148 E (the margin box) and more', **gr)
    with open(os.path.join(DATA, 'country.json'), 'w') as f:
        json.dump(header, f, indent=2)
    for name in ('country.u8.gz', 'country.json'):
        print(f'  data/{name}: {os.path.getsize(os.path.join(DATA, name))} bytes')
    for k in range(1, 6):
        print(f'  {NAMES[k]}: land {int(((out & 7) == k).sum() - ((out == (k | SEA))).sum())} cells, '
              f'with its sea {int(((out & 7) == k).sum())}')

    # the quick-look: land bright, sea dark of the same hue, borders black, 5 deg graticule,
    # the fine box (29-40 N, 119-142 E) white
    pal = np.array([[0, 0, 0], [60, 120, 220], [220, 60, 60], [240, 200, 40], [60, 170, 80], [150, 150, 150]], float)
    o = out & 7
    rgb = pal[o]
    rgb[sea] = rgb[sea] * 0.35 + np.array([10, 20, 40])
    edge = np.zeros_like(sea)
    edge[:, 1:] |= o[:, 1:] != o[:, :-1]; edge[1:, :] |= o[1:, :] != o[:-1, :]
    coast = np.zeros_like(sea)
    coast[:, 1:] |= sea[:, 1:] != sea[:, :-1]; coast[1:, :] |= sea[1:, :] != sea[:-1, :]
    rgb[coast] = rgb[coast] * 0.5 + 110
    rgb[edge] = 0
    xs = gr['x0'] + (np.arange(gr['nx']) + 0.5) * gr['cell']
    ys = gr['y0'] + (np.arange(gr['ny']) + 0.5) * gr['cell']
    X, Y = np.meshgrid(xs, ys)
    lat, lon = to_geo(X, Y)
    grat = np.zeros_like(sea)
    for a in (lat, lon):
        b = np.floor(a / 5)
        grat[:, 1:] |= b[:, 1:] != b[:, :-1]; grat[1:, :] |= b[1:, :] != b[:-1, :]
    rgb[grat] = rgb[grat] * 0.6 + 60
    inbox = (lat >= 29) & (lat <= 40) & (lon >= 119) & (lon <= 142)
    box = np.zeros_like(sea)
    box[:, 1:] |= inbox[:, 1:] != inbox[:, :-1]; box[1:, :] |= inbox[1:, :] != inbox[:-1, :]
    rgb[box] = 255
    png = os.path.join(SHOTS, 'v060-bake-country.png')
    write_png(png, np.clip(rgb, 0, 255).astype(np.uint8)[::-1])
    print('  quick-look:', png)


if __name__ == '__main__':
    main()
