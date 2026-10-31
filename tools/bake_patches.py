"""Step 5: the 30 m height patches (GLO-30) and the 10 m coast patches.

Height patches (cell 30 m, same .i16 encoding as the national grid, same treatment):
  incheon-gimpo  126.35-126.90 E, 37.40-37.65 N   (GLO-30 tile N37 E126)
  jeju           126.10-127.00 E, 33.15-33.60 N   (GLO-30 tile N33 E126; GLO-90 fills the
                                                   sliver east of 127 E, which is sea)
Each: GLO-30 bilinear at the cell centres, the sea and inland water from the same OSM
geometry rasterised at 30 m, the built-up fraction from the national cover grid
(bilinear), the urban local-minimum filter and the airfields flattened (compose_height).
Patch grids are aligned to multiples of the cell in map metres and are cell-centred,
row 0 = south, like the national grid.

Coast patches (cell 10 m, .u8, 128 + d/2, +-256 m): the signed distance to the sea
coastline (+ land), 16 km x 16 km centred on each airport's reference point.
"""
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import (CACHE, DATA, EXTRA_DEM90, NAT, RAW, cell_centres, height_to_i16, progress,
                         read_gz, signed_to_u8, to_geo, to_map, update_manifest, write_gz)
from bake_geom import aerodromes, compose_height, inland_water, land_geoms, rasterize, signed_distance
from bake_height import load_tiles, resample, sample_tiles

PATCHES = [('incheon-gimpo', (126.35, 37.40, 126.90, 37.65)),
           ('jeju', (126.10, 33.15, 127.00, 33.60))]
COAST = [('RKSS', 37.5583, 126.7906), ('RKSI', 37.4691, 126.4510), ('RKPC', 33.5113, 126.4930)]
COAST_SIZE = 16000.0


def grid_for_box(lon0, lat0, lon1, lat1, cell):
    """A cell-aligned map-metre grid covering the lon/lat box."""
    lats = np.array([lat0, lat0, lat1, lat1, (lat0 + lat1) / 2, (lat0 + lat1) / 2])
    lons = np.array([lon0, lon1, lon0, lon1, lon0, lon1])
    x, y = to_map(lats, lons)
    x0 = np.floor(x.min() / cell) * cell
    y0 = np.floor(y.min() / cell) * cell
    nx = int(np.ceil((x.max() - x0) / cell))
    ny = int(np.ceil((y.max() - y0) / cell))
    return x0, y0, nx, ny


def bilinear_grid(src, sx0, sy0, scell, X, Y):
    """Sample a cell-centred grid bilinearly at map points X, Y (clamped at its edges)."""
    fx = np.clip((X - sx0) / scell - 0.5, 0, src.shape[1] - 1.001)
    fy = np.clip((Y - sy0) / scell - 0.5, 0, src.shape[0] - 1.001)
    i = np.floor(fx).astype(int); j = np.floor(fy).astype(int)
    tx = fx - i; ty = fy - j
    return (src[j, i] * (1 - tx) * (1 - ty) + src[j, i + 1] * tx * (1 - ty)
            + src[j + 1, i] * (1 - tx) * ty + src[j + 1, i + 1] * tx * ty)


def main():
    _, _, land = land_geoms()
    water = inland_water()
    aero = aerodromes()
    t30 = load_tiles(sorted(glob.glob(os.path.join(RAW, 'dem30', '*.tif'))))
    t90 = None
    cover = read_gz(os.path.join(DATA, 'terrain', 'cover.rgba8.gz'), 'u1', (NAT['ny'], NAT['nx'], 4))
    urban_nat = cover[..., 2].astype(np.float32) / 255
    del cover
    patches = []
    for pid, (lon0, lat0, lon1, lat1) in PATCHES:
        cell = 30.0
        x0, y0, nx, ny = grid_for_box(lon0, lat0, lon1, lat1, cell)
        dem = resample(t30, x0, y0, cell, nx, ny, sub=1)
        if np.isnan(dem).any():
            if t90 is None:
                paths = sorted(glob.glob(os.path.join(RAW, 'dem90', '*.tif'))) + \
                    sorted(glob.glob(os.path.join(EXTRA_DEM90, '*.tif')))
                t90 = load_tiles([p for p in paths if '_N33_' in p or '_N37_' in p])
            gap = np.isnan(dem)
            X, Y = cell_centres(x0, y0, cell, nx, ny)
            lat, lon = to_geo(X[gap], Y[gap])
            dem[gap] = sample_tiles(t90, lat, lon)
            print(pid, 'filled', int(gap.sum()), 'cells from GLO-90')
        sea_sd = signed_distance(rasterize(land, x0, y0, cell, nx, ny), cell)
        water_sd = -signed_distance(rasterize(water, x0, y0, cell, nx, ny), cell)
        X, Y = cell_centres(x0, y0, cell, nx, ny)
        urban = bilinear_grid(urban_nat, NAT['x0'], NAT['y0'], NAT['cell'], X, Y).astype(np.float32)
        del X, Y
        h = compose_height(dem, sea_sd, water_sd, urban, cell, x0, y0, airports=aero)
        path = f'terrain/patch-{pid}.i16.gz'
        write_gz(os.path.join(DATA, path), height_to_i16(h))
        patches.append(dict(id=pid, x0=x0, y0=y0, cell=cell, nx=nx, ny=ny, height=path))
        print(pid, nx, 'x', ny, 'max', float(h.max()), os.path.getsize(os.path.join(DATA, path)), 'bytes')
        del dem, sea_sd, water_sd, urban, h

    coast = []
    for icao, la, lo in COAST:
        cell = 10.0
        cx, cy = to_map(la, lo)
        n = int(COAST_SIZE / cell)
        x0 = np.round((cx - COAST_SIZE / 2) / cell) * cell
        y0 = np.round((cy - COAST_SIZE / 2) / cell) * cell
        sd = signed_distance(rasterize(land, x0, y0, cell, n, n), cell)
        path = f'terrain/coast-{icao}.u8.gz'
        write_gz(os.path.join(DATA, path), signed_to_u8(sd, 2))
        coast.append(dict(id=icao, x0=float(x0), y0=float(y0), cell=cell, nx=n, ny=n, coast=path))
        print(icao, 'coast patch', n, 'x', n, 'sea fraction %.2f' % (sd < 0).mean(),
              os.path.getsize(os.path.join(DATA, path)), 'bytes')

    update_manifest(patches=patches, coastPatches=coast)
    progress('- step 5: 30 m height patches (incheon-gimpo, jeju) and 10 m coast patches (RKSS, RKSI, RKPC) '
             'written; manifest.json has patches and coastPatches.')


if __name__ == '__main__':
    main()
