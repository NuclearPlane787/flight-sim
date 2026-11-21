"""v0.6.0 Part 2 step 9: the fine land cover for Part 7, from ESA WorldCover 10 m 2021 v200, into
STAGING (/tmp/flight-sim/v060/bake/fine/, never data/).

The lattice is the game's map frame (bake_common: Lambert conformal conic), on Korea's 250 m
lattice extended both ways: l0 cell edges at x = -400000 + i * 250, y = -400000 + j * 250, l0 tiles
of 512 cells (128 km), tile (ti, tj) holding cells ti * 512 .. ti * 512 + 511. The tiles are
bake_region_height.region_tiles() (180 tiles, ti -4..14, tj -3..7).

v0.6.3: --tiles new bakes the 26 new tiles into /tmp/flight-sim/v063/bake/fine/ (state in
/tmp/flight-sim/v063/work/fine/state/); --index writes the whole index there, v0.6.0's entries first.

Fine pixels are 31.25 m, exactly 8 a 250 m cell: global fine pixel (P, Q) covers
x in [-400000 + P * 31.25, + 31.25), y likewise, and l0 tile (ti, tj) holds P = ti * 4096 ..
ti * 4096 + 4095. Each l0 tile is cut into 4 x 4 sub-tiles of 1024 x 1024 px (32 km), no borders:
sub-tile (a, b) of tile (ti, tj) holds P = ti * 4096 + a * 1024 + c, Q = tj * 4096 + b * 1024 + r
for c, r in 0..1023 (a = column from the west, b = row from the south).

One byte a pixel, the class 0..7:
  0 water      WorldCover 80 permanent water, 0 no data (and the open sea, where no tile exists)
  1 tree       10 tree cover, 95 mangroves
  2 shrub      20
  3 grass      30 grassland, 100 moss and lichen
  4 crop       40
  5 built      50
  6 bare       60 bare/sparse, 70 snow and ice
  7 wetland    90 herbaceous wetland
A pixel's class is the mode of 3 x 3 sub-points (at its (k + 0.5) / 3 fractions), each the class
of the WorldCover 10 m pixel it falls in. Ties go to the class whose (lowest) WorldCover code is
lowest: tree < shrub < grass < crop < built < bare < water < wetland. The sub-points' lat/lon
come from bake_common.to_geo at the 250 m lattice nodes, interpolated bilinearly inside each
cell (the frame is smooth: far under a centimetre off at 250 m); nodes and weights depend only on
global indices, so neighbouring sub-tiles are independent samples of one global pixel grid.
Then (--filter, used for the shipped bake: without it the box projected to about 100 MB, with it
59.3 MB) a 3 x 3 majority on the fine grid removes speckle: a pixel takes the class
held by at least 5 of its 3 x 3 neighbourhood, else keeps its own. The neighbourhood reaches
one pixel into the neighbouring sub-tiles (sampled the same way), so the filter is seamless too.

Files (staging/fine/):
  <ti>_<tj>_<a>_<b>.u8.gz   1024 * 1024 bytes, row-major, row 0 the SOUTH row, column 0 west;
                            gzip level 9, mtime 0, no file name (re-runs byte-identical)
  fine.json                 the index:
    { "version": 1, "px": 31.25, "sub": 1024, "perTile": 4, "x0": -400000, "y0": -400000,
      "classes": ["water", "tree", "shrub", "grass", "crop", "built", "bare", "wetland"],
      "files":   ["<ti>_<tj>_<a>_<b>", ...],            sub-tiles with a file
      "uniform": { "<ti>_<tj>_<a>_<b>": <class>, ... }  sub-tiles of one class, no file
    }
  Every sub-tile of the 180 l0 tiles is in exactly one of the two; anything else is absent
  (outside the fine box: use the 250 m cover).

Work state: /tmp/flight-sim/v060/fine-work/state/<ti>_<tj>.json, written once all 16 sub-tiles
of an l0 tile are written (resume at l0-tile granularity; `--index` builds fine.json from them).

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I \
      tools/bake_region_fine.py --filter --tiles all|ti0:ti1,tj0:tj1|ti,tj;ti,tj [--budget 17]
  ... --index | --quicklook | --crops | --seamlook | --check 'ti,tj;ti,tj'
"""
import argparse
import gzip
import io
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None
try:
    import bake_common as bc
    import bake_region_height as brh
    import bake_region_water as brw
    import bake_region_tiles as rt
