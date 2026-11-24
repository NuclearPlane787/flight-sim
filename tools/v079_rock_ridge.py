"""v0.7.9 part 8, item 5 (briefs/V0-7-9.md; the `looks` subagent): the Rock of Gibraltar's ridge, sharpened [EST].

"Found while building v0.7.8": the Rock is still soft from the finals. GLO-30's 30 m posts round off a ridge only tens of
metres wide (it holds 369.7 m of the Rock's 426); v0.7.8's RIDGE_LIFT (bake_region_patches.py) scaled the land over
150 m so that the box's highest cell reaches 426 m, which keeps GLO-30's rounded shape. No finer public source is on
disk (reference/raw/ has none for the Rock), so the ridge is shaped from its published heights instead:

  * the crest line: each patch row's highest cell inside RIDGE_BOX, its column smoothed along the rows (a running
    median over 5 rows), so the crest is GLO-30's own line;
  * the crest's height: raised (never lowered) towards the published spot heights, interpolated along the crest by
    latitude: 426 m at O'Hara's Battery (36.1235 N), 387 m at Signal Hill (36.1335 N), 412 m at the north summit by the
    Rock Gun (36.1440 N) [the latitudes EST, from the maps; the heights published]; the lift eased to nothing over
    TAPER_S south of O'Hara's and TAPER_N north of the Rock Gun, so the south and north faces keep their feet;
  * the faces: a cell is raised to at most the crest's height less EAST_STEEP m a metre east for EAST_STEEP_M, then
    EAST_SLOPE (the east face, cliffs above the sand slopes), or less WEST_SLOPE west (the town's side) [EST]; a cell is
    never lowered, and the raise is eased in over LOW_FROM to LOW_FULL m of its own height, so the town, the airport, the
    isthmus and the sea (every cell under LOW_FROM m, and every sea cell) are exactly as they were.

Reads the installed patch (data/europe/terrain/patch-gibraltar.i16.gz, the manifest's entry for its grid), writes a
new file in the same encoding (Europe's height_to_i16_land, gzip 9) where it is told, never into data/:

  /tmp/flight-sim/venv/bin/python -I tools/v079_rock_ridge.py <in patch-gibraltar.i16.gz> <out .i16.gz>

It refuses an input that isn't v0.7.8's installed patch (by SHA-256), so it can't be run twice over its own output.
"""
import gzip
import hashlib
import json
import os
import sys

import numpy as np

os.environ['FS_REGION'] = 'europe'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None          # bake_common makes data/ folders on import; not here
try:
    import bake_common as bc
finally:
    os.makedirs = _makedirs

GAME = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DATA = os.path.join(GAME, 'data')
V078_SHA = 'e7b79bad9584f9ee94e2e7d2b2f5fad2bd26a5dd84b93a9640170e8e660becf1'   # v0.7.8's installed patch-gibraltar.i16.gz
RIDGE_BOX = (-5.3560, 36.1100, -5.3330, 36.1500)     # W, S, E, N: bake_region_patches.py's RIDGE_LIFT box
PUBLISHED = [(36.1235, 426.0), (36.1335, 387.0), (36.1440, 412.0)]   # (latitude N [EST], published height m)
TAPER_S = 0.0022                                     # degrees of latitude (about 245 m) south of O'Hara's
TAPER_N = 0.0012                                     # (about 130 m) north of the Rock Gun
EAST_STEEP, EAST_STEEP_M, EAST_SLOPE = 2.4, 120.0, 1.0   # m a metre east of the crest [EST]
WEST_SLOPE = 0.85                                    # m a metre west [EST]
LOW_FROM, LOW_FULL = 40.0, 120.0


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def crest_target(lat):
    """The crest's published height at a latitude (the lift's weight with it): (height, weight)."""
    (l0, h0), (l2, h2) = PUBLISHED[0], PUBLISHED[-1]
    if lat < l0:
        return h0, float(smoothstep(l0 - TAPER_S, l0, lat))
    if lat > l2:
        return h2, float(1.0 - smoothstep(l2, l2 + TAPER_N, lat))
    return float(np.interp(lat, [p[0] for p in PUBLISHED], [p[1] for p in PUBLISHED])), 1.0


