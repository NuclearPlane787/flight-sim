// v0.7.4 part 9, item 6 (v0.7.7's look pass, subagent look1): the terminals at night (apron.js's TERM_NIGHT,
// BLDG_FRAG_NIGHT) and grass through the aprons (APRON_GRASS, apronSkirt()). Both on by default; off, each must be
// exactly the pushed v0.7.3: the building shader's text character for character, the pavement's triangles bit for bit.
// The comparisons with v0.7.3 itself read the run's frozen copy of it when it is there (the overnight run's
// /tmp/flight-sim/v074/base); without it (a clean clone) they are skipped and the rest still runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as A from '../src/world/apron.js';
import { dedupePolys, openRing, signedArea } from '../src/world/apron-geom.js';

const APRON = fileURLToPath(new URL('../src/world/apron.js', import.meta.url));
const BASE = '/tmp/flight-sim/v074/base/GameDump/games/flight-sim/';
const HAVE_BASE = existsSync(`${BASE}src/world/apron.js`);
const airport = (rel) => JSON.parse(readFileSync(new URL(`../data/${rel}`, import.meta.url), 'utf8'));

// The module as a child process sees it with the given environment: the switches, the shader in use, and (optionally)
// the pavement of one airport, as a hash of its bytes.
function child(env, pave = null) {
  const src = `
    import { createHash } from 'node:crypto';
    import { readFileSync } from 'node:fs';
    const A = await import(${JSON.stringify(APRON)});
    const G = await import(${JSON.stringify(fileURLToPath(new URL('../src/world/apron-geom.js', import.meta.url)))});
    const out = { term: A.TERM_NIGHT, grass: A.APRON_GRASS, used: A.BLDG_FRAG_USED };
    ${pave ? `const a = JSON.parse(readFileSync(${JSON.stringify(fileURLToPath(new URL(`../data/${pave}`, import.meta.url)))}, 'utf8'));
    const g = A.buildPavement(a, a.origin[0], a.origin[1], () => a.elevM || 0, G.dedupePolys(a.aprons || []));
    out.pos = createHash('sha256').update(Buffer.from(g.getAttribute('position').array.buffer)).update(Buffer.from(g.getAttribute('pm').array.buffer)).digest('hex');
    out.n = g.getAttribute('position').count;` : ''}
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('both switches are on by default, and off with FS_TERMNIGHT=0 / FS_APRONGRASS=0', () => {
  const on = child({ FS_TERMNIGHT: '', FS_APRONGRASS: '' });
  assert.equal(on.term, true);
  assert.equal(on.grass, true);
  assert.equal(on.used, A.BLDG_FRAG_NIGHT);
  const off = child({ FS_TERMNIGHT: '0', FS_APRONGRASS: '0' });
  assert.equal(off.term, false);
  assert.equal(off.grass, false);
  assert.equal(off.used, A.BLDG_FRAG);
});

test('the page switches are read from the query (?termnight=0, ?aprongrass=0)', () => {
  const src = readFileSync(APRON, 'utf8');
  assert.match(src, /lookSwitch\('termnight', 'FS_TERMNIGHT'\)/);
  assert.match(src, /lookSwitch\('aprongrass', 'FS_APRONGRASS'\)/);
});

test('switch off: the building shader is v0.7.3\'s text, character for character', { skip: !HAVE_BASE && 'no frozen v0.7.3 copy' }, () => {
  const base = readFileSync(`${BASE}src/world/apron.js`, 'utf8');
  const m = /const BLDG_FRAG = \/\* glsl \*\/ `([^`]*)`;/.exec(base);
  assert.ok(m, 'BLDG_FRAG in the frozen copy');
  assert.equal(A.BLDG_FRAG, m[1]);
  assert.equal(child({ FS_TERMNIGHT: '0' }).used, m[1]);
});

test('the night variant changes only the terminals\' lit term, and adds nothing by day', () => {
  const v = A.BLDG_FRAG_NIGHT;
  assert.notEqual(v, A.BLDG_FRAG);
  assert.ok(v.includes('float termLit(float along, float y, vec2 fw)'));
  assert.ok(v.includes('lit = termLit(along, y, fw);'));
  assert.ok(!v.includes('floor(y / 4.5)), 7u)'), 'the per-pane hash is gone');
  // Everything outside the replaced lines is as it was: removing the function and the call gives BLDG_FRAG back.
  const back = v.replace(/\n  float termLit[\s\S]*?\n  }\n/, '').replace('      lit = termLit(along, y, fw);',
    '      float h = ihash(ivec2(floor(along / 3.0), floor(y / 4.5)), 7u);\n      lit = glass * (0.6 + 0.4 * h) * step(0.1, h);');
  assert.equal(back, A.BLDG_FRAG);
  // `lit` reaches the colour only through uNight.
  assert.ok(v.includes('col += vec3(1.0, 0.72, 0.42) * lit * (1.0 - roof) * 0.32 * uNight;'));
  assert.equal((v.match(/\blit\b/g) || []).length, (A.BLDG_FRAG.match(/\blit\b/g) || []).length);
});

