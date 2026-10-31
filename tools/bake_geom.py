"""Geometry shared by the bake steps: land and water polygons in map metres, rasterising,
signed distances, and composing the final height (sea, inland water, urban filter,
airfield flattening). Used for the national grid and the patches alike.

The land: OSM natural=coastline ways (merged into rings; the mainland's open ends at the
DMZ are closed with a straight segment through North Korea, which is land anyway), plus
Natural Earth 1:10M land for everything more than 4 km from OSM land (North Korea, Japan,
China). Cached in /tmp/flight-sim/bake/geom_*.pkl.
"""
import json
import os
import pickle
import sys

import numpy as np
import shapely
from rasterio import features
from rasterio.transform import Affine
from scipy import ndimage
from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.ops import linemerge, unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import CACHE, RAW, to_map

MAP_BOX = box(-420000, -420000, 420000, 420000)


def project(geom):
    """lon/lat shapely geometry -> map metres."""
    def f(c):
        x, y = to_map(c[:, 1], c[:, 0])
        return np.stack([x, y], 1)
    return shapely.transform(geom, f)


def _cached(name, build):
    p = os.path.join(CACHE, f'geom_{name}.pkl')
    if os.path.exists(p):
        with open(p, 'rb') as f:
            return pickle.load(f)
    v = build()
    with open(p, 'wb') as f:
        pickle.dump(v, f, protocol=pickle.HIGHEST_PROTOCOL)
    return v


def _records(theme):
    from bake_osm_extract import read_records
    return read_records(theme)


# Where the mainland's coastline leaves the extract: the chain of open coastline lines
# starts on North Korea's south coast west of Ganghwa and ends at the east coast's DMZ.
# It's closed with this path through North Korean land (lon, lat), east to west; whatever
# it adds beyond real land is trimmed against Natural Earth inside CLOSURE_BOX.
CLOSURE_PATH = [(127.9, 38.75), (127.2, 38.55), (126.6, 38.25), (126.1, 38.05)]
CLOSURE_BOX = (125.5, 37.7, 126.65, 38.8)


def _chain(open_lines, snap=3500.0):
    """Join open lines end-to-start when the gap is under `snap` metres."""
    lines = [list(l) for l in open_lines]
    changed = True
    while changed:
        changed = False
        for i, a in enumerate(lines):
            best, bj = snap, None
            for j, b in enumerate(lines):
                if i != j:
                    g = np.hypot(a[-1][0] - b[0][0], a[-1][1] - b[0][1])
                    if g < best:
                        best, bj = g, j
            if bj is not None:
                lines[i] = a + lines[bj]
                del lines[bj]
                changed = True
                break
    return lines


def build_osm_land():
    lines = [project(LineString(c)) for _, c in _records('coast') if len(c) >= 2]
    merged = linemerge(lines)
    parts = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
    closed = [list(l.coords) for l in parts if l.is_closed]
    opened = _chain([list(l.coords) for l in parts if not l.is_closed])
    print(f'coast: {len(closed)} closed rings, {len(opened)} open chains after snapping')
    polys = []
    for cs in closed:
        if len(cs) >= 4:
            p = Polygon(cs)
            polys.append(p if p.is_valid else p.buffer(0))
    for cs in opened:
        ln = LineString(cs)
        print('  open chain km', round(ln.length / 1000, 1), 'from', np.round(cs[0]), 'to', np.round(cs[-1]))
        if ln.length < 100000:
            continue  # stray fragment at the extract's edge
        px, py = to_map(np.array([p[1] for p in CLOSURE_PATH]), np.array([p[0] for p in CLOSURE_PATH]))
        ring = cs + list(zip(px, py)) + [cs[0]]
        p = Polygon(ring)
        p = p if p.is_valid else p.buffer(0)
        # trim the closure's extra land against Natural Earth (buffered 1.5 km)
        cb = project(box(*CLOSURE_BOX))
        ne = build_ne_land()
        p = p.difference(cb).union(p.intersection(cb).intersection(ne.buffer(1500)))
        polys.append(p)
    land = unary_union(polys)
    return land, coast_zone(lines)


