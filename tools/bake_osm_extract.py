"""Read the OSM extract, cut down first, and stream what the later steps need to disk.

Memory rule (Shane, 03:50 KST): never hold the whole country's features in RAM. So:
1. osmium-tool cuts the 133 MB extract down first (brew install osmium-tool):
   - `osmium tags-filter` keeps only natural/waterway/landuse/water/aeroway objects
     (/tmp/flight-sim/bake/korea-themes.osm.pbf) and, separately, building ways;
   - `osmium extract -b` cuts a small box per airport (airport-<ICAO>.osm.pbf).
2. pyosmium reads the small files with a sparse node-location index (of the cut-down file only) and writes each
   feature straight to a per-theme stream file (a sequence of pickled records), keeping
   nothing per feature in memory. Buildings are binned straight into a count grid.

  bake_osm_extract.py national    coast.rec (coastline ways), water.rec, rivers.rec,
                                  cover-forest/farm/urban.rec, aerodromes.rec
  bake_osm_extract.py buildings   nat_bcount.npy: building ways per 250 m national cell
  bake_osm_extract.py airports    osm_airports.pkl (three small boxes; small by nature)

Records are lon/lat geometry as WKB. read_records(theme) streams them back.
"""
import os
import pickle
import subprocess
import sys
import time

import numpy as np
import osmium
import osmium.geom

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import CACHE, NAT, RAW, to_map

PBF = os.path.join(RAW, 'south-korea-latest.osm.pbf')
THEMES_PBF = os.path.join(CACHE, 'korea-themes.osm.pbf')
BUILDINGS_PBF = os.path.join(CACHE, 'korea-buildings.osm.pbf')
INDEX = 'sparse_mem_array'  # node locations of the cut-down files only (~8 M nodes, ~130 MB)

COVER = {
    'forest': {('landuse', 'forest'), ('natural', 'wood')},
    'farm': {('landuse', 'farmland'), ('landuse', 'meadow'), ('landuse', 'orchard'),
             ('landuse', 'vineyard'), ('landuse', 'grass'), ('natural', 'grassland'),
             ('landuse', 'paddy'), ('landuse', 'plant_nursery')},
    'urban': {('landuse', 'residential'), ('landuse', 'commercial'), ('landuse', 'industrial'),
              ('landuse', 'retail')},
}

# Boxes (lon0, lat0, lon1, lat1) around the three airports, generous.
AIRPORT_BOX = {
    'RKSS': (126.76, 37.53, 126.83, 37.59),
    'RKSI': (126.38, 37.41, 126.49, 37.50),
    'RKPC': (126.44, 33.48, 126.53, 33.53),
}


def osmium_tool(*args):
    print('osmium', ' '.join(args), flush=True)
    subprocess.run(['osmium', *args, '--overwrite', '--no-progress'], check=True)


def rec_path(theme):
    return os.path.join(CACHE, f'{theme}.rec')


class RecordWriter:
    """Append-only stream of pickled records, one file per theme."""
    def __init__(self, themes):
        self.f = {t: open(rec_path(t) + '.tmp', 'wb') for t in themes}
        self.n = {t: 0 for t in themes}

    def put(self, theme, rec):
        pickle.dump(rec, self.f[theme], protocol=pickle.HIGHEST_PROTOCOL)
        self.n[theme] += 1

    def close(self):
        for t, f in self.f.items():
            f.close()
            os.replace(rec_path(t) + '.tmp', rec_path(t))


def read_records(theme):
    """Stream the records of one theme back, one at a time."""
    with open(rec_path(theme), 'rb') as f:
        while True:
            try:
                yield pickle.load(f)
            except EOFError:
                return


def water_kind(tags):
    if tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank':
        return tags.get('water', 'riverbank' if tags.get('waterway') == 'riverbank' else 'water')
    if tags.get('landuse') in ('reservoir', 'basin'):
        return 'reservoir'
    return None


def cover_kind(tags):
    for k, pairs in COVER.items():
        for key, val in pairs:
            if tags.get(key) == val:
                return k
    return None


