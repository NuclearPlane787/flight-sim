"""v0.7.7 part 3 (briefs/V0-7-7.md, "The ground's data"): lakes at their own level, in Europe's 250 m tiles.

What was wrong: compose_height() draws inland water "at the bank level minus 2 m", cell by cell from the
nearest bank cell. A polder lake's banks are land at -4 to -6 m, so the IJsselmeer and the Markermeer lay at
-2 to -8 m; a mountain lake's banks are hillsides, so its surface climbed them (Loch Ness from 19 m to 484 m,
Lake Lucerne 412 to 620 m, Garda 63 to 112 m, measured on v0.7.6's tiles).

The level's source: Copernicus GLO-90 is hydro-flattened, so the staged raw heights (raw-h/<ti>_<tj>.npy, as
bake_region_height.py left them) already hold every mapped lake as a flat surface at its own level (the
IJsselmeer 0.00 m, Geneva 368.0 m, Loch Ness 16.0 m). No OSM `ele` tag is needed, and none is read.

The rule, on each tile's cells with a halo of its neighbours' cores (HALO cells), touching water cells only
(water as compose_height() has it: inland distance < 0 on land):
  1. a water cell is FLAT when at least two of its four neighbours are water and none of them differs from it
     by more than FLAT_M in the raw heights; flat cells joined (8-neighbours) into groups of at least
     MIN_PLATEAU are a lake's surface (a plateau), and each takes its own raw height as its level;
  2. any other water cell takes the level of the nearest plateau cell if that cell is of its own water body
     (joined through water, 8-neighbours; where the nearest plateau is another body's the cell is left as
     installed: 49 cells in Europe), fully within NEAR cells of it and eased back to its installed height by
     FAR cells (so a river leaving a lake, or a long narrow arm with no flat cell, keeps the old rule further
     off, with no step). **Never lifted far:** a cell whose own raw height is more than LIFT_MAX below that
     level is left as installed. That is the water at a dam's foot, which the 250 m mask joins to the
     reservoir above it (the code review's finding, 2026-11-22: without the limit 140 cells stood 5 to 31 m
     over their own ground below the Zujar, Mohne and Gabcikovo dams and beside the Staines reservoirs);
     5 m still lets a polder lake's mixed shore cells (the IJsselmeer beside Flevoland) take the lake's level;
  3. water with no plateau near it (rivers, small ponds) is left exactly as installed;
  4. the floor: a water cell never stores 0 (0 is the sea): a level that rounds to 0 is stored as -1 step
     (-0.25 m), which is where the IJsselmeer and the Markermeer come out (their mapped level is -0.2 m NAP).
No land cell, no sea cell, no water byte and no cover byte changes. The 1 km level never had inland water
(bake_region_l1.py) and is not touched. The 30 m patches keep their own water.

Reads data/europe/terrain/r0/ (the installed tiles) and the batches' staged raw-h. Writes only into staging:
  <out>/europe/terrain/r0/<ti>_<tj>.h.i16.gz    every tile whose heights change, sealed (borders from the owners' cores)
  <out>/europe/manifest.json                      {} (tools/install-region.py merges nothing from it)
  <out>/europe.sha256                             the list tools/install-region.py takes
  <out>/lakes-report.json                         per tile: cells changed, the largest moves; the named lakes before and after

  FS_REGION=europe FS_EUROPE_BATCH=E python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I \
      tools/bake_region_lakes.py --out /tmp/flight-sim/v077/bake/lakes [--tiles 0_5,0_4] [--check <installed dir>]
  --check <dir>: no bake; proves a folder of installed tiles against the pushed ones in <dir>: every file
  the rule didn't touch equal by SHA-256, and in every touched tile's core only water cells differ.
"""
import argparse
import gzip
import hashlib
import json
import os
import sys

import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
if os.environ.get('FS_REGION', '').strip().lower() != 'europe':
    sys.exit('bake_region_lakes.py: Europe only (FS_REGION=europe); East Asia\'s tiles are not to change')
sys.path.insert(0, HERE)
import bake_common as bc  # noqa: E402
import bake_region_tiles as rt  # noqa: E402

