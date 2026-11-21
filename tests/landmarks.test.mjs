// briefs/V0-6-0.md Part 6 step 3: the landmarks' list and models (node, no WebGL: three.js's BufferGeometry only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, CITY_BOXES, buildModel, landmarkFootprints, baseHeight, createLandmarks, landmarkOn, bridgeEnds, PYLON_R } from '../src/world/landmarks.js';
import { MODELS } from '../src/world/landmark-models.js';
// (v0.7.0: v0.6.0's flags are gone: every landmark is on; the tests of them off went.)

// The brief's heights (briefs/V0-6-0.md Part 6 and the subagent's brief): within 2 %.
const BRIEF = {
  lotte: 555, b63: 250, nseoul: 237, parc1: 333, shtower: 632, swfc: 492, jinmao: 420, pearl: 468,
  skytree: 634, tokyotower: 333, azabudai: 325, tmg: 243, ylmt: 296, lct: 411, neatt: 305, harukas: 300,
  umeda: 173, fktower: 234, fkdome: 84,
  // v0.6.3 (briefs/V0-6-3.md Part 5)
  citic: 528, cctv: 234, russky: 321, zolotoy: 226, cctvtower: 405, tjtower: 415, lntower: 305,
  // v0.6.4 (briefs/V0-6-4.md, "Centres and landmarks")
  ryugyong: 330, juche: 170, sapporotv: 147, daikannon: 100,
};
const ORDER = ['lotte', 'b63', 'nseoul', 'parc1', 'shtower', 'swfc', 'jinmao', 'pearl', 'skytree', 'tokyotower', 'azabudai', 'tmg', 'ylmt', 'lct', 'neatt', 'harukas', 'umeda', 'fktower', 'fkdome',
  'citic', 'cctv', 'russky', 'zolotoy', 'cctvtower', 'tjtower', 'lntower', 'ryugyong', 'juche', 'sapporotv', 'daikannon'];
const TRI_BUDGET = 6000, TOTAL_BUDGET = 60000;

test('the list: unique ids, the brief\'s order, a model for each, a source', () => {
  const ids = LANDMARKS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ORDER);
  for (const L of LANDMARKS) {
    assert.ok(MODELS[L.id], `${L.id}: a model`);
    assert.ok(typeof L.source === 'string' && L.source.length > 10, `${L.id}: a source`);
    // a bridge's footprint is its length (its pylons are its parts)
    assert.ok(L.footprintM > 5 && L.footprintM < (L.kind === 'bridge' ? 1200 : 300), `${L.id}: footprint`);
    assert.ok(Number.isFinite(L.x) && Number.isFinite(L.y), `${L.id}: map position`);
  }
});

test('coordinates inside their city boxes; heights within 2 % of the brief', () => {
  for (const L of LANDMARKS) {
    const b = CITY_BOXES[L.city];
    assert.ok(b, `${L.id}: city ${L.city}`);
    assert.ok(L.lat > b[0] && L.lat < b[2] && L.lon > b[1] && L.lon < b[3], `${L.id} at ${L.lat}, ${L.lon} outside ${L.city}`);
    assert.ok(Math.abs(L.heightM - BRIEF[L.id]) / BRIEF[L.id] < 0.02, `${L.id}: ${L.heightM} m against ${BRIEF[L.id]} m`);
    assert.equal(L.country === 'KR', ['seoul', 'busan', 'songdo'].includes(L.city), `${L.id}: country`);
  }
});