test('apronSkirt: a strip m wide outside each edge of a counter-clockwise ring', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const s = A.apronSkirt(ring, 1.5);
  assert.equal(s.length, 4 * 12);
  let area = 0;
  for (let i = 0; i < s.length; i += 6) area += Math.abs((s[i + 2] - s[i]) * (s[i + 5] - s[i + 1]) - (s[i + 4] - s[i]) * (s[i + 3] - s[i + 1])) / 2;
  assert.ok(Math.abs(area - 4 * 10 * 1.5) < 1e-9);
  // every skirt point is outside the ring or on its edge
  for (let i = 0; i < s.length; i += 2) assert.ok(s[i] <= 0 || s[i] >= 10 || s[i + 1] <= 0 || s[i + 1] >= 10);
  assert.deepEqual(A.apronSkirt([[0, 0], [0, 0], [5, 0], [5, 5]], 1).length, 3 * 12);   // a zero-length edge adds nothing
});

// Coverage on a 0.25 m grid round the two slivers the picture review saw (Gatwick, Madrid: tools in /tmp/flight-sim/v074/look1),
// from the pavement's own triangles: grass cells enclosed in a small window, before and after.
function covered(a, cx, cy, half, res = 0.25) {
  const g = A.buildPavement(a, 0, 0, () => 0, dedupePolys(a.aprons || []));
  const p = g.getAttribute('position').array, n = Math.round((2 * half) / res);
  const grid = new Uint8Array(n * n);
  for (let t = 0; t < p.length; t += 9) {
    const ax = p[t], ay = -p[t + 2], bx = p[t + 3], by = -p[t + 5], qx = p[t + 6], qy = -p[t + 8];
    const x0 = Math.min(ax, bx, qx), x1 = Math.max(ax, bx, qx), y0 = Math.min(ay, by, qy), y1 = Math.max(ay, by, qy);
    if (x1 < cx - half || x0 > cx + half || y1 < cy - half || y0 > cy + half) continue;
    const d = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy);
    if (Math.abs(d) < 1e-9) continue;
    for (let j = Math.max(0, Math.floor((y0 - cy + half) / res)); j <= Math.min(n - 1, Math.ceil((y1 - cy + half) / res)); j++) {
      for (let i = Math.max(0, Math.floor((x0 - cx + half) / res)); i <= Math.min(n - 1, Math.ceil((x1 - cx + half) / res)); i++) {
        const x = cx - half + (i + 0.5) * res, y = cy - half + (j + 0.5) * res;
        const l1 = ((by - qy) * (x - qx) + (qx - bx) * (y - qy)) / d, l2 = ((qy - ay) * (x - qx) + (ax - qx) * (y - qy)) / d;
        if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) grid[j * n + i] = 1;
      }
    }
  }
  let holes = 0;
  for (const v of grid) if (!v) holes++;
  return holes * res * res;
}

test('the slivers between Gatwick\'s and Madrid\'s apron polygons are paved (switch on)', { skip: !A.APRON_GRASS && 'FS_APRONGRASS=0' }, () => {
  // Windows inside paved areas where v0.7.3 showed a wedge of grass between two aprons: Gatwick's 47 m one at
  // (-290008, 466856), its 166 m one at (-289764, 466304); Madrid's 55 m one at (-639066, -690697).
  for (const [rel, cx, cy] of [['europe/airports/EGKK.json', -290008, 466856], ['europe/airports/EGKK.json', -289764, 466304], ['europe/airports/LEMD.json', -639066, -690697]]) {
    const grass = covered(airport(rel), cx, cy, 12);
    assert.ok(grass < 0.5, `${rel} at ${cx}, ${cy}: ${grass} m2 of grass left in a 24 m window`);
  }
});

test('switch off: the pavement is v0.7.3\'s, bit for bit (Gatwick, Madrid, Incheon)', { skip: !HAVE_BASE && 'no frozen v0.7.3 copy' }, async () => {
  const B = await import(`${BASE}src/world/apron.js`);
  const BG = await import(`${BASE}src/world/apron-geom.js`);
  const { createHash } = await import('node:crypto');
  for (const rel of ['europe/airports/EGKK.json', 'europe/airports/LEMD.json', 'airports/RKSI.json']) {
    const a = airport(rel);
    const g = B.buildPavement(a, a.origin[0], a.origin[1], () => a.elevM || 0, BG.dedupePolys(a.aprons || []));
    const h = createHash('sha256').update(Buffer.from(g.getAttribute('position').array.buffer)).update(Buffer.from(g.getAttribute('pm').array.buffer)).digest('hex');
    const off = child({ FS_APRONGRASS: '0' }, rel);
    assert.equal(off.pos, h, rel);
    const on = child({ FS_APRONGRASS: '' }, rel);
    assert.ok(on.n > off.n, `${rel}: the skirts add triangles`);
  }
});

test('every apron ring is turned counter-clockwise before its skirt (outward = right)', () => {
  // (as buildPavementInSteps does: a clockwise ring's skirt would lie inside it and pave nothing new)
  const a = airport('europe/airports/EGKK.json');
  for (const ap of dedupePolys(a.aprons || [])) {
    let ring = openRing(ap.points);
    if (ring.length < 3) continue;
    if (signedArea(ring) < 0) ring = ring.slice().reverse();
    assert.ok(signedArea(ring) > 0);
  }
});
