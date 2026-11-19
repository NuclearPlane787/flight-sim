"""v0.6.0 Part 2 step 7: the region's 30 m height patches and 10 m coast patches, into staging.

Same formats and treatment as Korea's (bake_patches.py):
  * height patches: GLO-30 at the cell centres on a cell-aligned map-metre grid (row 0 = south),
    the sea from OSM's land polygons (bbox-read, as bake_region_water.py), inland water from
    WorldCover's permanent water class (80) minus the sea (small specks dropped), the built-up
    fraction from WorldCover's built-up class (50) for compose_height()'s local-minimum filter,
    and the airfields flattened from data/airports/<ICAO>.json (boundary polygon, elevM).
    .i16 in 0.25 m units, gzipped.
  * coast patches: 10 m, 16 km x 16 km centred on the airport's reference point, signed
    distance to the sea coastline (+ land), .u8 128 + d/2.

Outputs: /tmp/flight-sim/v060/bake/patches/patch-<id>.i16.gz, coast-<ICAO>.u8.gz, a <name>.json
meta each, and manifest-patches.json ({patches, coastPatches}, paths as terrain/...).
Never writes into data/.

Usage (one item per guarded command; resumable, skips finished items unless --force):
  bake_region_patches.py patch <id>      ids: pudong-hongqiao haneda-narita gimhae kansai fukuoka qingdao fuji
  bake_region_patches.py coast <ICAO>    ZSPD RJTT RJBB RJFF RKPK RJAA ZSSS ZSQD
  bake_region_patches.py quicklook <id>
  bake_region_patches.py manifest
"""
import argparse
import glob
import json
import os
import sys
import time

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None          # bake_common makes data/ folders on import; not here
try:
    import bake_common as bc
    import bake_geom as bg
    import bake_height as bh
    import bake_patches as bp
    import bake_region_water as brw
finally:
    os.makedirs = _makedirs

import shapely
from shapely.geometry import Polygon

OUT = '/tmp/flight-sim/v060/bake/patches'
AIRPORT_DIR = os.path.join(bc.DATA, 'airports')
NEW_AIRPORTS = ['RJTT', 'RJAA', 'ZSPD', 'ZSSS', 'RKPK', 'RJBB', 'RJFF', 'ZSQD']

# id: (lon0, lat0, lon1, lat1)
PATCHES = {
    'pudong-hongqiao': (121.22, 31.05, 121.96, 31.28),
    'haneda-narita': (139.70, 35.45, 140.48, 35.85),
    'gimhae': (128.78, 35.07, 129.12, 35.34),       # Sinosan to the W/NW, Geumjeongsan to the NE
    'kansai': (135.08, 34.28, 135.46, 34.58),       # the island and Osaka Bay's south-east shore
    'fukuoka': (130.30, 33.48, 130.60, 33.70),
    'qingdao': (119.95, 36.25, 120.23, 36.47),
    'fuji': (138.507, 35.18, 138.948, 35.54),       # ~40 x 40 km round the summit (35.3606, 138.7274)
}
COAST = ['ZSPD', 'RJTT', 'RJBB', 'RJFF', 'RKPK', 'RJAA', 'ZSSS', 'ZSQD']


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def airfields():
    """{icao: (polygon in map metres, elevation m)} from the airport JSONs (boundary is map metres)."""
    out = {}
    for icao in NEW_AIRPORTS:
        d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
        g = Polygon(d['boundary'])
        if not g.is_valid:
            g = shapely.make_valid(g)
        out[icao] = (g, float(d['elevM']))
    return out


def dem_tiles(lon0, lat0, lon1, lat1):
    keys = {(la, lo) for la in range(int(np.floor(lat0)), int(np.floor(lat1)) + 1)
            for lo in range(int(np.floor(lon0)), int(np.floor(lon1)) + 1)}
    paths = []
    for la, lo in sorted(keys):
        p = os.path.join(bc.RAW, 'dem30', f'Copernicus_DSM_COG_10_N{la:02d}_00_E{lo:03d}_00_DEM.tif')
        if os.path.exists(p):
            paths.append(p)
        else:
            log('no GLO-30 tile', la, lo, '(sea, or missing)')
    return bh.load_tiles(paths)


