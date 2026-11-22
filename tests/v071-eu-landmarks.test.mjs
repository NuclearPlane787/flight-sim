// v0.7.1 (briefs/V0-7-1.md part 5): Europe's next landmarks, appended after v0.7.0's twenty-eight: the list, the
// models (each reading as itself), the three long bridges based at the sea, and East Asia's page untouched.
// Run in a process opened in Europe (tests/region-run.mjs), with one East Asia check outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRegion } from './region-run.mjs';

const NEW = ['fernsehturm', 'brandenburg', 'stephansdom', 'donauturm', 'riesenrad', 'duomo', 'ponte25', 'cristorei', 'vascodagama',
  'oresund', 'torso', 'poolbeg', 'palaisjustice', 'lovell', 'rocket'];
// The brief's "about" figures (within 3 %; the Palace of Justice is the article's 116 m, the rocket the brief's 53 m).
const BRIEF = { fernsehturm: 368, brandenburg: 26, stephansdom: 136, donauturm: 252, riesenrad: 65, duomo: 108, ponte25: 190, cristorei: 110,
  vascodagama: 150, oresund: 204, torso: 190, poolbeg: 207, palaisjustice: 116, lovell: 89, rocket: 53 };
const COUNTRY = { berlin: 'DE', vienna: 'AT', milan: 'IT', lisbon: 'PT', oresund: 'DK', malmo: 'SE', dublin: 'IE', brussels: 'BE', manchester: 'GB', toulouse: 'FR' };
const TRI_MAX = 4000, TOTAL_MAX = 20000;

