"""The path map's terminal labels (v0.7.4, Shane's item 1: "if you zoom into an airport, you can only see the runways.
But let's also have the shape of the terminals be visible, preferably with their terminal numbers marked.").

The shapes are the airport files' own `buildings` of kind 'terminal' (the map draws them all); this writes only the
labels, one small JSON a region, keyed by ICAO, each label with a point inside its building:
  data/terminal-labels.json, data/europe/terminal-labels.json   {v, source, airports: {ICAO: [{label, x, y}]}}

Rules (briefs/V0-7-4.md, part 3, item 1): passenger terminals only, by the numbers each airport signs them by (T1,
T2...); letter halls only where passengers use the letters as terminals (Charles de Gaulle's 2A to 2G); concourses,
satellites and piers drawn but not labelled; an airport with one passenger terminal gets no label. A terminal closed to
passengers (Heathrow's T1, Fiumicino's T5) gets none.

Each entry below is (label, x, y): a point in map metres inside the building meant (East Asia's found by the files'
OSM names; Europe's files carry no names, so by the names in the OSM extracts the bake cut, matched to the buildings by
position: /tmp/flight-sim/v074/map/match_terms.py in v0.7.4's run). The label is written at the pole of inaccessibility
of the terminal building holding that point, so a re-bake that keeps the building keeps the label inside it. `[EST]`
marks a reading of mine where the names alone don't settle it.

Run (from GameDump; seconds):
  /tmp/flight-sim/venv/bin/python -I games/flight-sim/tools/bake_terminal_labels.py
"""
import json
import os

from shapely.geometry import Point, Polygon
from shapely.ops import polylabel

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'data')