test('every model: triangles with finite positions and normals, base at y = 0, top at heightM +- 1 %, in budget', () => {
  let total = 0;
  for (const L of LANDMARKS) {
    const t0 = performance.now();
    const { geometry: g, lights } = buildModel(L);
    const ms = performance.now() - t0;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    assert.ok(!g.index, `${L.id}: non-indexed`);
    assert.equal(p.count % 3, 0, `${L.id}: whole triangles`);
    for (const name of ['aCol', 'aFac', 'aExt', 'aGlow']) assert.equal(g.getAttribute(name).count, p.count, `${L.id}: ${name}`);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${L.id}: finite position`);
      const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      assert.ok(Math.abs(l - 1) < 1e-3, `${L.id}: unit normal (${l})`);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      // everything within the footprint (the plan) or near the axis
      assert.ok(Math.hypot(x, z) <= L.footprintM * 1.05 + 2, `${L.id}: a vertex ${Math.hypot(x, z).toFixed(1)} m out, footprint ${L.footprintM}`);
    }
    assert.ok(Math.abs(minY) < 1e-6, `${L.id}: base ${minY}`);
    assert.ok(Math.abs(maxY - L.heightM) / L.heightM < 0.01, `${L.id}: top ${maxY} against ${L.heightM}`);
    const tris = p.count / 3;
    assert.ok(tris > 20 && tris <= TRI_BUDGET, `${L.id}: ${tris} triangles`);
    total += tris;
    // the aviation lights: anything over about 150 m has them, at its top
    if (L.heightM > 150) {
      assert.ok(lights.length >= 3, `${L.id}: lights`);
      const top = Math.max(...lights.map((l) => l[1]));
      assert.ok(top > L.heightM * 0.95, `${L.id}: a light at the top (${top})`);
      assert.ok(lights.some((l) => l[3] === 1), `${L.id}: a flashing light`);
    }
    for (const l of lights) assert.ok(l.every(Number.isFinite), `${L.id}: light`);
    assert.ok(ms < 200, `${L.id}: built in ${ms.toFixed(1)} ms`);
  }
  assert.ok(total <= TOTAL_BUDGET, `${total} triangles in all`);
});

test('the models are the same every run (no randomness)', () => {
  for (const id of ['lotte', 'skytree', 'tokyotower']) {
    const L = LANDMARKS.find((l) => l.id === id);
    const a = buildModel(L).geometry.getAttribute('position').array, b = buildModel(L).geometry.getAttribute('position').array;
    assert.deepEqual(Array.from(a), Array.from(b));
  }
});

test('footprints for the real centres: one circle per tower', () => {
  const f = landmarkFootprints();
  assert.equal(f.filter((c) => c.id === 'lct').length, 3);
  assert.equal(f.filter((c) => c.id === 'parc1').length, 2);
  assert.equal(new Set(f.map((c) => c.id)).size, LANDMARKS.length);
  for (const c of f) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && c.r > 5);
});

test('the base sits on the lowest ground round the plan', () => {
  const L = LANDMARKS.find((l) => l.id === 'nseoul');
  const h = baseHeight(L, (x, y) => 240 + 0.01 * (x - L.x));   // a slope: lower to the west
  assert.ok(h < 240 - 0.01 * 0.8 * L.footprintM - 0.4 && h > 240 - 0.01 * L.footprintM - 1);
});

// A stand-in scene and world for the runtime (no renderer).
function fakeScene() { const kids = new Set(); return { kids, add: (o) => kids.add(o), remove: (o) => kids.delete(o) }; }
const UNI = { uNight: { value: 0 } };
const CHUNKS = { UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' };

test('built near, shown within 80 km, hidden and then released far away; lights only at night', () => {
  const scene = fakeScene();
  const uni = { uNight: { value: 0 } };
  const lm = createLandmarks(scene, uni, CHUNKS, { heightfield: { heightAt: () => 12 } });
  const lotte = LANDMARKS.find((l) => l.id === 'lotte');
  const at = (dx, dy) => { const o = { x: lotte.x + dx, y: lotte.y + dy }; return lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 600, z: 0 } }); };
  let s = at(0, -3000);
  assert.equal(scene.kids.size, 1);
  const it = lm.items.find((i) => i.L.id === 'lotte');
  assert.equal(it.state, 'built');
  assert.ok(it.mesh.visible && !it.pts.visible, 'shown by day, its lights hidden');
  assert.ok(Math.abs(it.ground - 11.5) < 1e-9);
  // the mesh is placed relative to the origin, dropped by the Earth's curve
  assert.ok(Math.abs(it.mesh.position.x) < 1e-6 && Math.abs(it.mesh.position.z + 3000) < 1e-6);
  assert.ok(it.mesh.position.y < 11.5 && it.mesh.position.y > 11.5 - 1);
  const dayCalls = s.drawCalls;
  uni.uNight.value = 1;
  s = at(0, -3000);
  assert.ok(it.pts.visible);
  assert.ok(s.drawCalls > dayCalls);
  // (v0.7.0: the flag-off assertion, nothing outside Korea without the region, went.)
  // hidden beyond 80 km (no draw call), kept until 250 km, released beyond
  s = at(0, -82000);
  assert.equal(it.state, 'built');
  assert.equal(it.mesh.visible, false);
  assert.equal(it.pts.visible, false);
  s = at(0, -320000);
  assert.equal(it.state, 'none');
  assert.equal(s.drawCalls, 0);
  assert.equal(scene.kids.size, 0);
  // Shanghai's build near Lujiazui
  const sh = LANDMARKS.find((l) => l.id === 'shtower');
  const o = { x: sh.x, y: sh.y - 5000 };
  s = lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 900, z: 0 } });
  assert.equal(s.shown, 4);
  assert.ok(landmarkOn(sh));
  lm.dispose();
  assert.equal(scene.kids.size, 0);
});

// ------------------------------------------------------------------ v0.6.3 (briefs/V0-6-3.md Part 5)
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { scaleFactor } from '../src/world/frame.js';
import { runwayRects } from '../src/world/runways.js';
import { landmarkExclusions } from '../src/world/centres.js';
import { parseCentre, recordMean } from '../src/world/centres-worker.js';

const NEW = ['citic', 'cctv', 'russky', 'zolotoy', 'cctvtower', 'tjtower', 'lntower'];
const byId = (id) => LANDMARKS.find((l) => l.id === id);

test('v0.6.3: the new landmarks\' countries, cities and sources', () => {
  for (const id of NEW) {
    const L = byId(id);
    assert.ok(['beijing', 'tianjin', 'shenyang', 'vladivostok'].includes(L.city), id);
    assert.equal(L.country, L.city === 'vladivostok' ? 'RU' : 'CN', id);
    assert.match(L.source, /Wikipedia/, `${id}: a public source`);
    assert.equal(landmarkOn(L), true, `${id}: on`);   // (v0.7.0: was CITIES_ON && EAST_ASIA_ON, both flags gone)
  }
});

test('v0.6.3: the bridges from their real ends: the main span, the pylons, the deck coming down to each shore', () => {
  for (const [id, span, H, clear] of [['russky', 1104, 321, 70], ['zolotoy', 737, 226, 60]]) {
    const L = byId(id);
    assert.equal(L.kind, 'bridge');
    // the pylons' spacing in map metres, divided by the frame's scale there, is the published main span (2 %)
    const real = (2 * L.geo.s) / scaleFactor(L.lat);
    assert.ok(Math.abs(real - span) / span < 0.02, `${id}: main span ${real.toFixed(0)} m against ${span} m`);
    assert.ok(L.geo.n0 < -L.geo.s - 100 && L.geo.n1 > L.geo.s + 100, `${id}: the deck runs past both pylons`);
    assert.equal(L.parts.length, 2);
    assert.equal(baseHeight(L, () => 55), 0, `${id}: based at the sea`);
    // the ground read at each end, in the deck's order
    const ends = bridgeEnds(L, (x, y) => (Math.abs(x - L.endsMap[0][0]) < 1 && Math.abs(y - L.endsMap[0][1]) < 1 ? 40 : 12));
    assert.equal(ends.length, 2);
    assert.ok(ends.includes(40) && ends.includes(12));
    assert.deepEqual(bridgeEnds(L, () => -5), [3, 3], 'never below 3 m');
    // the model with the ends at 40 and 12 m: the deck meets them, clears the water by `clear` mid-span
    const g = buildModel(L, [40, 12]).geometry.getAttribute('position');
    const brg = L.brg * Math.PI / 180, ux = Math.sin(brg), uz = -Math.cos(brg);
    let midLow = Infinity, maxN = -Infinity, minN = Infinity, topAt0 = -Infinity, topAt1 = -Infinity;
    for (let i = 0; i < g.count; i++) {
      const x = g.getX(i), y = g.getY(i), z = g.getZ(i), n = x * ux + z * uz, lat = Math.abs(x * Math.cos(brg) + z * Math.sin(brg));
      maxN = Math.max(maxN, n); minN = Math.min(minN, n);
      if (Math.abs(n) < 30 && lat < 20) midLow = Math.min(midLow, y);
      if (n < L.geo.n0 + 1) topAt0 = Math.max(topAt0, y);
      if (n > L.geo.n1 - 1) topAt1 = Math.max(topAt1, y);
    }
    assert.ok(Math.abs(midLow - clear - 3) < 1.5, `${id}: underside mid-span ${midLow}`);
    assert.ok(Math.abs(minN - L.geo.n0) < 2 && Math.abs(maxN - L.geo.n1) < 2, `${id}: the deck's ends`);
    assert.ok(Math.abs(topAt0 - 40) < 0.5 && Math.abs(topAt1 - 12) < 0.5, `${id}: the deck at the ground (${topAt0}, ${topAt1})`);
    // the centres leave out only the pylons' circles, not the bridge's whole length
    const ex = landmarkExclusions([L]);
    assert.equal(ex.length, 2);
    for (const e of ex) assert.equal(e.r, PYLON_R);
  }
});

