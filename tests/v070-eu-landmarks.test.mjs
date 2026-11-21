// v0.7.0 (briefs/V0-7-0.md Part 6): Europe's landmarks: the list, the models, each reading as itself, and the two
// regions' lists kept apart. Run in a process opened in Europe (tests/region-run.mjs), with one East Asia check outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

const ORDER = ['shard', 'westminster', 'eye', 'stpauls', 'towerbridge', 'eiffel', 'arc', 'sacrecoeur', 'notredame', 'grandearche',
  'commerzbank', 'messeturm', 'europaturm', 'cepsa', 'pwc', 'cristal', 'emperador', 'caleido', 'kio', 'grossmunster', 'primetower',
  'olympiaturm', 'frauenkirche', 'sagrada', 'glories', 'collserola', 'stpeters', 'colosseum'];
// The brief's "about" figures (within 2 %); Westminster's entry is the Victoria Tower (98.5 m), the Elizabeth Tower's
// 96 m is checked on the model; Madrid's towers lie in the brief's 181 to 250 m.
const BRIEF = { shard: 310, eye: 135, stpauls: 111, towerbridge: 65, eiffel: 330, arc: 50, grandearche: 110, commerzbank: 259,
  messeturm: 257, europaturm: 337, kio: 114, primetower: 126, olympiaturm: 291, stpeters: 137, colosseum: 48 };
const COUNTRY = { london: 'GB', paris: 'FR', frankfurt: 'DE', madrid: 'ES', zurich: 'CH', munich: 'DE', barcelona: 'ES', rome: 'IT',
  // v0.7.1's cities
  berlin: 'DE', vienna: 'AT', milan: 'IT', lisbon: 'PT', oresund: 'DK', malmo: 'SE', dublin: 'IE', brussels: 'BE', manchester: 'GB', toulouse: 'FR',
  // v0.7.2's cities
  cologne: 'DE', dusseldorf: 'DE', prague: 'CZ', geneva: 'CH', edinburgh: 'GB', santiago: 'ES' };
const TRI_BUDGET = 6000, TOTAL_BUDGET = 60000;

