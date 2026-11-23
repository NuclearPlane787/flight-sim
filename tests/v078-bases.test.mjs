// v0.7.8 part 3, item 3 (the `marks` subagent): the air bases' shelters as low concrete vaults (src/world/shelters.js,
// drawn in apron.js's buildings loop), behind ?bases78=0 / FS_BASES78=0. On: each of the seven bases' shelters a vault
// 6 to 8 m high over its outline's least rectangle, its door towards the taxiways, every face turned outwards. Off: each
// base's buildings' geometry (positions, normals and the shader's kind and band) exactly the pushed v0.7.7's: the hashes
// below were taken from the pushed copy's apron.js (with the same one-line buildingsGeometry hook added in a scratch copy,
// the same airport JSONs and the same made-up ground).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASES = { 'east-asia': ['RJNK', 'RKTU', 'RKJK'], europe: ['LEZG', 'EGQS', 'EGUL', 'ETAR'] };
const DIR = { 'east-asia': 'data/airports/', europe: 'data/europe/airports/' };
// the pushed v0.7.7's buildings (sha-256 of position, normal and bk, first 16 hex; triangles)
const OLD = {
  RJNK: ['003d31b433ac4729', 2873], RKTU: ['e3238e87090f6bdf', 3214], RKJK: ['6f714feedf0b4626', 20706],
  LEZG: ['2d93ce7e611ab28b', 1110], EGQS: ['4d8e46370cfd4944', 8976], EGUL: ['72f76703bc81e60f', 15864], ETAR: ['b4adfad48ceb373c', 20215],
};
// OSM's shelters at each (SHELTERS in tools/bake_region_airports.py, as baked): Kunsan's 44 9 m buildings less three
// long strips (85 to 256 m) that aren't single shelters.
const COUNT = { RJNK: 20, RKTU: 41, RKJK: 10, LEZG: 6, EGQS: 18, EGUL: 42, ETAR: 39 };