const CENTRES = JSON.parse(readFileSync(new URL('../data/centres/centres.json', import.meta.url))).centres;
test('v0.6.3: a landmark inside a centre\'s box replaces its building there (CITIC, CCTV, the Tianjin and Liaoning towers)', () => {
  const ex = landmarkExclusions(LANDMARKS);
  const inBox = (c, L) => L.x > c.box[0] && L.x < c.box[2] && L.y > c.box[1] && L.y < c.box[3];
  const seen = {};
  for (const id of NEW) {
    const L = byId(id);
    const c = CENTRES.find((cc) => inBox(cc, L));
    if (!c) continue;
    const p = parseCentre(gunzipSync(readFileSync(new URL(`../data/centres/${c.file}`, import.meta.url))).buffer);
    let tallestOut = 0;
    for (let i = 0; i < p.count; i++) {
      const [mx, my] = recordMean(p, i);
      const X = c.origin[0] + mx / 2, Y = c.origin[1] + my / 2;
      if (ex.some((e) => (X - e.x) ** 2 + (Y - e.y) ** 2 < e.r * e.r) && Math.hypot(X - L.x, Y - L.y) < L.footprintM + 1) tallestOut = Math.max(tallestOut, p.height[i] / 10);
    }
    seen[id] = [c.id, tallestOut];
  }
  // OSM's own extrusions of them (528 m, 245 m, 415 m, and Liaoning's 160 m from its levels) are left out
  assert.deepEqual(Object.keys(seen).sort(), ['cctv', 'citic', 'lntower', 'tjtower', 'zolotoy'].sort());
  assert.equal(seen.citic[0], 'beijing'); assert.ok(seen.citic[1] >= 527, `citic ${seen.citic[1]}`);
  assert.ok(seen.cctv[1] >= 230, `cctv ${seen.cctv[1]}`);
  assert.equal(seen.tjtower[0], 'tianjin'); assert.ok(seen.tjtower[1] >= 414);
  assert.equal(seen.lntower[0], 'shenyang'); assert.ok(seen.lntower[1] >= 150);
  assert.equal(seen.zolotoy[0], 'vladivostok');
});

