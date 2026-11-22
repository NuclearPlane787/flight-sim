"""The path map's colour by height (v0.7.4, item 11): one small overview of the region's heights for the map, from the
1 km tiles the game already has (the manifest's `l1` level, data/terrain/r1/ and data/europe/terrain/r1/).

Why a file and not the tiles themselves (briefs/V0-7-4.md, part 3, item 11 allows it): the map wants the whole region at
once, and the 1 km tiles are 41 (East Asia) and 30 (Europe) files of 516 x 516 int16 heights plus their water layers:
about 22 MB and 16 MB to fetch, unzip and hold for one picture. The overview is the same heights at 2 km, one byte a
cell, a few hundred kB.

Each cell (2 x 2 cells of the 1 km level):
  0        sea (the 1 km water layer's sea distance negative in most of the four)
  1        land below sea level (Europe's polders: the stored height under 0 on land)
  2..255   land, 2 + round(253 * sqrt(h / HMAX)), h the four's mean height in metres (0 to HMAX, clamped)
so the browser reads h = HMAX * ((v - 2) / 253) ** 2.

Output (--out DIR, default the region's data folder): map-relief.u8.gz (row 0 south) and map-relief.json (the header).
Run (from GameDump; a few seconds a region):
  /tmp/flight-sim/v074/g.sh 5 map/relief-ea.txt /tmp/flight-sim/venv/bin/python -I games/flight-sim/tools/bake_map_relief.py
  FS_REGION=europe /tmp/flight-sim/v074/g.sh 5 map/relief-eu.txt /tmp/flight-sim/venv/bin/python -I games/flight-sim/tools/bake_map_relief.py
"""
import argparse
import gzip
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'data')
EUROPE = os.environ.get('FS_REGION', '').strip().lower() == 'europe'
HMAX = 5000.0
STEP = 2      # 1 km cells per overview cell
FADE_DEG = 2.5   # (second pass) East Asia: the tint and the shade fade out over this much inside the 1 km data's edge