def coast_zone(lines, dist=4000.0, cell=1000.0):
    """Polygon of everything within ~4 km of an OSM coastline line, built on a 1 km raster
    (a vector buffer of the whole coastline used far too much memory)."""
    n = int(840000 / cell)
    x0 = y0 = -420000.0
    shapes = [(ln, 1) for ln in lines]
    m = features.rasterize(shapes, out_shape=(n, n), transform=transform_for(x0, y0, cell, n),
                           fill=0, dtype=np.uint8, all_touched=True)
    near = ndimage.distance_transform_edt(m == 0) * cell <= dist
    polys = [shapely.geometry.shape(g) for g, v in features.shapes(near.astype(np.uint8), mask=near,
                                                                  transform=transform_for(x0, y0, cell, n))]
    return unary_union(polys)


def build_ne_land():
    if hasattr(build_ne_land, 'v'):
        return build_ne_land.v
    with open(os.path.join(RAW, 'ne', 'ne_10m_land.geojson')) as f:
        gj = json.load(f)
    clip = box(121.5, 31.0, 134.0, 41.0)
    geoms = []
    for ft in gj['features']:
        g = shapely.geometry.shape(ft['geometry']).intersection(clip)
        if not g.is_empty:
            geoms.append(project(g))
    build_ne_land.v = unary_union(geoms).intersection(MAP_BOX)
    return build_ne_land.v


def land_geoms():
    """(osm_land, ne_land_outside, all_land) in map metres."""
    def build():
        osm, zone = build_osm_land()
        ne = build_ne_land()
        ne_out = ne.difference(zone)
        return osm, ne_out, unary_union([osm, ne_out])
    return _cached('land', build)


def inland_water():
    """Inland water polygons (map metres) bigger than 0.02 km2, unioned, plus names."""
    def build():
        gs = []
        for kind, name, w in _records('water'):
            if kind in ('wastewater', 'ditch', 'drain', 'reflecting_pool', 'fishpond', 'stream'):
                continue
            try:
                g = project(shapely.from_wkb(w))
            except Exception:
                continue
            if not g.is_valid:
                g = g.buffer(0)
            if g.area >= 20000:
                gs.append(g)
        print(f'inland water: {len(gs)} polygons >= 0.02 km2')
        return unary_union(gs)
    return _cached('water', build)


def aerodromes():
    """{icao: (polygon in map metres, elevation m)} for the three airports."""
    def build():
        out = {}
        for icao, name, ele, w in _records('aerodromes'):
            if icao in ('RKSS', 'RKSI', 'RKPC'):
                g = project(shapely.from_wkb(w))
                if icao not in out or g.area > out[icao][0].area:
                    out[icao] = (g, float(ele))
        return out
    return _cached('aerodromes', build)


# ---------------------------------------------------------------- rasters
def transform_for(x0, y0, cell, ny):
    """rasterio affine for a north-up raster; we flip rows afterwards (row 0 = south)."""
    return Affine(cell, 0, x0, 0, -cell, y0 + ny * cell)


def rasterize(geoms, x0, y0, cell, nx, ny, value=1, all_touched=False):
    """Burn geometries into a uint8 grid with row 0 = south."""
    if not isinstance(geoms, (list, tuple)):
        geoms = [geoms]
    grid_box = box(x0, y0, x0 + nx * cell, y0 + ny * cell)
    shapes = []
    for g in geoms:
        if g is None or g.is_empty:
            continue
        if not g.intersects(grid_box):
            continue
        shapes.append((g.intersection(grid_box.buffer(cell * 2)), value))
    if not shapes:
        return np.zeros((ny, nx), np.uint8)
    r = features.rasterize(shapes, out_shape=(ny, nx), transform=transform_for(x0, y0, cell, ny),
                           fill=0, dtype=np.uint8, all_touched=all_touched)
    return r[::-1].copy()


