"""Step 1: the national height grid from Copernicus GLO-90.

For every 250 m cell of the national grid (cell-centred, row 0 = south) we map 3 x 3
sub-points back to lat/lon (toGeo) and sample the GLO-90 tiles bilinearly, then average:
an area average over the cell. Tiles that don't exist are sea (NaN here; bake_water
fills them). Tiles: reference/raw/dem90 (N33-N38 x E124-E131) plus the N32/N39 edge
tiles in /tmp/flight-sim/bake/dem90extra, if present (fetched with curl, same URL pattern).

Output: /tmp/flight-sim/bake/nat_dem.npy (float32 metres, NaN = no tile) and a first
data/terrain/height.i16.gz (sea and gaps simply set below 0) so the world job can start.
bake_water and bake_cover rewrite height.i16.gz with the sea, water and filters applied.
"""
import glob
import os
import re
import sys

import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import (CACHE, DATA, EXTRA_DEM90, NAT, RAW, cell_centres, height_to_i16,
                         progress, to_geo, update_manifest, write_gz)


def load_tiles(paths):
    """{(lat, lon): array (n+1, n+1)} with one extra row (south) and column (east),
    borrowed from the neighbouring tiles so bilinear sampling crosses tile edges.
    Copernicus tiles are PixelIsPoint: pixel (r, c) is at (lat+1 - r/n, lon + c/n)."""
    raw = {}
    for p in paths:
        m = re.search(r'_N(\d+)_00_E(\d+)_00_DEM', os.path.basename(p))
        raw[(int(m.group(1)), int(m.group(2)))] = tifffile.imread(p).astype(np.float32)
    tiles = {}
    for (la, lo), a in raw.items():
        n = a.shape[0]
        b = np.zeros((n + 1, n + 1), np.float32)
        b[:n, :n] = a
        s = raw.get((la - 1, lo))
        b[n, :n] = s[0] if s is not None else a[-1]
        e = raw.get((la, lo + 1))
        b[:n, n] = e[:, 0] if e is not None else a[:, -1]
        se = raw.get((la - 1, lo + 1))
        b[n, n] = se[0, 0] if se is not None else b[n - 1, n]
        tiles[(la, lo)] = b
    return tiles


def sample_tiles(tiles, lat, lon):
    """Bilinear samples at arrays lat, lon. NaN where no tile exists."""
    lat = np.asarray(lat, np.float64).ravel()
    lon = np.asarray(lon, np.float64).ravel()
    out = np.full(lat.shape, np.nan, np.float32)
    tla = np.floor(lat).astype(int)
    tlo = np.floor(lon).astype(int)
    key = tla * 1000 + tlo
    for k in np.unique(key):
        t = tiles.get((k // 1000, k % 1000))
        if t is None:
            continue
        sel = key == k
        n = t.shape[0] - 1
        r = (tla[sel] + 1 - lat[sel]) * n
        c = (lon[sel] - tlo[sel]) * n
        r0 = np.clip(np.floor(r).astype(int), 0, n - 1)
        c0 = np.clip(np.floor(c).astype(int), 0, n - 1)
        fr = (r - r0).astype(np.float32)
        fc = (c - c0).astype(np.float32)
        v = (t[r0, c0] * (1 - fr) * (1 - fc) + t[r0, c0 + 1] * (1 - fr) * fc
             + t[r0 + 1, c0] * fr * (1 - fc) + t[r0 + 1, c0 + 1] * fr * fc)
        out[sel] = v
    return out


def resample(tiles, x0, y0, cell, nx, ny, sub=3, rows_per_chunk=200):
    """Area-average the tiles onto a cell-centred grid (row 0 = south)."""
    out = np.zeros((ny, nx), np.float32)
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    for j0 in range(0, ny, rows_per_chunk):
        j1 = min(ny, j0 + rows_per_chunk)
        X, Y = cell_centres(x0, y0 + j0 * cell, cell, nx, j1 - j0)
        acc = np.zeros(X.shape, np.float64)
        cnt = np.zeros(X.shape, np.float64)
        for oy in offs:
            for ox in offs:
                lat, lon = to_geo(X + ox * cell, Y + oy * cell)
                v = sample_tiles(tiles, lat, lon).reshape(X.shape)
                ok = ~np.isnan(v)
                acc[ok] += v[ok]
                cnt[ok] += 1
        res = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan)
        out[j0:j1] = res
    return out


def main():
    paths = sorted(glob.glob(os.path.join(RAW, 'dem90', '*.tif')))
    paths += sorted(glob.glob(os.path.join(EXTRA_DEM90, '*.tif')))
    print(f'{len(paths)} GLO-90 tiles')
    tiles = load_tiles(paths)
    h = resample(tiles, NAT['x0'], NAT['y0'], NAT['cell'], NAT['nx'], NAT['ny'])
    np.save(os.path.join(CACHE, 'nat_dem.npy'), h)
    print('min/max', np.nanmin(h), np.nanmax(h), 'nan cells', int(np.isnan(h).sum()))

    # A first height file: DEM as is, the sea (<= 0 or no tile) at -20 m.
    first = np.where(np.isnan(h) | (h <= 0), -20.0, h)
    write_gz(os.path.join(DATA, 'terrain', 'height.i16.gz'), height_to_i16(first))
    update_manifest(national=dict(x0=NAT['x0'], y0=NAT['y0'], cell=NAT['cell'], nx=NAT['nx'],
                                  ny=NAT['ny'], height='terrain/height.i16.gz'),
                    heightScale=0.25)
    progress('- step 1 (first pass): data/terrain/height.i16.gz written from GLO-90, raw DEM '
             '(no sea/water/filters yet), sea = -20 m. manifest.json has national.height.')


if __name__ == '__main__':
    main()