test('v0.6.3: no landmark on a runway or its strip', () => {
  const dir = new URL('../data/airports/', import.meta.url);
  const airports = readdirSync(dir).filter((f) => /^[A-Z]{4}\.json$/.test(f)).map((f) => JSON.parse(readFileSync(new URL(f, dir))));
  const rects = runwayRects(airports);
  assert.ok(rects.length > 20);
  for (const L of LANDMARKS) {
    const circles = landmarkFootprints().filter((c) => c.id === L.id);
    if (L.kind === 'bridge') circles.push({ x: L.endsMap[0][0], y: L.endsMap[0][1], r: 20 }, { x: L.endsMap[1][0], y: L.endsMap[1][1], r: 20 });
    for (const r of rects) for (const c of circles) {
      const dx = c.x - r.cx, dy = c.y - r.cy;
      const along = Math.abs(dx * r.dx + dy * r.dy), across = Math.abs(-dx * r.dy + dy * r.dx);
      // the strip: 150 m each side of the centreline, 60 m past each end
      assert.ok(along > r.halfLen + 60 + c.r || across > 150 + c.r, `${L.id} on ${r.icao}'s runway strip`);
    }
  }
});

// ------------------------------------------------------------------ v0.6.4 (briefs/V0-6-4.md, "Centres and landmarks")
const NEW4 = ['ryugyong', 'juche', 'sapporotv', 'daikannon'];
// The heights as the sources give them (Wikipedia, read 2026-11-21): within 0.5 %.
const SOURCE4 = { ryugyong: 330, juche: 170, sapporotv: 147.2, daikannon: 100 };
const bearingOf = (x, z) => ((Math.atan2(x, -z) * 180 / Math.PI) + 360) % 360;   // scene x east, z = -north

