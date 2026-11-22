"""v0.6.0 Part 2: compose the region's final l0 tiles from the staged layers.

Inputs, per l0 tile (516 x 516 cells: 512 + a border of 2, on Korea's 250 m lattice):
  /tmp/flight-sim/v060/bake/raw-h/<ti>_<tj>.npy   raw GLO-90 heights (float32 m, NaN = no source)
  /tmp/flight-sim/v060/bake/water/<ti>_<tj>.npy   uint8 x2: R sea, G inland (128 + d/20 m)
  /tmp/flight-sim/v060/bake/cover/<ti>_<tj>.npy   uint8 x4: R forest, G farm, B built-up, A
and Korea's existing tiles in data/terrain/l0/ (from tools/cut_korea_tiles.mjs).

What it does (briefs/V0-6-0.md, Part 2 steps 2, 3, 4 and 6; "Korea unchanged, exactly"):
  - the heights as bake_geom.compose_height() makes them (the built-up filter, inland water
    at the bank level minus 2 m, land at least 0.5 m, the sea from -5 m to -40 m), on a
    mosaic of the tile and its neighbours (a HALO of cells) so the filters see across seams;
    no airfield flattening at 250 m: the new airports flatten in their own 30 m patches and
    by the runtime runway flattening (heightfield.js), so no tile has to be baked twice;
  - inside south-korea.poly (Geofabrik's boundary of Korea's OSM extract) every cell keeps
    Korea's existing height, water and cover bytes, to the bit;
  - within 5 km outside it, water and cover cross-fade from Korea's old values to the new
    ones (the DMZ and the two coast crossings show no step); heights outside are the new;
  - a tile whose every cell is open sea gets no file (the store's `sea` values).

Writes /tmp/flight-sim/v060/bake/l0/ (staging; --to-data writes data/terrain/l0/) <ti>_<tj>.{h.i16,w.rg8,c.rgba8}.gz only for tiles whose inputs are all
present (resumable: a tile already written by this script, listed in the state file, is
skipped unless --force). Korea's 35 tiles are rewritten only where their content changes
(outside the poly), and their cells inside it are checked equal before writing.

v0.6.3 (briefs/V0-6-3.md Part 1): only the 26 new tiles (bake_region_tiles.EXTRA) are composed,
into /tmp/flight-sim/v063/bake/l0pre/, their mosaics reading the old tiles' staged layers from
v0.6.0's staging through bake_region_tiles.find(). Then --seal writes /tmp/flight-sim/v063/bake/l0/:
each new tile with its 2-cell border taken from the owning tiles' cores (old: data/terrain/r0,
new: l0pre), and each old tile that gains a new neighbour with only those border cells taken from
the new tile's core (its own core asserted unchanged). Old tiles are never composed again: their
composition saw open sea where a new tile now is (the bank level and the filters would move
their cells near the seam).

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_compose.py --tiles all
  ... --tiles 0:6,0:6      (ti range, tj range, inclusive)
  ... --plan               (what's ready, what's done)
  ... --manifest           (write the manifest's tiles section for the region: extent, tile list)
"""
import argparse
import gzip
import json
import os
import sys
import time

import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
DATA = os.path.join(GAME, 'data')
L0 = os.path.join(DATA, 'terrain', 'l0')      # Korea's tiles (read); the output with --to-data
R0 = os.path.join(DATA, 'terrain', 'r0')      # the region's shipped tiles (read)
if os.environ.get('FS_REGION', '').strip().lower() == 'europe':
    R0 = os.path.join(DATA, 'europe', 'terrain', 'r0')   # v0.7.0: Europe's installed tiles (later batches' old tiles)
sys.path.insert(0, HERE)
import bake_region_tiles as rt  # noqa: E402
STAGE = rt.STAGE                              # v0.6.3's staging; v0.6.0's (rt.STAGE_OLD) is read through rt.find
PRE = os.path.join(STAGE, 'l0pre')            # v0.6.3: the new tiles as composed, before --seal
OUT = os.path.join(STAGE, 'l0')               # the output by default: staging, reviewed before data/
STATE = os.path.join(STAGE, 'compose-state.json')
POLY = os.path.join(GAME, 'reference', 'raw', 'osm', 'south-korea.poly')

