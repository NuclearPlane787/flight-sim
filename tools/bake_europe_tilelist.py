"""v0.7.0: Europe's 250 m tile rule, checked: every 128 km tile with land within 200 km of an
airport's reference point (briefs/V0-7-0.md). Run on Natural Earth's land (reference/raw/ne,
ne_10m_land: the 1:10 m file is what is on disk; the brief's list came from 1:50 m) and on OSM's
split land polygons, and compared with bake_region_tiles.EU_BATCH_A.

Land is rasterised at 1 km with all_touched (so an islet smaller than a pixel still counts) in a
window around the airports; a tile counts if a land pixel inside it has its nearest point within
200 km of an airport (pixel centre distance less half a pixel diagonal: generous by up to 0.7 km).

  FS_REGION=europe python3 tools/cpu-guard.py -- /tmp/flight-sim/venv/bin/python -I tools/bake_europe_tilelist.py
"""
import json
import os
import sys

import numpy as np

os.environ['FS_REGION'] = 'europe'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None
try:
    import bake_common as bc
    import bake_geom as bg
    import bake_region_tiles as rt
    import bake_region_water as brw
finally:
    os.makedirs = _makedirs
import shapely
from shapely.geometry import shape as to_shape

R_KM = 200.0
PX = 1000.0
SPAN = 128000.0


def airports_xy():
    return {k: bc.to_map(*v) for k, v in brw.AIRPORTS.items()}


def window():
    xy = np.array([[float(a), float(b)] for a, b in airports_xy().values()])
    x0 = np.floor((xy[:, 0].min() - R_KM * 1000 - SPAN) / SPAN) * SPAN
    y0 = np.floor((xy[:, 1].min() - R_KM * 1000 - SPAN) / SPAN) * SPAN
    x1 = np.ceil((xy[:, 0].max() + R_KM * 1000 + SPAN) / SPAN) * SPAN
    y1 = np.ceil((xy[:, 1].max() + R_KM * 1000 + SPAN) / SPAN) * SPAN
    return x0, y0, int((x1 - x0) / PX), int((y1 - y0) / PX)


def geo_bounds(x0, y0, nx, ny):
    t = np.linspace(0, 1, 401)
    xs = np.concatenate([x0 + nx * PX * t, np.full(401, x0 + nx * PX), x0 + nx * PX * t, np.full(401, x0)])
    ys = np.concatenate([np.full(401, y0), y0 + ny * PX * t, np.full(401, y0 + ny * PX), y0 + ny * PX * t])
    la, lo = bc.to_geo(xs, ys)
    return lo.min() - 0.1, la.min() - 0.1, lo.max() + 0.1, la.max() + 0.1


def tiles_from(mask, x0, y0):
    ny, nx = mask.shape
    xs = x0 + (np.arange(nx) + 0.5) * PX
    ys = y0 + (np.arange(ny) + 0.5) * PX
    near = np.zeros(mask.shape, bool)
    for ax, ay in airports_xy().values():
        d = np.sqrt((xs[None, :] - ax) ** 2 + (ys[:, None] - ay) ** 2) - PX * 0.7072
        near |= d <= R_KM * 1000
    r, c = np.nonzero(mask.astype(bool) & near)
    out = set()
    for ti, tj in zip(np.floor((xs[c] - bc.NAT['x0']) / SPAN).astype(int), np.floor((ys[r] - bc.NAT['y0']) / SPAN).astype(int)):
        out.add(f'{ti}_{tj}')
    return out


def main():
    x0, y0, nx, ny = window()
    gb = geo_bounds(x0, y0, nx, ny)
    # Natural Earth
    with open(os.path.join(bc.RAW, 'ne', 'ne_10m_land.geojson')) as f:
        fc = json.load(f)
    ne = []
    for ft in fc['features']:
        g = to_shape(ft['geometry'])
        a, b, c, d = g.bounds
        if c < gb[0] or a > gb[2] or d < gb[1] or b > gb[3]:
            continue
        g = g if g.is_valid else shapely.make_valid(g)
        g = g.intersection(shapely.box(*gb))
        if not g.is_empty:
            ne.append(bg.project(g))
    del fc
    m_ne = bg.rasterize(ne, x0, y0, PX, nx, ny, all_touched=True)
    t_ne = tiles_from(m_ne, x0, y0)
    # OSM land polygons
    lp = brw.LandPolys()
    osm = lp.query(*gb)
    m_osm = bg.rasterize(osm, x0, y0, PX, nx, ny, all_touched=True)
    t_osm = tiles_from(m_osm, x0, y0)
    brief = set(rt.EU_BATCH_A)
    key = lambda s: tuple(int(v) for v in s.split('_'))
    res = dict(brief=len(brief), ne10=len(t_ne), osm=len(t_osm),
               ne10_not_brief=sorted(t_ne - brief, key=key), brief_not_ne10=sorted(brief - t_ne, key=key),
               osm_not_brief=sorted(t_osm - brief, key=key), brief_not_osm=sorted(brief - t_osm, key=key),
               osm_not_ne10=sorted(t_osm - t_ne, key=key), ne10_not_osm=sorted(t_ne - t_osm, key=key))
    if bc.EU_BATCH != 'A':
        # v0.7.1, batch B: the rule over all twenty airports (NE 1:10 m united with OSM), less batch A; each
        # tile checked against the outline (its lat/lon bounding rectangle in map metres, and the polygon).
        from shapely.geometry import Polygon, box as sbox
        la, lo = bc.outline_latlon()
        ox, oy = bc.to_map(la, lo)
        outline = Polygon(list(zip(ox, oy)))
        t = np.linspace(0, 1, 101)
        rla = np.concatenate([np.full(101, 35.0), 35 + 24 * t, np.full(101, 59.0), 35 + 24 * t])
        rlo = np.concatenate([-11 + 30.5 * t, np.full(101, 19.5), -11 + 30.5 * t, np.full(101, -11.0)])
        rx, ry = bc.to_map(rla, rlo)
        rect = (rx.min(), ry.min(), rx.max(), ry.max())
        union = t_ne | t_osm
        b, outside_rect, outside_outline = [], [], []
        for s in sorted(union - set(rt.EU_BATCH_A), key=key):
            ti, tj = key(s)
            g = sbox(ti * SPAN, tj * SPAN, (ti + 1) * SPAN, (tj + 1) * SPAN)
            if not g.intersects(sbox(*rect)):
                outside_rect.append(s)
            elif not g.intersects(outline):
                outside_outline.append(s)
            else:
                b.append(s)
        res.update(union=len(union), batch_b=b, batch_b_n=len(b), outside_rect=outside_rect,
                   outside_outline=outside_outline, a_not_union=sorted(set(rt.EU_BATCH_A) - union, key=key))
    print(json.dumps(res, indent=1))
    with open(os.path.join(rt.WORK, 'tilelist-check.json'), 'w') as f:
        json.dump(res, f, indent=1)


if __name__ == '__main__':
    main()
