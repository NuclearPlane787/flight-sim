"""Step 2: the sea coastline, inland water, the water grid, coast.json, and the height
with the sea and inland water applied.

Masks are rasterised at 125 m (2x the national grid), turned into signed distances
(scipy distance_transform_edt), and averaged 2 x 2 onto the 250 m grid.

Outputs: data/terrain/water.rg8.gz (R = sea, G = inland water, 128 + d/20), data/coast.json,
data/terrain/height.i16.gz (rewritten), and caches /tmp/flight-sim/bake/nat_sea_sd.npy,
nat_water_sd.npy.
"""
import json
import os
import sys

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import CACHE, DATA, NAT, height_to_i16, progress, signed_to_u8, update_manifest, write_gz
from bake_geom import (MAP_BOX, aerodromes, block_mean, compose_height, inland_water, land_geoms, rasterize,
                       signed_distance)


def rings(geom, tol, min_area):
    """Exterior rings (and holes, as their own rings, skipped) simplified, rounded to 1 m."""
    out = []
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    for p in polys:
        if p.is_empty or p.area < min_area:
            continue
        s = p.simplify(tol, preserve_topology=True)
        if s.is_empty:
            continue
        for q in (s.geoms if isinstance(s, MultiPolygon) else [s]):
            cs = np.round(np.asarray(q.exterior.coords)).astype(int).tolist()
            if len(cs) >= 4:
                out.append(cs)
    return out


def main():
    osm_land, ne_out, land = land_geoms()
    water = inland_water()
    f = 2
    c = NAT['cell'] / f
    nx, ny = NAT['nx'] * f, NAT['ny'] * f
    x0, y0 = NAT['x0'], NAT['y0']

    land_m = rasterize(land, x0, y0, c, nx, ny)
    sea_sd = block_mean(signed_distance(land_m, c), f).astype(np.float32)
    del land_m
    water_m = rasterize(water, x0, y0, c, nx, ny)
    water_sd = block_mean(-signed_distance(water_m, c), f).astype(np.float32)  # + outside water
    del water_m
    np.save(os.path.join(CACHE, 'nat_sea_sd.npy'), sea_sd)
    np.save(os.path.join(CACHE, 'nat_water_sd.npy'), water_sd)

    rg = np.stack([signed_to_u8(sea_sd, 20), signed_to_u8(water_sd, 20)], -1)
    write_gz(os.path.join(DATA, 'terrain', 'water.rg8.gz'), rg)

    dem = np.load(os.path.join(CACHE, 'nat_dem.npy'))
    # If bake_cover has run before, keep its built-up filter and the airfields, so the
    # height file is never left less finished than it was.
    up = os.path.join(CACHE, 'nat_urban.npy')
    urban = np.load(up) if os.path.exists(up) else None
    h = compose_height(dem, sea_sd, water_sd, urban, NAT['cell'], x0, y0,
                       airports=aerodromes() if urban is not None else None)
    write_gz(os.path.join(DATA, 'terrain', 'height.i16.gz'), height_to_i16(h))
    print('land cells', int((sea_sd > 0).sum()), 'inland water cells', int(((water_sd < 0) & (sea_sd > 0)).sum()))

    # coast.json: land rings (OSM + Natural Earth), big inland water rings.
    land_r = rings(land.intersection(MAP_BOX), 100, 50000)
    water_r = rings(water, 100, 1_000_000)
    cj = os.path.join(DATA, 'coast.json')
    with open(cj + '.tmp', 'w') as fh:
        json.dump({'land': land_r, 'water': water_r}, fh, separators=(',', ':'))
    os.replace(cj + '.tmp', cj)
    print('coast.json rings', len(land_r), len(water_r), os.path.getsize(os.path.join(DATA, 'coast.json')), 'bytes')

    update_manifest(national=dict(water='terrain/water.rg8.gz'))
    progress('- step 2: water.rg8.gz (R sea, G inland, 128 + d/20) and coast.json written; '
             'height.i16.gz rewritten with sea (-5..-40 m), land >= 0.5 m and inland water '
             '(bank - 2 m). No urban filter or airfield flattening yet (step 4).')


if __name__ == '__main__':
    main()