finally:
    os.makedirs = _makedirs

X0, Y0, CELL, TILE = brh.X0, brh.Y0, brh.CELL, brh.TILE
PX = 31.25
PER_CELL = 8                    # fine pixels a 250 m cell side
SUBT = 1024                     # fine pixels a sub-tile side
PER = 4                         # sub-tiles an l0 tile side
TPX = TILE * PER_CELL           # 4096 fine pixels an l0 tile side
K = 3                           # sub-points a fine pixel side
MODE_FILTER = False            # --filter: the 3 x 3 majority (see the header)
STAGE = brw.STAGE
OUT = os.path.join(STAGE, 'fine')                 # v0.6.3: the new tiles' sub-tiles and the whole index
OUT_OLD = os.path.join(rt.STAGE_OLD, 'fine')      # v0.6.0's (read-only)
WORK = os.path.join(rt.WORK, 'fine')
STATE = os.path.join(WORK, 'state')
STATE_OLD = '/tmp/flight-sim/v060/fine-work/state'
if bc.EUROPE:
    STATE_OLD = STATE           # v0.7.0: Europe has no v0.6.0 state (never read East Asia's)
FINE_KM = 100.0                 # v0.7.0, Europe: sub-files with land within 100 km of an airport
# v0.6.4: earlier batches' sub-tiles and states (read-only), newest first, then v0.6.0's
OUT_EARLIER = [os.path.join(d, 'fine') for d in rt.STAGES_EARLIER] + [OUT_OLD]
STATE_EARLIER = [os.path.join(d, 'fine', 'state') for d in rt.WORKS_EARLIER] + [STATE_OLD]
LOG = os.path.join(WORK, 'log.tsv')
CLASSES = ['water', 'tree', 'shrub', 'grass', 'crop', 'built', 'bare', 'wetland']
NC = len(CLASSES)

LUT = np.zeros(256, np.uint8)            # WorldCover code -> class (0 for no data and unknown)
for code, k in ((80, 0), (10, 1), (95, 1), (20, 2), (30, 3), (100, 3), (40, 4), (50, 5), (60, 6), (70, 6), (90, 7)):
    LUT[code] = k
# tie priority: higher wins; by the class's lowest WorldCover code (10 tree ... 90 wetland)
PRIO = np.array([1, 7, 6, 5, 4, 3, 2, 0], np.int16)   # water(80) 1, tree 7, shrub 6, ..., bare(60) 2, wetland 0

COLOURS = np.array([[40, 90, 170], [30, 105, 45], [140, 150, 70], [150, 200, 100], [225, 205, 95],
                    [215, 40, 50], [175, 165, 150], [80, 180, 170]], np.uint8)


def name(ti, tj, a, b):
    return f'{ti}_{tj}_{a}_{b}'


def sub_path(n):
    """This batch's sub-tile if it exists, else the newest earlier batch's, else v0.6.0's, else
    where this batch writes it."""
    p = os.path.join(OUT, n + '.u8.gz')
    if os.path.exists(p):
        return p
    for d in OUT_EARLIER:
        q = os.path.join(d, n + '.u8.gz')
        if os.path.exists(q):
            return q
    return p


def state_path(ti, tj):
    p = os.path.join(STATE, f'{ti}_{tj}.json')
    if os.path.exists(p):
        return p
    for d in STATE_EARLIER:
        q = os.path.join(d, f'{ti}_{tj}.json')
        if os.path.exists(q):
            return q
    return p


