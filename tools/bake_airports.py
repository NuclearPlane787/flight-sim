"""Step 3: the three airports as JSON (data/airports/<ICAO>.json), in map metres.

Sources: OSM (cached by bake_osm_extract.py: runways, taxiways, aprons, stands, gates,
holding positions, buildings, service roads) and OurAirports (runway elevations,
displaced thresholds, cross-check of headings and positions; OSM geometry wins).

Runway ends:
- `x, y, lat, lon` are the landing threshold (the pavement end moved in by the displaced
  threshold); `pavementEnd: [x, y]` is the physical end of the runway way in OSM.
- `hdgTrueDeg` is the true course from this end towards the other one, `hdgGridDeg =
  hdgTrueDeg - convergence`. `hdgMagDeg` (extra) = true - magVar, checked against the ident.
- From the Korean eAIP (AMDT 11/26, via reference/notes/airports.md): `papi` ("left", or
  "both" for Jeju 31), `papiDeg`, `approachLights` (ALSF-II, ALSF-I, SSALF or null) and
  `approachLightsM`, `ils` (category), `tdzLights`, `centrelineLights`, the width, the
  displaced threshold (only Jeju 31, 411 m) and each threshold's `elevM`.
- Jeju 13 is helicopter-only for landing in the AIP; fixed-wing aircraft land on 31.
Stands: OSM aeroway=parking_position (nodes or lead-in ways). A way's stop point is the
end farther from the nearest taxiway, and its heading runs along the way towards it. A
node's heading points away from the nearest taxiway point (nose in). `gate` is true when
a jet bridge or an aeroway=gate lies within 45 m. `ref` is the stand number (OSM gate
numbers differ from stand numbers at Jeju; the stand number is used).
"""
import csv
import json
import os
import pickle
import sys

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import CACHE, DATA, RAW, convergence_deg, mag_var, progress, to_geo, to_map, update_manifest
from bake_geom import aerodromes

ICAOS = ['RKSS', 'RKPC', 'RKSI']

# Per runway end, from the Korean eAIP, AIRAC 15 OCT 2026 (AIP AMDT 11/26), AD 2.12-2.14,
# as collected in reference/notes/airports.md: approach lights (type, length m), PAPI
# (side, angle), ILS category, threshold elevation (m), touchdown-zone and centreline lights,
# runway width (m) and displaced threshold (m).
#        ident: (ALS, ALS m, PAPI side, PAPI deg, ILS, THR elev, TDZ lts, CL lts, width, displaced)
AIP = {
    'RKSS': {'14L': ('ALSF-II', 900, 'left', 3.0, 'I', 11.6, True, False, 45, 0),
             '32R': ('ALSF-II', 900, 'left', 3.0, 'I', 12.8, True, False, 45, 0),
             '14R': ('ALSF-II', 900, 'left', 3.0, 'II/III', 10.4, True, True, 60, 0),
             '32L': ('ALSF-I', 750, 'left', 3.0, 'I', 12.6, False, True, 60, 0)},
    'RKPC': {'07': ('ALSF-II', 900, 'left', 3.0, 'II', 26.6, True, True, 45, 0),
             '25': ('SSALF', 420, 'left', 3.0, 'I', 23.3, False, True, 45, 0),
             '13': (None, 0, None, None, None, 20.0, False, False, 45, 0),
             '31': ('SSALF', 450, 'both', 3.5, None, 32.0, False, False, 45, 411)},
    'RKSI': {e: ('ALSF-II', 900, 'left', 3.0, 'III', 7.0 if e[:2] in ('16', '34') else 6.9, True, True, 60, 0)
             for e in ('15L', '33R', '15R', '33L', '16L', '34R', '16R', '34L')},
}
FT = 0.3048


def r1(v):
    return round(float(v), 1)


def load_ourairports():
    ap, rw = {}, {}
    with open(os.path.join(RAW, 'ourairports', 'airports.csv'), newline='') as f:
        for row in csv.DictReader(f):
            if row['ident'] in ICAOS:
                ap[row['ident']] = row
    with open(os.path.join(RAW, 'ourairports', 'runways.csv'), newline='') as f:
        for row in csv.DictReader(f):
            if row['airport_ident'] in ICAOS:
                for side in ('le', 'he'):
                    rw[(row['airport_ident'], row[f'{side}_ident'])] = dict(
                        lat=row[f'{side}_latitude_deg'], lon=row[f'{side}_longitude_deg'],
                        elev=row[f'{side}_elevation_ft'], disp=row[f'{side}_displaced_threshold_ft'],
                        hdg=row[f'{side}_heading_degT'], width=row['width_ft'], length=row['length_ft'],
                        surface=row['surface'])
    return ap, rw


