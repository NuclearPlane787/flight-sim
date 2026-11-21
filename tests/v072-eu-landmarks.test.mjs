// v0.7.2 (briefs/V0-7-2.md part 4): Europe's next landmarks, appended after v0.7.1's forty-three: the list, the
// models (each reading as itself), the three Forth bridges based at the sea with their ends on the installed ground,
// the Jet d'Eau in the lake, and East Asia's page untouched. Run in a process opened in Europe (tests/region-run.mjs),
// with one East Asia check outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

const NEW = ['koelnerdom', 'rheinturm', 'zizkov', 'stvitus', 'jetdeau', 'forthbridge', 'forthroad', 'queensferry', 'edinburghcastle', 'santiago'];
// The brief's "about" figures (within 3 %), except St Vitus's main tower: the article's 102.8 m (the brief's 97 m the
// commonly quoted figure) and Edinburgh Castle's [EST] 90 m (its own rock and buildings, from the lowest ground round it).
const BRIEF = { koelnerdom: 157, rheinturm: 240, zizkov: 216, stvitus: 102.8, jetdeau: 140, forthbridge: 110, forthroad: 156, queensferry: 207,
  edinburghcastle: 90, santiago: 75 };
const COUNTRY = { cologne: 'DE', dusseldorf: 'DE', prague: 'CZ', geneva: 'CH', edinburgh: 'GB', santiago: 'ES' };
const TRI_MAX = 4000, TOTAL_MAX = 16000, BEFORE = 43;

