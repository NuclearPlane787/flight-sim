"""The path map's country borders and names (v0.7.4, Shane's item 10: "Country names are visible when you zoom out far
enough. Also, add the country borders in their own distinct line style."), one small file a region.

From Natural Earth's ne_10m_admin_0_countries (public domain), read as tools/bake_country.py reads it (there is no land
boundary lines file in reference/raw/ne/). The land borders are the stretches of boundary two countries share: each
pair's boundaries intersected in the map frame (Natural Earth's countries share their border vertices exactly, so the
intersection is the shared line; coasts are shared with nobody and drop out). Clipped to the region's frame (East
Asia's map rectangle, Europe's outline) and simplified at three tolerances, picked by zoom as the coast's are. The
names are Natural Earth's NAME_EN at its label points (LABEL_X, LABEL_Y), as they come, with LABELRANK and MIN_LABEL
for the map's choice by zoom; only label points inside the region's frame.

Output (--out DIR, default the region's data folder):
  country-lines.json  {v, source, tols, lines: [{a, b, levels: [[x0, y0, x1, y1, ...] per tolerance]}],
                       names: [{name, a3, x, y, rank, minLabel}]}   (map metres, rounded to 1 m)
  Claude outputs/flight-sim/v074-bake-country-lines-<region>.png  a quick look (north up)

Run (from GameDump):
  /tmp/flight-sim/v074/g.sh 5 map/bake-ea.txt /tmp/flight-sim/venv/bin/python -I games/flight-sim/tools/bake_country_lines.py
  FS_REGION=europe /tmp/flight-sim/v074/g.sh 5 map/bake-eu.txt /tmp/flight-sim/venv/bin/python -I games/flight-sim/tools/bake_country_lines.py
"""
import argparse
import json
import os
import sys

import numpy as np
from shapely.geometry import LineString, MultiLineString, Polygon, box, shape
from shapely.geometry import Point
from shapely.ops import linemerge, polylabel, transform

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import DATA, EUROPE, RAW, SHOTS, outline_latlon, to_map, write_png  # noqa: E402

SRC = os.path.join(RAW, 'ne', 'ne_10m_admin_0_countries.geojson')
TOLS = [200.0, 1200.0, 5000.0]                      # metres: close in, the middle zooms, the whole region
# East Asia's map rectangle (src/world/region.js REGION_EXTENT) and the box to take polygons from.
EA_RECT = (-1600000.0, -1338000.0, 2110000.0, 1284000.0)
EA_BOX = (20.0, 52.0, 105.0, 155.0)
EU_BOX = (30.0, 64.0, -16.0, 25.0)


def project(geom):
    return transform(lambda lon, lat, z=None: to_map(np.asarray(lat), np.asarray(lon)), geom)


def frame():
    if EUROPE:
        la, lo = outline_latlon(0.1)
        x, y = to_map(la, lo)
        return Polygon(np.stack([x, y], 1))
    return box(*EA_RECT)


CAND_M = 40000.0
CAND_MAX = 80


def candidates(g):
    if g.is_empty:
        return []
    inner = g.buffer(-15000)
    if inner.is_empty:
        inner = g
    x0, y0, x1, y1 = inner.bounds
    step = CAND_M
    while True:
        xs = np.arange(x0 + step / 2, x1, step)
        ys = np.arange(y0 + step / 2, y1, step)
        X, Y = np.meshgrid(xs, ys)
        from shapely import contains_xy
        ok = contains_xy(inner, X.ravel(), Y.ravel()) if X.size else np.zeros(0, bool)
        pts = np.stack([X.ravel()[ok], Y.ravel()[ok]], 1)
        if len(pts) <= CAND_MAX:
            break
        step *= 1.4
    return [int(round(v / 100) * 100) for xy in pts for v in xy]


