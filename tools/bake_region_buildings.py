"""briefs/V0-6-0.md Part 2 step 10: the real centres' buildings for Part 6, from OpenStreetMap (ODbL).

One compact binary per centre (<id>.bin.gz) plus centres.json, written to a staging folder
(/tmp/flight-sim/v060/bake/centres/); the lead copies it into data/ after review.

Stages (each its own guarded command; every stage skips work whose output exists, unless --force):
  extract  osmium extract -c (one pass per source file, --strategy=smart, every centre of that file),
           then osmium tags-filter wr/building wr/building:part per centre.
  export   osmium export -f geojsonseq --geometry-types=polygon (areas from ways and multipolygons).
  bake     heights, the 3D-parts rule, the keep rule, simplification, the binary, the index and quick-looks.

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_buildings.py extract china
  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_buildings.py bake [id ...]

The format (little-endian), <id>.bin.gz (gzip 9, mtime 0):
  header  u32 magic 'FSB1' (bytes F S B 1), u32 count, u32 vertexCount
  count records of 8 bytes: u16 height (dm), u16 minHeight (dm), u8 nVerts, u8 flags, u16 reserved 0
      flags bit 0: height estimated; bit 1: a building:part
  then every record's vertices in record order: i16 x, i16 y, 0.5 m units east and north of the origin;
      the outer ring only, counter-clockwise, no repeated closing vertex, 3..255 vertices.
  Records sorted by 500 m cell (row-major from the box's south-west corner, by the mean of the stored vertices),
  then by height descending inside a cell.
centres.json: { version, credit, cell, centres: [ { id, name, file, origin [x, y], box [x0, y0, x1, y1],
  latlon [S, W, N, E], cols, rows, count, vertices, maxHeightM, minKeepHeightM, bytes } ] } in map metres.
"""
import gzip
import io
import json
import math
import os
import struct
import subprocess
import sys

import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import RAW, SHOTS, to_geo, to_map

OSMIUM = '/opt/homebrew/bin/osmium'
# (v0.6.3: FS_CENTRES_WORK and FS_CENTRES_OUT move the two folders, FS_SHOT_PREFIX names the quick-looks, so new
# centres bake beside v0.6.0's without touching its staging.)
WORK = os.environ.get('FS_CENTRES_WORK') or '/tmp/flight-sim/v060/centres-work'
OUT = os.environ.get('FS_CENTRES_OUT') or '/tmp/flight-sim/v060/bake/centres'
SHOT_PREFIX = os.environ.get('FS_SHOT_PREFIX') or 'v060'
CELL = 500.0
LEVEL_M = 3.2
KEEP_AREA = 2000.0        # m²: kept whatever its height
MAX_COUNT = 60000
EST_CAP = 60.0

SOURCES = {
    'kanto': 'osm/kanto-261118.osm.pbf',
    'kansai': 'osm/kansai-261118.osm.pbf',
    'kyushu': 'osm/kyushu-261118.osm.pbf',
    'china': 'osm/china-261118.osm.pbf',
    'korea': 'south-korea-latest.osm.pbf',
    'fareast': 'osm/far-eastern-fed-district-261119.osm.pbf',   # v0.6.3: Vladivostok
}