TILE, B = 512, 2
S = TILE + 2 * B
CELL = 250.0
X0 = Y0 = -400000.0
import bake_common as _bc  # noqa: E402
EUROPE = _bc.EUROPE           # v0.7.0: FS_REGION=europe (its lattice origin 0, 0; no Korea)
X0, Y0 = _bc.NAT['x0'], _bc.NAT['y0']
HALO = 24                      # cells of the neighbours around a tile for the filters (6 km)
FADE_M = 5000.0                # the cross-fade outside south-korea.poly
SEA = dict(h=-160, w=(0, 255), c=(0, 0, 0, 0))
if EUROPE:
    SEA = dict(h=0, w=(0, 255), c=(0, 0, 0, 0))   # v0.7.0: Europe's sea is exactly 0 m (manifest sea.h 0)
KOREA = [(ti, tj) for ti in range(7) for tj in range(7)]   # Korea's old square's tiles
if EUROPE:
    KOREA = []

# The frame, from bake_common (it makes folders on import: harmless, they exist).
sys.path.insert(0, HERE)
from bake_common import to_map, height_to_i16  # noqa: E402


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def read_poly():
    rings, cur = [], None
    with open(POLY) as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            parts = s.split()
            if len(parts) == 2:
                try:
                    lon, lat = float(parts[0]), float(parts[1])
                except ValueError:
                    continue
                cur.append((lat, lon))
            elif s == 'END':
                if cur:
                    rings.append(cur)
                cur = None
            else:
                cur = []
    out = []
    for r in rings:
        lat = np.array([p[0] for p in r]); lon = np.array([p[1] for p in r])
        x, y = to_map(lat, lon)
        out.append(np.stack([x, y], 1))
    return out


def inside_poly(xs, ys, rings):
    """Even-odd test of cell centres (2-D arrays) against the rings."""
    ins = np.zeros(xs.shape, bool)
    for r in rings:
        x1, y1 = r[:, 0], r[:, 1]
        x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
        for k in range(len(x1)):
            a, b, c, d = x1[k], y1[k], x2[k], y2[k]
            if b == d:
                continue
            m = (ys > min(b, d)) & (ys <= max(b, d))
            if not m.any():
                continue
            xc = a + (ys - b) * (c - a) / (d - b)
            ins ^= m & (xs < xc)
    return ins


def tile_xy(ti, tj, pad=0):
    n = S + 2 * pad
    xs = X0 + (ti * TILE - B - pad + np.arange(n) + 0.5) * CELL
    ys = Y0 + (tj * TILE - B - pad + np.arange(n) + 0.5) * CELL
    return np.meshgrid(xs, ys)


def stage(kind, ti, tj):
    p = rt.find(kind, f'{ti}_{tj}.npy')
    return np.load(p, mmap_mode='r') if os.path.exists(p) else None