def lines_of(g):
    if g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, MultiLineString):
        return list(g.geoms)
    if hasattr(g, 'geoms'):
        out = []
        for p in g.geoms:
            out += lines_of(p)
        return out
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(DATA, 'europe') if EUROPE else DATA)
    args = ap.parse_args()
    lat0, lat1, lon0, lon1 = EU_BOX if EUROPE else EA_BOX
    with open(SRC) as f:
        feats = json.load(f)['features']
    fr = frame()
    clip = fr.buffer(20000)
    countries = []
    names = []
    for ft in feats:
        p = ft['properties']
        g = shape(ft['geometry'])
        bx0, by0, bx1, by1 = g.bounds      # lon, lat
        if by1 < lat0 or by0 > lat1 or bx1 < lon0 or bx0 > lon1:
            continue
        gm = project(g)
        if not gm.is_valid:
            gm = gm.buffer(0)
        gc = gm.intersection(clip)
        if gc.is_empty:
            continue
        countries.append((p['ADM0_A3'], gc))
        lx, ly = to_map(np.asarray(p['LABEL_Y']), np.asarray(p['LABEL_X']))
        rec = dict(name=p['NAME_EN'], a3=p['ADM0_A3'], x=round(float(lx)), y=round(float(ly)),
                   rank=int(p.get('LABELRANK') or 9), minLabel=float(p.get('MIN_LABEL') or 0))
        # (second pass) other places inside the country (in the frame) where its name may go when its label point is
        # taken or off the screen: a grid of points at least 15 km inside its land, every CAND_M, at most CAND_MAX
        rec['cand'] = candidates(gm.intersection(fr))
        if fr.contains(Point(float(lx), float(ly))):
            names.append(rec)
        else:
            # The label point is outside the frame (China's and Russia's are far inland): a country with a large
            # piece inside still gets its name, at the pole of inaccessibility of its largest piece in the frame
            # (a decision of v0.7.4's run: Natural Earth's own point would never show).
            inside = gm.intersection(fr)
            pieces = [q for q in (inside.geoms if hasattr(inside, 'geoms') else [inside]) if q.geom_type == 'Polygon']
            big = max(pieces, key=lambda q: q.area) if pieces else None
            if big is not None and big.area > 4e10:
                c = polylabel(big, 2000)
                rec.update(x=round(c.x), y=round(c.y), moved=True)
                names.append(rec)
    print(f'{len(countries)} countries in the frame; names: ' + ', '.join(n['name'] for n in names))
    lines = []
    for i in range(len(countries)):
        a3a, ga = countries[i]
        for j in range(i + 1, len(countries)):
            a3b, gb = countries[j]
            if not ga.envelope.intersects(gb.envelope):
                continue
            shared = ga.boundary.intersection(gb.boundary)
            parts = lines_of(shared)
            if not parts:
                continue
            merged = linemerge(parts) if len(parts) > 1 else parts[0]
            merged = merged.intersection(fr)
            segs = [s for s in lines_of(merged) if s.length > 500]
            if not segs:
                continue
            levels = [[] for _ in TOLS]
            for s in segs:
                for li, tol in enumerate(TOLS):
                    ss = s.simplify(tol, preserve_topology=False)
                    if len(ss.coords) >= 2:
                        levels[li].append([round(v) for c in ss.coords for v in c[:2]])
            km = sum(s.length for s in segs) / 1000
            print(f'  {a3a}-{a3b}: {len(segs)} pieces, {km:.0f} km, points by level ' + '/'.join(str(sum(len(p) // 2 for p in L)) for L in levels))
            lines.append(dict(a=a3a, b=a3b, levels=levels))
    doc = dict(v=1, source='Natural Earth ne_10m_admin_0_countries (public domain): shared land borders and NAME_EN at LABEL_X/LABEL_Y',
               region='europe' if EUROPE else 'east-asia', tols=TOLS, lines=lines, names=names)
    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, 'country-lines.json')
    with open(out, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    print(f'{out}: {os.path.getsize(out)} bytes, {len(lines)} borders, {len(names)} names')
    # quick look
    x0, y0, x1, y1 = fr.bounds
    W = 900
    sc = W / (x1 - x0)
    H = int((y1 - y0) * sc) + 1
    img = np.full((H, W, 3), 12, np.uint8)
    for ln in lines:
        for pts in ln['levels'][1]:
            xy = np.asarray(pts, float).reshape(-1, 2)
            for (ax, ay), (bx, by) in zip(xy[:-1], xy[1:]):
                n = int(max(abs(bx - ax), abs(by - ay)) * sc) + 1
                t = np.linspace(0, 1, n + 1)
                px = ((ax + (bx - ax) * t - x0) * sc).astype(int).clip(0, W - 1)
                py = ((ay + (by - ay) * t - y0) * sc).astype(int).clip(0, H - 1)
                img[py, px] = (220, 190, 150)
    for nm in names:
        px, py = int((nm['x'] - x0) * sc), int((nm['y'] - y0) * sc)
        img[max(0, py - 2):py + 3, max(0, px - 2):px + 3] = (255, 80, 80)
    write_png(os.path.join(SHOTS, f"v074-bake-country-lines-{'europe' if EUROPE else 'east-asia'}.png"), img[::-1].copy())


if __name__ == '__main__':
    main()