# id: (name, source, nominal box W, S, E, N, quick-look core: lat, lon, size km)
CENTRES = {
    'tokyo': ('Tokyo', 'kanto', (139.665, 35.600, 139.850, 35.745), (35.675, 139.728, 8.0)),
    'yokohama': ('Yokohama', 'kanto', (139.600, 35.435, 139.665, 35.480), (35.458, 139.630, 3.0)),
    'shanghai': ('Shanghai', 'china', (121.420, 31.175, 121.545, 31.265), (31.233, 121.495, 5.0)),
    'qingdao': ('Qingdao', 'china', (120.300, 36.040, 120.450, 36.100), (36.064, 120.385, 5.0)),
    'seoul': ('Seoul', 'korea', (126.890, 37.480, 127.130, 37.590), (37.512, 127.060, 8.0)),
    'songdo': ('Songdo', 'korea', (126.610, 37.365, 126.680, 37.415), (37.392, 126.640, 4.0)),
    'busan': ('Busan', 'korea', (129.040, 35.140, 129.185, 35.180), (35.162, 129.145, 5.0)),
    'osaka': ('Osaka', 'kansai', (135.470, 34.635, 135.535, 34.710), (34.675, 135.505, 8.0)),
    'fukuoka': ('Fukuoka', 'kyushu', (130.340, 33.570, 130.430, 33.605), (33.590, 130.395, 5.0)),
    # v0.6.3 (briefs/V0-6-3.md Part 5): Beijing from Financial Street to the CBD at Guomao, Tianjin along the Hai
    # River, Shenyang's centre, Dalian from Xinghai Bay to Zhongshan Square, Vladivostok round the Golden Horn.
    'beijing': ('Beijing', 'china', (116.330, 39.870, 116.490, 39.960), (39.912, 116.458, 6.0)),
    'tianjin': ('Tianjin', 'china', (117.160, 39.090, 117.260, 39.160), (39.125, 117.205, 5.0)),
    'shenyang': ('Shenyang', 'china', (123.380, 41.760, 123.480, 41.830), (41.795, 123.432, 5.0)),
    'dalian': ('Dalian', 'china', (121.580, 38.885, 121.680, 38.935), (38.915, 121.635, 5.0)),
    'vladivostok': ('Vladivostok', 'fareast', (131.860, 43.085, 131.945, 43.135), (43.112, 131.895, 4.0)),
}


# ---------------------------------------------------------------- boxes
def map_box(cid):
    """The centre's box in map metres: the nominal box's extents, centred on its projected centre,
    axis-aligned in the map frame. Returns (origin, (x0, y0, x1, y1)) rounded to the metre."""
    W, S, E, N = CENTRES[cid][2]
    latc, lonc = (S + N) / 2, (W + E) / 2
    cx, cy = to_map(latc, lonc)
    xw, _ = to_map(latc, W)
    xe, _ = to_map(latc, E)
    _, ys = to_map(S, lonc)
    _, yn = to_map(N, lonc)
    hw, hh = (float(xe) - float(xw)) / 2, (float(yn) - float(ys)) / 2
    ox, oy = round(float(cx)), round(float(cy))
    return (ox, oy), (round(ox - hw), round(oy - hh), round(ox + hw), round(oy + hh))


def geo_box(box, margin=0.0):
    """The lat/lon bounds [S, W, N, E] enclosing a map rectangle (its edges sampled)."""
    x0, y0, x1, y1 = box
    t = np.linspace(0, 1, 41)
    xs = np.concatenate([x0 + (x1 - x0) * t, np.full(41, x1), x1 - (x1 - x0) * t, np.full(41, x0)])
    ys = np.concatenate([np.full(41, y0), y0 + (y1 - y0) * t, np.full(41, y1), y1 - (y1 - y0) * t])
    lat, lon = to_geo(xs, ys)
    return [float(lat.min()) - margin, float(lon.min()) - margin, float(lat.max()) + margin, float(lon.max()) + margin]