def mosaic(kind, ti, tj, fill, shape_tail=()):
    """The tile's cells plus HALO cells of its neighbours (their cores), from staging."""
    n = S + 2 * HALO
    out = np.full((n, n) + shape_tail, fill, dtype=np.float32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            a = stage(kind, ti + di, tj + dj)
            if a is None:
                continue
            # neighbour's cell (li, lj) is global (ti+di)*TILE - B + li; ours at offset HALO - B
            gx0 = (ti + di) * TILE - B
            gy0 = (tj + dj) * TILE - B
            ox = gx0 - (ti * TILE - B - HALO)
            oy = gy0 - (tj * TILE - B - HALO)
            sx0, sy0 = max(0, -ox), max(0, -oy)
            sx1, sy1 = min(S, n - ox), min(S, n - oy)
            if sx1 <= sx0 or sy1 <= sy0:
                continue
            out[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = a[sy0:sy1, sx0:sx1]
    return out


def compose_height(dem, sea_sd, water_sd, urban):
    """bake_geom.compose_height() without the airfields (see the header)."""
    h = dem.astype(np.float32).copy()
    land = sea_sd > 0
    h[np.isnan(h)] = 30.0
    if urban is not None and urban.max() > 0:
        k = max(3, int(round(500 / CELL)) | 1)
        hmin = ndimage.minimum_filter(h, size=k)
        hmin = ndimage.uniform_filter(hmin, size=k)
        w = np.clip(urban * 1.5, 0, 1)
        h = np.minimum(h, h * (1 - w) + hmin * w)
    water = (water_sd < 0) & land
    if water.any():
        bank = ~water & land
        if bank.any():
            idx = ndimage.distance_transform_edt(~bank, return_distances=False, return_indices=True)
            bank_h = h[idx[0], idx[1]]
            bank_h = ndimage.uniform_filter(np.where(water, bank_h, 0), size=3) / np.maximum(
                ndimage.uniform_filter(water.astype(np.float32), size=3), 1e-3)
            h = np.where(water, (bank_h if EUROPE else np.maximum(bank_h, 0.5)) - 2.0, h)
    # The staged sea distance saturates at 2,560 m (its byte), so the sea reaches -40 m there.
    # v0.7.0, Europe: no 0.5 m floor on land (or on the water's bank): land below sea level stays
    # where the land polygons say land (the polders); East Asia's floor is unchanged.
    # Europe's sea is exactly 0 m (the game reads a stored 0 as sea; land is nudged off 0 when stored).
    if EUROPE:
        return np.where(land, h, 0.0).astype(np.float32)
    return np.where(land, np.maximum(h, 0.5),
                    -5.0 - 35.0 * smoothstep(0, 2560, -sea_sd)).astype(np.float32)


def read_korea(ti, tj):
    p = os.path.join(L0, f'{ti}_{tj}')
    if not os.path.exists(p + '.h.i16.gz'):
        return None
    rd = lambda suf, dt, sh: np.frombuffer(gzip.open(p + suf).read(), dt).reshape(sh)
    return rd('.h.i16.gz', '<i2', (S, S)), rd('.w.rg8.gz', np.uint8, (S, S, 2)), rd('.c.rgba8.gz', np.uint8, (S, S, 4))


def write(ti, tj, h, w, c, out=None):
    out = out or OUT
    os.makedirs(out, exist_ok=True)
    p = os.path.join(out, f'{ti}_{tj}')
    for suf, a in (('.h.i16.gz', h.astype('<i2')), ('.w.rg8.gz', w.astype(np.uint8)), ('.c.rgba8.gz', c.astype(np.uint8))):
        raw = np.ascontiguousarray(a).tobytes()
        if os.path.exists(p + suf) and gzip.open(p + suf).read() == raw:
            continue
        with gzip.open(p + suf + '.tmp', 'wb', compresslevel=9) as f:
            f.write(raw)
        os.replace(p + suf + '.tmp', p + suf)


def all_sea(h, w, c):
    return (h == SEA['h']).all() and (w[..., 0] == SEA['w'][0]).all() and (w[..., 1] == SEA['w'][1]).all() and not c.any()


def compose_tile(ti, tj, rings):
    raw = mosaic('raw-h', ti, tj, np.nan)
    wat = mosaic('water', ti, tj, 0, (2,))
    cov = mosaic('cover', ti, tj, 0, (4,))
    sea_sd = (wat[..., 0] - 128) * 20.0
    water_sd = (wat[..., 1] - 128) * 20.0
    h = compose_height(raw, sea_sd, water_sd, cov[..., 2] / 255.0)
    core = slice(HALO, HALO + S)
    h16 = height_to_i16(h[core, core])
    if EUROPE:   # v0.7.0: no land cell stores exactly 0 (0 is sea)
        h16 = _bc.height_to_i16_land(h[core, core], sea_sd[core, core] > 0)
    w8 = wat[core, core].astype(np.uint8)
    c8 = cov[core, core].astype(np.uint8)
    kor = read_korea(ti, tj) if (ti, tj) in KOREA else None
    stats = {}
    if (ti, tj) in KOREA:
        xs, ys = tile_xy(ti, tj)
        ins = inside_poly(xs, ys, rings)
        if kor is None:   # an open-sea tile of the old square
            kor = (np.full((S, S), SEA['h'], '<i2'), np.tile(np.array(SEA['w'], np.uint8), (S, S, 1)), np.zeros((S, S, 4), np.uint8))
        kh, kw, kc = kor
        # The distance (m) outside the poly, for the cross-fade (computed with a halo so it's seamless).
        xs2, ys2 = tile_xy(ti, tj, pad=int(FADE_M / CELL) + 2)
        ins2 = inside_poly(xs2, ys2, rings)
        d = ndimage.distance_transform_edt(~ins2) * CELL
        pad = int(FADE_M / CELL) + 2
        d = d[pad:pad + S, pad:pad + S]
        t = smoothstep(0, FADE_M, d)[..., None]
        w8 = np.where(ins[..., None], kw, np.round(kw * (1 - t) + w8 * t)).astype(np.uint8)
        c8 = np.where(ins[..., None], kc, np.round(kc * (1 - t) + c8 * t)).astype(np.uint8)
        h16 = np.where(ins, kh, h16).astype('<i2')
        assert (h16[ins] == kh[ins]).all() and (w8[ins] == kw[ins]).all() and (c8[ins] == kc[ins]).all()
        stats['inside'] = int(ins.sum())
    return h16, w8, c8, stats


def state():
    try:
        return json.load(open(STATE))
    except Exception:
        return {'done': []}


def tiles_in_stage():
    """v0.6.3: the new tiles (bake_region_tiles.EXTRA); v0.6.0's 180 are composed already
    (data/terrain/r0) and are never composed again (their cores stay byte for byte)."""
    import bake_region_height as brh
    return brh.new_tiles()


def ready(ti, tj):
    return all(os.path.exists(rt.find(k, f'{ti}_{tj}.npy')) for k in ('raw-h', 'water', 'cover'))


# ------------------------------------------------------------------ v0.6.3: the seal
LAYERS = (('.h.i16.gz', '<i2', ()), ('.w.rg8.gz', np.uint8, (2,)), ('.c.rgba8.gz', np.uint8, (4,)))


def read_tile(d, ti, tj):
    """(h, w, c) of a composed tile in folder d, or None (no file: open sea, or not there)."""
    p = os.path.join(d, f'{ti}_{tj}')
    if not os.path.exists(p + '.h.i16.gz'):
        return None
    return tuple(np.frombuffer(gzip.open(p + suf).read(), dt).reshape((S, S) + tail).copy() for suf, dt, tail in LAYERS)


def sea_tile():
    return (np.full((S, S), SEA['h'], '<i2'), np.tile(np.array(SEA['w'], np.uint8), (S, S, 1)), np.zeros((S, S, 4), np.uint8))


def seal(args):
    """Every new tile's border cells and every old tile's border cells that lie in a new tile
    take the owning tile's core values: an old tile's core from data/terrain/r0 (open sea where
    it has no file), a new tile's from PRE. Old tiles are rewritten (into OUT) only if a border
    cell changes; their cores are asserted unchanged. Writes OUT and seal-report.json."""
    import bake_region_height as brh
    old = set(brh.old_tiles())
    new = brh.new_tiles()
    news = set(new)
    pre_sea = set(tuple(t) for t in state().get('sea', []))
    cores = {}

    def core_of(t):
        """The owner's full (h, w, c) (its core is what's read), or None when it isn't in the region."""
        if t in cores:
            return cores[t]
        if t in news:
            v = read_tile(PRE, *t)
            v = v if v is not None else sea_tile()
        elif t in old:
            v = read_tile(R0, *t)
            v = v if v is not None else sea_tile()
        else:
            v = None
        cores[t] = v
        return v

    def fill_border(ti, tj, arrs, only_new):
        """Copy owners' cores into the tile's border; returns per-layer changed-cell counts."""
        changed = [0, 0, 0]
        cells = {}
        g = np.arange(S) - B                                # local index -> cell within the core lattice
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                if di == 0 and dj == 0:
                    continue
                o = (ti + di, tj + dj)
                if only_new and o not in news:
                    continue
                src = core_of(o)
                if src is None:
                    continue
                cs = np.nonzero((np.floor_divide(g, TILE) == di))[0]
                rs = np.nonzero((np.floor_divide(g, TILE) == dj))[0]
                if not len(cs) or not len(rs):
                    continue
                # our local (r, c) is the owner's local (r - dj * TILE, c - di * TILE)
                for k in range(3):
                    a = arrs[k]
                    before = a[np.ix_(rs, cs)].copy()
                    a[np.ix_(rs, cs)] = src[k][np.ix_(rs - dj * TILE, cs - di * TILE)]
                    d = before != a[np.ix_(rs, cs)]
                    if d.ndim == 3:
                        d = d.any(-1)
                    changed[k] += int(d.sum())
                cells[f'{o[0]}_{o[1]}'] = len(rs) * len(cs)
        return changed, cells

    report = {'new': {}, 'old': {}}
    os.makedirs(OUT, exist_ok=True)
    for t in new:
        arrs = list(core_of(t))
        arrs = [a.copy() for a in arrs]
        ch, cells = fill_border(*t, arrs, only_new=False)
        h, w, c = arrs
        name = f'{t[0]}_{t[1]}'
        if all_sea(h, w, c):
            for suf, _, _ in LAYERS:
                if os.path.exists(os.path.join(OUT, name + suf)):
                    os.remove(os.path.join(OUT, name + suf))
            report['new'][name] = {'file': False, 'border_changed': ch, 'owners': cells}
        else:
            write(*t, h, w, c)
            report['new'][name] = {'file': True, 'border_changed': ch, 'owners': cells}
        print(f'new {name}: border cells changed by the seal h/w/c {ch}; file {report["new"][name]["file"]}')
    for t in sorted(old):
        if not any((t[0] + a, t[1] + b) in news for a in (-1, 0, 1) for b in (-1, 0, 1)):
            continue
        orig = core_of(t)
        had_file = read_tile(R0, *t) is not None
        arrs = [a.copy() for a in orig]
        ch, cells = fill_border(*t, arrs, only_new=True)
        core = (slice(B, B + TILE), slice(B, B + TILE))
        for k in range(3):
            assert np.array_equal(arrs[k][core], orig[k][core]), (t, k)
        name = f'{t[0]}_{t[1]}'
        h, w, c = arrs
        if sum(ch) == 0:
            report['old'][name] = {'changed': False, 'had_file': had_file, 'owners': cells}
        elif not had_file and all_sea(h, w, c):
            report['old'][name] = {'changed': False, 'had_file': False, 'owners': cells}
        else:
            write(*t, h, w, c)
            report['old'][name] = {'changed': True, 'had_file': had_file, 'border_changed': ch, 'owners': cells}
        print(f'old {name}: border cells changed h/w/c {ch}; file {had_file}; owners {cells}')
    with open(os.path.join(STAGE, 'seal-report.json'), 'w') as f:
        json.dump(report, f, indent=1)


def main():
    if not _bc.EUROPE:
        # v0.7.4: East Asia's compose keeps Korea's tiles exactly by reading them from data/terrain/l0/, which is gone;
        # without them it would bake Korea's square anew. Europe's batches never read it.
        _bc.refuse_retired('bake_region_compose.py (East Asia)', "data/terrain/l0/ (Korea's own tiles, kept exactly inside south-korea.poly)",
                           "Europe's batches (FS_REGION=europe) don't read it and run as before.")
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', default='all')
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--budget', type=float, default=17.0, help='minutes: no new tile after this')
    ap.add_argument('--seal', action='store_true', help='v0.6.3: the borders (see seal())')
    args = ap.parse_args()
    if args.seal:
        return seal(args)
    # (v0.6.3: --to-data is gone; staging only, installed by the lead after review)
    allt = tiles_in_stage()
    if args.tiles not in ('all', 'new'):
        (a0, a1), (b0, b1) = [tuple(int(v) for v in r.split(':')) for r in args.tiles.split(',')]
        allt = [t for t in allt if a0 <= t[0] <= a1 and b0 <= t[1] <= b1]
    st = state()
    done = {tuple(t) for t in st['done']}
    if args.plan:
        r = [t for t in allt if ready(*t)]
        print(f'{len(allt)} tiles staged, {len(r)} with all three layers, {len(done)} composed')
        return
    rings = [] if EUROPE else read_poly()
    t0 = time.time()
    for ti, tj in allt:
        if (ti, tj) in done and not args.force:
            continue
        if not ready(ti, tj):
            print(f'{ti}_{tj}: inputs not all staged yet'); continue
        if time.time() - t0 > args.budget * 60:
            print('budget reached; re-run to resume'); break
        h, w, c, stats = compose_tile(ti, tj, rings)
        if all_sea(h, w, c):
            print(f'{ti}_{tj}: open sea (no file)')
            st.setdefault('sea', []).append([ti, tj])
        else:
            write(ti, tj, h, w, c, out=PRE)
            print(f'{ti}_{tj}: written {stats}')
        st['done'].append([ti, tj]); done.add((ti, tj))
        json.dump(st, open(STATE + '.tmp', 'w')); os.replace(STATE + '.tmp', STATE)
    print(f'{time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
