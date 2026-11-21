"""v0.7.0: quick-looks of Europe's sealed 250 m tiles (staging l0/), north up.

  FS_REGION=europe /tmp/flight-sim/venv/bin/python -I tools/bake_europe_quicklook.py [--l1]

Overall (1 km a pixel): Claude outputs/flight-sim/v070-bake-heights.png (hillshade x colour ramp;
sea dark blue; land below 0 m magenta-tinted; tiles not in batch A dark grey), -water.png (sea blue by
distance, inland water light blue, land beige; land below 0 m magenta), -cover.png (forest green, farm
yellow, built-up red, rest grey). Crops at 250 m a pixel (scaled up 2 x): -crop-<name>-{h,c}.png.
With --l1: v070-bake-l1-heights.png from the staged 1 km level (2 km a pixel).
"""
import argparse
import gzip
import os
import sys

import numpy as np

os.environ['FS_REGION'] = 'europe'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None
try:
    import bake_common as bc
    import bake_region_tiles as rt
finally:
    os.makedirs = _makedirs

S, T, B = 516, 512, 2
CROPS = {   # name: (lat0, lat1, lon0, lon1)
    'alps': (45.6, 47.6, 6.5, 10.5),
    'pyrenees': (42.0, 43.4, -2.0, 3.3),
    'polders': (51.8, 53.0, 4.2, 6.2),
    'thames': (51.3, 51.65, -0.75, 0.6),
    'barcelona': (41.1, 41.6, 1.7, 2.6),
    'rome': (41.55, 42.1, 11.9, 12.75),
}
PFX = 'v070'
if bc.EU_BATCH != 'A':   # v0.7.1, batch B: the merged view (rt.WORK/merged: every batch's sealed tiles) and B's crops
    PFX = 'v071'
    CROPS = {
        'dublin': (53.15, 53.6, -6.5, -5.9),
        'lisbon': (38.55, 39.0, -9.5, -8.85),
        'oresund': (55.35, 56.1, 12.2, 13.2),
        'berlin': (52.25, 52.65, 12.9, 13.9),
        'vienna': (47.95, 48.4, 16.0, 16.8),
        'toulouse-pyrenees': (42.6, 43.8, 0.4, 2.2),
    }


def read(d, name):
    p = os.path.join(d, name)
    if not os.path.exists(p + '.h.i16.gz'):
        return None
    h = np.frombuffer(gzip.open(p + '.h.i16.gz').read(), '<i2').reshape(S, S).astype(np.float32) * 0.25
    w = np.frombuffer(gzip.open(p + '.w.rg8.gz').read(), np.uint8).reshape(S, S, 2)
    c = np.frombuffer(gzip.open(p + '.c.rgba8.gz').read(), np.uint8).reshape(S, S, 4)
    return h, w, c


