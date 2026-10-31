"""Step 4: land cover, then the final national height (urban filter, airfields flattened).

Cover: OSM polygons rasterised at 62.5 m (4 x 4 per 250 m cell) into one class raster,
burned in the order forest, farm, urban (so urban wins overlaps), then counted per cell:
  R forest  (landuse=forest, natural=wood)
  G farm    (landuse=farmland|meadow|orchard|vineyard|grass|paddy|plant_nursery, natural=grassland)
  B urban   (landuse=residential|commercial|industrial|retail)
Built-up also comes from the density of OSM building ways (bake_osm_extract.py buildings,
binned straight into nat_bcount.npy): 2 per cell -> 0 up to 20 per cell -> 1. Korea's mapping is
patchy, and the neighbours have nothing in this extract, so the part of
each land cell that nothing covers is filled by a rule: next to built-up land (3 x 3 mean
urban > 0.25) it counts as urban; otherwise steep (> 6 deg) or high (> 250 m) ground is
forest, and flat lowland is 70 % farm, 30 % forest. Sea cells are 0.

Then the height: compose_height() with the urban fraction (local-minimum filter) and the
three airfields flattened to their published elevation (300 m blend), written to
data/terrain/height.i16.gz. Cache: nat_urban.npy (the built-up fraction, used by the patches).
"""
import os
import sys

import numpy as np
import shapely
from rasterio import features

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import CACHE, to_map, DATA, NAT, height_to_i16, progress, update_manifest, write_gz
from bake_geom import aerodromes, compose_height, project, transform_for

CLASSES = ['forest', 'farm', 'urban']


def class_raster(x0, y0, cell, nx, ny, batch=20000):
    """uint8 grid (row 0 = south): 0 none, 1 forest, 2 farm, 3 urban (urban wins).
    Streams each class's polygons from disk and burns them in batches."""
    from bake_osm_extract import read_records
    r = np.zeros((ny, nx), np.uint8)
    tr = transform_for(x0, y0, cell, ny)

    def burn(shapes):
        features.rasterize(shapes, out=r, transform=tr, dtype=np.uint8)

    for v, k in enumerate(CLASSES, 1):
        buf = []
        for w in read_records(f'cover-{k}'):
            g = project(shapely.from_wkb(w))
            if not g.is_empty:
                buf.append((g, v))
            if len(buf) >= batch:
                burn(buf)
                buf = []
        if buf:
            burn(buf)
    return r[::-1]


def fractions(cls, f):
    ny, nx = cls.shape[0] // f, cls.shape[1] // f
    b = cls.reshape(ny, f, nx, f)
    return [((b == v).sum(axis=(1, 3)) / (f * f)).astype(np.float32) for v in (1, 2, 3)]


def fill_rule(forest, farm, urban, h, land, cell):
    """Fill the unmapped part of each land cell (see the module docstring)."""
    from scipy import ndimage
    rest = np.clip(1 - forest - farm - urban, 0, 1) * land
    gy, gx = np.gradient(np.where(land, h, 0), cell)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    near_urban = ndimage.uniform_filter(urban, size=3) > 0.25
    steep = (slope > 6) | (h > 250)
    u_add = np.where(near_urban, rest, 0)
    rest2 = rest - u_add
    f_add = np.where(steep, rest2, rest2 * 0.3)
    g_add = np.where(steep, 0, rest2 * 0.7)
    return forest + f_add, farm + g_add, urban + u_add


def main():
    f = 4
    c = NAT['cell'] / f
    x0, y0, nx, ny = NAT['x0'], NAT['y0'], NAT['nx'], NAT['ny']
    cls = class_raster(x0, y0, c, nx * f, ny * f)
    forest, farm, urban = fractions(cls, f)
    del cls
    # Built-up density from OSM buildings (landuse=residential is patchy in Korea): the
    # count of building ways per cell, 3 x 3 mean, 2 -> 0 and 20 -> 1 built-up.
    from scipy import ndimage
    bcount = np.load(os.path.join(CACHE, 'nat_bcount.npy')).astype(np.float32)
    ub = np.clip((ndimage.uniform_filter(bcount, size=3) - 2) / 18, 0, 1)
    urban = np.maximum(urban, ub)
    other = forest + farm
    scale = np.where(other > 1e-6, np.minimum(1, (1 - urban) / np.maximum(other, 1e-6)), 1)
    forest, farm = forest * scale, farm * scale
    mapped = forest + farm + urban
    sea_sd = np.load(os.path.join(CACHE, 'nat_sea_sd.npy'))
    water_sd = np.load(os.path.join(CACHE, 'nat_water_sd.npy'))
    dem = np.load(os.path.join(CACHE, 'nat_dem.npy'))
    land = (sea_sd > 0) & (water_sd > 0)
    print('land cells with some OSM cover: %.1f %%' % (100 * ((mapped > 0) & land).sum() / land.sum()))
    print('land area covered by OSM polygons: %.1f %%' % (100 * mapped[land].mean()))
    hraw = np.where(np.isnan(dem), 30, dem)
    forest, farm, urban = fill_rule(forest, farm, urban, hraw, land, NAT['cell'])
    cover = np.zeros((ny, nx, 4), np.uint8)
    for k, a in enumerate((forest, farm, urban)):
        cover[..., k] = np.clip(np.round(np.where(land, a, 0) * 255), 0, 255)
    write_gz(os.path.join(DATA, 'terrain', 'cover.rgba8.gz'), cover)
    np.save(os.path.join(CACHE, 'nat_urban.npy'), np.where(land, urban, 0).astype(np.float32))

    # the built-up fraction drives the rooftop (local-minimum) filter
    h = compose_height(dem, sea_sd, water_sd, np.where(land, urban, 0), NAT['cell'], x0, y0, airports=aerodromes())
    write_gz(os.path.join(DATA, 'terrain', 'height.i16.gz'), height_to_i16(h))
    update_manifest(national=dict(cover='terrain/cover.rgba8.gz'))
    progress('- step 4: cover.rgba8.gz written (R forest, G farm, B urban; unmapped land filled by a '
             'slope/height rule); height.i16.gz final: urban local-minimum filter and the three '
             'airfields flattened (300 m blend).')


if __name__ == '__main__':
    main()
