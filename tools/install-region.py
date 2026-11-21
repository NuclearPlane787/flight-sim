#!/usr/bin/env python3
"""Install a region's staged bake into its data folder, after review (briefs/V0-7-0.md: "installed into
data/europe/ by a script after review").

  tools/install-region.py <region> <install tree> <sha256 list> [--dry-run]
  tools/install-region.py europe /tmp/flight-sim/v070/install/europe /tmp/flight-sim/v070/install/europe.sha256

The install tree mirrors the data folder (tools/bake_europe_manifest.py lays it out); the list is `shasum -a 256`
lines with paths relative to the tree. Every source is checked against the list before anything is copied, and
every copy after. The tree's manifest.json is not copied over the folder's: only its terrain keys (`tilesRegion`,
`heightScale`, `lowLand`) are merged in, so the airports' and patches' lists already there (listed and pending)
stay as they are. A file already in the folder with other bytes is replaced and named in the output."""
import hashlib
import json
import os
import shutil
import sys

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDERS = {'east-asia': 'data', 'europe': os.path.join('data', 'europe')}
MERGE = ('heightScale', 'lowLand', 'tilesRegion')


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main(argv):
    dry = '--dry-run' in argv
    argv = [a for a in argv if a != '--dry-run']
    if len(argv) != 3 or argv[0] not in FOLDERS:
        sys.exit(__doc__)
    dest, tree, listing = os.path.join(GAME, FOLDERS[argv[0]]), argv[1], argv[2]
    rows = []
    for line in open(listing):
        line = line.rstrip('\n')
        if line:
            digest, rel = line.split('  ', 1)
            rows.append((digest, rel[2:] if rel.startswith('./') else rel))
    bad = [rel for digest, rel in rows if not os.path.isfile(os.path.join(tree, rel)) or sha(os.path.join(tree, rel)) != digest]
    if bad:
        sys.exit(f'{len(bad)} staged file(s) missing or changed since the list was made (nothing copied): {bad[:5]}')
    files = [(d, r) for d, r in rows if r != 'manifest.json']
    new = [r for d, r in files if not os.path.exists(os.path.join(dest, r))]
    same = [r for d, r in files if os.path.exists(os.path.join(dest, r)) and sha(os.path.join(dest, r)) == d]
    replaced = [r for d, r in files if r not in set(new) and r not in set(same)]
    size = sum(os.path.getsize(os.path.join(tree, r)) for d, r in files)
    print(f'{len(rows)} staged files checked against the list; {len(files)} to install ({size / 1e6:.1f} MB): '
          f'{len(new)} new, {len(same)} already there with the same bytes, {len(replaced)} replaced {replaced[:8]}')
    if dry:
        print('dry run: nothing copied')
        return
    for digest, rel in files:
        out = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        shutil.copyfile(os.path.join(tree, rel), out + '.tmp')
        os.replace(out + '.tmp', out)
        if sha(out) != digest:
            sys.exit(f'copy mismatch: {rel}')
    mpath = os.path.join(dest, 'manifest.json')
    staged = json.load(open(os.path.join(tree, 'manifest.json')))
    cur = json.load(open(mpath)) if os.path.exists(mpath) else {}
    for k in MERGE:
        if k in staged:
            cur[k] = staged[k]
    for k in ('airports', 'patches', 'coastPatches', 'patchesRegion', 'coastPatchesRegion', 'airportsRegion'):
        cur.setdefault(k, [])
    with open(mpath + '.tmp', 'w') as fh:
        fh.write(json.dumps(cur, indent=2) + '\n')
    os.replace(mpath + '.tmp', mpath)
    t = cur.get('tilesRegion', {})
    print(f'installed into {os.path.relpath(dest, GAME)}; manifest: ' + ', '.join(
        f"{L['id']} {len(L.get('tiles', []))} tiles ({len(L.get('covered', []))} covered)" for L in t.get('levels', [])) +
        f"; airports listed {len(cur['airports']) + len(cur['airportsRegion'])}, pending {len(cur.get('airportsPending', []))}")


if __name__ == '__main__':
    main(sys.argv[1:])