def shade(h, cs):
    gy, gx = np.gradient(h, cs)
    slope = np.arctan(2.0 * np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(45)
    s = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(0.35 + 0.65 * s, 0, 1)


def render(H, W, C, have, cs):
    land = have & (W[..., 0] > 128)
    hz = np.where(land, H, 0)
    stops = np.array([-10, 0, 50, 200, 500, 1000, 2000, 3800], float)
    cols = np.array([[200, 60, 200], [70, 120, 60], [90, 140, 70], [170, 170, 100], [180, 140, 90],
                     [150, 110, 80], [200, 190, 180], [255, 255, 255]], float)
    sh = shade(hz, cs)
    rgb = np.stack([np.interp(np.clip(hz, -10, 3800), stops, cols[:, k]) for k in range(3)], -1) * sh[..., None]
    low = land & (H < 0)
    rgb[low] = rgb[low] * 0.4 + np.array([230, 60, 230]) * 0.6
    rgb[have & ~land] = [30, 55, 110]
    rgb[~have] = [25, 25, 25]
    # water picture
    sea = (W[..., 0].astype(np.float32) - 128)
    t = np.clip(sea / 127, 0, 1)[..., None]
    wimg = np.stack([200 - 60 * t[..., 0], 190 - 40 * t[..., 0], 150 - 40 * t[..., 0]], -1)
    s = np.clip(-sea / 128, 0, 1)
    wimg = np.where((~land)[..., None], np.stack([70 - 40 * s, 120 - 60 * s, 190 - 70 * s], -1), wimg)
    wimg = np.where((land & (W[..., 1] < 128))[..., None], np.array([30, 160, 255], np.float32), wimg)
    wimg = np.where((land & (H < 0) & (W[..., 1] >= 128))[..., None], np.array([220, 70, 220], np.float32), wimg)
    wimg[~have] = [25, 25, 25]
    # cover picture
    f = C[..., 0:1] / 255.0; fa = C[..., 1:2] / 255.0; u = C[..., 2:3] / 255.0
    rest = np.clip(1 - f - fa - u, 0, 1)
    cimg = f * np.array([30, 110, 40]) + fa * np.array([215, 200, 90]) + u * np.array([230, 40, 60]) + rest * np.array([150, 140, 125])
    cimg = np.where((~land)[..., None], np.array([30, 60, 110]), cimg)
    cimg = np.where((land & (W[..., 1] < 128))[..., None], np.array([60, 150, 230]), cimg)
    cimg[~have] = [25, 25, 25]
    out = []
    for a in (rgb, wimg, cimg):
        out.append(bc.south_up_to_image(np.clip(a, 0, 255).astype(np.uint8)))
    return out


def mosaic(d, tiles, i0, j0, nx, ny, step):
    """Cells (global l0 indices) i0.. i0 + nx*step, j0 likewise, sampled every `step` (block mean for H)."""
    H = np.zeros((ny, nx), np.float32); W = np.zeros((ny, nx, 2), np.uint8); C = np.zeros((ny, nx, 4), np.uint8)
    have = np.zeros((ny, nx), bool)
    for (ti, tj) in tiles:
        g0, h0 = ti * T, tj * T
        if g0 + T <= i0 or g0 >= i0 + nx * step or h0 + T <= j0 or h0 >= j0 + ny * step:
            continue
        r = read(d, f'{ti}_{tj}')
        if r is None:
            continue
        h, w, c = (a[B:B + T, B:B + T] for a in r)
        if step > 1:
            h = h.reshape(T // step, step, T // step, step).mean(axis=(1, 3))
            w = w[::step, ::step]; c = c[::step, ::step]
        n = T // step
        ox, oy = (g0 - i0) // step, (h0 - j0) // step
        sx0, sy0 = max(0, -ox), max(0, -oy)
        sx1, sy1 = min(n, nx - ox), min(n, ny - oy)
        if sx1 <= sx0 or sy1 <= sy0:
            continue
        H[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = h[sy0:sy1, sx0:sx1]
        W[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = w[sy0:sy1, sx0:sx1]
        C[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = c[sy0:sy1, sx0:sx1]
        have[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = True
    return H, W, C, have


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--l1', action='store_true')
    a = ap.parse_args()
    d = os.path.join(rt.STAGE, 'l0') if PFX == 'v070' else os.path.join(rt.WORK, 'merged', 'l0')
    tiles = rt.EXTRA_TILES
    if a.l1:
        d1 = os.path.join(rt.STAGE, 'l1') if PFX == 'v070' else os.path.join(rt.WORK, 'merged', 'l1')
        names = [f[:-9] for f in os.listdir(d1) if f.endswith('.h.i16.gz')]
        tl = [tuple(int(v) for v in n.split('_')) for n in names]
        ti0, ti1 = min(t[0] for t in tl), max(t[0] for t in tl)
        tj0, tj1 = min(t[1] for t in tl), max(t[1] for t in tl)
        step = 2
        nx, ny = (ti1 - ti0 + 1) * T // step, (tj1 - tj0 + 1) * T // step
        H, W, C, have = mosaic(d1, tl, ti0 * T, tj0 * T, nx, ny, step)
        hi, wi, ci = render(H, W, C, have, 1000.0 * step)
        bc.write_png(os.path.join(bc.SHOTS, f'{PFX}-bake-l1-heights.png'), hi)
        bc.write_png(os.path.join(bc.SHOTS, f'{PFX}-bake-l1-cover.png'), ci)
        print('l1', nx, ny)
        return
    ti0, ti1 = min(t[0] for t in tiles), max(t[0] for t in tiles)
    tj0, tj1 = min(t[1] for t in tiles), max(t[1] for t in tiles)
    step = 4
    nx, ny = (ti1 - ti0 + 1) * T // step, (tj1 - tj0 + 1) * T // step
    H, W, C, have = mosaic(d, tiles, ti0 * T, tj0 * T, nx, ny, step)
    hi, wi, ci = render(H, W, C, have, 250.0 * step)
    for nm, im in (('heights', hi), ('water', wi), ('cover', ci)):
        bc.write_png(os.path.join(bc.SHOTS, f'{PFX}-bake-{nm}.png'), im)
    print(f'overall {nx} x {ny} px, 1 km a pixel, tiles {ti0}..{ti1} x {tj0}..{tj1}')
    for nm, (la0, la1, lo0, lo1) in CROPS.items():
        lat = np.array([la0, la0, la1, la1, (la0 + la1) / 2, (la0 + la1) / 2])
        lon = np.array([lo0, lo1, lo0, lo1, lo0, lo1])
        x, y = bc.to_map(lat, lon)
        i0 = int(np.floor((x.min() - bc.NAT['x0']) / 250)); i1 = int(np.ceil((x.max() - bc.NAT['x0']) / 250))
        j0 = int(np.floor((y.min() - bc.NAT['y0']) / 250)); j1 = int(np.ceil((y.max() - bc.NAT['y0']) / 250))
        H, W, C, have = mosaic(d, tiles, i0, j0, i1 - i0, j1 - j0, 1)
        hi, wi, ci = render(H, W, C, have, 250.0)
        up = 2 if max(i1 - i0, j1 - j0) < 700 else 1
        for suf, im in (('h', hi), ('w', wi), ('c', ci)):
            if up > 1:
                im = np.repeat(np.repeat(im, up, 0), up, 1)
            bc.write_png(os.path.join(bc.SHOTS, f'{PFX}-bake-crop-{nm}-{suf}.png'), im)
        land = have & (W[..., 0] > 128)
        print(f'crop {nm}: {i1 - i0} x {j1 - j0} cells; land {int(land.sum())}, land below 0 m {int((land & (H < 0)).sum())}, '
              f'min {H[land].min() if land.any() else 0:.1f} max {H[land].max() if land.any() else 0:.1f}')


if __name__ == '__main__':
    main()