if (inRegion('europe', import.meta.url)) {
  const { LANDMARKS, EUROPE_LANDMARKS, EUROPE_CITY_BOXES, REGION_LANDMARKS, buildModel, landmarkOn, landmarkFootprints, createLandmarks } = await import('../src/world/landmarks.js');
  const { MODELS, EUROPE_MODELS } = await import('../src/world/landmark-models.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);
  const pos = (id) => buildModel(byId(id)).geometry.getAttribute('position');
  // local (east, north) of a scene vertex for a model built at grid bearing brg: local n = the part's own north
  const local = (L, x, z) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180), N = -z; return [x * c - N * s, x * s + N * c]; };

  test("Europe's list: the brief's order, region europe, a country, a source, a model each; East Asia's thirty kept apart", () => {
    assert.deepEqual(EUROPE_LANDMARKS.map((l) => l.id).slice(0, ORDER.length), ORDER);     // v0.7.1's follow (tests/v071-eu-landmarks.test.mjs)
    assert.equal(REGION_LANDMARKS, EUROPE_LANDMARKS);
    assert.equal(LANDMARKS.length, 30);
    for (const L of LANDMARKS) assert.equal(landmarkOn(L), false, `${L.id} is East Asia's`);
    for (const L of EUROPE_LANDMARKS) {
      assert.equal(L.region, 'europe');
      assert.equal(landmarkOn(L), true, `${L.id}: on in Europe`);
      assert.equal(L.country, COUNTRY[L.city], `${L.id}: country`);
      assert.ok(EUROPE_MODELS[L.id] && !MODELS[L.id], `${L.id}: its own model, not in East Asia's map`);
      assert.match(L.source, /Wikipedia/, `${L.id}: a source`);
      assert.ok(Number.isFinite(L.x) && Number.isFinite(L.y));
      const b = EUROPE_CITY_BOXES[L.city];
      assert.ok(L.lat > b[0] && L.lat < b[2] && L.lon > b[1] && L.lon < b[3], `${L.id} outside ${L.city}`);
      if (BRIEF[L.id]) assert.ok(Math.abs(L.heightM - BRIEF[L.id]) / BRIEF[L.id] < 0.02, `${L.id}: ${L.heightM} against ${BRIEF[L.id]}`);
      if (L.city === 'madrid' && L.id !== 'kio') assert.ok(L.heightM >= 180 && L.heightM <= 250, L.id);
    }
    // within a few km of each city's centre: Europe's frame puts them where the map does (47 N 4 E at 0, 0)
    assert.ok(Math.abs(byId('eiffel').x - (-124000)) < 15000 && Math.abs(byId('eiffel').y - 207000) < 15000, `Paris at ${byId('eiffel').x}, ${byId('eiffel').y}`);
    assert.equal(new Set(landmarkFootprints().map((f) => f.id)).size, EUROPE_LANDMARKS.length);
  });

  test("every model: whole triangles, finite, base at 0, top at heightM +- 1 %, inside its footprint, in budget; lights over 150 m", () => {
    let total = 0;
    const counts = {};
    for (const L of EUROPE_LANDMARKS) {
      const t0 = performance.now();
      const { geometry: g, lights } = buildModel(L);
      const ms = performance.now() - t0;
      const p = g.getAttribute('position'), n = g.getAttribute('normal');
      assert.equal(p.count % 3, 0);
      for (const name of ['aCol', 'aFac', 'aExt', 'aGlow']) assert.equal(g.getAttribute(name).count, p.count, `${L.id}: ${name}`);
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${L.id}: finite`);
        assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3, `${L.id}: unit normal`);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        assert.ok(Math.hypot(x, z) <= L.footprintM * 1.05 + 2, `${L.id}: a vertex ${Math.hypot(x, z).toFixed(1)} m out, footprint ${L.footprintM}`);
      }
      assert.ok(Math.abs(minY) < 1e-6, `${L.id}: base ${minY}`);
      assert.ok(Math.abs(maxY - L.heightM) / L.heightM < 0.01, `${L.id}: top ${maxY} against ${L.heightM}`);
      const tris = p.count / 3;
      counts[L.id] = tris;
      assert.ok(tris > 20 && tris <= TRI_BUDGET, `${L.id}: ${tris} triangles`);
      total += tris;
      if (L.heightM > 150) {
        assert.ok(lights.length >= 3, `${L.id}: lights`);
        assert.ok(Math.max(...lights.map((l) => l[1])) > L.heightM * 0.95, `${L.id}: a light at the top`);
        assert.ok(lights.some((l) => l[3] === 1), `${L.id}: a flashing light`);
      }
      for (const l of lights) assert.ok(l.every(Number.isFinite));
      assert.ok(ms < 200, `${L.id}: ${ms.toFixed(1)} ms`);
    }
    assert.ok(total <= TOTAL_BUDGET, `${total} triangles in all`);
    console.log('# triangles', JSON.stringify(counts), 'total', total);
  });

  test('the models are the same every run', () => {
    for (const id of ['eiffel', 'sagrada', 'colosseum']) assert.deepEqual(Array.from(pos(id).array), Array.from(pos(id).array));
  });

  // the largest horizontal distance from an axis point (scene x, z) among vertices with y in [y0, y1]
  const reach = (p, y0, y1, cx = 0, cz = 0) => { let r = 0; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= y0 && y <= y1) r = Math.max(r, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz)); } return r; };
  const sceneOf = (L, x, n) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180); return [x * c + n * s, -(-x * s + n * c)]; };

  test('London reads as itself: the Shard to a point, the Elizabeth Tower 96 m, the Eye a ring, a dome over its lantern, two bridge towers', () => {
    const sh = pos('shard');
    assert.ok(reach(sh, 0, 2) > 30 && reach(sh, 0.92 * 309.6, 309.6) < 6, `the Shard tapers: ${reach(sh, 0, 2)} to ${reach(sh, 285, 310)}`);
    const W = byId('westminster'), wp = pos('westminster');
    const [ex, ez] = sceneOf(W, 5, 133);
    let eTop = 0;
    for (let i = 0; i < wp.count; i++) if (Math.hypot(wp.getX(i) - ex, wp.getZ(i) - ez) < 8) eTop = Math.max(eTop, wp.getY(i));
    assert.ok(Math.abs(eTop - 96) < 0.5, `the Elizabeth Tower ${eTop}`);
    // the Eye: most of it on a circle of about 58 m round the hub, in a thin plane, nothing at the hub's height inside the rim but spokes
    const E = byId('eye'), ep = pos('eye');
    let onRim = 0, n = 0;
    for (let i = 0; i < ep.count; i++) {
      const [lx, ln] = local(E, ep.getX(i), ep.getZ(i)), y = ep.getY(i);
      if (y < 15) continue;
      n++;
      if (Math.abs(lx) < 5 && Math.abs(Math.hypot(ln, y - 73.5) - 58) < 6) onRim++;
    }
    assert.ok(onRim / n > 0.6, `the Eye's rim: ${onRim} of ${n}`);
    const sp = pos('stpauls');
    assert.ok(reach(sp, 70, 80) > 3 * reach(sp, 96, 103), `St Paul's: dome ${reach(sp, 70, 80)}, lantern ${reach(sp, 96, 103)}`);
    const T = byId('towerbridge'), tp = pos('towerbridge');
    const high = [];
    for (let i = 0; i < tp.count; i++) if (tp.getY(i) > 50) high.push(local(T, tp.getX(i), tp.getZ(i))[1]);
    assert.ok(high.some((v) => v > 25) && high.some((v) => v < -25) && high.every((v) => Math.abs(v) > 25 && Math.abs(v) < 55), 'two towers, nothing tall between');
  });

  test('Paris reads as itself: four legs under the Eiffel Tower, the arch through the Arc, a dome, the spire, the hole through the Grande Arche', () => {
    const ef = pos('eiffel');
    let inner = 0;
    for (let i = 0; i < ef.count; i++) if (ef.getY(i) > 5 && ef.getY(i) < 35 && Math.hypot(ef.getX(i), ef.getZ(i)) < 20) inner++;
    assert.equal(inner, 0, 'open under the first floor');
    assert.ok(reach(ef, 200, 210) < 12, `the shaft at 200 m: ${reach(ef, 200, 210)}`);
    for (const [id, hx, y0, y1, hn] of [['arc', 6.5, 1, 21, 10], ['grandearche', 30, 15, 85, 50]]) {
      const L = byId(id), p = pos(id);
      let through = 0, over = 0;
      for (let i = 0; i < p.count; i++) {
        const [lx, ln] = local(L, p.getX(i), p.getZ(i)), y = p.getY(i);
        if (Math.abs(lx) < hx && y > y0 && y < y1 && Math.abs(ln) < hn) through++;
        if (Math.abs(lx) < hx && y > y1 + 5) over++;
      }
      assert.equal(through, 0, `${id}: a hole through it`);
      assert.ok(over > 0, `${id}: closed over the hole`);
    }
    const sc = pos('sacrecoeur');
    let lantern = 0;
    for (let i = 0; i < sc.count; i++) if (sc.getY(i) > 76 && sc.getY(i) < 83 && Math.hypot(sc.getX(i), sc.getZ(i)) < 20) lantern = Math.max(lantern, Math.hypot(sc.getX(i), sc.getZ(i)));
    assert.ok(reach(sc, 52, 62) > 3 * lantern, `Sacré-Cœur: the dome wider than its lantern (${lantern})`);
    const SC = byId('sacrecoeur'), [kx, kz] = sceneOf(SC, 0, 34);
    assert.ok(reach(sc, 83.5, 84, kx, kz) < 1.5, 'the campanile, 84 m, the top');
    const nd = byId('notredame'), np = pos('notredame');
    const [sx, sz] = sceneOf(nd, 0, 8);
    assert.ok(reach(np, 75, 96, sx, sz) < 3, 'Notre-Dame: the spire alone above 75 m');
    assert.ok(reach(np, 66, 69) > 50, 'the west towers at 69 m');
  });

  test('Frankfurt, Madrid, Zurich and Munich: a triangle, a pyramid, a pod; an opening under the top; the towers lean 15 degrees; twin towers', () => {
    const cb = pos('commerzbank');
    const angs = [];
    for (let i = 0; i < cb.count; i++) if (Math.abs(cb.getY(i) - 160) < 0.1 && Math.hypot(cb.getX(i), cb.getZ(i)) > 33) angs.push(Math.atan2(cb.getZ(i), cb.getX(i)));
    assert.ok(angs.length >= 3, 'three corners out at 34 m');
    let minR = Infinity;
    for (let i = 0; i < cb.count; i++) if (Math.abs(cb.getY(i) - 160) < 0.1) minR = Math.min(minR, Math.hypot(cb.getX(i), cb.getZ(i)));
    assert.ok(minR < 19, `and the sides drawn in to ${minR}`);
    const mt = pos('messeturm');
    assert.ok(reach(mt, 100, 150) > 27 && reach(mt, 250, 256.5) < 3, 'the Messeturm: a square shaft under a pyramid');
    const eu = pos('europaturm');
    assert.ok(reach(eu, 214, 226) > 28 && reach(eu, 150, 190) < 10, 'the Europaturm: the pod far wider than the shaft');
    const cp = byId('cepsa'), cpp = pos('cepsa');
    let hole = 0;
    for (let i = 0; i < cpp.count; i++) { const [lx, ln] = local(cp, cpp.getX(i), cpp.getZ(i)), y = cpp.getY(i); if (Math.abs(lx) < 13 && Math.abs(ln) < 18 && y > 214 && y < 230) hole++; }
    assert.equal(hole, 0, 'Torre Cepsa: open under the arch');
    // the Gate of Europe: each tower's centre moves 114 tan 15 deg towards the other
    const k = byId('kio'), kp = pos('kio');
    for (const s of [-1, 1]) {
      const xs = (y0, y1) => { let a = 0, c = 0; for (let i = 0; i < kp.count; i++) { const [lx] = local(k, kp.getX(i), kp.getZ(i)), y = kp.getY(i); if (lx * s > 0 && y >= y0 && y <= y1) { a += lx; c++; } } return a / c; };
      const lean = Math.atan(Math.abs(xs(0, 0.1) - xs(110, 110.1)) / 110) * 180 / Math.PI;
      assert.ok(Math.abs(lean - 15) < 1, `KIO tower ${s}: leans ${lean.toFixed(2)} degrees`);
      assert.ok(Math.abs(xs(110, 110.1)) < Math.abs(xs(0, 0.1)), 'towards the other');
    }
    for (const [id, y0, dx] of [['grossmunster', 57, 7.5], ['frauenkirche', 80, 11.5]]) {
      const L = byId(id), p = pos(id);
      const xs = [];
      for (let i = 0; i < p.count; i++) if (p.getY(i) > y0) xs.push(local(L, p.getX(i), p.getZ(i))[0]);
      assert.ok(xs.some((v) => Math.abs(v - dx) < 2) && xs.some((v) => Math.abs(v + dx) < 2) && xs.every((v) => Math.abs(v) > dx - 8), `${id}: two towers`);
    }
    const ol = pos('olympiaturm');
    assert.ok(reach(ol, 182, 193) > 2.2 * reach(ol, 110, 160), 'the Olympiaturm: the pod');
  });

  test('Barcelona and Rome: the cluster of spires, a bullet, a guyed mast; St Peter\'s dome over its lantern; the Colosseum an open oval', () => {
    const sg = byId('sagrada'), sp = pos('sagrada');
    const cells = new Set();
    let top = null;
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i);
      if (y > 92 && y < 97) cells.add(`${Math.round(sp.getX(i) / 9)},${Math.round(sp.getZ(i) / 9)}`);
      if (!top || y > top[1]) top = [sp.getX(i), y, sp.getZ(i)];
    }
    assert.ok(cells.size >= 10, `spires at 95 m: ${cells.size} cells`);
    const [cx, cz] = sceneOf(sg, 0, 5);
    assert.ok(Math.hypot(top[0] - cx, top[2] - cz) < 2, 'the tallest over the crossing');
    const gl = pos('glories');
    assert.ok(reach(gl, 0, 40) > 19 && reach(gl, 140, 144.4) < 0.6 * reach(gl, 0, 40), 'Torre Glòries rounds off');
    const co = pos('collserola');
    assert.ok(reach(co, 108, 152) > 18 && reach(co, 160, 288) < 2.5 && reach(co, 0, 3) > 40, 'Collserola: the floors, the mast, the guys');
    const pt = byId('stpeters'), pp = pos('stpeters');
    const [dx, dz] = sceneOf(pt, 0, -40);
    assert.ok(reach(pp, 92, 100, dx, dz) > 3 * reach(pp, 120, 126, dx, dz), 'St Peter\'s: the dome wider than its lantern');
    const cl = byId('colosseum'), cp = pos('colosseum');
    let inArena = 0, maxR = 0;
    for (let i = 0; i < cp.count; i++) {
      const [lx, ln] = local(cl, cp.getX(i), cp.getZ(i)), y = cp.getY(i);
      if (y > 6 && (lx / 94.5) ** 2 + (ln / 78) ** 2 < 0.44 ** 2) inArena++;
      maxR = Math.max(maxR, Math.hypot(lx, ln));
    }
    assert.equal(inArena, 0, 'the arena open');
    assert.ok(Math.abs(maxR - 94.5) < 1, `the long axis ${maxR}`);
  });

  test('the runtime in Europe builds Europe\'s list and none of East Asia\'s', () => {
    const scene = { kids: new Set(), add(o) { this.kids.add(o); }, remove(o) { this.kids.delete(o); } };
    const lm = createLandmarks(scene, { uNight: { value: 0 } }, { UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' }, { heightfield: { heightAt: () => 30 } });
    assert.equal(lm.items.length, EUROPE_LANDMARKS.length);
    const ef = byId('eiffel'), o = { x: ef.x, y: ef.y - 4000 };
    const s = lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 500, z: 0 } });
    assert.equal(s.shown, 5, 'Paris\'s five');
    lm.dispose();
  });

  const AIRPORTS = new URL('../data/europe/airports/', import.meta.url);
  test('no landmark on a runway or its strip (Europe\'s airports as installed)', { skip: !existsSync(AIRPORTS) }, async () => {
    const { runwayRects } = await import('../src/world/runways.js');
    const airports = readdirSync(AIRPORTS).filter((f) => /^[A-Z]{4}\.json$/.test(f)).map((f) => JSON.parse(readFileSync(new URL(f, AIRPORTS))));
    const rects = runwayRects(airports);
    assert.ok(rects.length > 5);
    for (const c of landmarkFootprints()) for (const r of rects) {
      const dx = c.x - r.cx, dy = c.y - r.cy;
      assert.ok(Math.abs(dx * r.dx + dy * r.dy) > r.halfLen + 60 + c.r || Math.abs(-dx * r.dy + dy * r.dx) > 150 + c.r, `${c.id} on ${r.icao}'s strip`);
    }
  });
} else {
  test("East Asia's page: its thirty as before, none of Europe's on", async () => {
    const { LANDMARKS, EUROPE_LANDMARKS, REGION_LANDMARKS, landmarkOn, createLandmarks } = await import('../src/world/landmarks.js');
    assert.equal(REGION_LANDMARKS, LANDMARKS);
    assert.equal(LANDMARKS.length, 30);
    for (const L of EUROPE_LANDMARKS) assert.equal(landmarkOn(L), false, L.id);
    const lm = createLandmarks({ add() {}, remove() {} }, { uNight: { value: 0 } }, {}, {});
    assert.equal(lm.items.length, 30);
  });
}