def national():
    osmium_tool('tags-filter', PBF, 'nwr/natural', 'nwr/waterway', 'nwr/landuse', 'nwr/water',
                'nwr/aeroway', '-o', THEMES_PBF)
    wkb = osmium.geom.WKBFactory()
    out = RecordWriter(['coast', 'water', 'rivers', 'cover-forest', 'cover-farm', 'cover-urban', 'aerodromes'])
    keys = ('natural', 'landuse', 'waterway', 'water', 'aeroway')
    fp = (osmium.FileProcessor(THEMES_PBF)
          .with_locations(INDEX)
          .with_areas(osmium.filter.KeyFilter(*keys))
          .with_filter(osmium.filter.KeyFilter(*keys)))
    t0 = time.time()
    for o in fp:
        try:
            tags = o.tags
            if o.is_way():
                if tags.get('natural') == 'coastline':
                    out.put('coast', (o.id, [(nd.lon, nd.lat) for nd in o.nodes]))
                elif tags.get('waterway') in ('river', 'canal'):
                    out.put('rivers', (o.id, tags.get('waterway'), tags.get('name:en') or tags.get('name'),
                                       tags.get('width'), wkb.create_linestring(o)))
            elif o.is_area():
                if tags.get('natural') == 'coastline':
                    continue
                wk = water_kind(tags)
                ck = cover_kind(tags) if wk is None else None
                ad = tags.get('aeroway') == 'aerodrome'
                if not (wk or ck or ad):
                    continue
                g = wkb.create_multipolygon(o)
                if wk:
                    out.put('water', (wk, tags.get('name:en') or tags.get('name'), g))
                if ck:
                    out.put(f'cover-{ck}', g)
                if ad:
                    out.put('aerodromes', (tags.get('icao'), tags.get('name:en') or tags.get('name'),
                                           tags.get('ele'), g))
        except (osmium.InvalidLocationError, RuntimeError):
            pass  # broken geometry in OSM: skip it
    out.close()
    print('done in', round(time.time() - t0), 's', out.n)


def buildings():
    """Bin the first node of every building way into the national grid (no lists kept)."""
    osmium_tool('tags-filter', PBF, 'w/building', '-o', BUILDINGS_PBF)
    cnt = np.zeros(NAT['nx'] * NAT['ny'], np.int64)
    buf_lon, buf_lat = np.empty(100000), np.empty(100000)
    k = 0
    total = 0

    def flush(k):
        x, y = to_map(buf_lat[:k], buf_lon[:k])
        i = ((x - NAT['x0']) // NAT['cell']).astype(int)
        j = ((y - NAT['y0']) // NAT['cell']).astype(int)
        ok = (i >= 0) & (i < NAT['nx']) & (j >= 0) & (j < NAT['ny'])
        np.add.at(cnt, j[ok] * NAT['nx'] + i[ok], 1)

    fp = osmium.FileProcessor(BUILDINGS_PBF).with_locations(INDEX).with_filter(osmium.filter.KeyFilter('building'))
    for o in fp:
        if o.is_way() and len(o.nodes):
            try:
                nd = o.nodes[0]
                buf_lon[k], buf_lat[k] = nd.lon, nd.lat
            except osmium.InvalidLocationError:
                continue
            k += 1
            total += 1
            if k == len(buf_lon):
                flush(k)
                k = 0
    flush(k)
    np.save(os.path.join(CACHE, 'nat_bcount.npy'), cnt.reshape(NAT['ny'], NAT['nx']).astype(np.int32))
    print(total, 'buildings binned')


def airports():
    wkb = osmium.geom.WKBFactory()
    out = {k: dict(nodes=[], ways=[], areas=[]) for k in AIRPORT_BOX}
    for icao, (a, b, c, d) in AIRPORT_BOX.items():
        small = os.path.join(CACHE, f'airport-{icao}.osm.pbf')
        osmium_tool('extract', '-b', f'{a},{b},{c},{d}', '-s', 'complete_ways', PBF, '-o', small)
        fp = (osmium.FileProcessor(small)
              .with_locations()
              .with_areas(osmium.filter.KeyFilter('aeroway', 'building'))
              .with_filter(osmium.filter.KeyFilter('aeroway', 'building', 'highway')))
        dst = out[icao]
        for o in fp:
            try:
                if o.is_node():
                    if 'aeroway' in o.tags:
                        dst['nodes'].append((o.id, dict(o.tags), o.location.lon, o.location.lat))
                elif o.is_way():
                    tags = dict(o.tags)
                    if len(o.nodes) >= 2 and ('aeroway' in tags or tags.get('highway') == 'service'):
                        dst['ways'].append((o.id, tags, [(n.lon, n.lat) for n in o.nodes]))
                elif o.is_area():
                    tags = dict(o.tags)
                    if 'building' in tags or tags.get('aeroway') in ('terminal', 'hangar', 'apron', 'aerodrome'):
                        dst['areas'].append((o.orig_id(), o.from_way(), tags, wkb.create_multipolygon(o)))
            except (osmium.InvalidLocationError, RuntimeError):
                pass
        print(icao, {kk: len(vv) for kk, vv in dst.items()})
    with open(os.path.join(CACHE, 'osm_airports.pkl'), 'wb') as f:
        pickle.dump(out, f, protocol=pickle.HIGHEST_PROTOCOL)


if __name__ == '__main__':
    {'national': national, 'airports': airports, 'buildings': buildings}[sys.argv[1]]()