# ------------------------------------------------------------------ sampling
def wc_files_bbox():
    """The lat/lon boxes of the WorldCover tiles on disk."""
    out = []
    for n in os.listdir(brw.WCDIR):
        if n.endswith('_Map.tif'):
            t = n.split('_')[5]
            la = int(t[1:3]) * (1 if t[0] == 'N' else -1)     # v0.7.0: S and W names
            lo = int(t[4:7]) * (1 if t[3] == 'E' else -1)
            out.append((la, lo))
    return out


def geo_coords(P0, Q0, nx, ny):
    """Fractional global WorldCover row/col of the K x K sub-points of fine pixels P0..P0+nx-1,
    Q0..Q0+ny-1: arrays (ny * K, nx * K), row 0 south."""
    # sub-point positions in units of 1/(K*8) cell, from the global node grid
    D = K * PER_CELL                                   # 24 sub-point steps a cell
    sx = (np.arange(P0 * K, (P0 + nx) * K) * 2 + 1)    # 2 * sub-point index + 1 (half steps)
    sy = (np.arange(Q0 * K, (Q0 + ny) * K) * 2 + 1)
    ix = np.floor_divide(sx, 2 * D)                    # global node (cell) index
    iy = np.floor_divide(sy, 2 * D)
    wx = (sx - ix * 2 * D) / (2.0 * D)
    wy = (sy - iy * 2 * D) / (2.0 * D)
    nix = np.arange(ix.min(), ix.max() + 2)
    niy = np.arange(iy.min(), iy.max() + 2)
    NX, NY = np.meshgrid(X0 + nix * CELL, Y0 + niy * CELL)
    lat, lon = bc.to_geo(NX, NY)
    GR = (90.0 - lat) * 12000.0
    GC = (lon + 180.0) * 12000.0
    jx, jy = ix - nix[0], iy - niy[0]

    def interp(G):
        a = G[jy][:, jx] * (1 - wx) + G[jy][:, jx + 1] * wx
        b = G[jy + 1][:, jx] * (1 - wx) + G[jy + 1][:, jx + 1] * wx
        return a * (1 - wy)[:, None] + b * wy[:, None]
    return interp(GR), interp(GC)


def sample_classes(wc, P0, Q0, nx, ny, strip=128):
    """(ny, nx) uint8: the mode class of each fine pixel (before the 3 x 3 filter)."""
    out = np.zeros((ny, nx), np.uint8)
    for r0 in range(0, ny, strip):
        n = min(strip, ny - r0)
        gr, gc = geo_coords(P0, Q0 + r0, nx, n)
        gr = np.floor(gr).astype(np.int64)
        gc = np.floor(gc).astype(np.int64)
        ra, rb, ca, cb = int(gr.min()), int(gr.max()) + 1, int(gc.min()), int(gc.max()) + 1
        win = wc.window(ra, rb, ca, cb)
        cat = LUT[win[gr - ra, gc - ca]].reshape(n, K, nx, K)
        del gr, gc, win
        best = np.full((n, nx), -1, np.int16)
        cls = np.zeros((n, nx), np.uint8)
        for k in range(NC):
            s = (cat == k).sum(axis=(1, 3), dtype=np.int16) * 8 + PRIO[k]
            s[s < 8] = -1                             # absent class never wins
            m = s > best
            best[m] = s[m]
            cls[m] = k
        out[r0:r0 + n] = cls
        del cat
    return out


def majority3(a):
    """a: (h + 2, w + 2) uint8 with a 1-pixel apron. -> (h, w): the class held by >= 5 of the 3 x 3,
    else the centre's own."""
    h, w = a.shape[0] - 2, a.shape[1] - 2
    out = a[1:-1, 1:-1].copy()
    for k in range(NC):
        m = (a == k).astype(np.uint8)
        c = np.zeros((h, w), np.uint8)
        for dy in range(3):
            for dx in range(3):
                c += m[dy:dy + h, dx:dx + w]
        out[c >= 5] = k
    return out


