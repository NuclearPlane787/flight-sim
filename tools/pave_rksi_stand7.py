"""v0.7.8 (briefs/V0-7-8.md part 6, item 4; ROADMAP "Found while building v0.7.4"): pave Incheon's stand 7 pushback.

The airports' check failed "pushback on pavement" at RKSI's stand 7 (161 of 342 samples off by up to 25.3 m, about
-92,245, 161,443): OSM maps no apron over the wedge between the stand and the taxi line its lead-in curves onto. This
adds one apron polygon to data/airports/RKSI.json: the stand's lead-in buffered APRON_PUSH_HALF m (the half width
bake_region_airports.py's APRON_PUSH uses for Munich and Kunsan), closed by +-15 m as that bake closes its pieces, less
the mapped aprons and each runway's 30 m margin. Nothing else in the file changes; it is written in the same compact form.

Why not a bake: RKSI.json comes from tools/bake_airports.py, Korea's v0.1.0 tool, which writes data/airports and the
manifest directly with no staging folder and reads a cache that is no longer kept; bake_region_airports.py doesn't take
RKSI. So this edits the shipped file's aprons alone.

  python3 tools/pave_rksi_stand7.py <in RKSI.json> <out RKSI.json>     (needs shapely: /tmp/flight-sim/venv/bin/python -I)
It refuses an input that already holds the piece (the failing point already paved), or one that doesn't round-trip.
"""
import json
import os
import sys

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

APRON_PUSH_HALF = 27.0
FAIL_POINT = (-92245.0, 161443.0)    # the check's worst sample, off the mapped pavement before


def pave(src_path, dst_path):
    raw = open(src_path).read()
    d = json.loads(raw)
    if json.dumps(d, separators=(',', ':')) != raw:
        sys.exit('pave_rksi_stand7: the input does not round-trip byte for byte: not RKSI.json as the bake writes it')
    if d.get('icao') != 'RKSI':
        sys.exit('pave_rksi_stand7: not RKSI.json')
    mapped = unary_union([Polygon(a['points']).buffer(0) for a in d['aprons']])
    if mapped.contains(Point(*FAIL_POINT)):
        sys.exit('pave_rksi_stand7: stand 7\'s pushback is already paved (the piece was added before): nothing written')
    st = next(s for s in d['stands'] if s['ref'] == '7')
    piece = LineString(st['leadIn']).buffer(APRON_PUSH_HALF, cap_style='flat').buffer(15).buffer(-15)
    rw = unary_union([LineString([r['ends'][0]['pavementEnd'], r['ends'][1]['pavementEnd']]).buffer(r['widthM'] / 2 + 30)
                      for r in d['runways']])
    piece = piece.difference(mapped.buffer(-0.5)).difference(rw)
    added = []
    for p in [g for g in getattr(piece, 'geoms', [piece]) if g.area > 20]:
        pts = [[round(x, 1), round(y, 1)] for x, y in list(p.exterior.coords)[:-1]]
        d['aprons'].append({'points': pts})
        added.append((round(p.area), len(pts)))
    with open(dst_path + '.tmp', 'w') as f:
        f.write(json.dumps(d, separators=(',', ':')))
    os.replace(dst_path + '.tmp', dst_path)
    print('pave_rksi_stand7: added aprons (m2, points):', added)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    pave(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]))