if (inRegion('europe', import.meta.url)) {
  const { LANDMARKS, EUROPE_LANDMARKS, EUROPE_CITY_BOXES, PYLON_R, buildModel, bridgeEnds, baseHeight, landmarkOn, landmarkFootprints, createLandmarks } = await import('../src/world/landmarks.js');
  const { MODELS, EUROPE_MODELS } = await import('../src/world/landmark-models.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);
  const pos = (id, endH = null) => buildModel(byId(id), endH).geometry.getAttribute('position');
  const local = (L, x, z) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180), N = -z; return [x * c - N * s, x * s + N * c]; };
  const reach = (p, y0, y1, cx = 0, cz = 0) => { let r = 0; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= y0 && y <= y1) r = Math.max(r, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz)); } return r; };
  const count = (L, p, f) => { let k = 0; for (let i = 0; i < p.count; i++) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); if (f(lx, p.getY(i), ln)) k++; } return k; };
  // the distinct places (cells of `cell` m in local x, n) of the vertices above y0
  const tops = (L, p, y0, cell = 8) => { const s = new Set(); for (let i = 0; i < p.count; i++) if (p.getY(i) > y0) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); s.add(`${Math.round(lx / cell)},${Math.round(ln / cell)}`); } return s; };

  test("v0.7.2's list: after v0.7.1's forty-three, in the brief's order, each in its city's box with a country, a source and its own model", () => {
    assert.ok(EUROPE_LANDMARKS.length >= BEFORE + NEW.length);     // v0.7.3's follow (tests/v073-eu-landmarks.test.mjs)
    assert.deepEqual(EUROPE_LANDMARKS.slice(BEFORE, BEFORE + NEW.length).map((l) => l.id), NEW);
    assert.equal(LANDMARKS.length, 30);
    for (const L of EUROPE_LANDMARKS.slice(BEFORE, BEFORE + NEW.length)) {
      assert.equal(L.region, 'europe');
      assert.equal(landmarkOn(L), true);
      assert.equal(L.country, COUNTRY[L.city], `${L.id}: country`);
      assert.ok(EUROPE_MODELS[L.id] && !MODELS[L.id], `${L.id}: its own model`);
      assert.match(L.source, /Wikipedia "[^"]+" \(read 2026-11-21/, `${L.id}: a source read tonight`);
      const b = EUROPE_CITY_BOXES[L.city];
      assert.ok(b && L.lat > b[0] && L.lat < b[2] && L.lon > b[1] && L.lon < b[3], `${L.id} outside ${L.city}`);
      assert.ok(Math.abs(L.heightM - BRIEF[L.id]) / BRIEF[L.id] < 0.03, `${L.id}: ${L.heightM} against ${BRIEF[L.id]}`);
      assert.ok(Number.isFinite(L.x) && Number.isFinite(L.y) && Number.isFinite(L.brg));
    }
    assert.equal(new Set(EUROPE_LANDMARKS.map((l) => l.id)).size, EUROPE_LANDMARKS.length);
    // the Forth bridges side by side, east to west: the 1890 bridge, the road bridge, the Queensferry Crossing
    const xs = ['forthbridge', 'forthroad', 'queensferry'].map((id) => byId(id).x);
    assert.ok(xs[0] > xs[1] && xs[1] > xs[2], `${xs}`);
    assert.ok(xs[0] - xs[2] < 2500 && xs[0] - xs[2] > 1000);
  });

  test('every new model: whole triangles, finite, unit normals, base at 0, top at heightM +- 1 %, inside its footprint; under 4,000 each and 16,000 in all; lights', () => {
    let total = 0;
    const counts = {};
    for (const L of EUROPE_LANDMARKS.slice(BEFORE, BEFORE + NEW.length)) {
      const { geometry: g, lights } = buildModel(L);
      const p = g.getAttribute('position'), n = g.getAttribute('normal');
      assert.equal(p.count % 3, 0);
      for (const name of ['aCol', 'aFac', 'aExt', 'aGlow']) assert.equal(g.getAttribute(name).count, p.count, `${L.id}: ${name}`);
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${L.id}: finite`);
        assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3, `${L.id}: unit normal`);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        assert.ok(Math.hypot(x, z) <= L.footprintM * 1.05 + 2, `${L.id}: a vertex ${Math.hypot(x, z).toFixed(1)} m out`);
      }
      assert.ok(Math.abs(minY) < 1e-6, `${L.id}: base ${minY}`);
      assert.ok(Math.abs(maxY - L.heightM) / L.heightM < 0.01, `${L.id}: top ${maxY} against ${L.heightM}`);
      const tris = p.count / 3;
      counts[L.id] = tris;
      assert.ok(tris > 20 && tris <= TRI_MAX, `${L.id}: ${tris} triangles`);
      total += tris;
      assert.ok(lights.every((l) => l.length === 4 && l.every(Number.isFinite)), `${L.id}: lights`);
      if (L.heightM >= 150) {
        assert.ok(lights.length >= 3 && lights.some((l) => l[3] === 1), `${L.id}: three lights, one flashing`);
        assert.ok(Math.max(...lights.map((l) => l[1])) > L.heightM * 0.95, `${L.id}: a light at the top`);
      }
    }
    assert.ok(total <= TOTAL_MAX, `${total} triangles in all`);
    console.log('# triangles', JSON.stringify(counts), 'total', total);
  });

  test('the same every run', () => {
    for (const id of ['koelnerdom', 'forthbridge', 'jetdeau']) assert.deepEqual(Array.from(pos(id).array), Array.from(pos(id).array));
  });

  test('Cologne, Düsseldorf, Prague: two spires over the dark nave, the pod on its shaft, one of three tubes on top, the cathedral\'s great tower over its castle', () => {
    const kd = byId('koelnerdom'), kp = pos('koelnerdom');
    const sp = tops(kd, kp, 150, 6);
    assert.ok(sp.size >= 2 && count(kd, kp, (lx, y, ln) => y > 150 && ln > 10) > 0 && count(kd, kp, (lx, y, ln) => y > 150 && ln < -10) > 0, 'two spires');
    assert.equal(count(kd, kp, (lx, y) => y > 115 && lx > -45), 0, 'nothing but the west towers above 115 m');
    assert.ok(count(kd, kp, (lx, y) => y > 55 && y < 62 && lx > -45 && lx < 50) > 0, 'the roof\'s ridge');
    const rt = pos('rheinturm');
    assert.ok(reach(rt, 164, 178) > 2 * reach(rt, 100, 150), 'the Rheinturm\'s pod');
    assert.ok(reach(rt, 205, 240.5) < 3, 'the mast');
    const zz = byId('zizkov'), zp = pos('zizkov');
    assert.equal(tops(zz, zp, 140, 4).size > 0 && count(zz, zp, (lx, y, ln) => y > 140 && Math.hypot(lx, ln - 7.5) > 7), 0, 'one tube above the decks');
    assert.ok(count(zz, zp, (lx, y, ln) => y > 50 && y < 120 && Math.hypot(lx, ln) > 14) > 50, 'the pods out on the tubes');
    const sv = byId('stvitus'), vp = pos('stvitus');
    let top = null;
    for (let i = 0; i < vp.count; i++) if (!top || vp.getY(i) > top[1]) top = [vp.getX(i), vp.getY(i), vp.getZ(i)];
    const [tx, tn] = local(sv, top[0], top[2]);
    assert.ok(Math.hypot(tx - 18, tn + 24) < 1, 'the great south tower the top');
    assert.ok(count(sv, vp, (lx, y) => y > 78 && y < 83 && lx < -50) > 0, 'the west spires at 82 m');
    assert.ok(reach(vp, 0, 25) > 120 && reach(vp, 30, 60) < 70, 'a long low castle round the cathedral');
  });

  test('Geneva: the plume thin at the jetty, widest high up, leaning downwind; the jetty towards the shore', () => {
    const jd = byId('jetdeau'), jp = pos('jetdeau');
    assert.ok(reach(jp, 2, 10, 0, 0) < 1.2 && reach(jp, 125, 135, 0, 0) > 5, 'thin at the foot, wide high up');
    assert.ok(count(jd, jp, (lx, y) => y > 120 && lx > 5) > 0 && count(jd, jp, (lx, y) => y > 120 && lx < -5) === 0, 'leaning to local +x');
    assert.ok(count(jd, jp, (lx, y, ln) => y < 2 && ln < -140) > 0 && count(jd, jp, (lx, y, ln) => ln > 8) === 0, 'the jetty to the south (local -n)');
    assert.deepEqual(jd.parts, [[0, 0, 12]]);
    assert.equal(baseHeight(jd, () => 372), 371.5);
  });

  test('the Forth bridges: based at the sea, two pylons\' parts each, the deck down to the ground read at its ends; three cantilevers, two towers, three towers', () => {
    for (const id of ['forthbridge', 'forthroad', 'queensferry']) {
      const L = byId(id);
      assert.equal(L.kind, 'bridge');
      assert.equal(baseHeight(L, () => 25), 0, `${id}: based at the sea`);
      assert.equal(L.parts.length, 2);
      for (const [dx, dy, r] of L.parts) { assert.equal(r, PYLON_R); assert.ok(Math.abs(Math.hypot(dx, dy) - L.geo.s) < 1); }
      assert.equal(landmarkFootprints().filter((f) => f.id === id).length, 2);
      assert.deepEqual(bridgeEnds(L, () => 12), [12, 12]);
      const p = pos(id, [20, 6]);
      const near = (n0) => { let y = Infinity; for (let i = 0; i < p.count; i++) { const [, ln] = local(L, p.getX(i), p.getZ(i)); if (Math.abs(ln - n0) < 1) y = Math.min(y, p.getY(i)); } return y; };
      const deckD = { forthbridge: 3, forthroad: 7, queensferry: 5 }[id];
      assert.ok(Math.abs(near(L.geo.n0) - Math.max(20.3 - deckD, 0)) < 0.6, `${id}: the n0 end at the ground (${near(L.geo.n0)})`);
      assert.ok(Math.abs(near(L.geo.n1) - Math.max(6.3 - deckD, 0)) < 0.6, `${id}: the n1 end at the ground (${near(L.geo.n1)})`);
      assert.ok(count(L, p, (lx, y, ln) => y < 1 && Math.abs(ln) > L.geo.s + 300) > 8, `${id}: approach piers`);
    }
    const towersAt = (id, y0, half) => { const L = byId(id), p = pos(id); const s = new Set(); for (let i = 0; i < p.count; i++) if (p.getY(i) > y0) { const [, ln] = local(L, p.getX(i), p.getZ(i)); s.add(Math.round(ln / half)); } return [...s].sort((a, b) => a - b); };
    const fb = byId('forthbridge').geo.s, fr = byId('forthroad').geo.s, qc = byId('queensferry').geo.s;
    assert.deepEqual(towersAt('forthbridge', 100, fb), [-1, 0, 1], 'the Forth Bridge: three cantilever towers');
    assert.deepEqual(towersAt('forthroad', 150, fr), [-1, 1], 'the road bridge: two towers');
    assert.deepEqual(towersAt('queensferry', 190, qc), [-1, 0, 1], 'the Queensferry Crossing: three towers');
    // the main spans: the Forth Bridge's two of about 521 m between the cantilevers' faces, the road bridge's 1,006 m, the Crossing's two of 650 m
    assert.ok(Math.abs(fb - 552) / 552 < 0.012, `the Forth Bridge's towers ${fb} m apart (521 m between their faces)`);
    assert.ok(Math.abs(2 * fr - 1006) / 1006 < 0.012 && Math.abs(qc - 650) / 650 < 0.012, `${fr} ${qc}`);
    // clear under the road bridge's main span and the Crossing's
    assert.equal(count(byId('forthroad'), pos('forthroad'), (lx, y, ln) => Math.abs(ln) < fr - 40 && y > 1 && y < 42), 0, 'clear under the main span');
    const len = (id) => byId(id).geo.n1 - byId(id).geo.n0;
    assert.ok(Math.abs(len('forthbridge') - 2467) / 2467 < 0.02 && Math.abs(len('forthroad') - 2512) / 2512 < 0.02 && Math.abs(len('queensferry') - 2700) / 2700 < 0.02, 'the lengths');
  });

  test('Edinburgh and Santiago: the castle on its own rock; the twin west towers and the clock tower', () => {
    const ep = pos('edinburghcastle');
    assert.ok(reach(ep, 0, 1) > 120 && reach(ep, 69, 70.5) < 110, 'the crag narrowing to its top');
    assert.ok(reach(ep, 75, 90) > 60, 'buildings spread over the top');
    const sg = byId('santiago'), sp = pos('santiago');
    assert.ok(count(sg, sp, (lx, y, ln) => y > 68 && lx < -40 && ln > 8) > 0 && count(sg, sp, (lx, y, ln) => y > 68 && lx < -40 && ln < -8) > 0, 'two west towers');
    assert.ok(count(sg, sp, (lx, y, ln) => y > 72 && lx > 20 && ln < -20) > 0, 'the clock tower the top');
    assert.ok(reach(sp, 26, 40) < 60, 'the nave low behind them');
  });

  test('the runtime in Europe: the Forth\'s three and the castle built near Edinburgh, the bridges at the sea, the castle on its ground', () => {
    const scene = { kids: new Set(), add(o) { this.kids.add(o); }, remove(o) { this.kids.delete(o); } };
    const lm = createLandmarks(scene, { uNight: { value: 0 } }, { UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' }, { heightfield: { heightAt: () => 40 } });
    assert.equal(lm.items.length, EUROPE_LANDMARKS.length);
    const c = byId('edinburghcastle'), o = { x: c.x, y: c.y - 3000 };
    const s = lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 500, z: 0 } });
    assert.equal(s.shown, 4, 'Edinburgh\'s four');
    const it = (id) => lm.items.find((x) => x.L.id === id);
    for (const id of ['forthbridge', 'forthroad', 'queensferry']) assert.equal(it(id).ground, 0);
    assert.equal(it('edinburghcastle').ground, 39.5);
    lm.dispose();
  });

  // The installed 250 m ground (batch C): each Forth bridge's two ends on land, its towers in the water; the Jet d'Eau
  // in the lake (inland water) with its jetty's root on the shore.
  const TILES = new URL('../data/europe/manifest.json', import.meta.url);
  test('the installed ground: the Forth bridges\' ends on land, their towers over the water; the Jet d\'Eau in the lake', { skip: !existsSync(TILES) }, async () => {
    const { tiledTerrain } = await import('./tile-terrain.mjs');
    const { hf } = await tiledTerrain({ layers: ['h', 'w'], airports: [], maxTiles: 24 });
    const fb = byId('forthroad');
    await hf.tiles.whenReady(fb.x, fb.y, 4000, 'test');
    for (const id of ['forthbridge', 'forthroad', 'queensferry']) {
      const L = byId(id);
      for (const [x, y] of L.endsMap) assert.ok(hf.heightAt(x, y) > 1 && !hf.waterAt(x, y), `${id}: an end on land (${hf.heightAt(x, y).toFixed(1)} m)`);
      for (const [dx, dy] of L.parts) assert.ok(hf.waterAt(L.x + dx, L.y + dy), `${id}: a tower in the water`);
      assert.ok(hf.waterAt(L.x, L.y), `${id}: the middle over the water`);
    }
    const jd = byId('jetdeau');
    await hf.tiles.whenReady(jd.x, jd.y, 1500, 'test');
    assert.ok(hf.waterAt(jd.x, jd.y) && hf.heightAt(jd.x, jd.y) > 300, 'the jet in the lake (inland water at its own level)');
    const ux = Math.sin(jd.brg * Math.PI / 180), uy = Math.cos(jd.brg * Math.PI / 180);
    let land = false;
    for (const d of [150, 175, 200, 225]) if (!hf.waterAt(jd.x - ux * d, jd.y - uy * d)) land = true;
    assert.ok(land, 'the shore within about 225 m along the jetty');
  });
} else {
  test("East Asia's page: v0.7.2's landmarks not on, its thirty as before", async () => {
    const { LANDMARKS, EUROPE_LANDMARKS, REGION_LANDMARKS, landmarkOn } = await import('../src/world/landmarks.js');
    assert.equal(REGION_LANDMARKS, LANDMARKS);
    assert.equal(LANDMARKS.length, 30);
    for (const L of EUROPE_LANDMARKS.slice(BEFORE, BEFORE + NEW.length)) assert.equal(landmarkOn(L), false, L.id);
  });
}
