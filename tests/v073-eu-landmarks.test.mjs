// v0.7.3: Europe's last landmarks, appended after the fifty-three: the list, the models (each reading as itself), the
// Dom Luís I Bridge based at 0 with its ends on the installed ground, each one's ground, and East Asia's page untouched.
// Run in a process opened in Europe (tests/region-run.mjs), with one East Asia check outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

const NEW = ['elbphil', 'hht', 'campanile', 'ndg', 'fourviere', 'fourvieretower', 'domluis', 'bergisel'];
// The brief's "about" figures (within 3 %); Notre-Dame de la Garde's 72.7 m is the article's tower, belfry and statue
// (41 + 12.5 + 11.2 m) on the model's 8 m fort base; the Dom Luís I Bridge's 45 m its upper deck above the river.
const BRIEF = { elbphil: 110, hht: 279, campanile: 99, ndg: 72.7, fourviere: 48, fourvieretower: 101, domluis: 45, bergisel: 50 };
const COUNTRY = { hamburg: 'DE', venice: 'IT', marseille: 'FR', lyon: 'FR', porto: 'PT', innsbruck: 'AT' };
const TRI_MAX = 4000, TOTAL_MAX = 16000, BEFORE = 53;

if (inRegion('europe', import.meta.url)) {
  const { LANDMARKS, EUROPE_LANDMARKS, EUROPE_CITY_BOXES, PYLON_R, buildModel, bridgeEnds, baseHeight, landmarkOn, landmarkFootprints, createLandmarks } = await import('../src/world/landmarks.js');
  const { MODELS, EUROPE_MODELS } = await import('../src/world/landmark-models.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);
  const pos = (id, endH = null) => buildModel(byId(id), endH).geometry.getAttribute('position');
  const local = (L, x, z) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180), N = -z; return [x * c - N * s, x * s + N * c]; };
  const reach = (p, y0, y1, cx = 0, cz = 0) => { let r = 0; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= y0 && y <= y1) r = Math.max(r, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz)); } return r; };
  const count = (L, p, f) => { let k = 0; for (let i = 0; i < p.count; i++) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); if (f(lx, p.getY(i), ln)) k++; } return k; };
  const topAt = (L, p) => { let t = null; for (let i = 0; i < p.count; i++) if (!t || p.getY(i) > t[1]) t = [p.getX(i), p.getY(i), p.getZ(i)]; const [lx, ln] = local(L, t[0], t[2]); return [lx, t[1], ln]; };

  test("v0.7.3's list: after the fifty-three, in the brief's order, each in its city's box with a country, a source and its own model", () => {
    assert.equal(EUROPE_LANDMARKS.length, BEFORE + NEW.length);
    assert.deepEqual(EUROPE_LANDMARKS.slice(BEFORE).map((l) => l.id), NEW);
    assert.equal(LANDMARKS.length, 30);
    for (const L of EUROPE_LANDMARKS.slice(BEFORE)) {
      assert.equal(L.region, 'europe');
      assert.equal(landmarkOn(L), true);
      assert.equal(L.country, COUNTRY[L.city], `${L.id}: country`);
      assert.ok(EUROPE_MODELS[L.id] && !MODELS[L.id], `${L.id}: its own model`);
      assert.match(L.source, /Wikipedia "[^"]+" \(read 2026-11-22/, `${L.id}: a source read tonight`);
      const b = EUROPE_CITY_BOXES[L.city];
      assert.ok(b && L.lat > b[0] && L.lat < b[2] && L.lon > b[1] && L.lon < b[3], `${L.id} outside ${L.city}`);
      assert.ok(Math.abs(L.heightM - BRIEF[L.id]) / BRIEF[L.id] < 0.03, `${L.id}: ${L.heightM} against ${BRIEF[L.id]}`);
      assert.ok(Number.isFinite(L.x) && Number.isFinite(L.y) && Number.isFinite(L.brg));
    }
    assert.equal(new Set(EUROPE_LANDMARKS.map((l) => l.id)).size, EUROPE_LANDMARKS.length);
    assert.equal(new Set(landmarkFootprints().map((f) => f.id)).size, EUROPE_LANDMARKS.length);
  });

  test('every new model: whole triangles, finite, unit normals, base at 0, top at heightM +- 1 %, inside its footprint; under 4,000 each and 16,000 in all; lights', () => {
    let total = 0;
    const counts = {};
    for (const L of EUROPE_LANDMARKS.slice(BEFORE)) {
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
    for (const id of ['elbphil', 'campanile', 'domluis']) assert.deepEqual(Array.from(pos(id).array), Array.from(pos(id).array));
  });

  test('Hamburg: the glass body over the brick, peaking at the western tip; the TV tower\'s two pods and its mast', () => {
    const L = byId('elbphil'), p = pos('elbphil');
    const [tx, ty] = topAt(L, p);
    assert.ok(ty > 107.9 && tx < -50, `the peak at the western tip (local x ${tx.toFixed(1)})`);
    assert.ok(count(L, p, (lx, y) => y > 75 && y < 90 && lx > 40) > 0, 'lower in the east');
    assert.ok(reach(p, 0, 37) > 55 && reach(p, 38, 108) > 55, 'the glass body as long as the warehouse');
    const h = pos('hht');
    assert.ok(reach(h, 124, 131) > 2 * reach(h, 60, 110) && reach(h, 142, 148) > 2 * reach(h, 60, 110), 'two pods');
    assert.ok(reach(h, 134, 137) < 6, 'a waist between the pods');
    assert.ok(reach(h, 210, 279.2) < 2.5, 'the mast');
  });

  test('Venice: the square brick shaft, the belfry, the cube and the spire; the basilica\'s five domes low beside it', () => {
    const L = byId('campanile'), p = pos('campanile');
    const [tx, ty, tn] = topAt(L, p);
    assert.ok(Math.hypot(tx, tn) < 0.5 && ty > 98.5, 'the vane on the campanile');
    assert.ok(count(L, p, (lx, y, ln) => y >= 0 && y < 49.9 && Math.hypot(lx, ln) < 12 && (Math.abs(lx) > 6.01 || Math.abs(ln) > 6.01)) === 0 && count(L, p, (lx, y, ln) => y >= 0 && y < 49.9 && Math.abs(Math.abs(lx) - 6) < 0.01 && Math.abs(Math.abs(ln) - 6) < 0.01) > 0, 'the shaft 12 m a side');
    assert.equal(count(L, p, (lx, y, ln) => y > 53 && y < 60 && Math.abs(lx) > 3.3 && Math.abs(lx) < 4.1 && Math.abs(ln) < 3), 0, 'open arches in the belfry');
    assert.equal(count(L, p, (lx, y, ln) => y > 45 && Math.hypot(lx, ln) > 12), 0, 'nothing of the basilica above 45 m');
    const domes = new Set();
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 36) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); if (Math.hypot(lx, ln) > 20) domes.add(`${Math.round((lx - 54) / 22)},${Math.round((ln - 48) / 22)}`); }
    assert.equal(domes.size, 5, `five domes (${[...domes]})`);
  });

  test('Marseille and Lyon: the striped tower with the statue on top; four towers at the corners, nothing above them', () => {
    const L = byId('ndg'), p = pos('ndg'), g = buildModel(L).geometry.getAttribute('aCol');
    const [tx, , tn] = topAt(L, p);
    assert.ok(Math.abs(tx + 27) < 2 && Math.abs(tn) < 2, 'the statue on the bell tower');
    const cols = new Set();
    for (let i = 0; i < p.count; i++) { const [lx] = local(L, p.getX(i), p.getZ(i)); if (p.getY(i) > 12 && p.getY(i) < 40 && Math.abs(lx + 27) < 6) cols.add(g.getX(i).toFixed(2)); }
    assert.ok(cols.size >= 2, 'stripes of two stones');
    assert.ok(count(L, p, (lx, y) => y > 61 && y < 72.7 && Math.abs(lx + 27) < 2.5) > 10, 'the statue');
    const F = byId('fourviere'), fp = pos('fourviere');
    const corners = new Set();
    for (let i = 0; i < fp.count; i++) if (fp.getY(i) > 36) { const [lx, ln] = local(F, fp.getX(i), fp.getZ(i)); corners.add(`${Math.sign(lx)},${Math.sign(ln)}`); }
    assert.equal(corners.size, 4, 'four corner towers above the roof');
    assert.equal(count(F, fp, (lx, y, ln) => y > 36 && Math.abs(ln) < 5), 0, 'nothing between them above the roof');
    const mt = pos('fourvieretower');
    assert.ok(reach(mt, 0, 1) > 10 && reach(mt, 60, 80) < 5 && reach(mt, 87, 101) < 1, 'the metal tower: four legs closing to the antenna');
    assert.ok(byId('fourvieretower').y - F.y > 120, 'the metal tower north of the basilica');
  });

  test('Porto: the Dom Luís I Bridge based at 0, its arch\'s feet the parts, two decks, the upper deck down to the ground read at its ends', () => {
    const L = byId('domluis');
    assert.equal(L.kind, 'bridge');
    assert.equal(baseHeight(L, () => 25), 0);
    assert.equal(L.parts.length, 2);
    for (const [dx, dy, r] of L.parts) { assert.equal(r, PYLON_R); assert.ok(Math.abs(Math.hypot(dx, dy) - L.geo.s) < 1); }
    assert.ok(Math.abs(2 * L.geo.s - 172.5) / 172.5 < 0.01, `the arch ${2 * L.geo.s} m`);
    assert.ok(Math.abs(L.geo.n1 - L.geo.n0 - 395.25) / 395.25 < 0.01, 'the upper deck 395 m');
    assert.equal(landmarkFootprints().filter((f) => f.id === 'domluis').length, 2);
    assert.deepEqual(bridgeEnds(L, () => 22), [22, 22]);
    const p = pos('domluis', [24, 18]);
    const near = (n0) => { let y = Infinity; for (let i = 0; i < p.count; i++) { const [, ln] = local(L, p.getX(i), p.getZ(i)); if (Math.abs(ln - n0) < 1) y = Math.min(y, p.getY(i)); } return y; };
    assert.ok(Math.abs(near(L.geo.n0) - (24.3 - 3.5)) < 0.6 && Math.abs(near(L.geo.n1) - (18.3 - 3.5)) < 0.6, 'the ends at the ground');
    const q = pos('domluis');
    assert.ok(count(L, q, (lx, y, ln) => Math.abs(ln) < 60 && y > 9.9 && y < 10.1) > 0 && count(L, q, (lx, y, ln) => Math.abs(ln) < 2 && y > 41 && y <= 45) > 0, 'the two decks');
    assert.equal(count(L, q, (lx, y, ln) => Math.abs(ln) < 40 && y > 0.5 && y < 7.4), 0, 'clear under the lower deck in the middle');
  });

  test('Innsbruck: the tower with its pod on top, the in-run sloping down to the north', () => {
    const L = byId('bergisel'), p = pos('bergisel');
    assert.ok(reach(p, 42, 49) > 15 && count(L, p, (lx, y, ln) => y > 5 && y < 35 && ln < 5 && Math.hypot(lx, ln) > 7) === 0, 'the pod wider than the tower');
    assert.ok(count(L, p, (lx, y, ln) => ln > 90 && y < 4) > 0 && count(L, p, (lx, y, ln) => ln > 50 && y > 30) === 0, 'the take-off low, far out to the north');
    assert.equal(count(L, p, (lx, y, ln) => ln < -20), 0, 'nothing to the south');
  });

  test('the runtime in Europe: the Dom Luís I Bridge at 0, the campanile on its ground', () => {
    const scene = { kids: new Set(), add(o) { this.kids.add(o); }, remove(o) { this.kids.delete(o); } };
    const lm = createLandmarks(scene, { uNight: { value: 0 } }, { UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' }, { heightfield: { heightAt: () => 4 } });
    assert.equal(lm.items.length, EUROPE_LANDMARKS.length);
    for (const id of ['domluis', 'campanile']) {
      const c = byId(id), o = { x: c.x, y: c.y - 3000 };
      lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 500, z: 0 } });
      const it = lm.items.find((x) => x.L.id === id);
      assert.equal(it.ground, id === 'domluis' ? 0 : 3.5, id);
    }
    lm.dispose();
  });

  // The installed 250 m ground: the bridge's ends on land; the Elbphilharmonie at the water's edge; the campanile on
  // land at Venice; the two basilicas on their hills; the ski jump on its slope.
  const TILES = new URL('../data/europe/manifest.json', import.meta.url);
  test('the installed ground: the bridge\'s ends on land, the quay, the island, the hills, the slope', { skip: !existsSync(TILES) }, async () => {
    const { tiledTerrain } = await import('./tile-terrain.mjs');
    const { hf } = await tiledTerrain({ layers: ['h', 'w'], airports: [], maxTiles: 40 });
    const ring = (L, d) => { const out = []; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; out.push([L.x + d * Math.sin(a), L.y + d * Math.cos(a)]); } return out; };
    const dl = byId('domluis');
    await hf.tiles.whenReady(dl.x, dl.y, 2000, 'test');
    for (const [x, y] of dl.endsMap) assert.ok(hf.heightAt(x, y) > 1 && !hf.waterAt(x, y), `an end on land (${hf.heightAt(x, y).toFixed(1)} m)`);
    const eb = byId('elbphil');
    await hf.tiles.whenReady(eb.x, eb.y, 2000, 'test');
    assert.ok(ring(eb, 150).some(([x, y]) => hf.waterAt(x, y)), 'water beside the Elbphilharmonie');
    const cp = byId('campanile');
    await hf.tiles.whenReady(cp.x, cp.y, 2000, 'test');
    assert.ok(!hf.waterAt(cp.x, cp.y) && hf.heightAt(cp.x, cp.y) > 0.5 && baseHeight(cp, (x, y) => hf.heightAt(x, y)) > 0, 'St Mark\'s Square on land');
    for (const [id, min, drop] of [['ndg', 40, 15], ['fourviere', 180, 25]]) {
      const L = byId(id);
      await hf.tiles.whenReady(L.x, L.y, 2000, 'test');
      const h = hf.heightAt(L.x, L.y), low = Math.min(...ring(L, 500).map(([x, y]) => hf.heightAt(x, y)));
      assert.ok(h > min && h - low > drop, `${id}: on its hill (${h.toFixed(0)} m, ${low.toFixed(0)} m round it)`);
    }
    const bg = byId('bergisel');
    await hf.tiles.whenReady(bg.x, bg.y, 2000, 'test');
    const hs = ring(bg, 300).map(([x, y]) => hf.heightAt(x, y));
    assert.ok(Math.max(...hs) - Math.min(...hs) > 40, 'the ski jump on a slope');
  });
} else {
  test("East Asia's page: v0.7.3's landmarks not on, its thirty as before", async () => {
    const { LANDMARKS, EUROPE_LANDMARKS, REGION_LANDMARKS, landmarkOn } = await import('../src/world/landmarks.js');
    assert.equal(REGION_LANDMARKS, LANDMARKS);
    assert.equal(LANDMARKS.length, 30);
    for (const L of EUROPE_LANDMARKS.slice(BEFORE)) assert.equal(landmarkOn(L), false, L.id);
  });
}