def to_xy(lonlat):
    a = np.asarray(lonlat, np.float64)
    x, y = to_map(a[:, 1], a[:, 0])
    return np.stack([x, y], 1)


def pts(xy):
    return [[r1(x), r1(y)] for x, y in xy]


def bearing_true(x0, y0, x1, y1):
    """True course (deg) at (x0, y0) towards (x1, y1), via the grid course + convergence."""
    grid = np.degrees(np.arctan2(x1 - x0, y1 - y0))
    lat, lon = to_geo(x0, y0)
    return (grid + convergence_deg(lon)) % 360, grid % 360


def num(s, default=None):
    try:
        return float(str(s).split()[0].replace('m', ''))
    except (ValueError, IndexError, TypeError):
        return default


def building_height(tags, kind):
    h = num(tags.get('height'))
    if h:
        return h
    lv = num(tags.get('building:levels'))
    if lv:
        return lv * 4.0
    return {'terminal': 25.0, 'hangar': 20.0}.get(kind, 10.0)


def main():
    with open(os.path.join(CACHE, 'osm_airports.pkl'), 'rb') as f:
        osm = pickle.load(f)
    oa_ap, oa_rw = load_ourairports()
    aero = aerodromes()
    table = []
    for icao in ICAOS:
        d = osm[icao]
        poly, elev_osm = aero[icao]
        area = poly.buffer(30)
        oa = oa_ap[icao]
        elev = float(oa['elevation_ft']) * FT
        lat, lon = float(oa['latitude_deg']), float(oa['longitude_deg'])
        ox, oy = to_map(lat, lon)

        # ---- runways
        runways = []
        for _, tags, coords in d['ways']:
            if tags.get('aeroway') != 'runway':
                continue
            xy = to_xy(coords)
            a, b = xy[0], xy[-1]
            ref = tags.get('ref', '').replace('-', '/')
            ids = ref.split('/')
            t_ab, g_ab = bearing_true(a[0], a[1], b[0], b[1])
            # which ident belongs to end a? its runway number ~ magnetic course a->b
            lat_a, lon_a = to_geo(a[0], a[1])
            mag_ab = (t_ab - mag_var(lat_a, lon_a)) % 360
            n0 = num(ids[0].rstrip('LRC'))
            diff = abs(((n0 * 10 - mag_ab) + 180) % 360 - 180)
            if diff > 90:
                a, b = b, a
            length = float(np.hypot(*(b - a)))
            width = num(tags.get('width'))
            ends = []
            for ident, p, q in ((ids[0], a, b), (ids[1], b, a)):
                o = oa_rw.get((icao, ident), {})
                aip = AIP[icao][ident]
                disp = float(aip[9])          # eAIP (OurAirports agrees: only Jeju 31, 411 m)
                u = (q - p) / np.hypot(*(q - p))
                th = p + u * disp
                tlat, tlon = to_geo(th[0], th[1])
                hdg_t, hdg_g = bearing_true(th[0], th[1], q[0], q[1])
                hdg_m = (hdg_t - mag_var(tlat, tlon)) % 360
                e_elev = aip[5]               # eAIP threshold elevation
                # OurAirports' own end position, for the cross-check
                oa_off = None
                if o.get('lat'):
                    exy = np.array(to_map(float(o['lat']), float(o['lon'])))
                    oa_off = float(np.hypot(*(exy - p)))
                ends.append(dict(ident=ident, lat=round(float(tlat), 7), lon=round(float(tlon), 7),
                                 x=r1(th[0]), y=r1(th[1]), elevM=round(e_elev, 1), displacedM=round(disp, 1),
                                 hdgTrueDeg=round(float(hdg_t), 2), hdgGridDeg=round(float(hdg_g), 2),
                                 hdgMagDeg=round(float(hdg_m), 2), pavementEnd=[r1(p[0]), r1(p[1])],
                                 papi=aip[2], papiDeg=aip[3], approachLights=aip[0],
                                 approachLightsM=aip[1], ils=aip[4], tdzLights=aip[6],
                                 centrelineLights=aip[7]))
                table.append((icao, ident, hdg_t, hdg_g, hdg_m, length, width, e_elev, disp,
                              float(o.get('hdg') or 'nan'), oa_off))
            o = oa_rw.get((icao, ids[0]), {})
            runways.append(dict(id=f'{ids[0]}/{ids[1]}', widthM=float(AIP[icao][ids[0]][8]),
                                lengthM=round(length, 1), surface=tags.get('surface', 'asphalt'), ends=ends))

        # ---- taxiways
        taxiways = []
        for _, tags, coords in d['ways']:
            if tags.get('aeroway') in ('taxiway', 'taxilane'):
                xy = to_xy(coords)
                if not LineString(xy).intersects(area):
                    continue
                w = num(tags.get('width'), 23.0 if tags.get('aeroway') == 'taxiway' else 15.0)
                taxiways.append(dict(ref=tags.get('ref', ''), kind=tags['aeroway'], widthM=w, points=pts(xy)))
        twy_lines = shapely.MultiLineString([t['points'] for t in taxiways if t['kind'] == 'taxiway'] or
                                            [t['points'] for t in taxiways])

        # ---- aprons
        aprons = []
        for _, _, tags, g in d['areas']:
            if tags.get('aeroway') == 'apron':
                for p in shapely.get_parts(shapely.from_wkb(g)):
                    aprons.append(dict(points=pts(to_xy(p.exterior.coords))))
        for _, tags, coords in d['ways']:
            if tags.get('aeroway') == 'apron' and coords[0] == coords[-1]:
                aprons.append(dict(points=pts(to_xy(coords))))

        # ---- stands
        bridges = [LineString(to_xy(c)) for _, t, c in d['ways'] if t.get('aeroway') == 'jet_bridge']
        gate_nodes = [Point(to_map(la, lo)) for _, t, lo, la in d['nodes'] if t.get('aeroway') == 'gate']
        near_gate = lambda p: any(b.distance(p) < 45 for b in bridges) or any(g.distance(p) < 45 for g in gate_nodes)
        stands = []
        seen = set()
        for _, tags, coords in d['ways']:
            if tags.get('aeroway') != 'parking_position':
                continue
            xy = to_xy(coords)
            a, b = xy[0], xy[-1]
            if twy_lines.distance(Point(a)) > twy_lines.distance(Point(b)):
                a, b = b, a           # b = the stop point, farthest from the taxiway
            if np.hypot(*(b - a)) < 1:
                continue
            hdg_g = float(np.degrees(np.arctan2(b[0] - a[0], b[1] - a[1])) % 360)
            ref = tags.get('ref', '')
            stands.append(dict(ref=ref, x=r1(b[0]), y=r1(b[1]), hdgGridDeg=round(hdg_g, 1),
                               gate=bool(near_gate(Point(b))), leadIn=pts(xy)))
            seen.add(ref)
        for _, tags, lo, la in d['nodes']:
            if tags.get('aeroway') != 'parking_position':
                continue
            ref = tags.get('ref', '')
            if ref and ref in seen:
                continue
            x, y = to_map(la, lo)
            p = Point(x, y)
            if not p.within(area):
                continue
            q = shapely.ops.nearest_points(twy_lines, p)[0]
            hdg_g = float(np.degrees(np.arctan2(x - q.x, y - q.y)) % 360)
            stands.append(dict(ref=ref, x=r1(x), y=r1(y), hdgGridDeg=round(hdg_g, 1), gate=bool(near_gate(p))))

        # Merge stands whose stop points are within 15 m (duplicate lead-in lines).
        merged = []
        for st in stands:
            if any(np.hypot(st['x'] - m['x'], st['y'] - m['y']) < 15 for m in merged):
                continue
            merged.append(st)
        stands = merged
        # Stands without numbers (Jeju): take the nearest gate's number within 80 m
        # (OSM's gate refs), else number them R1, R2, ... from west to east.
        gate_refs = [(Point(to_map(la, lo)), t.get('ref', '')) for _, t, lo, la in d['nodes']
                     if t.get('aeroway') == 'gate' and t.get('ref')]
        unnamed = [st for st in stands if not st['ref']]
        if unnamed:
            used = set()
            for st in unnamed:
                p = Point(st['x'], st['y'])
                cands = sorted((g.distance(p), r) for g, r in gate_refs if r not in used)
                if cands and cands[0][0] < 80:
                    st['ref'] = cands[0][1]
                    used.add(cands[0][1])
                    st['gate'] = True
            k = 1
            for st in sorted((s for s in unnamed if not s['ref']), key=lambda s: s['x']):
                st['ref'] = f'R{k}'
                k += 1
            print(f'{icao}: {len(unnamed)} stands had no number: {len(used)} took a gate number, the rest R1..')

        # No apron polygons in OSM (Jeju): make one around the stands, marked synthetic.
        if not aprons and stands:
            blob = shapely.unary_union([Point(s['x'], s['y']).buffer(40) for s in stands] +
                                       [LineString(s['leadIn']).buffer(25) for s in stands if 'leadIn' in s])
            blob = blob.buffer(15).buffer(-15)
            for p in shapely.get_parts(blob):
                if p.area > 5000:
                    aprons.append(dict(points=pts(np.asarray(p.simplify(3).exterior.coords)), synthetic=True))

        # ---- holding positions
        holds = []
        for _, tags, lo, la in d['nodes']:
            if tags.get('aeroway') == 'holding_position':
                x, y = to_map(la, lo)
                holds.append(dict(ref=tags.get('ref', ''), x=r1(x), y=r1(y)))
        for _, tags, coords in d['ways']:
            if tags.get('aeroway') == 'holding_position':
                xy = to_xy(coords).mean(0)
                holds.append(dict(ref=tags.get('ref', ''), x=r1(xy[0]), y=r1(xy[1])))

        # ---- buildings (inside the aerodrome)
        buildings = []
        for _, _, tags, g in d['areas']:
            kind = tags.get('aeroway') if tags.get('aeroway') in ('terminal', 'hangar') else (
                'hangar' if tags.get('building') == 'hangar' else
                'terminal' if tags.get('building') in ('terminal', 'transportation') else
                'building' if 'building' in tags else None)
            if not kind:
                continue
            geom = shapely.from_wkb(g)
            for p in shapely.get_parts(geom):
                xy = to_xy(p.exterior.coords)
                pp = Polygon(xy)
                if not pp.centroid.within(area) or pp.area < 30:
                    continue
                buildings.append(dict(kind=kind, heightM=round(building_height(tags, kind), 1),
                                      name=tags.get('name:en') or tags.get('name') or '', points=pts(xy)))

        # ---- service roads
        roads = []
        for _, tags, coords in d['ways']:
            if tags.get('highway') == 'service':
                xy = to_xy(coords)
                ln = LineString(xy)
                if ln.intersects(area):
                    c = ln.intersection(area)
                    for part in shapely.get_parts(c):
                        if part.geom_type == 'LineString' and part.length > 20:
                            roads.append(dict(points=pts(part.coords)))

        out = dict(icao=icao, name=oa['name'], lat=lat, lon=lon, elevM=round(elev, 1),
                   origin=[r1(ox), r1(oy)], magVarDeg=round(float(mag_var(lat, lon)), 2),
                   boundary=pts(poly.exterior.coords) if poly.geom_type == 'Polygon' else
                   pts(max(poly.geoms, key=lambda g: g.area).exterior.coords),
                   runways=runways, taxiways=taxiways, aprons=aprons, stands=stands,
                   holdingPositions=holds, buildings=buildings, serviceRoads=roads)
        path = os.path.join(DATA, 'airports', f'{icao}.json')
        with open(path + '.tmp', 'w') as f:
            json.dump(out, f, separators=(',', ':'))
        os.replace(path + '.tmp', path)
        print(f'{icao}: {len(runways)} runways, {len(taxiways)} taxiways ({sum(1 for t in taxiways if t["ref"])} with ref), '
              f'{len(aprons)} aprons, {len(stands)} stands ({sum(s["gate"] for s in stands)} gates, '
              f'{sum(1 for s in stands if s["ref"])} with ref), {len(holds)} holds, {len(buildings)} buildings, '
              f'{len(roads)} service roads; {os.path.getsize(path)} bytes')

    print('\nident    true    grid     mag   ident-mag  length  width  thr elev  displ  OA hdgT  OA end off')
    for icao, ident, t, g, m, ln, w, e, disp, oah, off in table:
        dev = ((num(ident.rstrip('LRC')) * 10 - m) + 180) % 360 - 180
        flag = '' if abs(dev) <= 5 else '  <-- check'
        print(f'{icao} {ident:4s} {t:6.1f} {g:7.1f} {m:7.1f} {dev:+7.1f} {ln:8.0f} {w or 0:6.0f} {e:8.1f} {disp:6.0f} '
              f'{oah:7.1f} {off if off is not None else float("nan"):9.0f}{flag}')
    update_manifest(airports=[f'airports/{i}.json' for i in ICAOS])
    progress('- step 3: data/airports/RKSS.json, RKPC.json, RKSI.json written (runways with thresholds, '
             'headings, elevations; taxiways, aprons, stands, holds, buildings, service roads). '
             'Runway end x/y = landing threshold; pavementEnd = physical end.')


if __name__ == '__main__':
    main()