# ---------------------------------------------------------------- stages: extract and export
def run(cmd):
    print('+', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def stage_extract(source, force=False):
    ids = [c for c, v in CENTRES.items() if v[1] == source]
    todo = [c for c in ids if force or not os.path.exists(os.path.join(WORK, c + '.bld.osm.pbf'))]
    if not todo:
        print(source, ': all extracted')
        return
    os.makedirs(WORK, exist_ok=True)
    cfg = {'directory': WORK, 'extracts': []}
    for c in todo:
        S, W, N, E = geo_box(map_box(c)[1], margin=0.004)
        cfg['extracts'].append({'output': c + '.box.osm.pbf', 'bbox': [round(W, 4), round(S, 4), round(E, 4), round(N, 4)]})
    cpath = os.path.join(WORK, source + '.extract.json')
    with open(cpath, 'w') as f:
        json.dump(cfg, f, indent=1)
    run([OSMIUM, 'extract', '-c', cpath, '--strategy=smart', '--overwrite', '--no-progress',
         os.path.join(RAW, SOURCES[source])])
    for c in todo:
        box = os.path.join(WORK, c + '.box.osm.pbf')
        out = os.path.join(WORK, c + '.bld.osm.pbf')
        run([OSMIUM, 'tags-filter', box, 'wr/building', 'wr/building:part', '-o', out + '.tmp.pbf',
             '--overwrite', '--no-progress'])
        os.replace(out + '.tmp.pbf', out)
        os.remove(box)


def stage_export(cid, force=False):
    src = os.path.join(WORK, cid + '.bld.osm.pbf')
    out = os.path.join(WORK, cid + '.geojsonseq')
    if os.path.exists(out) and not force:
        return
    run([OSMIUM, 'export', src, '-f', 'geojsonseq', '--geometry-types=polygon', '-a', 'type,id',
         '-x', 'print_record_separator=false', '-o', out + '.tmp', '-O', '--no-progress'])
    os.replace(out + '.tmp', out)


# ---------------------------------------------------------------- tags
def parse_len(s):
    """'123', '123 m', '123.5m', '12,5', "40'", '40 ft' -> metres, or None."""
    if s is None:
        return None
    s = str(s).strip().lower().split(';')[0].strip()
    feet = s.endswith("'") or s.endswith('ft') or s.endswith('feet')
    num = ''
    for ch in s.replace(',', '.'):
        if ch.isdigit() or (ch == '.' and '.' not in num) or (ch == '-' and not num):
            num += ch
        elif num:
            break
    try:
        v = float(num)
    except ValueError:
        return None
    if feet:
        v *= 0.3048
    if not math.isfinite(v) or v < 0 or v > 700:
        return None
    return v


def parse_levels(s):
    v = parse_len(s)
    if v is None or v > 200:
        return None
    return v


def is_yes(v):
    return v is not None and v not in ('no', 'false', '0')


# ---------------------------------------------------------------- bake
def load_features(cid, box):
    """Reads the GeoJSON-seq; returns a list of dicts with the projected outer ring and the tags we need.
    Drops footprints whose centroid is outside the box, and (early, to keep memory small) plain
    untagged-height outlines under 150 m², which can never be kept."""
    x0, y0, x1, y1 = box
    feats = []
    path = os.path.join(WORK, cid + '.geojsonseq')
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip().lstrip('\x1e')
            if not line:
                continue
            g = json.loads(line)
            p = g['properties']
            part = is_yes(p.get('building:part'))
            bld = is_yes(p.get('building'))
            if not (part or bld):
                continue
            if p.get('location') == 'underground' or p.get('building') == 'underground':
                continue
            geom = g['geometry']
            polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            h = parse_len(p.get('height'))
            lv = parse_levels(p.get('building:levels'))
            for poly in polys:
                ring = np.asarray(poly[0], dtype=np.float64)
                if len(ring) < 4:
                    continue
                x, y = to_map(ring[:, 1], ring[:, 0])
                xy = np.stack([x, y], axis=1)
                a = 0.5 * float(np.dot(xy[:-1, 0], xy[1:, 1]) - np.dot(xy[1:, 0], xy[:-1, 1]))
                area = abs(a)
                if area < 25:
                    continue
                c = xy[:-1].mean(axis=0)
                if not (x0 <= c[0] < x1 and y0 <= c[1] < y1):
                    continue
                if not part and h is None and lv is None and area < 150:
                    continue
                feats.append(dict(xy=xy, area=area, part=part, tags=p, h=h, lv=lv,
                                  name=p.get('name:en') or p.get('name') or '',
                                  osm=f"{p.get('@type', '?')[0]}{p.get('@id', '?')}"))
    return feats


def heights(feats):
    """Sets f['H'], f['minH'], f['src'] in ('tag', 'levels', 'est')."""
    for f in feats:
        p = f['tags']
        rl = parse_levels(p.get('roof:levels')) or 0.0
        minlv = parse_levels(p.get('building:min_level'))
        if f['h'] is not None and f['h'] >= 2:
            f['H'], f['src'] = f['h'], 'tag'
        elif f['lv'] is not None and f['lv'] >= 1:
            lv = f['lv']
            if minlv and lv <= minlv:          # levels given for the part alone
                lv += minlv
            f['H'], f['src'] = (lv + rl) * LEVEL_M, 'levels'
        else:
            f['H'], f['src'] = None, 'est'
        mh = parse_len(p.get('min_height'))
        if mh is None and minlv is not None:
            mh = minlv * LEVEL_M
        f['minH'] = mh or 0.0


def estimate(feats, box):
    """Untagged heights from footprint and place: floors by area (2 under 200 m², 3 under 1,000, else 4),
    raised towards 0.75 x the median tagged height of the buildings of 300 m² or more within the
    surrounding 1.5 km (3 x 3 cells of 500 m, at least 10 of them) for compact (4πA/P² >= 0.5) footprints
    of 300-5,000 m²; footprints over 5,000 m² (halls, malls) get at most 30 m. Capped at 60 m."""
    x0, y0 = box[0], box[1]
    cols = int(math.ceil((box[2] - x0) / CELL))
    rows = int(math.ceil((box[3] - y0) / CELL))
    bins = {}
    for f in feats:
        c = f['xy'][:-1].mean(axis=0)
        f['cell'] = (min(rows - 1, max(0, int((c[1] - y0) // CELL))), min(cols - 1, max(0, int((c[0] - x0) // CELL))))
        if f['src'] != 'est' and f['area'] >= 300:
            bins.setdefault(f['cell'], []).append(f['H'])
    med = {}
    for f in feats:
        if f['src'] != 'est':
            continue
        A = f['area']
        floors = 2 if A < 200 else 3 if A < 1000 else 4
        h = floors * LEVEL_M
        r, c = f['cell']
        if (r, c) not in med:
            vals = [v for dr in (-1, 0, 1) for dc in (-1, 0, 1) for v in bins.get((r + dr, c + dc), [])]
            med[(r, c)] = float(np.median(vals)) if len(vals) >= 10 else None
        m = med[(r, c)]
        if m is not None:
            d = np.diff(f['xy'], axis=0)
            perim = float(np.hypot(d[:, 0], d[:, 1]).sum())
            compact = 4 * math.pi * A / (perim * perim) if perim > 0 else 0
            if 300 <= A <= 5000 and compact >= 0.5:
                h = max(h, 0.75 * m)
            elif A > 5000:
                h = min(max(h, 0.5 * m), 30.0)
        f['H'] = min(h, EST_CAP)
    for f in feats:
        if f['minH'] >= f['H']:
            f['minH'] = 0.0


def drop_outlines(feats):
    """The OSM 3D rule: an outline with building:parts inside it is dropped (the parts stand for it),
    unless the parts inside cover under 30% of it (a half-mapped building keeps its outline too)."""
    parts = [f for f in feats if f['part']]
    if not parts:
        return feats, 0, 0
    ppolys = [Polygon(f['xy']) for f in parts]
    ppolys = [p if p.is_valid else p.buffer(0) for p in ppolys]
    reps = shapely.points([p.representative_point().coords[0] for p in ppolys])
    tree = shapely.STRtree(reps)
    pareas = np.array([f['area'] for f in parts])
    out, dropped, kept_both = [], 0, 0
    for f in feats:
        if f['part']:
            out.append(f)
            continue
        poly = Polygon(f['xy'])
        if not poly.is_valid:
            poly = poly.buffer(0)
        idx = tree.query(poly, predicate='contains')
        for i in idx:   # for the report: a part takes its outline's name and id
            parts[i].setdefault('group', f['osm'])
            if not parts[i]['name']:
                parts[i]['name'] = f['name']
        if len(idx):
            cover = float(pareas[idx].sum()) / f['area']
            if cover >= 0.3:
                dropped += 1
                continue
            kept_both += 1
        out.append(f)
    return out, dropped, kept_both


def simplify_ring(xy):
    """Outer ring -> CCW, ~1 m Douglas-Peucker, no closing vertex, <= 255 vertices; None if a sliver."""
    poly = Polygon(xy)
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.geom_type == 'MultiPolygon':
            poly = max(poly.geoms, key=lambda g: g.area)
    if poly.is_empty or poly.area < 25:
        return None
    poly = Polygon(poly.exterior)
    tol = 1.0
    while True:
        s = poly.simplify(tol, preserve_topology=True)
        if s.is_empty or s.area < 25:
            s = poly
        s = orient(Polygon(s.exterior), 1.0)
        ring = np.asarray(s.exterior.coords)[:-1]
        if len(ring) <= 255:
            return ring
        tol *= 2


def bake_centre(cid):
    name = CENTRES[cid][0]
    origin, box = map_box(cid)
    feats = load_features(cid, box)
    n_read = len(feats)
    heights(feats)
    estimate(feats, box)
    feats, dropped, both = drop_outlines(feats)

    thr = 12.0
    while True:
        kept = [f for f in feats if f['H'] >= thr or f['area'] >= KEEP_AREA]
        if len(kept) <= MAX_COUNT or thr >= 30:
            break
        thr += 3.0

    ox, oy = origin
    x0, y0, x1, y1 = box
    cols = int(math.ceil((x1 - x0) / CELL))
    rows = int(math.ceil((y1 - y0) / CELL))
    recs = []
    for f in kept:
        ring = simplify_ring(f['xy'])
        if ring is None:
            continue
        q = np.round((ring - [ox, oy]) * 2).astype(np.int64)
        keep = np.ones(len(q), bool)
        keep[1:] = np.any(q[1:] != q[:-1], axis=1)
        q = q[keep]
        if len(q) > 1 and np.all(q[0] == q[-1]):
            q = q[:-1]
        if len(q) < 3 or np.abs(q).max() > 32767:
            continue
        c = q.mean(axis=0) / 2 + [ox, oy]     # the quantized centroid: a loader recomputes the same cell
        cell = min(rows - 1, max(0, int((c[1] - y0) // CELL))) * cols + min(cols - 1, max(0, int((c[0] - x0) // CELL)))
        hd = int(min(65535, round(f['H'] * 10)))
        md = int(min(hd, round(f['minH'] * 10)))
        flags = (1 if f['src'] == 'est' else 0) | (2 if f['part'] else 0)
        recs.append((cell, -hd, md, flags, q, f))
    recs.sort(key=lambda r: (r[0], r[1], r[4][0, 0], r[4][0, 1]))

    head = struct.pack('<4sII', b'FSB1', len(recs), sum(len(r[4]) for r in recs))
    body = io.BytesIO()
    for cell, nhd, md, flags, q, f in recs:
        body.write(struct.pack('<HHBBH', -nhd, md, len(q), flags, 0))
    for r in recs:
        body.write(r[4].astype('<i2').tobytes())
    raw = head + body.getvalue()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, cid + '.bin.gz')
    bio = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=bio, mtime=0) as g:
        g.write(raw)
    with open(path + '.tmp', 'wb') as fo:
        fo.write(bio.getvalue())
    os.replace(path + '.tmp', path)

    # stats
    bands = [(12, 25), (25, 50), (50, 100), (100, 150), (150, 200), (200, 1e9)]
    hs = np.array([-r[1] / 10 for r in recs])
    band_counts = {f'{a}-{b if b < 1e9 else "+"}': int(((hs >= a) & (hs < b)).sum()) for a, b in bands}
    band_counts['<12 (area >= 2000 m2)'] = int((hs < 12).sum())
    src = {}
    for r in recs:
        src[r[5]['src']] = src.get(r[5]['src'], 0) + 1
    top, seen = [], set()
    for r in sorted(recs, key=lambda r: r[1]):   # the tallest distinct buildings (parts grouped by outline)
        g = r[5].get('group', r[5]['osm'])
        if g not in seen:
            seen.add(g)
            top.append(r)
        if len(top) == 8:
            break
    entry = dict(id=cid, name=name, file=cid + '.bin.gz', origin=[ox, oy], box=[x0, y0, x1, y1],
                 latlon=[round(v, 5) for v in geo_box(box)], cols=cols, rows=rows,
                 count=len(recs), vertices=sum(len(r[4]) for r in recs),
                 maxHeightM=round(float(hs.max()), 1) if len(hs) else 0, minKeepHeightM=thr,
                 bytes=os.path.getsize(path))
    report = dict(read=n_read, outlinesDropped=dropped, outlinesKeptWithParts=both,
                  parts=int(sum(1 for r in recs if r[5]['part'])), bands=band_counts, sources=src,
                  rawBytes=len(raw),
                  tallest=[dict(h=-r[1] / 10, est=bool(r[3] & 1), part=bool(r[3] & 2), name=r[5]['name'], osm=r[5].get('group', r[5]['osm']))
                           for r in top])
    quicklook(cid, recs, origin, box)
    return entry, report


# ---------------------------------------------------------------- quick-look
RAMP = [(0, (90, 100, 120)), (12, (70, 130, 200)), (25, (60, 180, 170)), (50, (150, 210, 80)),
        (100, (250, 210, 60)), (150, (250, 140, 40)), (200, (230, 50, 50)), (400, (230, 60, 230)), (650, (255, 255, 255))]


def colour(h, est):
    for (a, ca), (b, cb) in zip(RAMP, RAMP[1:]):
        if h < b:
            t = (h - a) / (b - a)
            c = [int(ca[i] + (cb[i] - ca[i]) * t) for i in range(3)]
            break
    else:
        c = list(RAMP[-1][1])
    if est:
        g = sum(c) // 3
        c = [(v + 2 * g) // 3 for v in c]
    return tuple(c)


def quicklook(cid, recs, origin, box):
    from PIL import Image, ImageDraw
    ox, oy = origin
    x0, y0, x1, y1 = box
    clat, clon, ckm = CENTRES[cid][3]
    cx, cy = (float(v) for v in to_map(clat, clon))
    order = sorted(recs, key=lambda r: -r[1])    # ascending height: the tall drawn last

    def draw(img, mpp, ax0, ay1, outline):
        d = ImageDraw.Draw(img)
        W, H = img.size
        for r in order:
            q = r[4]
            xs = (ox + q[:, 0] / 2 - ax0) / mpp
            ys = (ay1 - (oy + q[:, 1] / 2)) / mpp
            if xs.max() < 0 or ys.max() < 0 or xs.min() > W or ys.min() > H:
                continue
            col = colour(-r[1] / 10, r[3] & 1)
            d.polygon(list(zip(xs.tolist(), ys.tolist())), fill=col, outline=(20, 20, 25) if outline else None)
        return d

    # core crop
    half = ckm * 500
    cmpp = max(2.0, min(4.0, ckm * 1000 / 1800))
    cw = int(2 * half / cmpp)
    core = Image.new('RGB', (cw, cw), (16, 18, 24))
    dc = draw(core, cmpp, cx - half, cy + half, True)
    # labels: the 5 tallest inside the crop
    for r in sorted(recs, key=lambda r: r[1])[:12]:
        q = r[4]
        mx, my = ox + q[:, 0].mean() / 2, oy + q[:, 1].mean() / 2
        if abs(mx - cx) < half and abs(my - cy) < half:
            px, py = (mx - (cx - half)) / cmpp, ((cy + half) - my) / cmpp
            dc.text((px + 6, py - 6), f"{-r[1] / 10:.0f} m", fill=(255, 255, 255))
    dc.text((8, 8), f"{cid}: core {ckm:.0f} km at {cmpp:.1f} m/px (grey-tinted = estimated height)", fill=(255, 255, 255))
    # whole box
    bw, bh = x1 - x0, y1 - y0
    wmpp = max(bw, bh) / cw
    whole = Image.new('RGB', (int(bw / wmpp) + 1, int(bh / wmpp) + 1), (16, 18, 24))
    dw = draw(whole, wmpp, x0, y1, False)
    dw.rectangle([(cx - half - x0) / wmpp, (y1 - cy - half) / wmpp, (cx + half - x0) / wmpp, (y1 - cy + half) / wmpp],
                 outline=(255, 255, 255))
    dw.text((8, 8), f"whole box {bw / 1000:.1f} x {bh / 1000:.1f} km at {wmpp:.1f} m/px, {len(recs)} buildings", fill=(255, 255, 255))
    # legend
    leg = Image.new('RGB', (cw + whole.size[0], 40), (16, 18, 24))
    dl = ImageDraw.Draw(leg)
    for i, h in enumerate([12, 25, 50, 100, 150, 200, 300, 400, 600]):
        dl.rectangle([10 + i * 110, 10, 40 + i * 110, 30], fill=colour(h, 0))
        dl.text((46 + i * 110, 14), f"{h} m", fill=(255, 255, 255))
    out = Image.new('RGB', (cw + whole.size[0], max(cw, whole.size[1]) + 40), (16, 18, 24))
    out.paste(core, (0, 0))
    out.paste(whole, (cw, 0))
    out.paste(leg, (0, max(cw, whole.size[1])))
    os.makedirs(SHOTS, exist_ok=True)
    out.save(os.path.join(SHOTS, f'{SHOT_PREFIX}-bake-centre-{cid}.png'), optimize=True)


def stage_bake(ids):
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, 'centres.json')
    rep_path = os.path.join(WORK, 'report.json')
    index = {'version': 1, 'credit': '© OpenStreetMap contributors (ODbL)', 'cell': CELL, 'centres': []}
    reports = {}
    if os.path.exists(idx_path):
        with open(idx_path) as f:
            index = json.load(f)
    if os.path.exists(rep_path):
        with open(rep_path) as f:
            reports = json.load(f)
    for cid in ids:
        stage_export(cid)
        entry, rep = bake_centre(cid)
        index['centres'] = [c for c in index['centres'] if c['id'] != cid] + [entry]
        reports[cid] = rep
        print(json.dumps(entry), '\n', json.dumps(rep, ensure_ascii=False), flush=True)
    index['centres'].sort(key=lambda c: list(CENTRES).index(c['id']))
    with open(idx_path + '.tmp', 'w') as f:
        json.dump(index, f, indent=1)
    os.replace(idx_path + '.tmp', idx_path)
    with open(rep_path, 'w') as f:
        json.dump(reports, f, indent=1, ensure_ascii=False)


def main():
    args = sys.argv[1:]
    force = '--force' in args
    args = [a for a in args if a != '--force']
    if not args:
        print(__doc__)
        return
    stage, rest = args[0], args[1:]
    if stage == 'extract':
        for s in rest or list(SOURCES):
            stage_extract(s, force)
    elif stage == 'export':
        for c in rest or list(CENTRES):
            stage_export(c, force)
    elif stage == 'bake':
        stage_bake(rest or list(CENTRES))
    elif stage == 'boxes':
        for c in CENTRES:
            o, b = map_box(c)
            print(c, o, b, [round(v, 4) for v in geo_box(b)])
    else:
        raise SystemExit('stages: extract [source ...], export [id ...], bake [id ...], boxes')


if __name__ == '__main__':
    main()
