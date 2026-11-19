// V060.md Part 6 step 3: the landmarks' list and models (node, no WebGL: three.js's BufferGeometry only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, CITY_BOXES, buildModel, landmarkFootprints, baseHeight, createLandmarks, landmarkOn } from '../src/world/landmarks.js';
import { MODELS } from '../src/world/landmark-models.js';
import { setCities, setEastAsia, CITIES_ON, EAST_ASIA_ON } from '../src/world/region.js';

// The brief's heights (V060.md Part 6 and the subagent's brief): within 2 %.
const BRIEF = {
  lotte: 555, b63: 250, nseoul: 237, parc1: 333, shtower: 632, swfc: 492, jinmao: 420, pearl: 468,
  skytree: 634, tokyotower: 333, azabudai: 325, tmg: 243, ylmt: 296, lct: 411, neatt: 305, harukas: 300,
  umeda: 173, fktower: 234, fkdome: 84,
};
const ORDER = ['lotte', 'b63', 'nseoul', 'parc1', 'shtower', 'swfc', 'jinmao', 'pearl', 'skytree', 'tokyotower', 'azabudai', 'tmg', 'ylmt', 'lct', 'neatt', 'harukas', 'umeda', 'fktower', 'fkdome'];
const TRI_BUDGET = 6000, TOTAL_BUDGET = 60000;

test('the list: unique ids, the brief\'s order, a model for each, a source', () => {
  const ids = LANDMARKS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ORDER);
  for (const L of LANDMARKS) {
    assert.ok(MODELS[L.id], `${L.id}: a model`);
    assert.ok(typeof L.source === 'string' && L.source.length > 10, `${L.id}: a source`);
    assert.ok(L.footprintM > 5 && L.footprintM < 300, `${L.id}: footprint`);
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

test('with CITIES_ON off nothing exists in the scene', () => {
  const was = CITIES_ON;
  setCities(false);
  const scene = fakeScene();
  const lm = createLandmarks(scene, UNI, CHUNKS, { heightfield: { heightAt: () => 10 } });
  const L = LANDMARKS[0];
  const s = lm.update({ camMap: { x: L.x, y: L.y - 1000 }, origin: { x: L.x, y: L.y - 1000 }, camScene: { x: 0, y: 500, z: 0 } });
  assert.equal(scene.kids.size, 0);
  assert.equal(s.drawCalls, 0);
  assert.equal(s.built, 0);
  setCities(was);
});

test('built near, shown within 80 km, hidden and then released far away; lights only at night; Korea only without the region', () => {
  const wasC = CITIES_ON, wasE = EAST_ASIA_ON;
  setCities(true); setEastAsia(false);
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
  // nothing outside Korea without the region
  assert.ok(lm.items.filter((i) => i.L.country !== 'KR').every((i) => i.state === 'none'));
  // hidden beyond 80 km (no draw call), kept until 250 km, released beyond
  s = at(0, -82000);
  assert.equal(it.state, 'built');
  assert.equal(it.mesh.visible, false);
  assert.equal(it.pts.visible, false);
  s = at(0, -320000);
  assert.equal(it.state, 'none');
  assert.equal(s.drawCalls, 0);
  assert.equal(scene.kids.size, 0);
  // the region on: Shanghai's build near Lujiazui
  setEastAsia(true);
  const sh = LANDMARKS.find((l) => l.id === 'shtower');
  const o = { x: sh.x, y: sh.y - 5000 };
  s = lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 900, z: 0 } });
  assert.equal(s.shown, 4);
  assert.ok(landmarkOn(sh));
  lm.dispose();
  assert.equal(scene.kids.size, 0);
  setCities(wasC); setEastAsia(wasE);
});