def wc_fractions(x0, y0, cell, nx, ny, lonlat_box, classes, sub=3, rows=200):
    """Fraction of each WorldCover class over sub x sub points a cell (nearest 10 m pixel)."""
    D = brw.D
    lon0, lat0, lon1, lat1 = lonlat_box
    pad = 0.02
    r0 = int(np.floor((90 - (lat1 + pad)) / D)); r1 = int(np.ceil((90 - (lat0 - pad)) / D))
    c0 = int(np.floor((lon0 - pad + 180) / D)); c1 = int(np.ceil((lon1 + pad + 180) / D))
    wc = brw.WorldCover().window(r0, r1, c0, c1)
    log('worldcover window', wc.shape, 'decoded')
    out = {k: np.zeros((ny, nx), np.float32) for k in classes}
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    for j0 in range(0, ny, rows):
        j1 = min(ny, j0 + rows)
        X, Y = bc.cell_centres(x0, y0 + j0 * cell, cell, nx, j1 - j0)
        for oy in offs:
            for ox in offs:
                lat, lon = bc.to_geo(X + ox * cell, Y + oy * cell)
                rr = np.clip(np.floor((90 - lat) / D).astype(np.int64) - r0, 0, wc.shape[0] - 1)
                cc = np.clip(np.floor((lon + 180) / D).astype(np.int64) - c0, 0, wc.shape[1] - 1)
                v = wc[rr, cc]
                for k in classes:
                    out[k][j0:j1] += (v == k)
    n = sub * sub
    for k in classes:
        out[k] /= n
    del wc
    return out


def patch_name(pid):
    return os.path.join(OUT, f'patch-{pid}.i16.gz')