def signed_distance(mask, cell):
    """+ inside mask (distance to the nearest outside cell), - outside. Metres."""
    mask = mask.astype(bool)
    if mask.all():
        return np.full(mask.shape, 1e6, np.float32)
    if not mask.any():
        return np.full(mask.shape, -1e6, np.float32)
    # one transform at a time, kept as float32, to hold memory down on big grids
    out = ndimage.distance_transform_edt(mask).astype(np.float32)
    out *= cell
    out -= cell / 2
    dout = ndimage.distance_transform_edt(~mask).astype(np.float32)
    dout *= cell
    dout -= cell / 2
    np.negative(dout, out=dout)
    out[~mask] = dout[~mask]
    return out


def block_mean(a, f):
    ny, nx = a.shape
    return a.reshape(ny // f, f, nx // f, f).mean(axis=(1, 3))


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- the height
def compose_height(dem, sea_sd, water_sd, urban, cell, x0, y0, land_fallback=30.0, airports=None):
    """Final heights (m) on one grid.

    dem: raw Copernicus (NaN = no data); sea_sd: signed distance to the sea coastline
    (+ land); water_sd: signed distance to inland water (+ outside); urban: built-up
    fraction 0..1; airports: {icao: (polygon, elev)} flattened inside, blended over 300 m.
    """
    h = dem.astype(np.float32).copy()
    land = sea_sd > 0
    h[np.isnan(h)] = land_fallback

    # 1. Built-up areas: Copernicus is a surface model (rooftops). Blend towards a local
    #    minimum (about 500 m across), smoothed, by the built-up fraction.
    if urban is not None and urban.max() > 0:
        k = max(3, int(round(500 / cell)) | 1)
        hmin = ndimage.minimum_filter(h, size=k)
        hmin = ndimage.uniform_filter(hmin, size=k)
        w = np.clip(urban * 1.5, 0, 1)
        h = np.minimum(h, h * (1 - w) + hmin * w)

    # 2. Inland water: flat at the surrounding bank level minus 2 m.
    water = (water_sd < 0) & land
    if water.any():
        bank = ~water & land
        if bank.any():
            idx = ndimage.distance_transform_edt(~bank, return_distances=False, return_indices=True)
            bank_h = h[idx[0], idx[1]]
            # smooth the bank level along the water so it doesn't jump cell to cell
            bank_h = ndimage.uniform_filter(np.where(water, bank_h, 0), size=3) / np.maximum(
                ndimage.uniform_filter(water.astype(np.float32), size=3), 1e-3)
            h = np.where(water, np.maximum(bank_h, 0.5) - 2.0, h)

    # 3. Airfields: flat at the published elevation, blended over 300 m outside.
    if airports:
        X = x0 + (np.arange(h.shape[1]) + 0.5) * cell
        Y = y0 + (np.arange(h.shape[0]) + 0.5) * cell
        for icao, (poly, elev) in airports.items():
            bx = poly.bounds
            if bx[2] < X[0] - 400 or bx[0] > X[-1] + 400 or bx[3] < Y[0] - 400 or bx[1] > Y[-1] + 400:
                continue
            inside = rasterize(poly, x0, y0, cell, h.shape[1], h.shape[0]).astype(bool)
            if not inside.any():
                continue
            d = ndimage.distance_transform_edt(~inside) * cell
            w = 1 - smoothstep(0, 300, d)
            w = np.where(land, w, 0)
            h = h * (1 - w) + elev * w

    # 4. Land at least 0.5 m; the sea from -5 m at the shore to -40 m 3 km out.
    h = np.where(land, np.maximum(h, 0.5), -5.0 - 35.0 * smoothstep(0, 3000, -sea_sd))
    return h.astype(np.float32)