R0 = os.path.join(GAME, 'data', 'europe', 'terrain', 'r0')
TILE, B = 512, 2
S = TILE + 2 * B
HALO = 24
FLAT_M = 0.06        # m: two raw water cells of one flattened surface differ by less (float noise of the 250 m mean)
MIN_PLATEAU = 6      # cells (0.375 km2): smaller flat groups are chance
NEAR, FAR = 4.0, 12.0   # cells: the level holds within NEAR of a plateau cell and eases out by FAR
LIFT_MAX = 5.0          # m: a cell that isn't a plateau's is never given a level more than this above its own raw height
EIGHT = np.ones((3, 3), bool)

# For the report only: (lat, lon) inside each, and the level it should come out near (m).
NAMED = {
    'IJsselmeer': (52.80, 5.40, -0.2), 'Markermeer': (52.53, 5.22, -0.2), 'Lake Geneva': (46.45, 6.55, 372.0),
    'Lake Constance': (47.62, 9.40, 395.0), 'Lake Garda': (45.62, 10.66, 65.0), 'Lough Neagh': (54.62, -6.42, 12.5),
    'Loch Ness': (57.27, -4.50, 15.8), 'Lago Maggiore': (45.95, 8.63, 193.0), 'Lake Lucerne': (47.02, 8.42, 433.6),
    'Lake Zurich': (47.25, 8.65, 406.0), 'Lake Bolsena': (42.60, 11.93, 305.0),
}


def read_h(d, name):
    p = os.path.join(d, name + '.h.i16.gz')
    return np.frombuffer(gzip.open(p).read(), '<i2').reshape(S, S) if os.path.exists(p) else None


def read_w(name):
    p = os.path.join(R0, name + '.w.rg8.gz')
    return np.frombuffer(gzip.open(p).read(), np.uint8).reshape(S, S, 2) if os.path.exists(p) else None


def read_raw(name):
    p = rt.find('raw-h', name + '.npy')
    return np.load(p, mmap_mode='r') if os.path.exists(p) else None