def main():
    ap = argparse.ArgumentParser()
    folder = os.path.join(DATA, 'europe') if EUROPE else DATA
    ap.add_argument('--out', default=folder)
    args = ap.parse_args()
    with open(os.path.join(folder, 'manifest.json')) as f:
        spec = json.load(f)['tilesRegion']
    L = next(lv for lv in spec['levels'] if lv['id'] == 'l1')
    T, B, cell, scale = L['tile'], L['border'], L['cell'], spec.get('heightScale', 0.25)
    S = T + 2 * B
    e = L['extent']
    i0, j0 = e['i0'] - e['i0'] % STEP, e['j0'] - e['j0'] % STEP
    nx, ny = (e['i1'] - i0 + STEP - 1) // STEP * STEP, (e['j1'] - j0 + STEP - 1) // STEP * STEP
    h = np.zeros((ny, nx), np.float32)
    sea = np.ones((ny, nx), bool)
    for name in L['tiles']:
        ti, tj = map(int, name.split('_'))
        base = os.path.join(folder, L['dir'], name)
        hh = np.frombuffer(gzip.open(base + '.h.i16.gz').read(), np.int16).reshape(S, S)[B:B + T, B:B + T] * scale
        ww = np.frombuffer(gzip.open(base + '.w.rg8.gz').read(), np.uint8).reshape(S, S, 2)[B:B + T, B:B + T, 0]
        gi, gj = ti * T - i0, tj * T - j0          # the tile's first cell in the mosaic
        a0, b0 = max(0, -gi), max(0, -gj)
        a1, b1 = min(T, nx - gi), min(T, ny - gj)
        if a1 <= a0 or b1 <= b0:
            continue
        h[gj + b0:gj + b1, gi + a0:gi + a1] = hh[b0:b1, a0:a1]
        sea[gj + b0:gj + b1, gi + a0:gi + a1] = ww[b0:b1, a0:a1] < 128
    # 2 x 2 means
    hm = h.reshape(ny // STEP, STEP, nx // STEP, STEP).mean(axis=(1, 3))
    sm = sea.reshape(ny // STEP, STEP, nx // STEP, STEP).mean(axis=(1, 3)) > 0.5
    land = ~sm
    v = np.zeros(hm.shape, np.uint8)
    head_x0, head_y0 = spec['x0'] + i0 * cell, spec['y0'] + j0 * cell
    weight = np.full(hm.shape, 255, np.uint8)
    up = np.clip(hm, 0, HMAX)
    v[land] = (2 + np.round(253 * np.sqrt(up[land] / HMAX))).astype(np.uint8)
    if not EUROPE:
        # East Asia's 1 km heights stop at the margin box (24-46 N, 112-148 E: tools/bake_country.py's); past it the
        # tiles hold a flat fill, striped where it meets the data near 112 E. Land there is drawn as low ground.
        sys.path.insert(0, HERE)
        from bake_common import to_geo   # noqa: E402  (East Asia's frame: FS_REGION unset)
        jj, ii = np.mgrid[0:v.shape[0], 0:v.shape[1]]
        lat, lon = to_geo(head_x0 + (ii + 0.5) * cell * STEP, head_y0 + (jj + 0.5) * cell * STEP)
        out_box = (lon < 112.6) | (lon > 148) | (lat < 24) | (lat > 46)
        v[land & out_box] = 2
        # (second pass) and the tint and the shade both faded out over the last FADE_DEG inside, as a weight the map
        # blends with the plain land colour: v0.7.4's first 0.6 degrees, blending the heights, still showed a straight edge
        t = np.clip(np.minimum.reduce([lon - 112.6, 148 - lon, lat - 24, 46 - lat]) / FADE_DEG, 0, 1)
        weight = np.round(255 * t * t * (3 - 2 * t)).astype(np.uint8)
        print(f'  {int((land & out_box).sum())} land cells outside the margin box drawn as low ground; faded over {FADE_DEG} degrees')
    if EUROPE:
        sys.path.insert(0, HERE)
        # (second pass) nothing outside the region's outline: the map's land stops there (its diagonal in the south-east)
        from shapely import contains_xy
        from shapely.geometry import Polygon
        from bake_common import outline_latlon, to_map   # noqa: E402  (Europe's frame: FS_REGION=europe)
        la, lo = outline_latlon(0.1)
        ox, oy = to_map(la, lo)
        jj, ii = np.mgrid[0:v.shape[0], 0:v.shape[1]]
        outside = ~contains_xy(Polygon(np.stack([ox, oy], 1)), head_x0 + (ii + 0.5) * cell * STEP, head_y0 + (jj + 0.5) * cell * STEP)
        v[outside] = 0
        land = land & ~outside
        print(f'  {int(outside.sum())} cells outside the region\'s outline left empty')
    if EUROPE:   # (regions.js lowLand: only Europe stores land below the sea; East Asia's sub-zero land is the coast's blend)
        v[land & (hm < -0.5)] = 1
    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, 'map-relief.u8.gz')
    # (mtime=0, the lead, v0.7.4: no time in the gzip header, so a second bake of the same heights is byte-identical)
    with open(out, 'wb') as fh, gzip.GzipFile(filename='', mode='wb', fileobj=fh, compresslevel=9, mtime=0) as f:
        f.write(v.tobytes())
        f.write(weight.tobytes())
    head = dict(v=1, source='the 1 km level (l1) of the region\'s terrain tiles, 2 x 2 means (tools/bake_map_relief.py)',
                x0=spec['x0'] + i0 * cell, y0=spec['y0'] + j0 * cell, cell=cell * STEP, nx=int(v.shape[1]), ny=int(v.shape[0]),
                hmax=HMAX, encoding='0 sea, 1 land below sea level, 2..255 land: h = hmax * ((v - 2) / 253) ** 2 metres',
                planes=2, weight='the second plane: 0..255, how much of the tint and shade shows (faded to the plain land where the heights end)',
                rowOrder='south first', sampling='cell-centred', file='map-relief.u8.gz')
    with open(os.path.join(args.out, 'map-relief.json'), 'w') as f:
        json.dump(head, f, indent=1)
    print(f'{out}: {os.path.getsize(out)} bytes, {v.shape[1]} x {v.shape[0]} cells of {cell * STEP:.0f} m; '
          f'land {int(land.sum())}, below sea level {int((v == 1).sum())}, highest {hm.max():.0f} m')


if __name__ == '__main__':
    main()
