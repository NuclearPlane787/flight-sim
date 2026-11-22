#!/usr/bin/env python3
"""v0.6.0 Part 7 step 1's second half: South Korea's 250 m cover re-aggregated from the same
land cover as the fine cover (ESA WorldCover 2021), so the near ground (the 31 m fine cover) and
the far ground (the 250 m cover) agree over Korea as they do over Japan and China. OSM's
building density, which Korea's own bake used, is kept as a second source: the built-up share
of a cell is the larger of WorldCover's and the old one, so Seoul's built-up ground is at least
as wide as v0.5.8's.

Inputs: bake_region_cover.py's staged tiles (/tmp/flight-sim/v060/bake/cover/<ti>_<tj>.npy,
516 x 516 x 4 with the 2-cell border, row 0 south: R forest, G farm, B built-up, by its fill
rules) and the game's tiles data/terrain/r0/<ti>_<tj>.c.rgba8.gz (Korea's old cover inside
south-korea.poly, WorldCover outside, cross-faded over 5 km).

Output: data/terrain/r0/<ti>_<tj>.c2.rgba8.gz, only for tiles where it differs from c, and the
list in data/manifest.json (tilesRegion.levels[0].cover2). The game reads c2 in place of c only
with GROUND_ON (Part 7's flag): with it off nothing changes, and the heights and the water are
never touched.

  python3 tools/cpu-guard.py --minutes 5 -- /tmp/flight-sim/venv/bin/python -I tools/bake_korea_cover2.py [--check]
"""
import argparse
import gzip
import json
import os

import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None          # the bake modules make their staging folders on import
try:
    import bake_region_compose as comp      # south-korea.poly, the tiles' cell centres, the 5 km fade
    from scipy import ndimage
finally:
    os.makedirs = _makedirs
DATA = os.path.join(HERE, '..', 'data')
R0 = os.path.join(DATA, 'terrain', 'r0')
STAGE = '/tmp/flight-sim/v060/bake/cover'
S, B = 516, 2
KOREA = [(ti, tj) for ti in range(7) for tj in range(7)]


def read_c(ti, tj, suf='c'):
    p = os.path.join(R0, f'{ti}_{tj}.{suf}.rgba8.gz')
    if not os.path.exists(p):
        return None
    with gzip.open(p, 'rb') as f:
        return np.frombuffer(f.read(), np.uint8).reshape(S, S, 4)


def cover2(old, wc):
    wc = wc.astype(np.float64)
    built = np.maximum(wc[..., 2], old[..., 2].astype(np.float64))
    rg = wc[..., 0] + wc[..., 1]
    scale = np.minimum(1.0, (255.0 - built) / np.maximum(rg, 1.0))
    new = np.zeros_like(old)
    new[..., 0] = np.floor(wc[..., 0] * scale + 0.5)
    new[..., 1] = np.floor(wc[..., 1] * scale + 0.5)
    new[..., 2] = built
    # Land in Korea's own masks where WorldCover has none (a reclaimed shore, a small island):
    # the old cover stays. Cells that were not land stay empty (the water layer draws them).
    none = wc[..., :3].sum(axis=-1) == 0
    new = np.where(none[..., None], old, new)
    new = np.where((old[..., :3].sum(axis=-1) == 0)[..., None] & ~none[..., None], old, new)
    return new.astype(np.uint8)


def korea_weight(ti, tj, rings):
    """1 inside south-korea.poly, falling to 0 at 5 km outside it (bake_region_compose's fade, the
    other way round), computed with a halo so neighbouring tiles agree in their borders."""
    pad = int(comp.FADE_M / comp.CELL) + 2
    xs, ys = comp.tile_xy(ti, tj, pad=pad)
    ins = comp.inside_poly(xs, ys, rings)
    d = ndimage.distance_transform_edt(~ins) * comp.CELL
    return 1.0 - comp.smoothstep(0, comp.FADE_M, d[pad:pad + S, pad:pad + S])


def main():
    import bake_common
    bake_common.refuse_retired('bake_korea_cover2.py', "data/terrain/r0/<tile>.c.rgba8.gz as Korea's OLD cover and the manifest's `cover2` list",
                               'Since v0.7.0 the `c` files are the `c2` cover this tool once wrote, so it would blend the new cover with itself.')
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='only report (the seams, the shares); write nothing')
    A = ap.parse_args()
    out, tot = {}, {'old': np.zeros(3), 'new': np.zeros(3), 'n': 0}
    rings = comp.read_poly()
    for ti, tj in KOREA:
        old = read_c(ti, tj)
        sp = os.path.join(STAGE, f'{ti}_{tj}.npy')
        if old is None or not os.path.exists(sp):
            continue
        # Only South Korea's own ground changes: beyond the poly's 5 km band the tile keeps c.
        k = korea_weight(ti, tj, rings)[..., None]
        if not k.any():
            continue
        new = np.floor(cover2(old, np.load(sp)) * k + old * (1.0 - k) + 0.5).astype(np.uint8)
        tot['old'] += old[..., :3].reshape(-1, 3).sum(axis=0); tot['new'] += new[..., :3].reshape(-1, 3).sum(axis=0); tot['n'] += S * S
        if (new != old).any():
            out[(ti, tj)] = new
    # Seams: each tile's 2-cell border must be its neighbour's core, as in c.
    cur = lambda ti, tj: out.get((ti, tj), read_c(ti, tj))
    bad = 0
    for (ti, tj), a in out.items():
        for dx, dy in ((1, 0), (0, 1)):
            b = cur(ti + dx, tj + dy)
            if b is None:
                continue
            if dx:   # a's east border columns are b's first core columns, and b's west border a's last core columns
                bad += int((a[:, S - B:, :] != b[:, B:2 * B, :]).sum()) + int((b[:, :B, :] != a[:, S - 2 * B:S - B, :]).sum())
            else:
                bad += int((a[S - B:, :, :] != b[B:2 * B, :, :]).sum()) + int((b[:B, :, :] != a[S - 2 * B:S - B, :, :]).sum())
    names = sorted(f'{ti}_{tj}' for ti, tj in out)
    size = 0
    if not A.check:
        for (ti, tj), a in out.items():
            p = os.path.join(R0, f'{ti}_{tj}.c2.rgba8.gz')
            raw = np.ascontiguousarray(a).tobytes()
            if not (os.path.exists(p) and gzip.open(p).read() == raw):
                with open(p + '.tmp', 'wb') as f:
                    f.write(gzip.compress(raw, 9, mtime=0))
                os.replace(p + '.tmp', p)
            size += os.path.getsize(p)
        mp = os.path.join(DATA, 'manifest.json')
        with open(mp) as f:
            man = json.load(f)
        man['tilesRegion']['levels'][0]['cover2'] = names
        with open(mp + '.tmp', 'w') as f:
            json.dump(man, f, indent=2)          # the manifest's own formatting (bake_common.update_manifest)
        os.replace(mp + '.tmp', mp)
    sh = lambda v: ' '.join(f'{k} {100 * x / (255 * tot["n"]):.1f}%' for k, x in zip(('forest', 'farm', 'built'), v))
    print(f'{len(names)} tiles differ: {" ".join(names)}')
    print(f'shares over those 49 tiles, before: {sh(tot["old"])}; after: {sh(tot["new"])}')
    print(f'border bytes that differ from the neighbour\'s core: {bad}')
    if not A.check:
        print(f'wrote {len(names)} c2 files, {size / 1e6:.2f} MB; manifest.tilesRegion.levels[0].cover2')


if __name__ == '__main__':
    main()
