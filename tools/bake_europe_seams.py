"""v0.7.0: the seam check over every pair of neighbouring tiles of a sealed tile folder.

For two tiles that share an edge or a corner, every cell that lies in both 516 x 516 grids (a core
cell of one is a border cell of the other) must hold the same bytes in all three layers (heights,
water, cover). A tile in the list with no file is open sea (the manifest's `sea` values).

  FS_REGION=europe python3 tools/cpu-guard.py -- /tmp/flight-sim/venv/bin/python -I tools/bake_europe_seams.py \
      [--dir /tmp/flight-sim/v070/bake/l0] [--level l0|l1]
"""
import argparse
import gzip
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_region_tiles as rt  # noqa: E402

TILE, B = 512, 2
S = TILE + 2 * B
SEA = dict(h=0 if os.environ.get('FS_REGION', '').strip().lower() == 'europe' else -160, w=(0, 255), c=(0, 0, 0, 0))
LAYERS = (('.h.i16.gz', '<i2', ()), ('.w.rg8.gz', np.uint8, (2,)), ('.c.rgba8.gz', np.uint8, (4,)))


def read(d, name):
    p = os.path.join(d, name)
    if not os.path.exists(p + '.h.i16.gz'):
        return (np.full((S, S), SEA['h'], '<i2'), np.tile(np.array(SEA['w'], np.uint8), (S, S, 1)),
                np.zeros((S, S, 4), np.uint8))
    return tuple(np.frombuffer(gzip.open(p + suf).read(), dt).reshape((S, S) + tail) for suf, dt, tail in LAYERS)


def seal_dir(d, tiles):
    """--seal: every tile with a file takes its border cells from the owning neighbours' cores (a
    neighbour in the list with no file is open sea); its own core is never changed. Rewrites only the
    tiles whose border changes. Used for Europe's 1 km level, whose margin tiles compute their borders
    independently (the 250 m level is sealed by bake_region_compose.py --seal)."""
    cores = {t: read(d, f'{t[0]}_{t[1]}') for t in tiles}
    report = {}
    for t in sorted(tiles):
        name = f'{t[0]}_{t[1]}'
        if not os.path.exists(os.path.join(d, name + '.h.i16.gz')):
            continue
        arrs = [a.copy() for a in cores[t]]
        g = np.arange(S) - B
        changed = 0
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                o = (t[0] + di, t[1] + dj)
                if (di == 0 and dj == 0) or o not in tiles:
                    continue
                cs = np.nonzero(np.floor_divide(g, TILE) == di)[0]
                rs = np.nonzero(np.floor_divide(g, TILE) == dj)[0]
                for k in range(3):
                    src = cores[o][k][np.ix_(rs - dj * TILE, cs - di * TILE)]
                    dd = arrs[k][np.ix_(rs, cs)] != src
                    changed += int(dd.sum())
                    arrs[k][np.ix_(rs, cs)] = src
        core = (slice(B, B + TILE), slice(B, B + TILE))
        for k in range(3):
            assert np.array_equal(arrs[k][core], cores[t][k][core])
        if changed:
            for (suf, dt, tail), a in zip(LAYERS, arrs):
                p = os.path.join(d, name + suf)
                with gzip.open(p + '.tmp', 'wb', compresslevel=9) as f:
                    f.write(np.ascontiguousarray(a).tobytes())
                os.replace(p + '.tmp', p)
        report[name] = changed
    print('seal: border values changed per tile:', {k: v for k, v in report.items() if v})
    return report