if (inRegion('europe', import.meta.url)) {
  const { LANDMARKS, EUROPE_LANDMARKS, EUROPE_CITY_BOXES, PYLON_R, buildModel, bridgeEnds, baseHeight, landmarkOn, landmarkFootprints, createLandmarks } = await import('../src/world/landmarks.js');
  const { MODELS, EUROPE_MODELS } = await import('../src/world/landmark-models.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);
  const pos = (id, endH = null) => buildModel(byId(id), endH).geometry.getAttribute('position');
  const local = (L, x, z) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180), N = -z; return [x * c - N * s, x * s + N * c]; };
  const reach = (p, y0, y1, cx = 0, cz = 0) => { let r = 0; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= y0 && y <= y1) r = Math.max(r, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz)); } return r; };
  const count = (L, p, f) => { let k = 0; for (let i = 0; i < p.count; i++) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); if (f(lx, p.getY(i), ln)) k++; } return k; };

  test("v0.7.1's list: after v0.7.0's twenty-eight, in the brief's order, each in its city's box with a country, a source and its own model", () => {
    assert.ok(EUROPE_LANDMARKS.length >= 28 + NEW.length);     // v0.7.2's follow (tests/v072-eu-landmarks.test.mjs)
    assert.deepEqual(EUROPE_LANDMARKS.slice(28, 28 + NEW.length).map((l) => l.id), NEW);
    assert.equal(LANDMARKS.length, 35);   // (v0.7.5: East Asia's thirty and v0.7.5's five, appended)
    const ids = new Set();
    for (const L of EUROPE_LANDMARKS.slice(28, 28 + NEW.length)) {
      assert.ok(!ids.has(L.id)); ids.add(L.id);
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
    // v0.7.0's cities' boxes kept as they were
    for (const c of ['london', 'paris', 'frankfurt', 'madrid', 'zurich', 'munich', 'barcelona', 'rome']) assert.ok(EUROPE_CITY_BOXES[c]);
    // the Lovell Telescope in fields about 13 km south of Manchester's airport (53.354 N 2.275 W)
    const lv = byId('lovell');
    assert.ok(Math.abs(Math.hypot((lv.lat - 53.354) * 111.2, (lv.lon + 2.275) * 66.6) - 13.3) < 1.5);
  });

  test('every new model: whole triangles, finite, unit normals, base at 0, top at heightM +- 1 %, inside its footprint; under 4,000 each and 20,000 in all; lights', () => {
    let total = 0;
    const counts = {};
    for (const L of EUROPE_LANDMARKS.slice(28, 28 + NEW.length)) {
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
    for (const id of ['fernsehturm', 'vascodagama', 'lovell']) assert.deepEqual(Array.from(pos(id).array), Array.from(pos(id).array));
  });

  test('Berlin and Vienna: the sphere on its shaft, open passages through the gate, the south tower the top, the pod, the wheel a ring', () => {
    const ft = pos('fernsehturm');
    assert.ok(reach(ft, 205, 219) > 2.5 * reach(ft, 150, 190), 'the Fernsehturm\'s sphere');
    assert.ok(reach(ft, 260, 368) < 3, 'the antenna');
    const bg = byId('brandenburg'), bp = pos('brandenburg');
    for (const n0 of [0, 7, -7, 14, -14]) assert.equal(count(bg, bp, (lx, y, ln) => Math.abs(lx) < 3 && Math.abs(ln - n0) < 2.4 && y > 1.4 && y < 14.3), 0, `the passage at ${n0}`);
    assert.ok(count(bg, bp, (lx, y, ln) => Math.abs(ln) < 2 && y > 21) > 0, 'the quadriga over the middle');
    const sd = byId('stephansdom'), sp = pos('stephansdom');
    let top = null;
    for (let i = 0; i < sp.count; i++) if (!top || sp.getY(i) > top[1]) top = [sp.getX(i), sp.getY(i), sp.getZ(i)];
    const [tx, tn] = local(sd, top[0], top[2]);
    assert.ok(Math.hypot(tx + 6, tn + 26) < 1, 'the south tower the top');
    assert.ok(count(sd, sp, (lx, y) => y > 55 && y < 62 && lx > -45 && lx < 10) > 0, 'the steep roof\'s ridge');
    const dt = pos('donauturm');
    assert.ok(reach(dt, 155, 172) > 2.5 * reach(dt, 100, 140), 'the Donauturm\'s pod');
    const rr = byId('riesenrad'), rp = pos('riesenrad');
    const HUB = 64.75 - 30.2 - 0.3;
    let on = 0, all = 0;
    for (let i = 0; i < rp.count; i++) { const [lx, ln] = local(rr, rp.getX(i), rp.getZ(i)), y = rp.getY(i); if (Math.abs(lx) > 2.4 && Math.abs(lx) < 3.8 && y > 6) { all++; if (Math.abs(Math.hypot(ln, y - HUB) - 30.2) < 1.2) on++; } }
    assert.ok(all > 100 && on / all > 0.6, `the rims: ${on} of ${all}`);
  });

  test('Milan, Lisbon: pinnacles round the Duomo under its spire; the suspension bridge\'s towers, cables and deck; Christ the King\'s arches and arms', () => {
    const dm = byId('duomo'), dp = pos('duomo');
    const tips = new Set();
    for (let i = 0; i < dp.count; i++) { const y = dp.getY(i); if (y > 40 && y < 56) tips.add(`${Math.round(dp.getX(i) / 6)},${Math.round(dp.getZ(i) / 6)}`); }
    assert.ok(tips.size >= 25, `pinnacles: ${tips.size} cells`);
    assert.ok(count(dm, dp, (lx, y) => y > 100 && Math.abs(lx - 26) > 3) === 0, 'only the crossing\'s spire above 100 m');
    const pb = byId('ponte25'), pp = pos('ponte25');
    const S = 506.45;
    assert.equal(count(pb, pp, (lx, y, ln) => y > 186.5 && Math.abs(Math.abs(ln) - S) > 7), 0, 'nothing at the top but the towers');
    assert.ok(count(pb, pp, (lx, y, ln) => y > 186.5 && ln > 0) > 0 && count(pb, pp, (lx, y, ln) => y > 186.5 && ln < 0) > 0, 'two towers');
    assert.ok(count(pb, pp, (lx, y, ln) => Math.abs(ln) < 5 && y > 70 && y < 84) > 0, 'the deck at mid-span');
    assert.equal(count(pb, pp, (lx, y, ln) => Math.abs(ln) < 400 && Math.abs(ln) > 30 && y < 69), 0, 'clear under the main span');
    assert.ok(count(pb, pp, (lx, y, ln) => Math.abs(ln) > 200 && Math.abs(ln) < 300 && y > 95 && y < 140) > 0, 'the cables\' sag');
    const cr = byId('cristorei'), cp = pos('cristorei');
    assert.equal(count(cr, cp, (lx, y, ln) => Math.abs(lx) < 4.5 && Math.abs(ln) < 4.5 && y > 15 && y < 64), 0, 'the arches open under the terrace');
    assert.ok(reach(cp, 100.5, 104.5) > 12.5 && reach(cp, 82.5, 100) < 5, 'the arms out');
  });

  test('the long bridges: based at the sea, two pylons each, the deck down to the ground read at its ends, parts only at the pylons', () => {
    for (const id of ['ponte25', 'vascodagama', 'oresund']) {
      const L = byId(id);
      assert.equal(L.kind, 'bridge');
      assert.equal(baseHeight(L, () => 25), 0, `${id}: based at the sea`);
      assert.equal(L.parts.length, 2);
      for (const [dx, dy, r] of L.parts) { assert.equal(r, PYLON_R); assert.ok(Math.abs(Math.hypot(dx, dy) - L.geo.s) < 1); }
      const fp = landmarkFootprints().filter((f) => f.id === id);
      assert.equal(fp.length, 2, `${id}: the centres leave out only the pylons`);
      const e = bridgeEnds(L, () => 12);
      assert.deepEqual(e, [12, 12]);
    }
    for (const [id, H, PX] of [['vascodagama', 150, 17], ['oresund', 204, 16]]) {
      const L = byId(id), p = pos(id, [20, 6]);
      // above the deck's height only the pylons' columns (|x| about PX) and the stays near them
      assert.equal(count(L, p, (lx, y, ln) => y > H * 0.7 && (Math.abs(Math.abs(lx) - PX) > 5 || Math.min(Math.abs(ln - L.geo.s), Math.abs(ln + L.geo.s)) > 6)), 0, `${id}: the pylons alone at the top`);
      // the deck's ends at the ground read there (the deck's top at h, its underside D under it)
      const near = (n0) => { let y = Infinity; for (let i = 0; i < p.count; i++) { const [, ln] = local(L, p.getX(i), p.getZ(i)); if (Math.abs(ln - n0) < 1) y = Math.min(y, p.getY(i)); } return y; };
      assert.ok(Math.abs(near(L.geo.n0) - 15.5) < 0.6, `${id}: the n0 end at the ground (${near(L.geo.n0)})`);
      assert.ok(Math.abs(near(L.geo.n1) - 1.5) < 0.6, `${id}: the n1 end at the ground (${near(L.geo.n1)})`);
      // piers under the long approaches
      assert.ok(count(L, p, (lx, y, ln) => y < 1 && Math.abs(ln) > L.geo.s + 100) > 20, `${id}: piers`);
    }
    // the lengths: the Øresund's 7,845 m (8.0 km between the game's shores), the Vasco da Gama's water crossing about 12.2 km, the 25 de Abril's 2,000 m
    const len = (id) => byId(id).geo.n1 - byId(id).geo.n0;
    assert.ok(Math.abs(len('oresund') - 7845) < 200, `${len('oresund')}`);
    assert.ok(Math.abs(len('vascodagama') - 12165) < 200, `${len('vascodagama')}`);
    assert.ok(Math.abs(len('ponte25') - 2000) < 30, `${len('ponte25')}`);
    assert.ok(Math.abs(2 * byId('oresund').geo.s - 490) < 10 && Math.abs(2 * byId('vascodagama').geo.s - 420) < 10 && Math.abs(2 * byId('ponte25').geo.s - 1013) < 10, 'the main spans');
  });

  test('Malmö, Dublin, Brussels, Jodrell Bank, Toulouse: the twist, two chimneys, the dome on its block, the bowl, the launcher', () => {
    const tp = pos('torso');
    const dirAt = (y0, y1) => { let best = null; for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); if (y > y0 && y < y1) { const r = Math.hypot(tp.getX(i), tp.getZ(i)); if (!best || r > best[0]) best = [r, Math.atan2(-tp.getZ(i), tp.getX(i))]; } } return best[1]; };
    let d = (dirAt(167.5, 188) - dirAt(-1, 20)) * 180 / Math.PI;
    d = ((d % 360) + 360) % 360;
    assert.ok(Math.abs(d - 90) < 3, `the Turning Torso turns ${d.toFixed(1)} degrees`);
    const pl = byId('poolbeg'), pp = pos('poolbeg');
    assert.ok(count(pl, pp, (lx, y) => y > 150) > 0 && count(pl, pp, (lx, y) => y > 150 && Math.abs(Math.abs(lx) - 37.5) > 7) === 0, 'two chimneys');
    assert.ok(count(pl, pp, (lx, y) => y > 150 && lx < 0) > 0 && count(pl, pp, (lx, y) => y > 150 && lx > 0) > 0);
    const pj = pos('palaisjustice');
    assert.ok(reach(pj, 0, 30) > 100 && reach(pj, 95, 104) < 14, 'the Palace of Justice: the dome over its block');
    const lv = byId('lovell'), lp = pos('lovell');
    assert.ok(reach(lp, 60, 88) > 34, 'the bowl\'s rim');
    assert.equal(count(lv, lp, (lx, y, ln) => Math.abs(lx) < 30 && y > 3 && y < 10 && Math.abs(ln) < 20), 0, 'open under the bowl');
    const rk = pos('rocket');
    assert.ok(reach(rk, 2.6, 34) > 5.5 && reach(rk, 45, 53) < 3, 'the core and its boosters');
  });

  test('the runtime in Europe: Lisbon\'s three built near Lisbon, the bridges at the sea, the statue on its ground', () => {
    const scene = { kids: new Set(), add(o) { this.kids.add(o); }, remove(o) { this.kids.delete(o); } };
    const lm = createLandmarks(scene, { uNight: { value: 0 } }, { UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' }, { heightfield: { heightAt: () => 40 } });
    assert.equal(lm.items.length, EUROPE_LANDMARKS.length);
    const c = byId('cristorei'), o = { x: c.x, y: c.y - 3000 };
    const s = lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 500, z: 0 } });
    assert.equal(s.shown, 3, 'Lisbon\'s three');
    const it = (id) => lm.items.find((x) => x.L.id === id);
    assert.equal(it('ponte25').ground, 0);
    assert.equal(it('vascodagama').ground, 0);
    assert.equal(it('cristorei').ground, 39.5);
    lm.dispose();
  });
} else {
  test("East Asia's page: v0.7.1's landmarks not on, its thirty as before", async () => {
    const { LANDMARKS, EUROPE_LANDMARKS, REGION_LANDMARKS, landmarkOn } = await import('../src/world/landmarks.js');
    assert.equal(REGION_LANDMARKS, LANDMARKS);
    assert.equal(LANDMARKS.length, 35);   // (v0.7.5: East Asia's thirty and v0.7.5's five, appended)
    for (const L of EUROPE_LANDMARKS.slice(28, 28 + NEW.length)) assert.equal(landmarkOn(L), false, L.id);
  });
}