def tile_touches_wc(ti, tj, wcbox):
    lon0, lat0, lon1, lat1 = brw.geo_bounds_window(ti, tj)
    for la, lo in wcbox:
        if la <= lat1 and la + 3 >= lat0 and lo <= lon1 and lo + 3 >= lon0:
            return True
    return False


def bake_sub(wc, ti, tj, a, b):
    P0, Q0 = ti * TPX + a * SUBT, tj * TPX + b * SUBT
    if MODE_FILTER:
        g = sample_classes(wc, P0 - 1, Q0 - 1, SUBT + 2, SUBT + 2)
        c = majority3(g)
    else:
        c = sample_classes(wc, P0, Q0, SUBT, SUBT)
    return c


def write_sub(n, c):
    buf = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=buf, mtime=0) as f:
        f.write(np.ascontiguousarray(c, np.uint8).tobytes())
    p = os.path.join(OUT, n + '.u8.gz')
    with open(p + '.tmp', 'wb') as f:
        f.write(buf.getvalue())
    os.replace(p + '.tmp', p)
    return len(buf.getvalue())


def read_sub(n, index=None):
    p = sub_path(n)
    if os.path.exists(p):
        with gzip.open(p, 'rb') as f:
            return np.frombuffer(f.read(), np.uint8).reshape(SUBT, SUBT)
    if index is not None and n in index['uniform']:
        return np.full((SUBT, SUBT), index['uniform'][n], np.uint8)
    return None


def eu_selected(ti, tj):
    """v0.7.0, Europe: the sub-files (a, b) of tile (ti, tj) with land (the staged water layer's sea
    byte > 128) within FINE_KM of one of the batch's airports' reference points (map metres)."""
    w = np.load(brw.out_path(ti, tj), mmap_mode='r')[brh.BORDER:brh.BORDER + TILE, brh.BORDER:brh.BORDER + TILE, 0]
    land = np.asarray(w) > 128
    xs = X0 + (ti * TILE + np.arange(TILE) + 0.5) * CELL
    ys = Y0 + (tj * TILE + np.arange(TILE) + 0.5) * CELL
    near = np.zeros((TILE, TILE), bool)
    for la, lo in brw.AIRPORTS.values():
        ax, ay = bc.to_map(la, lo)
        near |= ((xs[None, :] - ax) ** 2 + (ys[:, None] - ay) ** 2) <= (FINE_KM * 1000.0) ** 2
    m = land & near
    q = TILE // PER
    return {(a, b) for b in range(PER) for a in range(PER) if m[b * q:(b + 1) * q, a * q:(a + 1) * q].any()}


def bake_tile(wc, ti, tj, wcbox):
    st = {'tile': f'{ti}_{tj}', 'subs': {}, 'bytes': 0}
    touches = tile_touches_wc(ti, tj, wcbox)
    hist = np.zeros(NC, np.int64)
    sel = eu_selected(ti, tj) if bc.EUROPE else None
    have = {}
    if bc.EUROPE and bc.EU_BATCH != 'A':
        # v0.7.1: an earlier batch's sub-files of this tile are kept as they are (never re-baked); only the
        # selected ones it lacks are baked (an old tile near a new airport gains sub-files)
        p = state_path(ti, tj)
        if os.path.exists(p) and not p.startswith(STATE + os.sep):
            with open(p) as f:
                have = json.load(f)['subs']
        st['subs'].update(have)
        st['kept'] = len(have)
    for b in range(PER):
        for a in range(PER):
            n = name(ti, tj, a, b)
            if sel is not None and (a, b) not in sel:
                continue                 # Europe: beyond 100 km, absent (the 250 m cover draws)
            if n in have:
                continue                 # v0.7.1: an earlier batch's, kept
            if not touches:
                st['subs'][n] = {'uniform': 0}
                hist[0] += SUBT * SUBT
                continue
            c = bake_sub(wc, ti, tj, a, b)
            h = np.bincount(c.ravel(), minlength=NC)
            hist += h
            if (h > 0).sum() == 1:
                st['subs'][n] = {'uniform': int(np.argmax(h))}
                if os.path.exists(os.path.join(OUT, n + '.u8.gz')):
                    os.remove(os.path.join(OUT, n + '.u8.gz'))
            else:
                sz = write_sub(n, c)
                st['subs'][n] = {'bytes': sz}
                st['bytes'] += sz
    st['hist'] = [int(v) for v in hist]
    p = os.path.join(STATE, f'{ti}_{tj}.json')
    with open(p + '.tmp', 'w') as f:
        json.dump(st, f)
    os.replace(p + '.tmp', p)
    return st