EAST_ASIA = {
    'RKSI': [('T1', -92686, 161243), ('T2', -94186, 163309)],                 # the Concourse (Starfield) unlabelled
    'RKSS': [('Domestic', -61538, 173049), ('International', -61734, 173894)],
    'RJTT': [('T1', 1109777, 19385), ('T2', 1110183, 19659), ('T3', 1108609, 18713)],
    'RJAA': [('T1', 1160821, 49669), ('T2', 1160998, 50804), ('T3', 1160568, 51473)],   # the satellites unlabelled
    'RJBB': [('T1', 710496, -145629), ('T2', 709432, -145226)],
    'RJCC': [('Domestic', 1164892, 838927), ('International', 1164503, 838760)],
    'RJFF': [('Domestic', 273444, -262162), ('International', 273176, -263639)],
    'ZSPD': [('T1', -544365, -522034), ('T2', -543754, -521772)],             # S1 and S2 unlabelled
    'ZSSS': [('T1', -587639, -514443), ('T2', -589435, -514283)],
    'ZBAA': [('T2', -930936, 504384), ('T3', -929463, 501788)],               # T3's D and E halls unlabelled
    'ZKPY': [('T1', -157733, 356792), ('T2', -157687, 356682)],               # [EST] the file's "Terminal 3" left out
    # v0.7.5: Centrair's two. [EST] T2: OSM names the southern building "1st Passenger Terminal" too; its place (south of
    # T1, joined by the walkway) and its footprint (27,900 m2) are the second terminal's. Itami's one building (its north
    # and south wings), Cheongju's, Hiroshima's, Komatsu's and Kunsan's one terminal each: no label.
    'RJGG': [('T1', 849746, -86322), ('T2', 849934, -86821)],
}
EUROPE = {
    'EGLL': [('T2', -307493, 502130), ('T3', -308166, 502368), ('T4', -307376, 501095), ('T5', -310122, 502556)],  # T1 closed (2015); 5B, 5C unlabelled
    'LFPG': [('T1', -105836, 223121), ('2A', -104377, 221789), ('2B', -104385, 221991), ('2C', -104028, 221804),
             ('2D', -104033, 222020), ('2E', -103334, 221787), ('2F', -103164, 222131), ('2G', -101578, 221998),
             ('T3', -104602, 222904)],                                         # 2E's L and M halls and T1's satellites unlabelled
    'EDDF': [('T1', 325135, 345777), ('T3', 325800, 343705)],                 # T2 is not among the file's terminal shapes
    'EDDM': [('T1', 571298, 177510), ('T2', 571793, 177625)],                 # the T2 satellite unlabelled
    'EDDB': [('T1', 643924, 631457), ('T2', 643943, 631838)],
    'EDDH': [('T1', 396535, 748593), ('T2', 396564, 748386)],
    'EDDK': [('T1', 218446, 432402), ('T2', 218182, 432636)],
    'EGCC': [('T1', -416625, 719944), ('T2', -416958, 720494), ('T3', -416398, 719751)],
    'EGKK': [('North', -290592, 466863), ('South', -289545, 466453)],
    'EIDW': [('T1', -678374, 754883), ('T2', -678001, 754464)],
    'EKCH': [('T2', 545903, 986003), ('T3', 546130, 986030)],
    'LEMD': [('T1', -639268, -690668), ('T2', -639046, -690095), ('T3', -639177, -689674), ('T4', -640749, -687372),
             ('T4S', -638615, -687220)],                                       # T4S signed as its own terminal
    'LFLL': [('T1', 83366, -140615), ('T2', 83416, -140221)],                 # [EST] T3 left out (closed to scheduled flights)
    'LFML': [('T1', 98186, -391518), ('T2', 97878, -391417)],
    'LFMN': [('T1', 257254, -362389), ('T2', 256629, -363046)],
    'LFPO': [('Orly 1-2', -119768, 191879), ('Orly 3', -119546, 191655), ('Orly 4', -118883, 191832)],
    'LIMC': [('T1', 364237, -140329), ('T2', 364895, -138158)],
    'LIRF': [('T1', 681428, -538302), ('T3', 681062, -538309)],               # T5 closed to passengers
    'LKPR': [('T1', 727474, 390361), ('T2', 727436, 390068)],                 # [EST] T1 the building between piers A and B
    'LOWW': [('T1', 923525, 197387), ('T1A', 923584, 197391), ('T2', 923591, 197307), ('T3', 923745, 197255)],
    'LPPT': [('T1', -1136392, -813910), ('T2', -1137067, -814756)],
    'LSGG': [('T1', 161157, -82660), ('T2', 160770, -82908)],
}


def polys_of(apt):
    out = []
    for b in apt.get('buildings', []):
        if b.get('kind') != 'terminal':
            continue
        p = Polygon(b['points'])
        if not p.is_valid:
            p = p.buffer(0)
        out.append(p)
    return out


def bake(table, folder):
    res = {}
    for icao, labels in sorted(table.items()):
        path = os.path.join(folder, 'airports', f'{icao}.json')
        if not os.path.exists(path):
            print(f'{icao}: no airport file, skipped')
            continue
        with open(path) as f:
            polys = polys_of(json.load(f))
        out = []
        for label, x, y in labels:
            hit = [p for p in polys if p.buffer(1).contains(Point(x, y))]
            if not hit:
                print(f'{icao} {label}: no terminal building at ({x}, {y}); left out')
                continue
            p = max(hit, key=lambda q: q.area)
            if p.geom_type != 'Polygon':
                p = max(p.geoms, key=lambda q: q.area)
            c = polylabel(p, 2.0)
            out.append(dict(label=label, x=round(c.x, 1), y=round(c.y, 1)))
        res[icao] = out
        print(f'{icao}: ' + ', '.join(q['label'] for q in out))
    doc = dict(v=1, source='the airport files\' terminal buildings; labels by the OSM names in the files and the extracts '
               '(tools/bake_terminal_labels.py)', airports=res)
    out = os.path.join(folder, 'terminal-labels.json')
    with open(out, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    print(f'{out}: {os.path.getsize(out)} bytes')


if __name__ == '__main__':
    bake(EAST_ASIA, DATA)
    bake(EUROPE, os.path.join(DATA, 'europe'))
