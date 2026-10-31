"""Quick-look PNGs and spot checks of the baked data (for review, not used by the game).

  bake_quicklook.py [height] [water] [cover] [patches] [spots]

PNGs go to Claude outputs/flight-sim/bake-*.png (north up, 1600 px for the national grid).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import DATA, NAT, SHOTS, read_gz, south_up_to_image, to_map, write_png

NX, NY = NAT['nx'], NAT['ny']


def shade(h, cell):
    """Hypsometric colours with hillshade; sea in blue by depth."""
    gy, gx = np.gradient(h, cell)
    light = np.clip(0.75 + (-gx * 0.6 + gy * 0.6) * 4, 0.35, 1.25)
    t = np.clip(h / 1800, 0, 1)[..., None]
    low = np.array([70, 140, 70]); mid = np.array([190, 170, 110]); high = np.array([250, 250, 250])
    land = np.where(t < 0.4, low + (mid - low) * (t / 0.4), mid + (high - mid) * ((t - 0.4) / 0.6))
    land = land * light[..., None]
    d = np.clip(-h / 40, 0, 1)[..., None]
    sea = np.array([120, 180, 230]) * (1 - d) + np.array([20, 50, 120]) * d
    rgb = np.where((h > 0)[..., None], land, sea)
    return np.clip(rgb, 0, 255).astype(np.uint8)


def down(a, f=2):
    return a[::f, ::f]


def load_height():
    return read_gz(os.path.join(DATA, 'terrain', 'height.i16.gz'), '<i2', (NY, NX)).astype(np.float32) * 0.25


def cell_of(lat, lon):
    x, y = to_map(lat, lon)
    return int((y - NAT['y0']) // NAT['cell']), int((x - NAT['x0']) // NAT['cell'])


SPOTS = [('Hallasan summit', 33.3617, 126.5292), ('Gimpo ARP', 37.5583, 126.7906),
         ('Jeju ARP', 33.5113, 126.4930), ('Incheon ARP', 37.4691, 126.4510),
         ('Han River at Mapo', 37.5390, 126.9330), ('Yellow Sea off Incheon', 37.40, 126.20),
         ('Jirisan (1915 m)', 35.3370, 127.7306), ('Seoraksan (1708 m)', 38.1194, 128.4656),
         ('Namsan, Seoul (262 m)', 37.5512, 126.9882), ('Gangnam street level', 37.4979, 127.0276)]


def bilinear(h, x0, y0, cell, x, y):
    fx = (x - x0) / cell - 0.5
    fy = (y - y0) / cell - 0.5
    i, j = int(np.floor(fx)), int(np.floor(fy))
    tx, ty = fx - i, fy - j
    return (h[j, i] * (1 - tx) * (1 - ty) + h[j, i + 1] * tx * (1 - ty)
            + h[j + 1, i] * (1 - tx) * ty + h[j + 1, i + 1] * tx * ty)


def spot_heights(m):
    h = load_height()
    patches = [(p, read_gz(os.path.join(DATA, p['height']), '<i2', (p['ny'], p['nx'])).astype(np.float32) * 0.25)
               for p in m.get('patches', [])]
    print(f"{'place':28s} {'national':>9s} {'patch':>9s}")
    for name, la, lo in SPOTS:
        x, y = to_map(la, lo)
        nat = bilinear(h, NAT['x0'], NAT['y0'], NAT['cell'], x, y)
        pv = ''
        for p, ph in patches:
            if p['x0'] + p['cell'] < x < p['x0'] + (p['nx'] - 1) * p['cell'] and \
               p['y0'] + p['cell'] < y < p['y0'] + (p['ny'] - 1) * p['cell']:
                pv = f"{bilinear(ph, p['x0'], p['y0'], p['cell'], x, y):9.1f}"
        print(f'{name:28s} {nat:9.1f} {pv:>9s}')
    print('national max', h.max(), 'at', np.unravel_index(h.argmax(), h.shape), '; min', h.min())


def main(what):
    m = json.load(open(os.path.join(DATA, 'manifest.json')))
    if 'height' in what:
        h = load_height()
        write_png(os.path.join(SHOTS, 'bake-height.png'), down(south_up_to_image(shade(h, 250))))
        # Seoul/Incheon close-up (rows/cols around Gimpo)
        j, i = cell_of(37.55, 126.8)
        crop = h[j - 200:j + 200, i - 250:i + 250]
        write_png(os.path.join(SHOTS, 'bake-height-seoul.png'), south_up_to_image(shade(crop, 250)))
    if 'water' in what:
        w = read_gz(os.path.join(DATA, 'terrain', 'water.rg8.gz'), 'u1', (NY, NX, 2))
        rgb = np.zeros((NY, NX, 3), np.uint8)
        r = w[..., 0].astype(int); g = w[..., 1].astype(int)
        rgb[..., 0] = np.where(r >= 128, 60 + (r - 128) // 2, 0)   # land: grey-red by distance
        rgb[..., 1] = np.where(r >= 128, 60 + (r - 128) // 2, 0)
        rgb[..., 2] = np.where(r < 128, 80 + r, 40)
        inland = g < 128
        rgb[inland] = [0, 220, 255]
        write_png(os.path.join(SHOTS, 'bake-water.png'), down(south_up_to_image(rgb)))
        j, i = cell_of(37.55, 126.9)
        write_png(os.path.join(SHOTS, 'bake-water-seoul.png'),
                  south_up_to_image(rgb[j - 160:j + 160, i - 260:i + 260]))
    if 'cover' in what:
        c = read_gz(os.path.join(DATA, 'terrain', 'cover.rgba8.gz'), 'u1', (NY, NX, 4))
        h = load_height()
        rgb = np.full((NY, NX, 3), 235, np.float32)
        f, g, u = (c[..., k:k + 1].astype(np.float32) / 255 for k in range(3))
        rgb = rgb * (1 - f - g - u).clip(0, 1) + f * np.array([30, 110, 40]) + g * np.array([210, 200, 90]) \
            + u * np.array([200, 40, 40])
        rgb[h <= 0] = [40, 70, 140]
        rgb = rgb.clip(0, 255).astype(np.uint8)
        write_png(os.path.join(SHOTS, 'bake-cover.png'), down(south_up_to_image(rgb)))
        j, i = cell_of(37.55, 126.9)
        write_png(os.path.join(SHOTS, 'bake-cover-seoul.png'),
                  south_up_to_image(rgb[j - 160:j + 160, i - 260:i + 260]))
    if 'patches' in what:
        for p in m.get('patches', []):
            h = read_gz(os.path.join(DATA, p['height']), '<i2', (p['ny'], p['nx'])).astype(np.float32) * 0.25
            f = max(1, p['nx'] // 1600)
            write_png(os.path.join(SHOTS, f"bake-patch-{p['id']}.png"), south_up_to_image(shade(h, p['cell']))[::f, ::f])
        for p in m.get('coastPatches', []):
            c = read_gz(os.path.join(DATA, p['coast']), 'u1', (p['ny'], p['nx']))
            rgb = np.stack([c, c, np.where(c < 128, 255, c)], -1).astype(np.uint8)
            write_png(os.path.join(SHOTS, f"bake-coast-{p['id']}.png"), south_up_to_image(rgb))
    if 'spots' in what:
        spot_heights(m)


if __name__ == '__main__':
    main(sys.argv[1:] or ['height'])