def cmd_patch(pid, force):
    path = patch_name(pid)
    meta = path.replace('.i16.gz', '.json')
    if os.path.exists(path) and os.path.exists(meta) and not force:
        log(pid, 'done already; skip')
        return
    t0 = time.time()
    lon0, lat0, lon1, lat1 = PATCHES[pid]
    cell = 30.0
    x0, y0, nx, ny = bp.grid_for_box(lon0, lat0, lon1, lat1, cell)
    log(pid, 'grid', nx, 'x', ny, 'x0', x0, 'y0', y0)
    tiles = dem_tiles(lon0, lat0, lon1, lat1)
    dem = bh.resample(tiles, x0, y0, cell, nx, ny, sub=1)
    del tiles
    nan = int(np.isnan(dem).sum())
    log(pid, 'dem', 'nan cells', nan, 'range', float(np.nanmin(dem)), float(np.nanmax(dem)))

    lp = brw.LandPolys()
    land_geoms = lp.query(lon0 - 0.05, lat0 - 0.05, lon1 + 0.05, lat1 + 0.05)
    land_m = bg.rasterize(land_geoms, x0, y0, cell, nx, ny)
    del land_geoms
    sea_sd = bg.signed_distance(land_m, cell)
    land = land_m.astype(bool)
    del land_m
    log(pid, 'land fraction %.3f' % land.mean())

    fr = wc_fractions(x0, y0, cell, nx, ny, (lon0, lat0, lon1, lat1), (50, 80))
    # built-up: smoothed over ~210 m, as Korea's came from the 250 m cover grid (bilinear)
    urban = ndimage.uniform_filter(fr[50], size=7).astype(np.float32)
    # inland water: WorldCover water on land, specks (< ~2 ha) and one-cell slivers dropped
    wat = (fr[80] >= 0.5) & land
    del fr
    wat = ndimage.binary_opening(wat, structure=np.ones((3, 3), bool))
    lab, n = ndimage.label(wat)
    if n:
        sizes = ndimage.sum(np.ones_like(lab, np.int32), lab, index=np.arange(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = sizes >= 25
        wat = keep[lab]
    del lab
    water_sd = -bg.signed_distance(wat, cell)
    log(pid, 'urban mean %.3f, inland water cells %d' % (float(urban.mean()), int(wat.sum())))
    del wat, land

    aero = airfields()
    h = bg.compose_height(dem, sea_sd, water_sd, urban, cell, x0, y0, airports=aero)
    del dem, water_sd, urban
    flat = []
    for icao, (poly, elev) in aero.items():
        bx = poly.bounds
        if bx[0] < x0 + nx * cell and bx[2] > x0 and bx[1] < y0 + ny * cell and bx[3] > y0:
            flat.append(icao)
    os.makedirs(OUT, exist_ok=True)
    bc.write_gz(path, bc.height_to_i16(h))
    np.save(os.path.join(OUT, f'patch-{pid}.sea.npy'), (sea_sd > 0))  # for the quick-look
    entry = dict(id=pid, x0=float(x0), y0=float(y0), cell=cell, nx=nx, ny=ny, height=f'terrain/patch-{pid}.i16.gz')
    info = dict(entry=entry, box=PATCHES[pid], flattened=flat, max=float(h.max()), min=float(h.min()),
                bytes=os.path.getsize(path), seconds=round(time.time() - t0, 1))
    with open(meta + '.tmp', 'w') as f:
        json.dump(info, f, indent=1)
    os.replace(meta + '.tmp', meta)
    log(pid, json.dumps(info))


def cmd_coast(icao, force):
    path = os.path.join(OUT, f'coast-{icao}.u8.gz')
    meta = path.replace('.u8.gz', '.json')
    if os.path.exists(meta) and not force:
        log(icao, 'done already; skip')
        return
    t0 = time.time()
    d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
    cell = 10.0
    size = bp.COAST_SIZE
    cx, cy = bc.to_map(d['lat'], d['lon'])
    n = int(size / cell)
    x0 = float(np.round((cx - size / 2) / cell) * cell)
    y0 = float(np.round((cy - size / 2) / cell) * cell)
    # lon/lat bounds of the square
    xs = np.array([x0, x0 + size, x0, x0 + size]); ys = np.array([y0, y0, y0 + size, y0 + size])
    lat, lon = bc.to_geo(xs, ys)
    lp = brw.LandPolys()
    geoms = lp.query(lon.min() - 0.02, lat.min() - 0.02, lon.max() + 0.02, lat.max() + 0.02)
    m = bg.rasterize(geoms, x0, y0, cell, n, n)
    sea = float((m == 0).mean())
    os.makedirs(OUT, exist_ok=True)
    info = dict(icao=icao, seaFraction=round(sea, 4), seconds=None)
    if sea > 0:
        sd = bg.signed_distance(m, cell)
        bc.write_gz(path, bc.signed_to_u8(sd, 2))
        info['entry'] = dict(id=icao, x0=x0, y0=y0, cell=cell, nx=n, ny=n, coast=f'terrain/coast-{icao}.u8.gz')
        info['bytes'] = os.path.getsize(path)
        info['nearestSeaM'] = float(sd[n // 2, n // 2]) if sd[n // 2, n // 2] > 0 else 0.0
    else:
        info['entry'] = None
        info['note'] = 'square is all land: no coast patch'
    info['seconds'] = round(time.time() - t0, 1)
    with open(meta + '.tmp', 'w') as f:
        json.dump(info, f, indent=1)
    os.replace(meta + '.tmp', meta)
    log(icao, json.dumps(info))


def hillshade(h, cell, az=315, alt=45):
    gy, gx = np.gradient(h, cell)
    gy = -gy  # row 0 = south: flip so north is up after south_up_to_image
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, z = np.radians(az), np.radians(90 - alt)
    return np.clip(np.cos(z) * np.cos(slope) + np.sin(z) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def cmd_quicklook(pid):
    meta = json.load(open(patch_name(pid).replace('.i16.gz', '.json')))
    e = meta['entry']
    h = bc.read_gz(patch_name(pid), '<i2', (e['ny'], e['nx'])).astype(np.float32) * 0.25
    f = max(1, int(np.ceil(max(e['nx'], e['ny']) / 1600)))
    if f > 1:
        ny, nx = (e['ny'] // f) * f, (e['nx'] // f) * f
        h = h[:ny, :nx].reshape(ny // f, f, nx // f, f).mean(axis=(1, 3))
    cell = e['cell'] * f
    hs = hillshade(h, cell)
    land = h > 0
    t = np.clip(h / max(200.0, float(h.max())), 0, 1)
    base = np.stack([0.35 + 0.45 * t, 0.55 + 0.15 * t, 0.30 + 0.45 * t], -1)
    shade = (0.35 + 0.75 * hs)[..., None]
    rgb = np.where(land[..., None], base * shade, np.array([0.12, 0.25, 0.45]) * (1 + h[..., None] / 80))
    # airfields (flat to 0.3 m of elevM) in orange
    for icao in meta['flattened']:
        d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
        g = Polygon(d['boundary']).buffer(0)
        inside = bg.rasterize(g, e['x0'], e['y0'], cell, h.shape[1], h.shape[0]).astype(bool)
        edge = inside & ~ndimage.binary_erosion(inside, iterations=2)
        rgb[edge] = (1.0, 0.55, 0.1)
    rgb = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    out = os.path.join(bc.SHOTS, f'v060-bake-patch-{pid}.png')
    bc.write_png(out, bc.south_up_to_image(rgb))
    log('wrote', out, rgb.shape)


def cmd_manifest():
    patches, coasts, report = [], [], {}
    for pid in PATCHES:
        p = patch_name(pid).replace('.i16.gz', '.json')
        if os.path.exists(p):
            patches.append(json.load(open(p))['entry'])
        else:
            report[pid] = 'missing'
    for icao in COAST:
        p = os.path.join(OUT, f'coast-{icao}.json')
        if not os.path.exists(p):
            report[icao] = 'missing'
            continue
        m = json.load(open(p))
        if m['entry']:
            coasts.append(m['entry'])
        else:
            report[icao] = 'all land: no coast patch'
    out = os.path.join(OUT, 'manifest-patches.json')
    with open(out + '.tmp', 'w') as f:
        json.dump(dict(patches=patches, coastPatches=coasts), f, indent=1)
    os.replace(out + '.tmp', out)
    log('wrote', out, len(patches), 'patches', len(coasts), 'coasts', report)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['patch', 'coast', 'quicklook', 'manifest'])
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'manifest':
        return cmd_manifest()
    for i in a.ids:
        if a.cmd == 'patch':
            cmd_patch(i, a.force)
        elif a.cmd == 'coast':
            cmd_coast(i, a.force)
        else:
            cmd_quicklook(i)


if __name__ == '__main__':
    main()
