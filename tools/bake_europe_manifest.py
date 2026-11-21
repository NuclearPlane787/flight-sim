"""v0.7.0: Europe's staged manifest (East Asia's `tilesRegion` format, Europe's lattice) and the
install tree.

  FS_REGION=europe /tmp/flight-sim/venv/bin/python -I tools/bake_europe_manifest.py [--install DIR]

Writes <staging>/manifest.json:
  { "heightScale": 0.25, "lowLand": true,
    "tilesRegion": { "version": 1, "x0": 0, "y0": 0, "heightScale": 0.25, "extent": {...l0...},
                     "sea": {"h": 0, "w": [0, 255], "c": [0, 0, 0, 0]},
                     "levels": [ {l0: id, cell 250, tile 512, border 2, dir terrain/r0/, extent, tiles, covered},
                                 {l1: id, cell 1000, ..., dir terrain/r1/, extent, tiles, covered} ] },
    "airports": [], "patches": [], "coastPatches": [], "airportsRegion": [], "patchesRegion": [],
    "coastPatchesRegion": [] }
`tiles` lists the tiles with files, `covered` every tile of the level's data (a covered tile with no
file is open sea: `sea`), both string-sorted as East Asia's. Europe's sea is exactly 0 m.

With --install DIR it lays out DIR (default /tmp/flight-sim/v070/install/europe) as data/europe/ should
be: manifest.json, terrain/r0/, terrain/r1/, terrain/fine/ (with fine.json), and the region-wide files
present in staging (coast-region.json, urban-region.json, country.json + country.u8.gz, magvar.json +
magvar.i16.gz), and writes DIR/../europe.sha256 (sha256sum format, paths relative to DIR).
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

os.environ['FS_REGION'] = 'europe'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None
try:
    import bake_common as bc
    import bake_region_compose as brc
    import bake_region_height as brh
    import bake_region_l1 as brl
    import bake_region_tiles as rt
finally:
    os.makedirs = _makedirs

REGION_FILES = ['coast-region.json', 'urban-region.json', 'country.json', 'country.u8.gz', 'magvar.json', 'magvar.i16.gz']


def files_in(d, suffix='.h.i16.gz'):
    return sorted(f[:-len(suffix)] for f in os.listdir(d) if f.endswith(suffix)) if os.path.isdir(d) else []


def build():
    st = rt.STAGE
    covered0 = sorted(f'{a}_{b}' for a, b in brh.region_tiles())
    tis = [int(s.split('_')[0]) for s in covered0]
    tjs = [int(s.split('_')[1]) for s in covered0]
    ext0 = dict(i0=min(tis) * 512, j0=min(tjs) * 512, i1=(max(tis) + 1) * 512, j1=(max(tjs) + 1) * 512)
    tiles0 = [t for t in files_in(os.path.join(st, 'l0')) if t in set(covered0)]
    i0, j0, i1, j1 = brl.extent()
    covered1 = [f'{a}_{b}' for a, b in brl.all_tiles()]
    tiles1 = sorted(files_in(os.path.join(st, 'l1')))
    lev0 = dict(id='l0', cell=250, tile=512, border=2, dir='terrain/r0/', extent=ext0, tiles=tiles0, covered=covered0)
    lev1 = dict(id='l1', cell=1000, tile=512, border=2, dir='terrain/r1/', extent=dict(i0=i0, j0=j0, i1=i1, j1=j1),
                tiles=tiles1, covered=sorted(covered1))
    tr = dict(version=1, x0=int(bc.NAT['x0']), y0=int(bc.NAT['y0']), heightScale=0.25, extent=dict(ext0),
              sea=dict(h=int(brc.SEA['h']), w=list(brc.SEA['w']), c=list(brc.SEA['c'])), levels=[lev0, lev1])
    m = dict(heightScale=0.25, lowLand=True, airports=[], patches=[], coastPatches=[], tilesRegion=tr,
             patchesRegion=[], coastPatchesRegion=[], airportsRegion=[])
    with open(os.path.join(st, 'manifest.json'), 'w') as f:
        json.dump(m, f, indent=2)
    print(f'l0: {len(tiles0)} files of {len(covered0)} covered, extent {ext0}')
    print(f'l1: {len(tiles1)} files of {len(covered1)} covered, extent {lev1["extent"]}')
    return m


def install(dest):
    st = rt.STAGE
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    for sub, src in (('terrain/r0', 'l0'), ('terrain/r1', 'l1'), ('terrain/fine', 'fine')):
        d = os.path.join(dest, sub)
        os.makedirs(d, exist_ok=True)
        s = os.path.join(st, src)
        if not os.path.isdir(s):
            continue
        for fn in sorted(os.listdir(s)):
            if fn.endswith('.gz') or fn == 'fine.json':
                shutil.copy2(os.path.join(s, fn), os.path.join(d, fn))
    shutil.copy2(os.path.join(st, 'manifest.json'), os.path.join(dest, 'manifest.json'))
    for fn in REGION_FILES:
        if os.path.exists(os.path.join(st, fn)):
            shutil.copy2(os.path.join(st, fn), os.path.join(dest, fn))
    lines, total, n, big = [], 0, 0, (0, '')
    for root, _, fs in os.walk(dest):
        for fn in sorted(fs):
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, dest)
            h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
            sz = os.path.getsize(p)
            total += sz; n += 1
            big = max(big, (sz, rel))
            lines.append(f'{h}  {rel}')
    out = os.path.join(os.path.dirname(dest.rstrip('/')), 'europe.sha256')
    with open(out, 'w') as f:
        f.write('\n'.join(sorted(lines, key=lambda s: s[66:])) + '\n')
    print(f'install tree {dest}: {n} files, {total / 1e6:.2f} MB; biggest {big[1]} {big[0] / 1e6:.2f} MB; sha256 list {out}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--install', nargs='?', const='/tmp/flight-sim/v070/install/europe', default=None)
    a = ap.parse_args()
    build()
    if a.install:
        install(a.install)


if __name__ == '__main__':
    main()