def seal_unowned(d, tiles):
    """--seal-unowned (v0.7.8, East Asia's shipped tiles): a border cell that two listed tiles both hold and that
    no listed tile owns (its owner is a tile that was never baked: East Asia's 250 m area is a list of tiles with the
    1 km level round it, not a rectangle with the sea round it) can't be sealed from an owner's core. Where two
    such borders differ, the later tile of the pair (sorted order) takes the earlier one's value. Cores are never
    changed. Returns the border values changed per tile."""
    arrs = {t: [a.copy() for a in read(d, f'{t[0]}_{t[1]}')] for t in tiles if os.path.exists(os.path.join(d, f'{t[0]}_{t[1]}.h.i16.gz'))}
    core = (slice(B, B + TILE), slice(B, B + TILE))
    before = {t: [a[core].copy() for a in v] for t, v in arrs.items()}
    report = {}
    for t in sorted(arrs):
        for di, dj in ((1, 0), (0, 1), (1, 1), (1, -1)):
            u = (t[0] + di, t[1] + dj)
            if u not in arrs:
                continue
            for gj in range(max(t[1], u[1]) * TILE - B, min(t[1], u[1]) * TILE + TILE + B):
                for gi in range(max(t[0], u[0]) * TILE - B, min(t[0], u[0]) * TILE + TILE + B):
                    if (gi // TILE, gj // TILE) in tiles:
                        continue                       # owned: --seal's business
                    for k in range(3):
                        x = arrs[t][k][gj - (t[1] * TILE - B), gi - (t[0] * TILE - B)]
                        y = arrs[u][k][gj - (u[1] * TILE - B), gi - (u[0] * TILE - B)]
                        if not np.array_equal(x, y):
                            arrs[u][k][gj - (u[1] * TILE - B), gi - (u[0] * TILE - B)] = x
                            report[f'{u[0]}_{u[1]}'] = report.get(f'{u[0]}_{u[1]}', 0) + 1
    for t, v in arrs.items():
        name = f'{t[0]}_{t[1]}'
        for k in range(3):
            assert np.array_equal(v[k][core], before[t][k]), name
        if name in report:
            for (suf, dt, tail), a in zip(LAYERS, v):
                p = os.path.join(d, name + suf)
                with gzip.open(p + '.tmp', 'wb', compresslevel=9) as f:
                    f.write(np.ascontiguousarray(a).tobytes())
                os.replace(p + '.tmp', p)
    print('seal-unowned: border values changed per tile:', report)
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(rt.STAGE, 'l0'))
    ap.add_argument('--tiles', default='', help='comma list; default: the region (all batches up to this one)')
    ap.add_argument('--out', default=os.path.join(rt.WORK, 'seams.json'))
    ap.add_argument('--seal', action='store_true', help='copy the owners\' cores into the borders first')
    ap.add_argument('--seal-unowned', action='store_true', help='then make borders that no listed tile owns agree (v0.7.8)')
    a = ap.parse_args()
    if (a.seal or a.seal_unowned) and os.path.realpath(a.dir).startswith(os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')) + os.sep):
        sys.exit('bake_europe_seams.py: --seal writes in place: run it on a staged copy, never on the game\'s data folder')
    names = a.tiles.split(',') if a.tiles else list(rt.EXTRA)
    tiles = {tuple(int(v) for v in n.split('_')) for n in names}
    if a.seal:
        seal_dir(a.dir, tiles)
    if a.seal_unowned:
        seal_unowned(a.dir, tiles)
    cache = {}

    def get(t):
        if t not in cache:
            cache[t] = read(a.dir, f'{t[0]}_{t[1]}')
        return cache[t]
    pairs = cells = bad = 0
    worst = []
    for t in sorted(tiles):
        for di, dj in ((1, 0), (0, 1), (1, 1), (1, -1)):
            u = (t[0] + di, t[1] + dj)
            if u not in tiles:
                continue
            A, Bt = get(t), get(u)
            # global cell g in A's local = g - (t*TILE - B); in B's local = g - (u*TILE - B)
            # overlap of the two 516-wide local ranges along each axis
            def ov(ta, tb):
                lo = max(ta * TILE - B, tb * TILE - B)
                hi = min(ta * TILE + TILE + B, tb * TILE + TILE + B)
                return np.arange(lo, hi)
            gi, gj = ov(t[0], u[0]), ov(t[1], u[1])
            ai, aj = gi - (t[0] * TILE - B), gj - (t[1] * TILE - B)
            bi, bj = gi - (u[0] * TILE - B), gj - (u[1] * TILE - B)
            nb = 0
            for k in range(3):
                x = A[k][np.ix_(aj, ai)]
                y = Bt[k][np.ix_(bj, bi)]
                d = x != y
                if d.ndim == 3:
                    d = d.any(-1)
                nb += int(d.sum())
                cells += d.size
            pairs += 1
            bad += nb
            if nb:
                worst.append((f'{t[0]}_{t[1]}', f'{u[0]}_{u[1]}', nb))
    res = dict(dir=a.dir, tiles=len(tiles), files=sum(1 for t in tiles if os.path.exists(os.path.join(a.dir, f'{t[0]}_{t[1]}.h.i16.gz'))),
               pairs=pairs, cells_compared=cells, cells_differing=bad, differing_pairs=worst[:50])
    print(json.dumps(res, indent=1))
    with open(a.out, 'w') as f:
        json.dump(res, f, indent=1)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
