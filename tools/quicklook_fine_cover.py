#!/usr/bin/env python3
"""The fine cover (data/terrain/fine/, ESA WorldCover 2021 resampled to 31.25 m) as a map of one
place: north up, in WorldCover's own legend colours, with the view's direction drawn on it. For
the Part 7 picture sets (V060.md: each view "beside WorldCover's map of the same place").

  python3 tools/quicklook_fine_cover.py --at 36.05,140.05 --hdg 30 --km 16 --out <png>
  python3 tools/quicklook_fine_cover.py --views         # every Part 7 view, into the pictures folder

Reads at most four 1 MB sub-tiles; no dataset is read whole.
"""
import argparse
import gzip
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bake_common import to_map  # noqa: E402

FINE = os.path.join(HERE, '..', 'data', 'terrain', 'fine')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'Claude outputs', 'flight-sim'))
# WorldCover's legend (water, tree, shrub, grass, crop, built, bare, wetland), the index.json order.
COLOURS = np.array([[0, 100, 200], [0, 100, 0], [255, 187, 34], [255, 255, 76], [240, 150, 255],
                    [250, 0, 0], [180, 180, 180], [0, 150, 160]], dtype=np.uint8)
# The same places as tests/browser-v060-stills.mjs's ground views: name -> (lat, lon, heading).
VIEWS = {
    'west-gimpo': (37.68, 126.47, 0), 'nakdong': (35.13, 128.90, 200), 'jeju-farm': (33.45, 126.83, 90),
    'kanto': (36.05, 140.05, 30), 'yangtze': (31.25, 120.85, 280), 'kyushu': (33.2, 130.45, 0),
}


def read_window(index, p0, q0, n):
    """n x n fine pixels from global pixel (p0, q0) (south-west corner), row 0 the south row."""
    sub, per = index['sub'], index['perTile']
    files, uniform = set(index['files']), index['uniform']
    out = np.zeros((n, n), dtype=np.uint8)
    for sj in range(q0 // sub, (q0 + n - 1) // sub + 1):
        for si in range(p0 // sub, (p0 + n - 1) // sub + 1):
            ti, a = divmod(si, per)
            tj, b = divmod(sj, per)
            key = f'{ti}_{tj}_{a}_{b}'
            if key in files:
                with gzip.open(os.path.join(FINE, key + '.u8.gz'), 'rb') as f:
                    t = np.frombuffer(f.read(), dtype=np.uint8).reshape(sub, sub)
            else:
                t = np.full((sub, sub), uniform.get(key, 0), dtype=np.uint8)
            c0, r0 = max(p0, si * sub), max(q0, sj * sub)
            c1, r1 = min(p0 + n, (si + 1) * sub), min(q0 + n, (sj + 1) * sub)
            out[r0 - q0:r1 - q0, c0 - p0:c1 - p0] = t[r0 - sj * sub:r1 - sj * sub, c0 - si * sub:c1 - si * sub]
    return out


def render(lat, lon, hdg, km, path, size=900):
    from PIL import Image, ImageDraw
    with open(os.path.join(FINE, 'fine.json')) as f:
        index = json.load(f)
    px = index['px']
    x, y = to_map(lat, lon)
    n = int(round(km * 1000 / px))
    p0 = int(math.floor((x - index['x0']) / px)) - n // 2
    q0 = int(math.floor((y - index['y0']) / px)) - n // 2
    cls = read_window(index, p0, q0, n)
    rgb = COLOURS[np.minimum(cls, 7)][::-1]          # north up
    im = Image.fromarray(rgb, 'RGB').resize((size, size), Image.NEAREST)
    d = ImageDraw.Draw(im)
    c = size / 2
    a = math.radians(hdg)
    ux, uy = math.sin(a), -math.cos(a)
    L = size * 0.18
    d.line([c - ux * L, c - uy * L, c + ux * L, c + uy * L], fill=(0, 0, 0), width=5)
    d.line([c - ux * L, c - uy * L, c + ux * L, c + uy * L], fill=(255, 255, 255), width=2)
    for s in (2.5, -2.5):                             # the arrow's head: the way the picture looks
        b = a + math.radians(180 - 28 * (1 if s > 0 else -1))
        d.line([c + ux * L, c + uy * L, c + ux * L + math.sin(b) * 26, c + uy * L - math.cos(b) * 26], fill=(255, 255, 255), width=3)
    d.rectangle([0, size - 22, size, size], fill=(0, 0, 0))
    d.text((6, size - 18), f'WorldCover 2021 (as baked, 31.25 m): {km:g} km across, north up; the arrow is the view   '
           'tree green, crop pink, built red, grass yellow, water blue, wetland teal, bare grey', fill=(255, 255, 255))
    im.save(path)
    counts = np.bincount(cls.ravel(), minlength=8)[:8] / cls.size
    return ', '.join(f'{nm} {100 * v:.0f}%' for nm, v in zip(index['classes'], counts) if v >= 0.005)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--at'); ap.add_argument('--hdg', type=float, default=0); ap.add_argument('--km', type=float, default=16)
    ap.add_argument('--out'); ap.add_argument('--views', action='store_true')
    A = ap.parse_args()
    if A.views:
        for name, (la, lo, h) in VIEWS.items():
            p = os.path.join(OUT, f'v060-ground-cover-{name}.png')
            print(name, render(la, lo, h, A.km, p), '->', os.path.basename(p))
    else:
        la, lo = (float(v) for v in A.at.split(','))
        print(render(la, lo, A.hdg, A.km, A.out))
