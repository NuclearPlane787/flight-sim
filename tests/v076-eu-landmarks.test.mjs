// v0.7.6 part 5 (briefs/V0-7-6.md): three landmarks by the new air bases, appended after Europe's sixty-one: Ely
// Cathedral (by Lakenheath), Zaragoza's Basílica del Pilar, Cádiz Cathedral (across the bay from Rota). The list, the
// models (height, plan, triangles, what makes each read as itself), each one's ground and water from the installed tiles,
// the real centre's blocks left out round the Pilar, and the older models identical to the pushed v0.7.5 (a digest of their
// entries and position arrays, taken from the pushed tree, in each region's frame). Run in a process opened in Europe
// (tests/region-run.mjs), with East Asia's checks outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inRegion } from './region-run.mjs';

const NEW = ['ely', 'pilar', 'cadiz'];
const BEFORE = 61;
// [city, country, height (m), at most this many triangles]
const W = { ely: ['ely', 'GB', 66, 2000], pilar: ['zaragoza', 'ES', 92, 3000], cadiz: ['cadiz', 'ES', 54, 1500] };
const TOTAL_MAX = 6000;
// The older landmarks' digest (each entry's JSON and its model's positions), from the pushed v0.7.5's tree.
const DIGEST = { europe: '9b837fde90248dd81b05a90d2ace33fe', 'east-asia': '3a5787437857f9cd135587a8bd7b51dc' };
const EA_DIGEST_IN_EUROPE = '0ba7edeaa22d6cb0498a0b9c9ba9ebb4', EU_DIGEST_IN_EA = 'c9394dcd8bc0370ebc4a5f5d3f9b689f';
// v0.7.8 (landmark-models.js's LANDMARKS78, on by default): Europe's Tower Bridge, Elbphilharmonie and Bergisel jump are
// meant to change, so with the switch on the Europe digests below are left to tests/v078-landmarks.test.mjs, which pins
// every other model (all its attributes and its entry) to the pushed v0.7.7's one by one. With FS_LANDMARKS78=0 they
// are checked here as before. (East Asia's thirty-five keep their positions: only the castles' colours change.)
const L78 = process.env.FS_LANDMARKS78 !== '0';

async function digest(list, n) {
  const { buildModel } = await import('../src/world/landmarks.js');
  const c = createHash('sha256');
  for (const L of list.slice(0, n)) {
    c.update(JSON.stringify(L));
    const p = buildModel(L).geometry.getAttribute('position').array;
    c.update(Buffer.from(p.buffer, p.byteOffset, p.byteLength));
  }
  return c.digest('hex').slice(0, 32);
}

