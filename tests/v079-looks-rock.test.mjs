// v0.7.9 part 8, item 5 (briefs/V0-7-9.md; tools/v079_rock_ridge.py, data with no switch): the Rock of Gibraltar's ridge
// sharpened [EST] from its published heights (O'Hara's Battery 426 m, Signal Hill 387 m, the north summit 412 m). On the
// installed data/europe/terrain/patch-gibraltar.i16.gz: every cell outside the Rock's box exactly v0.7.8's (by SHA-256 of
// the grid with the box zeroed, taken from v0.7.8's file), the crest at the published heights and the east face steeper
// than the west. (The tool itself refuses to lower a cell or change a sea cell, and leaves every cell under 40 m as it
// was: its asserts.) Skipped while the installed file is still v0.7.8's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inRegion } from './region-run.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = process.env.FS_V079_ROCK || ROOT + 'data/europe/terrain/patch-gibraltar.i16.gz';   // (FS_V079_ROCK: the staged file, before the install)
const V078 = 'e7b79bad9584f9ee94e2e7d2b2f5fad2bd26a5dd84b93a9640170e8e660becf1';
const V078_OUTSIDE = '07b7d9c10101b181cb820c63cf6cbb4e1bb3911292f66285fb402fbbbee01152';
const V079 = 'ce7d250496f6006ab438b2dca1ac4e86ce10173ae03e3833762a74ce74b4db14';
const BOX = [-5.3560, 36.1100, -5.3330, 36.1500];
const PUBLISHED = [[36.1235, 426], [36.1335, 387], [36.1440, 412]];

if (inRegion('europe', import.meta.url)) {
  const raw = existsSync(FILE) ? readFileSync(FILE) : null;
  const sha = raw ? createHash('sha256').update(raw).digest('hex') : '';
  test('v0.7.9 looks, the Rock: the installed patch is v0.7.9\'s sharpened ridge, the rest v0.7.8\'s', { skip: sha === V078 ? 'the installed patch is still v0.7.8\'s (the lead installs v0.7.9\'s)' : !raw }, async () => {
    assert.equal(sha, V079);
    const { toMap } = await import('../src/world/frame.js');
    const man = JSON.parse(readFileSync(ROOT + 'data/europe/manifest.json', 'utf8'));
    const e = man.patchesRegion.find((p) => p.id === 'gibraltar');
    const b = gunzipSync(raw), q = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    assert.equal(q.length, e.nx * e.ny);
    const cs = [[BOX[1], BOX[0]], [BOX[1], BOX[2]], [BOX[3], BOX[0]], [BOX[3], BOX[2]]].map(([la, lo]) => toMap(la, lo));
    const i0 = Math.floor((Math.min(...cs.map((c) => c[0])) - e.x0) / e.cell), i1 = Math.floor((Math.max(...cs.map((c) => c[0])) - e.x0) / e.cell);
    const j0 = Math.floor((Math.min(...cs.map((c) => c[1])) - e.y0) / e.cell), j1 = Math.floor((Math.max(...cs.map((c) => c[1])) - e.y0) / e.cell);
    const out = Int16Array.from(q);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out[j * e.nx + i] = 0;
    assert.equal(createHash('sha256').update(Buffer.from(out.buffer)).digest('hex'), V078_OUTSIDE, 'every cell outside the Rock\'s box is v0.7.8\'s');
    const at = (i, j) => q[j * e.nx + i] * 0.25;
    for (const [lat, hp] of PUBLISHED) {
      const j = Math.floor((toMap(lat, -5.344)[1] - e.y0) / e.cell);
      let top = -1, ic = -1;
      for (let i = i0; i <= i1; i++) if (at(i, j) > top) { top = at(i, j); ic = i; }
      assert.ok(Math.abs(top - hp) < 1.5, `the crest at ${lat} N: ${top} m against ${hp}`);
      // the east face steeper than the west over the first 90 m
      const east = top - at(ic + 3, j), west = top - at(ic - 3, j);
      assert.ok(east > west, `at ${lat} N the east face falls ${east.toFixed(0)} m in 90 m, the west ${west.toFixed(0)}`);
      assert.ok(east > 100, `at ${lat} N the east face falls ${east.toFixed(0)} m in 90 m`);
    }
  });
}