test('v0.6.4: the four new landmarks\' countries, cities, heights and sources', () => {
  const city = { ryugyong: 'pyongyang', juche: 'pyongyang', sapporotv: 'sapporo', daikannon: 'sendai' };
  for (const id of NEW4) {
    const L = byId(id);
    assert.equal(L.city, city[id], id);
    assert.equal(L.country, L.city === 'pyongyang' ? 'KP' : 'JP', id);
    assert.match(L.source, /Wikipedia/, `${id}: a public source`);
    assert.match(L.source, /OSM/, `${id}: placed from OSM`);
    assert.ok(Math.abs(L.heightM - SOURCE4[id]) / SOURCE4[id] < 0.005, `${id}: ${L.heightM} m against ${SOURCE4[id]} m`);
    assert.equal(landmarkOn(L), true, `${id}: on`);   // (v0.7.0: was CITIES_ON && EAST_ASIA_ON; the two flag-off checks went)
  }
  // the Juche Tower on the Taedong's east bank: east of Kim Il Sung Square (39.0195 N, 125.7527 E) across the river
  assert.ok(byId('juche').lon > 125.758);
  // the Daikannon on its hill north-west of Sendai's centre, outside the centre's box
  const sendai = CENTRES.find((c) => c.id === 'sendai'), dk = byId('daikannon');
  assert.ok(dk.x < sendai.box[0] && dk.y > sendai.box[3], 'north-west of, and outside, the centre');
});