// One base's buildings hashed in a child process (the region and the switch are read once, at import).
function hashes(region, env) {
  const code = `
    import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto';
    const { buildingsGeometry } = await import(${JSON.stringify(ROOT + 'src/world/apron.js')});
    const out = {};
    for (const id of ${JSON.stringify(BASES[region])}) {
      const a = JSON.parse(readFileSync(${JSON.stringify(ROOT + DIR[region])} + id + '.json', 'utf8'));
      const r = buildingsGeometry(a, a.origin ? a.origin[0] : 0, a.origin ? a.origin[1] : 0, (x, y) => 20 + ((x * 0.37 + y * 0.11) % 3));
      const h = createHash('sha256');
      for (const k of ['position', 'normal', 'bk']) { const arr = r.geo.getAttribute(k).array; h.update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)); }
      out[id] = [h.digest('hex').slice(0, 16), r.geo.getAttribute('position').count / 3];
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, FS_REGION: region, NODE_TEST_CONTEXT: undefined, ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('the switch is on by default', async () => {
  const { BASES78 } = await import('../src/world/shelters.js');
  assert.equal(BASES78, process.env.FS_BASES78 !== '0');
});

test('off (FS_BASES78=0): every base\'s buildings exactly the pushed v0.7.7\'s', () => {
  for (const region of Object.keys(BASES)) {
    // (with the lead's gates switch off too: Komatsu's and the others' jet bridges share this geometry, and v0.7.8's gates
    // change them; both off is the pushed v0.7.7)
    const got = hashes(region, { FS_BASES78: '0', FS_GATES78: '0' });
    for (const id of BASES[region]) assert.deepEqual(got[id], OLD[id], id);
  }
});

test('on: each base\'s buildings change (its shelters: boxes out, vaults in)', () => {
  for (const region of Object.keys(BASES)) {
    const got = hashes(region, { FS_BASES78: '1' });
    for (const id of BASES[region]) {
      assert.notEqual(got[id][0], OLD[id][0], `${id}: changed`);
      assert.ok(got[id][1] !== OLD[id][1], `${id}: ${OLD[id][1]} -> ${got[id][1]} triangles`);
    }
  }
});

test('the vaults: the right buildings, 6 to 8 m high on a least rectangle, the door towards the taxiways, faces outward', async () => {
  const S = await import('../src/world/shelters.js');
  for (const region of Object.keys(BASES)) for (const id of BASES[region]) {
    const a = JSON.parse(readFileSync(ROOT + DIR[region] + id + '.json', 'utf8'));
    const sh = a.buildings.filter((b) => S.isShelter(a, b));
    assert.equal(sh.length, COUNT[id], `${id}: shelters`);
    for (const b of sh) assert.equal(b.heightM, 9);
    // no shelter anywhere else: every other airport's buildings stay boxes
    const taxi = S.shelterTaxiPts(a);
    let doorNear = 0;
    for (const b of sh) {
      const vt = S.vaultTris(b, () => 12, taxi);
      assert.ok(vt.H >= 6 && vt.H <= 8, `${id}: height ${vt.H}`);
      assert.ok(Math.abs(vt.top - 12 - vt.H) < 1e-9);
      let zmax = -Infinity;
      const T = vt.tris;
      assert.equal(T.length % 3, 0);
      for (let i = 0; i < T.length; i += 3) {
        const P = [0, 1, 2].map((k) => [T[i + k][0], T[i + k][2], -T[i + k][1]]);   // the scene's frame
        const e1 = P[1].map((v, j) => v - P[0][j]), e2 = P[2].map((v, j) => v - P[0][j]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        for (const t of T.slice(i, i + 3)) zmax = Math.max(zmax, t[2]);
        if (Math.hypot(...n) < 1e-9) continue;
        assert.ok(n[0] * T[i][3] + n[1] * T[i][4] + n[2] * T[i][5] > 0, `${id}: a face turned inward`);
      }
      assert.ok(zmax <= 12 + 8 + 1e-6, `${id}: top ${zmax}`);
      const r = vt.rect, back = [2 * r.cx - vt.door[0], 2 * r.cy - vt.door[1]];
      const near = (p) => Math.min(...taxi.map(([x, y]) => Math.hypot(x - p[0], y - p[1])));
      if (near(vt.door) <= near(back)) doorNear++;
    }
    assert.equal(doorNear, sh.length, `${id}: every door the nearer end to the taxiways`);
  }
  // the bases only: a 9 m building at an airline airport stays a box
  const lhr = { icao: 'EGLL', buildings: [] }, b9 = { kind: 'building', heightM: 9, points: [[0, 0], [30, 0], [30, 20], [0, 20]] };
  assert.equal(S.isShelter(lhr, b9), false);
  assert.equal(S.isShelter({ icao: 'EGQS' }, b9), true);
  assert.equal(S.isShelter({ icao: 'EGQS' }, { ...b9, heightM: 10 }), false);
});

// Items 6 to 8 (baked: tools/bake_region_airports.py's STAND_DROP['LEZG'], PAVE_JOIN and APRON_SMOOTH, installed by the
// lead): Zaragoza's stand 2 gone (it overlapped 1), the hangars, shelters and pads that OSM left on grass at Zaragoza and
// Lossiemouth joined to pavement, Fairford's apron outlines smoothed.
const EU_AP = (id) => JSON.parse(readFileSync(ROOT + 'data/europe/airports/' + id + '.json', 'utf8'));
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const inside = (px, py, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; };
// the gap (m) from a ring to the airport's pavement (taxiways at their half width, aprons other than `self`), over its
// vertices and points every 2 m along its edges
function gapToPavement(a, ring, self = null) {
  const pts = [];
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2); for (let k = 0; k < n; k++) pts.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]); }
  let best = Infinity;
  for (const [x, y] of pts) {
    for (const t of a.taxiways) for (let i = 0; i + 1 < t.points.length; i++) best = Math.min(best, segDist(x, y, t.points[i], t.points[i + 1]) - t.widthM / 2);
    for (const ap of a.aprons) {
      if (ap === self) continue;
      if (inside(x, y, ap.points)) return 0;
      for (let i = 0; i + 1 < ap.points.length; i++) best = Math.min(best, segDist(x, y, ap.points[i], ap.points[i + 1]));
    }
  }
  return Math.max(best, 0);
}

test('item 6: Zaragoza keeps stand 1 and leaves out stand 2, which overlapped it', () => {
  const a = EU_AP('LEZG'), refs = a.stands.map((s) => s.ref);
  assert.ok(refs.includes('1') && !refs.includes('2'), refs.join(' '));
  assert.equal(a.stands.length, 21);
});

test('item 7: every hangar and shelter at Zaragoza and Lossiemouth, and every pad at Lossiemouth, joined to pavement', () => {
  for (const id of ['LEZG', 'EGQS']) {
    const a = EU_AP(id);
    for (const b of a.buildings.filter((b) => b.kind === 'hangar' || b.heightM === 9)) {
      const g = gapToPavement(a, b.points);
      assert.ok(g < 1.5, `${id}: a ${b.kind} ${g.toFixed(1)} m from any pavement`);
    }
    // (a pad within 3 m: apron.js's APRON_SKIRT draws 1.5 m of concrete outside every apron, so a 1.9 m gap shows none)
    if (id === 'EGQS') for (const ap of a.aprons) { const g = gapToPavement(a, ap.points, ap); assert.ok(g < 3, `${id}: a pad ${g.toFixed(1)} m apart`); }
    assert.ok(a.aprons.filter((p) => p.synthetic).length >= (id === 'LEZG' ? 8 : 6), `${id}: the strips`);
  }
});

test("item 8: Fairford's apron outlines smooth: no inward corner sharper than 45 degrees (a notch's step; the v0.7.6 bake's had 56)", () => {
  const a = EU_AP('EGVA');
  let sharp = 0;
  for (const ap of a.aprons) {
    const pts = ap.points, r = pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] ? pts.slice(0, -1) : pts, n = r.length;
    let area = 0;
    for (let i = 0; i < n; i++) area += r[i][0] * r[(i + 1) % n][1] - r[(i + 1) % n][0] * r[i][1];
    for (let i = 0; i < n; i++) {
      const p = r[(i + n - 1) % n], q = r[i], t = r[(i + 1) % n];
      const cr = (q[0] - p[0]) * (t[1] - q[1]) - (q[1] - p[1]) * (t[0] - q[0]);
      let d = Math.abs(Math.atan2(t[1] - q[1], t[0] - q[0]) - Math.atan2(q[1] - p[1], q[0] - p[0])) * 180 / Math.PI;
      if (d > 180) d = 360 - d;
      if (cr * Math.sign(area) < 0 && d > 45) sharp++;
    }
  }
  assert.equal(sharp, 0, `${sharp} sharp inward corners`);
  assert.equal(a.stands.length, 3);
});