def select(spec):
    if ';' in spec or (spec.count(',') == 1 and ':' not in spec):
        out = []
        for part in spec.split(';'):
            i, j = part.split(',')
            out.append((int(i), int(j)))
        return out
    return brw.select(spec)


def cmd_bake(args):
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(STATE, exist_ok=True)
    todo = select(args.tiles)
    wc = brw.WorldCover(cap=args.cache)
    wcbox = wc_files_bbox()
    listed = brw.wc_listed()
    t_start = time.time()
    nd = ns = 0
    for ti, tj in todo:
        if os.path.exists(state_path(ti, tj)) and not (bc.EUROPE and bc.EU_BATCH != 'A'):
            ns += 1
            continue
        if bc.EUROPE and bc.EU_BATCH != 'A' and os.path.exists(os.path.join(STATE, f'{ti}_{tj}.json')):
            ns += 1
            continue                     # v0.7.1: this batch's own state: done
        miss = brw.wc_missing(ti, tj, listed, set(wc.files))
        if miss:
            print(f'{ti}_{tj}: waits for WorldCover ' + ', '.join(f'{a}/{b}' for a, b in miss))
            continue
        if time.time() - t_start > args.budget * 60:
            print(f'budget of {args.budget} min reached; stopping (resumable)')
            break
        t0 = time.time()
        st = bake_tile(wc, ti, tj, wcbox)
        nu = sum(1 for v in st['subs'].values() if 'uniform' in v)
        line = (f'{ti}_{tj}\t{time.time() - t0:.1f}s\t{st["bytes"] / 1e6:.2f} MB\tuniform {nu}/{len(st["subs"])}\t'
                f'hist {st["hist"]}')
        print(line, flush=True)
        with open(LOG, 'a') as f:
            f.write(time.strftime('%H:%M:%S') + '\t' + line + '\n')
        nd += 1
    print(f'baked {nd}, already done {ns}, of {len(todo)}; WorldCover tiles decoded {wc.decoded}; '
          f'{time.time() - t_start:.0f} s')


def load_index():
    with open(os.path.join(OUT, 'fine.json')) as f:
        return json.load(f)


def cmd_index(args):
    tiles = brh.region_tiles()
    files, uniform, missing, total = [], {}, [], 0
    for ti, tj in tiles:
        p = state_path(ti, tj)
        if not os.path.exists(p):
            missing.append(f'{ti}_{tj}')
            continue
        with open(p) as f:
            st = json.load(f)
        for n in sorted(st['subs'], key=lambda s: [int(v) for v in s.split('_')]):
            v = st['subs'][n]
            if 'uniform' in v:
                uniform[n] = v['uniform']
            else:
                if not os.path.exists(sub_path(n)):
                    missing.append(n)
                files.append(n)
                total += os.path.getsize(sub_path(n)) if os.path.exists(sub_path(n)) else 0
    idx = dict(version=1, px=PX, sub=SUBT, perTile=PER, x0=X0, y0=Y0, classes=CLASSES,
               files=files, uniform=uniform)
    with open(os.path.join(OUT, 'fine.json'), 'w') as f:
        json.dump(idx, f, separators=(',', ':'))
    print(f'fine.json: {len(files)} files ({total / 1e6:.2f} MB), {len(uniform)} uniform; missing {len(missing)}'
          + (f': {missing[:10]}' if missing else ''))