test('v0.6.4: each reads as itself: three wings at 120 degrees, a lattice, an obelisk with its flame, a figure', () => {
  // the Ryugyong Hotel: its far points (over 90 m out) in three clusters, along OSM's wing bearings 77, 197, 317
  {
    const p = buildModel(byId('ryugyong')).geometry.getAttribute('position');
    const far = [];
    for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i), p.getZ(i)) > 90 && p.getY(i) > 12) far.push(bearingOf(p.getX(i), p.getZ(i)));
    for (const w of [77, 197, 317]) assert.ok(far.some((b) => Math.abs(((b - w + 540) % 360) - 180) < 8), `a wing towards ${w}`);
    assert.ok(far.every((b) => [77, 197, 317].some((w) => Math.abs(((b - w + 540) % 360) - 180) < 12)), 'nothing else so far out');
    // the slope: each wing's reach shrinks with height (at 230 m about 40 m), the crown narrow at 310 m
    let r230 = 0, r310 = 0;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)), y = p.getY(i); if (Math.abs(y - 230) < 5) r230 = Math.max(r230, r); if (y > 305 && y < 316) r310 = Math.max(r310, r); }
    assert.ok(r230 > 30 && r230 < 55, `reach at 230 m: ${r230}`);
    assert.ok(r310 < 12, `the crown at 310 m: ${r310}`);
  }
  // the Sapporo TV Tower: a lattice (thin members and the far stand-in shell), the deck about 90 m up
  {
    const g = buildModel(byId('sapporotv')).geometry, e = g.getAttribute('aExt'), p = g.getAttribute('position'), f = g.getAttribute('aFac');
    let shell = 0, deckY = [];
    for (let i = 0; i < e.count; i++) { if (e.getZ(i) > 0.5) shell++; if (f.getX(i) > 0 && p.getY(i) > 60 && p.getY(i) < 120) deckY.push(p.getY(i)); }
    assert.ok(shell > 0 && shell < e.count / 4, `the shell is a small share (${shell} of ${e.count})`);
    assert.ok(e.count / 3 > 1500, 'members, not a shaft');
    assert.ok(deckY.length && Math.abs((Math.min(...deckY) + Math.max(...deckY)) / 2 - 90.4) < 2, 'the deck at 90 m');
  }
  // the Juche Tower: slender (under 20 m across above the terrace), the torch's flame lit at night
  {
    const g = buildModel(byId('juche')).geometry, p = g.getAttribute('position'), gl = g.getAttribute('aGlow');
    let wide = 0, flame = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 10) wide = Math.max(wide, Math.hypot(p.getX(i), p.getZ(i)));
      if (p.getY(i) > 152 && gl.getX(i) > 1) flame++;
    }
    assert.ok(wide < 13.5, `the spire's half-width ${wide}`);
    assert.ok(flame > 30, 'the flame glows');
  }
  // the Daikannon: a figure, not a tower: broader at the shoulders than at the waist, the head narrower than both
  {
    const p = buildModel(byId('daikannon')).geometry.getAttribute('position');
    const halfAt = (y0, y1) => { let r = 0; for (let i = 0; i < p.count; i++) if (p.getY(i) >= y0 && p.getY(i) <= y1) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i))); return r; };
    const waist = halfAt(42, 46), shoulders = halfAt(78, 80), head = halfAt(90, 97);
    assert.ok(shoulders > waist + 1.5, `shoulders ${shoulders} against waist ${waist}`);
    assert.ok(head < waist * 0.65 && head > 3, `head ${head}`);
  }
});

test('v0.6.4: a landmark inside a centre\'s box replaces its building there (the Ryugyong Hotel, the Juche Tower, the Sapporo TV Tower)', () => {
  const ex = landmarkExclusions(LANDMARKS);
  const inBox = (c, L) => L.x > c.box[0] && L.x < c.box[2] && L.y > c.box[1] && L.y < c.box[3];
  const seen = {};
  for (const id of NEW4) {
    const L = byId(id);
    const c = CENTRES.find((cc) => inBox(cc, L));
    if (!c) continue;
    const p = parseCentre(gunzipSync(readFileSync(new URL(`../data/centres/${c.file}`, import.meta.url))).buffer);
    let tallestOut = 0, tallestKept = 0;
    for (let i = 0; i < p.count; i++) {
      const [mx, my] = recordMean(p, i);
      const X = c.origin[0] + mx / 2, Y = c.origin[1] + my / 2;
      if (Math.hypot(X - L.x, Y - L.y) >= L.footprintM) continue;
      if (ex.some((e) => (X - e.x) ** 2 + (Y - e.y) ** 2 < e.r * e.r)) tallestOut = Math.max(tallestOut, p.height[i] / 10);
      else tallestKept = Math.max(tallestKept, p.height[i] / 10);
    }
    seen[id] = [c.id, tallestOut, tallestKept];
  }
  assert.deepEqual(Object.keys(seen).sort(), ['juche', 'ryugyong', 'sapporotv']);
  // OSM's own: the hotel's 322 m pinnacle part and its wings, the tower's 170 m torch and stages, the TV tower's 147.2 m
  assert.equal(seen.ryugyong[0], 'pyongyang'); assert.ok(seen.ryugyong[1] >= 322, `ryugyong ${seen.ryugyong[1]}`);
  assert.equal(seen.juche[0], 'pyongyang'); assert.ok(seen.juche[1] >= 170);
  assert.equal(seen.sapporotv[0], 'sapporo'); assert.ok(seen.sapporotv[1] >= 147);
  for (const id of Object.keys(seen)) assert.equal(seen[id][2], 0, `${id}: nothing of OSM's left inside its footprint`);
});
