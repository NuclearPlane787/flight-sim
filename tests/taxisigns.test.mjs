// v0.4.1: the taxiway and runway signs (src/world/taxisigns.js), and their mesh (apron.js buildSigns).
//   node --test tests/taxisigns.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { taxiSignSites, SIGN, RUNWAY_SIGN, panelWidth, arrayWidth } from '../src/world/taxisigns.js';
import { buildSigns, ARROWS } from '../src/world/apron.js';
import { runwayLines, nearestRunway, segmentIndex, segDist, pointInRing, openRing } from '../src/world/apron-geom.js';

const here = new URL('..', import.meta.url).pathname;
const AIRPORTS = ['RKSS', 'RKPC', 'RKSI'].map((i) => JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8')));
const SITES = AIRPORTS.map((a) => taxiSignSites(a));

// A made-up airport: a runway along x, taxiway A parallel to it 300 m north, and B from A's middle up to an apron.
const runway = { id: '09/27', widthM: 45, ends: [{ ident: '09', x: -1500, y: 0 }, { ident: '27', x: 1500, y: 0 }] };
const fake = {
  icao: 'TEST', runways: [runway], holdingPositions: [], stands: [], buildings: [], aprons: [],
  taxiways: [
    { ref: 'A', widthM: 23, points: [[-1000, 300], [0, 300], [1000, 300]] },
    { ref: 'B', widthM: 23, points: [[0, 300], [0, 700]] },
    { ref: 'C', widthM: 23, points: [[600, 300], [600, 0]] },     // to the runway: a hold, a mandatory sign
  ],
};

test('a T junction: each named way in gets an array on its left, its location between the turns', () => {
  const s = taxiSignSites(fake);
  const at = (x, y) => s.arrays.find((q) => Math.hypot(q.x - x, q.y - y) < 40);
  // From the west on A (going east): B is to the left, A goes on; the array stands on the left (north) of A.
  const west = s.arrays.find((q) => q.tx > 0.99 && q.x < 0);
  assert.ok(west, JSON.stringify(s.arrays));
  assert.deepEqual(west.panels, [{ kind: 'dir', text: 'B', arrow: 6 }, { kind: 'loc', text: 'A' }]);
  assert.ok(west.y > 300 + 11.5 + SIGN.set - 0.01, `north of A: ${west.y}`);
  assert.ok(Math.abs(west.x - (0 - SIGN.back)) < 1, `${SIGN.back} m before the junction: ${west.x}`);
  // From B (going south): A both ways, left (east) and right (west) of it.
  const fromB = s.arrays.find((q) => q.ty < -0.99 && q.y > 300);
  assert.deepEqual(fromB.panels.map((p) => [p.text, p.arrow]), [['A', 6], ['B', undefined], ['A', 2]]);
  void at;
  // The painted name for each array, on the centreline before the junction.
  assert.equal(s.painted.length, s.arrays.length);
  assert.ok(s.painted.some((p) => p.text === 'A' && Math.abs(p.y - 300) < 0.01 && Math.abs(p.x + SIGN.back) < 1));
});

test('a mandatory sign at the runway holding position: white on red, the end on the left first', () => {
  const s = taxiSignSites(fake);
  assert.equal(s.mandatory.length, 1, JSON.stringify(s.mandatory));
  const m = s.mandatory[0];
  // Going south on C to the runway, 27 (east) is on the left.
  assert.deepEqual(m.panels, [{ kind: 'mand', text: '27-09' }]);
  assert.ok(m.ty < -0.99, 'facing traffic going to the runway');
  assert.ok(m.x > 600 + 11.5, `on the left (east) of C: ${m.x}`);
  assert.ok(Math.abs(m.y - 90) < 3, `at the hold line, 90 m out: ${m.y}`);
});

test('real data: arrays at every airport, none in a runway strip or on pavement, each telling the truth', () => {
  for (const [i, a] of AIRPORTS.entries()) {
    const s = SITES[i], lines = runwayLines(a), index = segmentIndex(a.taxiways);
    const aprons = (a.aprons || []).map((q) => openRing(q.points || q));
    assert.ok(s.arrays.length >= 20, `${a.icao}: ${s.arrays.length} arrays`);
    assert.ok(s.mandatory.length >= 10, `${a.icao}: ${s.mandatory.length} mandatory signs`);
    const refs = new Set(a.taxiways.map((t) => t.ref).filter(Boolean));
    for (const q of s.arrays) {
      assert.ok(nearestRunway(lines, q.x, q.y).d >= SIGN.runwayClear, `${a.icao}: an array in a runway strip at ${q.x}, ${q.y}`);
      const W = arrayWidth(q);
      for (const k of [-0.5, 0, 0.5]) {
        const x = q.x + q.ty * k * W, y = q.y - q.tx * k * W;
        for (const sg of index.segs) assert.ok(segDist(x, y, sg.ax, sg.ay, sg.bx, sg.by).d >= sg.hw + SIGN.clear - 1e-6, `${a.icao}: an array on a taxiway`);
        for (const r of aprons) assert.ok(!pointInRing(x, y, r), `${a.icao}: an array on an apron`);
      }
      const loc = q.panels.filter((p) => p.kind === 'loc');
      assert.equal(loc.length, 1);
      assert.ok(refs.has(loc[0].text));
      for (const p of q.panels.filter((d) => d.kind === 'dir')) {
        assert.ok(refs.has(p.text) && p.text !== loc[0].text);
        assert.ok([0, 1, 2, 3, 5, 6, 7].includes(p.arrow), `${a.icao}: arrow ${p.arrow}`);
      }
      // Turns to the left left of the location sign, to the right right of it.
      const li = q.panels.findIndex((p) => p.kind === 'loc');
      assert.ok(q.panels.slice(0, li).every((p) => p.arrow >= 5) && q.panels.slice(li + 1).every((p) => p.arrow <= 3));
      assert.ok(Math.abs(Math.hypot(q.tx, q.ty) - 1) < 1e-9);
    }
    // No two arrays on top of each other.
    for (let j = 0; j < s.arrays.length; j++) for (let k = j + 1; k < s.arrays.length; k++) {
      assert.ok(Math.hypot(s.arrays[j].x - s.arrays[k].x, s.arrays[j].y - s.arrays[k].y) >= SIGN.spacing);
    }
    for (const m of s.mandatory) {
      const ids = a.runways.flatMap((r) => r.ends.map((e) => e.ident));
      const [l, r] = m.panels[0].text.split('-');
      assert.ok(ids.includes(l) && ids.includes(r), `${a.icao}: ${m.panels[0].text}`);
    }
  }
});

test('v0.4.2: a runway exit sign for each way along the runway, 60 m before the exit, on its side, with its turn', () => {
  const s = taxiSignSites(fake);
  // C leaves 09/27 to the north at x = 600: a left turn going east, a right turn going west.
  assert.equal(s.exits.length, 2, JSON.stringify(s.exits));
  const east = s.exits.find((q) => q.tx > 0.99), west = s.exits.find((q) => q.tx < -0.99);
  assert.deepEqual(east.panels, [{ kind: 'dir', text: 'C', arrow: 6 }]);
  assert.deepEqual(west.panels, [{ kind: 'dir', text: 'C', arrow: 2 }]);
  assert.ok(Math.abs(east.x - (600 - RUNWAY_SIGN.exitBack)) < 0.5 && Math.abs(west.x - (600 + RUNWAY_SIGN.exitBack)) < 0.5, `${east.x}, ${west.x}`);
  for (const q of s.exits) assert.ok(q.y > 22.5 + RUNWAY_SIGN.exitSet, `north of the runway, past its edge: ${q.y}`);
});

test('v0.4.2: distance remaining signs every 1,000 ft along both sides, back to back, adding up to the length', () => {
  const s = taxiSignSites(fake);
  // 3,000 m is 9,843 ft: 9 thousands, so signs at 1 to 8 thousand from each end, on both sides.
  assert.equal(s.distance.length, 8 * 2 * 2, `${s.distance.length} faces`);
  const pairs = new Map();
  for (const q of s.distance) {
    assert.equal(q.panels[0].kind, 'dist');
    assert.ok(Math.abs(q.y) > 22.5 + RUNWAY_SIGN.distSet, `past the edge: ${q.y}`);
    const key = `${Math.round(q.x + q.tx * SIGN.depth / 2)}:${Math.sign(q.y)}`;   // the pair's middle
    pairs.set(key, [...(pairs.get(key) || []), q]);
  }
  for (const [key, pr] of pairs) {
    assert.equal(pr.length, 2, key);
    assert.ok(pr[0].tx * pr[1].tx < 0, `${key}: back to back`);
    assert.equal(Number(pr[0].panels[0].text) + Number(pr[1].panels[0].text), 9, key);
    // The face for the traffic going east shows what's left ahead of it.
    const e = pr.find((q) => q.tx > 0);
    assert.equal(Number(e.panels[0].text), Math.floor((1500 - e.x) / 0.3048 / 1000), key);
  }
});

test('v0.4.2, real data: exit signs on named taxiways and distance signs clear of the pavement, at every airport', () => {
  for (const [i, a] of AIRPORTS.entries()) {
    const s = SITES[i], lines = runwayLines(a), index = segmentIndex(a.taxiways);
    const refs = new Set(a.taxiways.map((t) => t.ref).filter(Boolean));
    assert.ok(s.exits.length >= 10, `${a.icao}: ${s.exits.length} exit signs`);
    assert.ok(s.distance.length >= 40, `${a.icao}: ${s.distance.length} distance faces`);
    for (const q of [...s.exits, ...s.distance]) {
      const W = panelWidth(q.panels[0]);
      for (const k of [-0.5, 0, 0.5]) {
        const x = q.x + q.ty * k * W, y = q.y - q.tx * k * W;
        for (const sg of index.near(x, y)) assert.ok(segDist(x, y, sg.ax, sg.ay, sg.bx, sg.by).d >= sg.hw + SIGN.clear - 1e-6, `${a.icao}: a sign on a taxiway at ${x}, ${y}`);
        for (const l of lines) assert.ok(segDist(x, y, l.ax, l.ay, l.bx, l.by).d >= l.hw + SIGN.clear - 1e-6, `${a.icao}: a sign on a runway at ${x}, ${y}`);
      }
    }
    for (const q of s.exits) {
      assert.ok(refs.has(q.panels[0].text), `${a.icao}: ${q.panels[0].text}`);
      assert.ok([1, 2, 6, 7].includes(q.panels[0].arrow), `${a.icao}: arrow ${q.panels[0].arrow}`);
    }
    for (const q of s.distance) assert.ok(/^[1-9][0-9]?$/.test(q.panels[0].text), `${a.icao}: ${q.panels[0].text}`);
  }
});

test('the taxi instructions name taxiways the signs show', () => {
  // At Gimpo, every name in the data with a junction to another name has a sign somewhere.
  const a = AIRPORTS[0], s = SITES[0];
  const shown = new Set(s.arrays.flatMap((q) => q.panels.map((p) => p.text)));
  for (const ref of ['P', 'P5', 'N1']) assert.ok(shown.has(ref), `${ref} on a sign at ${a.icao}`);
});

test('the mesh: the letters on the faces, looking back at the traffic, and every triangle wound outwards', () => {
  const chars = [...new Set('0123456789-ABCDLNPR'.split('').concat(ARROWS))].sort().join('');
  const s = taxiSignSites(fake);
  const m = buildSigns(s, 0, 0, () => 10, chars);
  assert.equal(m.arrays, s.arrays.length);
  assert.equal(m.mandatory, s.mandatory.length);
  assert.equal(m.exits, s.exits.length);
  assert.equal(m.distance, s.distance.length);
  const g = m.geo, pos = g.getAttribute('position'), n = g.getAttribute('normal'), k = g.getAttribute('sk');
  assert.ok(m.triangles > 0 && g.index.count === m.triangles * 3);
  // Every letter faces the traffic it's for, and stands on the face, above the ground (10 m here).
  let letters = 0;
  for (let i = 0; i < pos.count; i++) {
    if (k.getX(i) !== 2) continue;
    letters++;
    assert.ok(pos.getY(i) > 10 + SIGN.base - 1e-6 && pos.getY(i) < 10 + SIGN.base + SIGN.faceH + 1e-6);
    assert.ok(k.getY(i) >= 0 && k.getY(i) < chars.length);
  }
  const want = [...s.arrays, ...s.mandatory, ...s.exits, ...s.distance].reduce((t, q) => t + q.panels.reduce((u, p) => u + p.text.length + (p.arrow !== undefined ? 1 : 0), 0), 0);
  assert.equal(letters, want * 4);
  // Each triangle winds counter-clockwise seen from its normal's side.
  const idx = g.index.array, v = (i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  for (let t = 0; t < idx.length; t += 3) {
    const a = v(idx[t]), b = v(idx[t + 1]), c = v(idx[t + 2]);
    const cr = b.clone().sub(a).cross(c.clone().sub(a));
    const nn = new THREE.Vector3(n.getX(idx[t]), n.getY(idx[t]), n.getZ(idx[t]));
    assert.ok(cr.dot(nn) > 0, `triangle ${t / 3}`);
  }
  // A panel's width: its letters, its arrow, its margins.
  assert.ok(Math.abs(panelWidth({ kind: 'loc', text: 'A' }) - (SIGN.glyphW + 2 * SIGN.pad)) < 1e-9);
});