# ------------------------------------------------------------------ reading back
def window(P0, Q0, nx, ny, index):
    """(ny, nx) classes of global fine pixels, 255 where absent."""
    out = np.full((ny, nx), 255, np.uint8)
    sa0, sa1 = P0 // SUBT, (P0 + nx - 1) // SUBT
    sb0, sb1 = Q0 // SUBT, (Q0 + ny - 1) // SUBT
    for sb in range(sb0, sb1 + 1):
        for sa in range(sa0, sa1 + 1):
            ti, a = divmod(sa, PER)
            tj, b = divmod(sb, PER)
            c = read_sub(name(ti, tj, a, b), index)
            if c is None:
                continue
            x0, y0 = sa * SUBT, sb * SUBT
            px0, px1 = max(P0, x0), min(P0 + nx, x0 + SUBT)
            py0, py1 = max(Q0, y0), min(Q0 + ny, y0 + SUBT)
            out[py0 - Q0:py1 - Q0, px0 - P0:px1 - P0] = c[py0 - y0:py1 - y0, px0 - x0:px1 - x0]
    return out


def colourise(c):
    pal = np.vstack([COLOURS, np.zeros((256 - NC, 3), np.uint8) + 20])
    return pal[c]


def cmd_quicklook(args):
    index = load_index()
    f = args.step                          # fine pixels a picture pixel
    tiles = brh.region_tiles()
    tis, tjs = [t[0] for t in tiles], [t[1] for t in tiles]
    ti0, ti1, tj0, tj1 = min(tis), max(tis), min(tjs), max(tjs)
    n = SUBT // f
    Wd, H = (ti1 - ti0 + 1) * PER * n, (tj1 - tj0 + 1) * PER * n
    rgb = np.full((H, Wd, 3), 20, np.uint8)
    for ti, tj in tiles:
        for b in range(PER):
            for a in range(PER):
                nm = name(ti, tj, a, b)
                if nm in index['uniform']:
                    img = np.broadcast_to(COLOURS[index['uniform'][nm]].astype(np.float32), (n, n, 3))
                else:
                    c = read_sub(nm)
                    img = COLOURS[c].astype(np.float32).reshape(n, f, n, f, 3).mean(axis=(1, 3))
                r0 = ((tj - tj0) * PER + b) * n
                c0 = ((ti - ti0) * PER + a) * n
                rgb[r0:r0 + n, c0:c0 + n] = np.clip(img + 0.5, 0, 255).astype(np.uint8)
    p = os.path.join(bc.SHOTS, 'v070-bake-fine-region.png' if bc.EUROPE else 'v063-bake-fine-region.png')
    bc.write_png(p, bc.south_up_to_image(rgb))
    print(f'{p}: {Wd} x {H} px, {f * PX:.0f} m a pixel')


PLACES = {   # name: (lat, lon) of the crop's centre
    'kanto': (35.92, 140.12),          # north-east of Tokyo: Tone river plain, Ushiku, Kasumigaura's SW
    'yangtze': (31.20, 120.92),        # west of Shanghai: Kunshan, Dianshan lake's north
    'gimhae': (35.13, 128.90),
    'ganghwa': (37.68, 126.47),
    'jeju-east': (33.45, 126.83),
}


def cmd_crops(args):
    index = load_index()
    half = int(round(10000 / PX))      # 320 px: 20 x 20 km
    for nm, (la, lo) in PLACES.items():
        if args.place and nm != args.place:
            continue
        x, y = bc.to_map(la, lo)
        P = int(np.floor((float(x) - X0) / PX))
        Q = int(np.floor((float(y) - Y0) / PX))
        c = window(P - half, Q - half, 2 * half, 2 * half, index)
        p = os.path.join(bc.SHOTS, (f'v070-bake-fine-{nm}.png' if bc.EUROPE else f'v060-bake-fine-{nm}.png'))
        bc.write_png(p, bc.south_up_to_image(colourise(c)))
        h = np.bincount(c.ravel(), minlength=256)[:NC] / c.size
        print(f'{p}: P {P - half}, Q {Q - half}; ' + ', '.join(f'{CLASSES[k]} {100 * h[k]:.1f}%' for k in range(NC)))