def mosaic(reader, ti, tj, fill, dtype, tail=()):
    """Tile (ti, tj)'s core with HALO cells of its neighbours' cores round it."""
    n = TILE + 2 * HALO
    out = np.full((n, n) + tail, fill, dtype)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            a = reader(f'{ti + di}_{tj + dj}')
            if a is None:
                continue
            core = np.asarray(a[B:B + TILE, B:B + TILE])
            ox, oy = HALO + di * TILE, HALO + dj * TILE          # where the neighbour's core starts in the mosaic
            x0, y0, x1, y1 = max(0, ox), max(0, oy), min(n, ox + TILE), min(n, oy + TILE)
            if x1 > x0 and y1 > y0:
                out[y0:y1, x0:x1] = core[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    return out


def lake_core(ti, tj):
    """The tile's new core heights (int16, 0.25 m) and its water mask; None if nothing changes."""
    w = mosaic(read_w, ti, tj, 0, np.uint8, (2,))
    w[..., 1][w[..., 0] == 0] = 255        # outside every tile: open sea (R 0, G 255), never water
    water = (w[..., 1] < 128) & (w[..., 0] > 128)
    core = slice(HALO, HALO + TILE)
    if not water[core, core].any():
        return None, None
    raw = mosaic(read_raw, ti, tj, np.nan, np.float32)
    old = mosaic(lambda n: read_h(R0, n), ti, tj, 0, '<i2')
    ok = water & ~np.isnan(raw)
    # 1. flat cells: >= 2 water neighbours of the four, none further than FLAT_M
    nb = np.zeros(raw.shape, np.int8)
    far = np.zeros(raw.shape, bool)
    r0 = np.where(ok, raw, 0.0)
    for sh, ax in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
        o2 = np.roll(ok, sh, ax)
        r2 = np.roll(r0, sh, ax)
        edge = [slice(None), slice(None)]
        edge[ax] = 0 if sh == 1 else -1
        o2[tuple(edge)] = False                 # np.roll wraps: the wrapped row or column is no neighbour
        nb += (ok & o2)
        far |= ok & o2 & (np.abs(r2 - r0) > FLAT_M)
    flat = ok & (nb >= 2) & ~far
    lab, n = ndimage.label(flat, structure=EIGHT)
    if n == 0:
        return None, None
    size = ndimage.sum_labels(flat, lab, index=np.arange(1, n + 1))
    plateau = flat & (np.concatenate([[0], size])[lab] >= MIN_PLATEAU)
    if not plateau.any():
        return None, None
    # 2. the nearest plateau cell of the same water body
    body, _ = ndimage.label(water, structure=EIGHT)
    dist, idx = ndimage.distance_transform_edt(~plateau, return_indices=True)
    level = raw[idx[0], idx[1]]
    same = body[idx[0], idx[1]] == body
    t = np.clip((dist - NEAR) / (FAR - NEAR), 0.0, 1.0)
    t = t * t * (3 - 2 * t)
    oldm = old.astype(np.float32) * 0.25
    new = level + (oldm - level) * t
    lifted = ~plateau & ((level - raw) > LIFT_MAX)       # a dam's foot (NaN raw compares False: no limit there)
    take = water & same & (dist < FAR) & ~lifted
    q = np.clip(np.round(new / 0.25), -32768, 32767).astype('<i2')
    q[q == 0] = -1                              # 4. the floor: never 0 (the sea)
    out = np.where(take, q, old).astype('<i2')
    assert (out[~water] == old[~water]).all()
    oc, nc = old[core, core], out[core, core]
    if (oc == nc).all():
        return None, None
    return nc.copy(), water[core, core].copy()


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def tile_list():
    m = json.load(open(os.path.join(GAME, 'data', 'europe', 'manifest.json')))
    return [l for l in m['tilesRegion']['levels'] if l['id'] == 'l0'][0]['tiles']


def named_levels(get):
    """Each named lake's water cells within 30 cells of its point: min, median, max (m) of get(name) -> (516, 516) int16."""
    out = {}
    for lake, (la, lo, want) in NAMED.items():
        x, y = bc.to_map(la, lo)
        ti, tj = bc.tile_of(float(x), float(y))
        h, w = get(f'{ti}_{tj}'), read_w(f'{ti}_{tj}')
        if h is None or w is None:
            continue
        ci, cj = int((x - ti * TILE * 250.0) // 250) + B, int((y - tj * TILE * 250.0) // 250) + B
        sl = (slice(max(B, cj - 30), min(S - B, cj + 30)), slice(max(B, ci - 30), min(S - B, ci + 30)))
        wat = (w[sl][..., 1] < 128) & (w[sl][..., 0] > 128)
        v = h[sl][wat] * 0.25
        if v.size:
            out[lake] = dict(tile=f'{ti}_{tj}', cells=int(v.size), min=float(v.min()), median=float(np.median(v)), max=float(v.max()), mapped=want)
    return out


def cmd_bake(args):
    tiles = tile_list()
    want = [t for t in args.tiles.split(',') if t] or tiles
    out_r0 = os.path.join(args.out, 'europe', 'terrain', 'r0')
    os.makedirs(out_r0, exist_ok=True)
    if os.listdir(out_r0):
        # The seal reads a neighbour's core from the installed folder unless this run changed it, so a second
        # run into the same staging (a bake in pieces with --tiles) would seal against stale cores.
        sys.exit(f'bake_region_lakes.py: {out_r0} is not empty; bake into an empty staging folder, in one run')
    cores, report = {}, {}
    for k, name in enumerate(want):
        ti, tj = (int(v) for v in name.split('_'))
        if read_raw(name) is None:
            report[name] = dict(skipped='no staged raw heights')
            continue
        nc, water = lake_core(ti, tj)
        if nc is None:
            continue
        old = read_h(R0, name)[B:B + TILE, B:B + TILE]
        ch = nc != old
        assert not (ch & ~water).any(), name
        d = (nc.astype(np.float32) - old) * 0.25
        cores[name] = nc
        report[name] = dict(cells=int(ch.sum()), raised=int((d > 0).sum()), lowered=int((d < 0).sum()),
                            most_raised_m=float(d.max()), most_lowered_m=float(d.min()))
        if k % 20 == 0:
            print(f'  {k + 1}/{len(want)} {name}: {int(ch.sum())} water cells', flush=True)
    # the seal: every tile whose core, or whose neighbour's core, changed gets its 516 x 516 rewritten
    touched = set(cores)
    for name in list(cores):
        ti, tj = (int(v) for v in name.split('_'))
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                n2 = f'{ti + di}_{tj + dj}'
                if n2 in tiles:
                    touched.add(n2)

    def new_core(n):
        if n in cores:
            return cores[n]
        a = read_h(R0, n)
        return None if a is None else a[B:B + TILE, B:B + TILE]
    written = []
    for name in sorted(touched):
        ti, tj = (int(v) for v in name.split('_'))
        full = read_h(R0, name).copy()
        before = full.copy()
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                c = new_core(f'{ti + di}_{tj + dj}')
                if c is None:
                    continue                       # no file there (open sea, or outside the tiles): the border stays as installed
                ox, oy = B + di * TILE, B + dj * TILE
                x0, y0, x1, y1 = max(0, ox), max(0, oy), min(S, ox + TILE), min(S, oy + TILE)
                if x1 > x0 and y1 > y0:
                    full[y0:y1, x0:x1] = c[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
        if (full == before).all():
            continue
        if name not in cores:
            assert (full[B:B + TILE, B:B + TILE] == before[B:B + TILE, B:B + TILE]).all(), name
            report.setdefault(name, {})['border_only'] = int((full != before).sum())
        bc.write_gz(os.path.join(out_r0, name + '.h.i16.gz'), full)
        written.append(name)
    json.dump({}, open(os.path.join(args.out, 'europe', 'manifest.json'), 'w'))
    with open(os.path.join(args.out, 'europe.sha256'), 'w') as fh:
        for name in written:
            rel = f'terrain/r0/{name}.h.i16.gz'
            fh.write(f'{sha(os.path.join(args.out, "europe", rel))}  {rel}\n')
    before = named_levels(lambda n: read_h(R0, n))
    after = named_levels(lambda n: read_h(out_r0, n) if os.path.exists(os.path.join(out_r0, n + '.h.i16.gz')) else read_h(R0, n))
    tot = sum(r.get('cells', 0) for r in report.values())
    json.dump(dict(tiles=report, written=written, cells=tot, named=dict(before=before, after=after),
                   rule=dict(FLAT_M=FLAT_M, MIN_PLATEAU=MIN_PLATEAU, NEAR=NEAR, FAR=FAR, LIFT_MAX=LIFT_MAX, HALO=HALO)),
              open(os.path.join(args.out, 'lakes-report.json'), 'w'), indent=1)
    print(f'lakes: {len(cores)} tiles\' cores change ({tot} water cells, {tot * 0.0625:.0f} km2), {len(written)} files written '
          f'({len(written) - len(cores)} for their borders alone), of {len(tiles)} tiles; '
          f'{sum(1 for r in report.values() if "skipped" in r)} skipped for no raw heights')
    for lake in NAMED:
        if lake in before:
            b, a = before[lake], after[lake]
            print(f'  {lake:15s} {b["tile"]:>7s}  installed {b["min"]:8.2f} .. {b["max"]:8.2f} (median {b["median"]:8.2f})  ->  '
                  f'{a["min"]:8.2f} .. {a["max"]:8.2f} (median {a["median"]:8.2f}); mapped about {b["mapped"]}')
    print('lakes: done')


def cmd_check(args):
    """The installed folder against the pushed one: untouched files by SHA-256, touched cores differing in water cells only."""
    names = sorted(f for f in os.listdir(args.check) if f.endswith('.gz'))
    same = diff = 0
    bad = []
    for f in names:
        a, b = os.path.join(args.check, f), os.path.join(R0, f)
        if not os.path.exists(b):
            bad.append(f + ': gone')
            continue
        if sha(a) == sha(b):
            same += 1
            continue
        diff += 1
        if not f.endswith('.h.i16.gz'):
            bad.append(f + ': a water or cover file changed')
            continue
        name = f[:-len('.h.i16.gz')]
        old, new, w = read_h(args.check, name), read_h(R0, name), read_w(name)
        water = (w[..., 1] < 128) & (w[..., 0] > 128)
        c = (slice(B, B + TILE), slice(B, B + TILE))
        ch = old[c] != new[c]
        if (ch & ~water[c]).any():
            bad.append(f'{f}: {int((ch & ~water[c]).sum())} core cells that are not water changed')
        if (new[c][water[c]] == 0).any():
            bad.append(f'{f}: a water cell stores 0')
    extra = sorted(set(os.listdir(R0)) - set(names))
    print(f'lakes check: {len(names)} pushed files; {same} equal by SHA-256, {diff} differ (heights of touched tiles); '
          f'new files {len(extra)}; faults {len(bad)} {bad[:6]}')
    sys.exit(1 if bad or extra else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='/tmp/flight-sim/v077/bake/lakes')
    ap.add_argument('--tiles', default='')
    ap.add_argument('--check', default='')
    args = ap.parse_args()
    (cmd_check if args.check else cmd_bake)(args)


if __name__ == '__main__':
    main()