if (inRegion('europe', import.meta.url)) {
  const { LANDMARKS, EUROPE_LANDMARKS, EUROPE_CITY_BOXES, buildModel, baseHeight, landmarkOn, landmarkFootprints, createLandmarks } = await import('../src/world/landmarks.js');
  const { MODELS, EUROPE_MODELS } = await import('../src/world/landmark-models.js');
  const { landmarkExclusions } = await import('../src/world/centres.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);
  const geom = (id) => { const { geometry: g, lights } = buildModel(byId(id)); return { g, lights, p: g.getAttribute('position'), c: g.getAttribute('aCol') }; };
  const local = (L, x, z) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180), N = -z; return [x * c - N * s, x * s + N * c]; };
  const count = (L, p, f) => { let k = 0; for (let i = 0; i < p.count; i++) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); if (f(lx, p.getY(i), ln)) k++; } return k; };
  const topAt = (L, p, f = () => true) => { let t = null; for (let i = 0; i < p.count; i++) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); if (f(lx, ln) && (!t || p.getY(i) > t[1])) t = [lx, p.getY(i), ln]; } return t; };

  test("v0.7.6's list: the three after the sixty-one, each in its city's box with a country, a source and its own model", () => {
    assert.equal(EUROPE_LANDMARKS.length, BEFORE + NEW.length);
    assert.deepEqual(EUROPE_LANDMARKS.slice(BEFORE).map((l) => l.id), NEW);
    assert.equal(LANDMARKS.length, 35);
    for (const L of EUROPE_LANDMARKS.slice(BEFORE)) {
      const [city, country, H] = W[L.id];
      assert.equal(L.region, 'europe');
      assert.equal(landmarkOn(L), true);
      assert.equal(L.city, city); assert.equal(L.country, country);
      assert.ok(EUROPE_MODELS[L.id] && !MODELS[L.id], `${L.id}: its own model`);
      assert.match(L.source, /Wikipedia "[^"]+".*\(.*read 2026-11-22/, `${L.id}: a source read today`);
      assert.match(L.source, /\[EST\]/, `${L.id}: what is estimated marked`);
      const b = EUROPE_CITY_BOXES[city];
      assert.ok(b && L.lat > b[0] && L.lat < b[2] && L.lon > b[1] && L.lon < b[3], `${L.id} outside ${city}`);
      assert.equal(L.heightM, H, `${L.id}: height`);
      assert.ok(Number.isFinite(L.x) && Number.isFinite(L.y) && Number.isFinite(L.brg));
    }
    assert.equal(new Set(EUROPE_LANDMARKS.map((l) => l.id)).size, EUROPE_LANDMARKS.length);
    assert.equal(new Set(landmarkFootprints().map((f) => f.id)).size, EUROPE_LANDMARKS.length);
  });

  test('the places: within 150 m of the brief\'s points', () => {
    const P = { ely: [52.3986, 0.2638], pilar: [41.6567, -0.8785], cadiz: [36.5290, -6.2952] };
    for (const id of NEW) {
      const L = byId(id), [la, lo] = P[id];
      const d = Math.hypot((L.lat - la) * 111195, (L.lon - lo) * 111195 * Math.cos(la * Math.PI / 180));
      assert.ok(d < 150, `${id}: ${d.toFixed(0)} m from the brief's point`);
    }
  });

  test('every new model: whole triangles, finite, unit normals, base at 0, top at heightM, inside its footprint, in its budget', () => {
    let total = 0;
    const counts = {};
    for (const id of NEW) {
      const L = byId(id), { g, p, lights } = geom(id), n = g.getAttribute('normal');
      assert.equal(p.count % 3, 0);
      for (const name of ['aCol', 'aFac', 'aExt', 'aGlow']) assert.equal(g.getAttribute(name).count, p.count, `${id}: ${name}`);
      let lo = Infinity, hi = -Infinity, r = 0;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        assert.ok(Number.isFinite(x + y + z), id);
        assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3, `${id}: unit normal`);
        lo = Math.min(lo, y); hi = Math.max(hi, y); r = Math.max(r, Math.hypot(x, z));
      }
      assert.ok(Math.abs(lo) < 1e-6, `${id}: base ${lo}`);
      assert.ok(Math.abs(hi - L.heightM) < 0.01, `${id}: top ${hi}`);
      assert.ok(r <= L.footprintM, `${id}: ${r.toFixed(1)} m out, footprint ${L.footprintM}`);
      const tris = p.count / 3;
      counts[id] = tris;
      assert.ok(tris > 200 && tris <= W[id][3], `${id}: ${tris} triangles`);
      total += tris;
      assert.ok(lights.length >= 1 && lights.every((l) => l.length === 4 && l.every(Number.isFinite)), `${id}: lights`);
      g.dispose();
    }
    assert.ok(total <= TOTAL_MAX, `${total} triangles for the three`);
    console.log('# triangles', JSON.stringify(counts), 'total', total);
  });

  test('the same every run', () => {
    for (const id of NEW) assert.deepEqual(Array.from(geom(id).p.array), Array.from(geom(id).p.array));
  });

  test('Ely: the west tower at 66 m at the west end, the Octagon\'s lantern to 52 m over the crossing, about 164 m long', () => {
    const L = byId('ely'), { p } = geom('ely');
    const [tx, , tn] = topAt(L, p);
    assert.ok(tx < -60 && Math.abs(tn) < 8, `the top on the west tower (local ${tx.toFixed(1)}, ${tn.toFixed(1)})`);
    const lan = topAt(L, p, (lx, ln) => Math.hypot(lx, ln) < 16);
    assert.ok(Math.abs(lan[1] - 52) < 0.01, `the lantern ${lan[1]}`);
    assert.ok(count(L, p, (lx, y, ln) => y > 34.5 && y < 48 && Math.hypot(lx, ln) > 7.5 && Math.abs(lx) < 20 && Math.abs(ln) < 20) === 0, 'the lantern narrower than the octagon');
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < p.count; i++) { const [lx] = local(L, p.getX(i), p.getZ(i)); x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); }
    assert.ok(Math.abs(x1 - x0 - 163.7) < 2, `${(x1 - x0).toFixed(1)} m long`);
    assert.equal(count(L, p, (lx, y) => y > 34 && lx > -55 && lx < -15), 0, 'the nave low between the towers');
  });

  test('the Pilar: 130 x 67 m, four corner towers to 92 m, eleven domes with tiles of four colours over brick', () => {
    const L = byId('pilar'), { p, c } = geom('pilar');
    let ex = 0, en = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 1) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); ex = Math.max(ex, Math.abs(lx)); en = Math.max(en, Math.abs(ln)); }
    assert.ok(Math.abs(2 * ex - 130) < 1.5 && Math.abs(2 * en - 67) < 1.5, `the plan ${2 * ex} x ${2 * en}`);
    const towers = new Set();
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 85) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); towers.add(`${Math.sign(lx)},${Math.sign(ln)}`); }
    assert.equal(towers.size, 4, 'four towers above 85 m');
    for (const sx of [-1, 1]) for (const sn of [-1, 1]) {
      const t = topAt(L, p, (lx, ln) => Math.sign(lx) === sx && Math.sign(ln) === sn && Math.abs(lx) > 50 && Math.abs(ln) > 20);
      assert.ok(Math.abs(t[1] - 92) < 0.01, `the tower ${sx},${sn}: ${t[1]}`);
    }
    // the domes: tiled vertices (green, yellow, blue, white) below the towers' caps (74 m up); each dome's crown is a
    // tiled vertex with nothing tiled higher within 6 m of it across the plan
    const tile = (r, g, b) => (g > r + 0.15 && g > b) || (r > 0.6 && g > 0.45 && b < 0.2 && b > 0.08) || (b > r + 0.2 && b > g) || (r > 0.6 && g > 0.6 && b > 0.6);
    const pts = [], cols = new Set();
    for (let i = 0; i < p.count; i++) {
      const r = c.getX(i), g = c.getY(i), b = c.getZ(i);
      if (p.getY(i) > 70 || !tile(r, g, b)) continue;
      cols.add([r, g, b].map((v) => v.toFixed(2)).join());
      pts.push([p.getX(i), p.getY(i), p.getZ(i)]);
    }
    assert.ok(cols.size >= 4, `four tile colours (${cols.size})`);
    const crowns = new Set();
    for (const q of pts) if (!pts.some((o) => o[1] > q[1] + 0.01 && Math.hypot(o[0] - q[0], o[2] - q[2]) < 6)) crowns.add(`${Math.round(q[0])},${Math.round(q[2])}`);
    const groups = crowns.size;
    assert.equal(groups, 11, `eleven domes (${groups})`);
    const great = topAt(L, p, (lx, ln) => Math.hypot(lx, ln) < 13);
    assert.ok(great[1] > 65 && great[1] < 85, `the great dome's top ${great[1]}`);
    const brick = (r, g, b) => r > g + 0.12 && g > b && r < 0.6;
    let nb = 0; for (let i = 0; i < c.count; i++) if (brick(c.getX(i), c.getY(i), c.getZ(i))) nb++;
    assert.ok(nb / c.count > 0.2, 'brick');
  });

  test('Cádiz: the two west towers at 54 m, the golden dome over the crossing to about 52 m, pale stone', () => {
    const L = byId('cadiz'), { p, c } = geom('cadiz');
    const towers = new Set();
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 53) { const [lx, ln] = local(L, p.getX(i), p.getZ(i)); assert.ok(lx < -30, 'only the towers above 53 m, at the front'); towers.add(Math.sign(ln)); }
    assert.equal(towers.size, 2, 'two towers');
    const gold = (r, g, b) => r > 0.55 && g > 0.35 && b < 0.12;
    let gTop = 0, gLow = Infinity, ng = 0;
    for (let i = 0; i < p.count; i++) if (gold(c.getX(i), c.getY(i), c.getZ(i))) { ng++; gTop = Math.max(gTop, p.getY(i)); gLow = Math.min(gLow, p.getY(i)); const [lx] = local(L, p.getX(i), p.getZ(i)); assert.ok(lx > -5, 'gold only on the crossing\'s dome'); }
    assert.ok(ng > 100 && Math.abs(gTop - 52) < 0.01 && gLow > 35, `the golden dome ${gLow}..${gTop}`);
    const pale = (r, g, b) => r > 0.38 && g > 0.34 && b > 0.24 && r - b < 0.2;
    let np = 0; for (let i = 0; i < c.count; i++) if (pale(c.getX(i), c.getY(i), c.getZ(i))) np++;
    assert.ok(np / c.count > 0.4, 'pale stone');
  });

  test('each stands on the lowest ground round its plan, and the real centres leave out what stands where it stands', () => {
    for (const id of NEW) assert.equal(baseHeight(byId(id), () => 12), 11.5, id);
    const ex = landmarkExclusions(EUROPE_LANDMARKS);
    for (const id of NEW) { const L = byId(id); assert.equal(ex.filter((e) => Math.hypot(e.x - L.x, e.y - L.y) < 1 && e.r === L.footprintM).length, 1, id); }
    // the Pilar's disc covers its whole plan (the corners 73.4 m from its centre)
    assert.ok(byId('pilar').footprintM >= Math.hypot(65, 33.5));
  });

  test('the runtime in Europe: the three built on their ground', () => {
    const scene = { kids: new Set(), add(o) { this.kids.add(o); }, remove(o) { this.kids.delete(o); } };
    const lm = createLandmarks(scene, { uNight: { value: 0 } }, { UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' }, { heightfield: { heightAt: () => 4 } });
    assert.equal(lm.items.length, EUROPE_LANDMARKS.length);
    for (const id of NEW) {
      const c = byId(id), o = { x: c.x, y: c.y - 3000 };
      lm.update({ camMap: o, origin: o, camScene: { x: 0, y: 500, z: 0 } });
      assert.equal(lm.items.find((x) => x.L.id === id).ground, 3.5, id);
    }
    lm.dispose();
  });

  test('the older landmarks identical to the pushed v0.7.5: Europe\'s sixty-one and East Asia\'s thirty-five', async () => {
    if (!L78) assert.equal(await digest(EUROPE_LANDMARKS, BEFORE), DIGEST.europe);
    assert.equal(await digest(LANDMARKS, 35), EA_DIGEST_IN_EUROPE);
  });

  // The installed ground (batch E's 250 m tiles at Ely and Cádiz): each on land; Cádiz on its shore with the sea close
  // to the south; the Pilar on the Ebro's south bank, the river's line to its north.
  const TILES = new URL('../data/europe/manifest.json', import.meta.url);
  test('the installed ground: on land, Cádiz by the sea', { skip: !existsSync(TILES) }, async () => {
    const { tiledTerrain } = await import('./tile-terrain.mjs');
    const { hf } = await tiledTerrain({ layers: ['h', 'w'], airports: [], maxTiles: 40 });
    const ring = (L, d) => { const out = []; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; out.push([L.x + d * Math.sin(a), L.y + d * Math.cos(a)]); } return out; };
    for (const id of NEW) {
      const L = byId(id);
      await hf.tiles.whenReady(L.x, L.y, 2000, 'test');
      assert.ok(!hf.waterAt(L.x, L.y) && hf.heightAt(L.x, L.y) > 0.5, `${id}: on land (${hf.heightAt(L.x, L.y).toFixed(1)} m)`);
      for (const [x, y] of ring(L, L.footprintM * 0.8)) assert.ok(!hf.waterAt(x, y), `${id}: its plan on land`);
      assert.ok(baseHeight(L, (x, y) => hf.heightAt(x, y)) > 0, `${id}: base above the sea`);
    }
    const cd = byId('cadiz');
    assert.ok(ring(cd, 300).some(([x, y]) => hf.waterAt(x, y)), 'the sea within 300 m of Cádiz Cathedral');
    const el = byId('ely');
    assert.ok(hf.heightAt(el.x, el.y) > 8, 'Ely on its rise above the fens');
    const pl = byId('pilar');
    assert.ok(hf.heightAt(pl.x, pl.y) > 150 && hf.heightAt(pl.x, pl.y) < 250, 'Zaragoza at about 200 m');
  });

  // The lead's, after the pictures: a generated town block ran through Cádiz Cathedral's east end. The town's blocks
  // (400 m squares, cities.js) leave the ground of Ely's and Cádiz's free; the Pilar stands in a real centre, which
  // leaves it out itself; no older landmark is in the table, so no earlier view loses a block.
  test("the generated town's blocks leave Ely's and Cádiz's ground free, and nothing else's", async () => {
    const { EUROPE_LANDMARKS, BLOCKS_CLEAR, landmarkBlockMask } = await import('../src/world/landmarks.js');
    assert.deepEqual([...BLOCKS_CLEAR].sort(), ['cadiz', 'ely']);
    const mask = landmarkBlockMask();
    assert.equal(typeof mask, 'function');
    const centreOf = (v) => (Math.floor(v / 400) + 0.5) * 400;
    for (const L of EUROPE_LANDMARKS) {
      const own = mask(centreOf(L.x), centreOf(L.y));                      // the block the landmark stands in
      assert.equal(own, BLOCKS_CLEAR.has(L.id), L.id);
    }
    for (const id of ['ely', 'cadiz']) {
      const L = EUROPE_LANDMARKS.find((l) => l.id === id);
      let n = 0;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (mask(centreOf(L.x) + i * 400, centreOf(L.y) + j * 400)) n++;
      assert.ok(n >= 1 && n <= 4, `${id}: ${n} blocks left out`);          // its own, and a neighbour only where it stands by an edge
      assert.equal(mask(centreOf(L.x) + 1200, centreOf(L.y)), false);
    }
  });
} else {
  test("East Asia's page has no such mask: the town's blocks are masked by the centres alone, as before", async () => {
    const { landmarkBlockMask } = await import('../src/world/landmarks.js');
    assert.equal(landmarkBlockMask(), null);
  });
  test("East Asia's page: v0.7.6's landmarks not on, the older ones identical", async () => {
    const { LANDMARKS, EUROPE_LANDMARKS, REGION_LANDMARKS, landmarkOn } = await import('../src/world/landmarks.js');
    assert.equal(REGION_LANDMARKS, LANDMARKS);
    assert.equal(LANDMARKS.length, 35);
    for (const L of EUROPE_LANDMARKS.slice(BEFORE)) assert.equal(landmarkOn(L), false, L.id);
    assert.equal(await digest(LANDMARKS, 35), DIGEST['east-asia']);
    if (!L78) assert.equal(await digest(EUROPE_LANDMARKS, BEFORE), EU_DIGEST_IN_EA);
  });
}