def sharpen(h, land, x0, y0, cell):
    """h (ny, nx) metres, row 0 south -> (the new h, a report)."""
    ny, nx = h.shape
    w0, s0, e0, n0 = RIDGE_BOX
    bx = bc.to_map(np.array([s0, s0, n0, n0]), np.array([w0, e0, w0, e0]))
    i0 = max(0, int((bx[0].min() - x0) // cell)); i1 = min(nx - 1, int((bx[0].max() - x0) // cell))
    j0 = max(0, int((bx[1].min() - y0) // cell)); j1 = min(ny - 1, int((bx[1].max() - y0) // cell))
    xs = x0 + (np.arange(nx) + 0.5) * cell
    out = h.copy()
    rows = list(range(j0, j1 + 1))
    crest = []
    for j in rows:
        seg = np.where(land[j, i0:i1 + 1], h[j, i0:i1 + 1], -1e9)
        crest.append(i0 + int(seg.argmax()))
    crest = np.array(crest)
    sm = np.array([int(np.median(crest[max(0, k - 2):k + 3])) for k in range(len(crest))])
    rep = dict(rows=0, cells=0, crestBefore=0.0, crestAfter=0.0, maxRaise=0.0)
    for k, j in enumerate(rows):
        ic = sm[k]
        xc = xs[ic]
        lat = float(bc.to_geo(np.array([xc]), np.array([y0 + (j + 0.5) * cell]))[0][0])
        target, wt = crest_target(lat)
        rowmax = float(h[j, i0:i1 + 1][land[j, i0:i1 + 1]].max()) if land[j, i0:i1 + 1].any() else 0.0
        lift = max(0.0, target - rowmax) * wt
        if lift <= 0.0:
            continue
        H = rowmax + lift
        d = xs[i0:i1 + 1] - xc                                     # east of the crest, m
        drop = np.where(d >= 0, np.where(d <= EAST_STEEP_M, EAST_STEEP * d, EAST_STEEP * EAST_STEEP_M + EAST_SLOPE * (d - EAST_STEEP_M)),
                        WEST_SLOPE * -d)
        T = H - drop
        old = h[j, i0:i1 + 1]
        ok = land[j, i0:i1 + 1]
        raise_ = np.where(ok, np.maximum(T - old, 0.0) * smoothstep(LOW_FROM, LOW_FULL, old), 0.0)
        out[j, i0:i1 + 1] = old + raise_
        n = int((raise_ > 0.25).sum())
        if n:
            rep['rows'] += 1
            rep['cells'] += n
            rep['maxRaise'] = max(rep['maxRaise'], float(raise_.max()))
    rep['crestBefore'] = float(h[j0:j1 + 1, i0:i1 + 1].max())
    rep['crestAfter'] = float(out[j0:j1 + 1, i0:i1 + 1].max())
    rep['box'] = [i0, i1, j0, j1]
    return out, rep


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    src, dst = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    if os.path.commonpath([dst, DATA]) == DATA:
        sys.exit('v079_rock_ridge: will not write into data/: give a staging path')
    raw = open(src, 'rb').read()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != V078_SHA:
        sys.exit(f'v079_rock_ridge: {src} is not v0.7.8\'s installed patch-gibraltar.i16.gz (sha256 {sha[:16]}...): nothing written')
    man = json.load(open(os.path.join(DATA, 'europe', 'manifest.json')))
    e = next(p for p in man['patchesRegion'] if p['id'] == 'gibraltar')
    q = np.frombuffer(gzip.decompress(raw), '<i2').reshape(e['ny'], e['nx'])
    land = q != 0
    h = q.astype(np.float64) * 0.25
    out, rep = sharpen(h, land, e['x0'], e['y0'], e['cell'])
    qo = bc.height_to_i16_land(out, land)
    changed = qo != q
    assert not (changed & ~land).any(), 'a sea cell changed'
    assert (qo >= q).all(), 'a cell lowered'
    rep['changedCells'] = int(changed.sum())
    with open(dst + '.tmp', 'wb') as fo:       # gzip 9 with no name and mtime 0: the same bytes every run
        with gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=fo, mtime=0) as g:
            g.write(np.ascontiguousarray(qo, '<i2').tobytes())
    os.replace(dst + '.tmp', dst)
    rep['out'] = dict(bytes=os.path.getsize(dst), sha256=hashlib.sha256(open(dst, 'rb').read()).hexdigest())
    print(json.dumps(rep))


if __name__ == '__main__':
    main()
