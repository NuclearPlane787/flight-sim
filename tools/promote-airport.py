#!/usr/bin/env python3
"""Move airports that passed their check (tools/check-airport.sh) from a region's pending lists to its listed
ones, in that region's manifest (data/manifest.json for East Asia, data/europe/manifest.json for Europe).

  tools/promote-airport.py <region> ICAO[:patch-id[,patch-id]] ...
  tools/promote-airport.py europe EGLL:heathrow LFPG:charles-de-gaulle

A coast patch pending under the ICAO's id moves with it. Only those entries move; the rest of the manifest is
written back as it was read. Then add the airport to src/world/regions.js's AIRPORT_INDEX if it isn't there, and
run the unit suite (the tests that count airports)."""
import json
import os
import sys

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDERS = {'east-asia': 'data', 'europe': os.path.join('data', 'europe')}


def main(argv):
    if len(argv) < 2 or argv[0] not in FOLDERS:
        sys.exit(__doc__)
    path = os.path.join(GAME, FOLDERS[argv[0]], 'manifest.json')
    src = open(path).read()
    m = json.loads(src)
    for k in ('airportsRegion', 'patchesRegion', 'coastPatchesRegion'):
        m.setdefault(k, [])
    for arg in argv[1:]:
        icao, _, pids = arg.partition(':')
        f = f'airports/{icao}.json'
        assert f in m.get('airportsPending', []), f'{icao} is not pending in {path}'
        m['airportsPending'].remove(f)
        m['airportsRegion'].append(f)
        moved = []
        for pid in [p for p in pids.split(',') if p]:
            e = [p for p in m.get('patchesPending', []) if p['id'] == pid]
            assert len(e) == 1, f'patch {pid} is not pending'
            m['patchesPending'].remove(e[0])
            m['patchesRegion'].append(e[0])
            moved.append(pid)
        coasts = [p for p in m.get('coastPatchesPending', []) if p['id'] == icao]
        for x in coasts:
            m['coastPatchesPending'].remove(x)
            m['coastPatchesRegion'].append(x)
        print('promoted', icao, moved, [x['id'] for x in coasts])
    for k in ('airportsPending', 'patchesPending', 'coastPatchesPending'):
        if k in m and not m[k]:
            del m[k]
    indent = 2 if src.startswith('{\n  "') else 1 if src.startswith('{\n "') else None
    out = json.dumps(m, indent=indent) if indent else json.dumps(m, separators=(',', ':'))
    out += '\n' if src.endswith('\n') else ''
    with open(path + '.tmp', 'w') as fh:
        fh.write(out)
    os.replace(path + '.tmp', path)
    print('listed', len(m['airportsRegion']), 'airports,', len(m['patchesRegion']), 'patches,', len(m['coastPatchesRegion']), 'coasts; pending left',
          m.get('airportsPending'), [p['id'] for p in m.get('patchesPending', [])])


if __name__ == '__main__':
    main(sys.argv[1:])