def cmd_seamlook(args):
    """A crop centred on a sub-tile corner and on an l0-tile corner, each 2x enlarged, with tick
    marks at the edges' ends (outside the picture's data)."""
    index = load_index()
    for tag, (ti, tj, a, b) in (('subcorner', (8, 2, 2, 2)), ('tilecorner', (8, 2, 0, 0)),
                                ('tilecorner-korea', (2, 3, 0, 0))):
        P, Q = ti * TPX + a * SUBT, tj * TPX + b * SUBT
        c = window(P - 128, Q - 128, 256, 256, index)
        img = colourise(c).repeat(3, 0).repeat(3, 1)
        img = np.pad(img, ((6, 6), (6, 6), (0, 0)), constant_values=255)
        m = 6 + 128 * 3
        img[:6, m - 1:m + 1] = img[-6:, m - 1:m + 1] = 0
        img[m - 1:m + 1, :6] = img[m - 1:m + 1, -6:] = 0
        p = os.path.join(WORK, f'seam-{tag}.png')
        bc.write_png(p, bc.south_up_to_image(img))
        print(p)


def cmd_check(args):
    """The fine classes' fractions per 250 m cell against the staged 250 m cover (R forest, G
    farm, B built-up), for a few tiles."""
    index = load_index()
    for t in args.check_tiles.split(';'):
        ti, tj = (int(v) for v in t.split(','))
        cp = os.path.join(STAGE, 'cover', f'{ti}_{tj}.npy')
        if not os.path.exists(cp):
            print(f'{ti}_{tj}: no staged cover')
            continue
        cov = np.load(cp)[2:514, 2:514].astype(np.float32) / 255
        fine = window(ti * TPX, tj * TPX, TPX, TPX, index)
        fr = np.zeros((NC, TILE, TILE), np.float32)
        for k in range(NC):
            fr[k] = (fine == k).reshape(TILE, 8, TILE, 8).mean(axis=(1, 3))
        land = cov.sum(-1) > 0
        out = [f'{ti}_{tj}: land cells {int(land.sum())}']
        for nm, ks, ch in (('forest', [1], 0), ('crop', [4], 1), ('farm*', [4, 3, 2], 1), ('built', [5], 2)):
            f = fr[ks].sum(0)
            r_all = np.corrcoef(f.ravel(), cov[..., ch].ravel())[0, 1]
            r_land = np.corrcoef(f[land], cov[..., ch][land])[0, 1]
            out.append(f'{nm}: r {r_all:.3f} (land {r_land:.3f}), mean fine {f[land].mean():.3f} cover {cov[..., ch][land].mean():.3f}')
        print('\n  '.join(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles')
    ap.add_argument('--budget', type=float, default=17.0)
    ap.add_argument('--cache', type=int, default=600)
    ap.add_argument("--filter", action="store_true")
    ap.add_argument('--index', action='store_true')
    ap.add_argument('--quicklook', action='store_true')
    ap.add_argument('--step', type=int, default=64)
    ap.add_argument('--crops', action='store_true')
    ap.add_argument('--place')
    ap.add_argument('--seamlook', action='store_true')
    ap.add_argument('--check', dest='check_tiles')
    a = ap.parse_args()
    global MODE_FILTER
    if a.filter:
        MODE_FILTER = True
    if a.index:
        cmd_index(a)
    elif a.quicklook:
        cmd_quicklook(a)
    elif a.crops:
        cmd_crops(a)
    elif a.seamlook:
        cmd_seamlook(a)
    elif a.check_tiles:
        cmd_check(a)
    elif a.tiles:
        cmd_bake(a)
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
