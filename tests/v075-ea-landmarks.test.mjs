// v0.7.5 part 6 (briefs/V0-7-5.md): five East Asian landmarks as our own models: Nagoya Castle, Nagoya's TV tower,
// Miyajima's torii, Hiroshima's Atomic Bomb Dome, Osaka Castle. Node only: the entries, the models (height, plan,
// triangles, what makes each read as itself), the base (the torii at the sea's level) and the ground under each from
// the installed terrain (the torii in the water, the others on land).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, CITY_BOXES, buildModel, baseHeight, landmarkFootprints } from '../src/world/landmarks.js';
import { MODELS } from '../src/world/landmark-models.js';
import { landmarkExclusions } from '../src/world/centres.js';
import { toMap } from '../src/world/frame.js';
import { tiledTerrain } from './tile-terrain.mjs';

const NEW = ['nagoyacastle', 'nagoyatv', 'torii', 'abombdome', 'osakacastle'];
// [city, height as published (m), at most this many triangles, OSM outline's centre (lat, lon)]
const W = {
  nagoyacastle: ['nagoya', 55.6, 1500, 35.185582, 136.899086], nagoyatv: ['nagoya', 180, 3500, 35.172298, 136.90834],
  torii: ['hiroshima', 16.6, 1000, 34.297297, 132.318135], abombdome: ['hiroshima', 25, 2500, 34.395468, 132.45347],
  osakacastle: ['osaka', 55, 1500, 34.68728, 135.525843],
};
const byId = (id) => LANDMARKS.find((l) => l.id === id);
const geom = (id) => { const { geometry: g, lights } = buildModel(byId(id)); return { g, lights, p: g.getAttribute('position'), c: g.getAttribute('aCol') }; };

test('v0.7.5: the five, appended after East Asia\'s thirty, Japan\'s, each with a model, a source and its city', () => {
  assert.deepEqual(LANDMARKS.slice(-5).map((l) => l.id), NEW);
  assert.equal(LANDMARKS.length, 35);
  for (const id of NEW) {
    const L = byId(id), [city, H, , la, lo] = W[id];
    assert.equal(L.city, city); assert.equal(L.country, 'JP'); assert.ok(!L.region, `${id}: East Asia's`);
    assert.ok(MODELS[id], id);
    assert.ok(/OSM way \d+/.test(L.source) && L.source.length > 60, `${id}: source`);
    assert.ok(Math.abs(L.heightM - H) / H <= 0.005, `${id}: ${L.heightM} m against ${H} m`);
    assert.ok(Math.abs(L.lat - la) < 1e-6 && Math.abs(L.lon - lo) < 1e-6, `${id}: OSM's place`);
    const b = CITY_BOXES[city];
    assert.ok(L.lat > b[0] && L.lat < b[2] && L.lon > b[1] && L.lon < b[3], `${id}: in ${city}'s box`);
  }
});

test('v0.7.5: each model: finite, base at 0, top at its height, inside its footprint, in its triangle budget', () => {
  let total = 0;
  for (const id of NEW) {
    const L = byId(id), { g, p } = geom(id);
    const tris = p.count / 3;
    let lo = Infinity, hi = -Infinity, r = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      assert.ok(Number.isFinite(x + y + z), id);
      lo = Math.min(lo, y); hi = Math.max(hi, y); r = Math.max(r, Math.hypot(x, z));
    }
    assert.equal(lo, 0, `${id}: base`);
    assert.ok(Math.abs(hi - L.heightM) < 0.01 * L.heightM, `${id}: top ${hi}`);
    assert.ok(r <= L.footprintM, `${id}: ${r.toFixed(1)} m out, footprint ${L.footprintM}`);
    assert.ok(tris <= W[id][2], `${id}: ${tris} triangles`);
    total += tris;
    g.dispose();
  }
  assert.ok(total <= 9000, `${total} triangles for the five`);
});

test('v0.7.5: the torii stands at the sea\'s level; the others on the lowest ground round their plans', () => {
  assert.equal(baseHeight(byId('torii'), () => 3.5), 0, 'the torii: y 0 is the water whatever the ground reads');
  for (const id of ['nagoyacastle', 'nagoyatv', 'abombdome', 'osakacastle']) assert.equal(baseHeight(byId(id), () => 12), 11.5, id);
  // each leaves out the centre's buildings under it (one disc of its footprint) and is one footprint circle
  const ex = landmarkExclusions(LANDMARKS), fp = landmarkFootprints();
  for (const id of NEW) {
    const L = byId(id);
    assert.equal(ex.filter((e) => Math.hypot(e.x - L.x, e.y - L.y) < 1 && e.r === Math.max(L.footprintM, 20)).length, 1, id);   // (20 m at least)
    assert.equal(fp.filter((f) => f.id === id).length, 1, id);
  }
});

// The colours that make each read as itself (aCol per vertex).
const share = (c, f) => { let n = 0; for (let i = 0; i < c.count; i++) if (f(c.getX(i), c.getY(i), c.getZ(i))) n++; return n / c.count; };
const isGreen = (r, g, b) => g > r + 0.12 && g > b;            // the copper roofs
const isVermilion = (r, g, b) => r > 0.6 && g < 0.3 && b < 0.2;
const isGold = (r, g, b) => r > 0.7 && g > 0.5 && b < 0.3;

test('v0.7.5: the castles: five tiers of green roofs over white walls, on a battered stone base, gilded fish on top', () => {
  for (const [id, baseH] of [['nagoyacastle', 19.5], ['osakacastle', 13.5]]) {
    const { p, c } = geom(id), L = byId(id);
    // the roofs' eaves: distinct heights where green vertices stand, at least five tiers above the base
    const ys = new Set();
    for (let i = 0; i < p.count; i++) if (isGreen(c.getX(i), c.getY(i), c.getZ(i)) && Math.hypot(p.getX(i), p.getZ(i)) < 30) ys.add(Math.round(p.getY(i) / 3));
    assert.ok(ys.size >= 8, `${id}: green roofs over ${ys.size} bands of 3 m`);
    assert.ok(share(c, isGreen) > 0.25, `${id}: green share`);
    // the base: stone up to baseH, wider at its foot than at its top
    let foot = 0, top = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      if (r > 32) continue;   // (Nagoya's small keep apart)
      if (y < 0.01) foot = Math.max(foot, r);
      if (Math.abs(y - baseH) < 0.01) top = Math.max(top, r);
    }
    assert.ok(foot > top + 2, `${id}: the base battered (${foot.toFixed(1)} at the foot, ${top.toFixed(1)} at the top)`);
    let goldTop = 0;
    for (let i = 0; i < p.count; i++) if (isGold(c.getX(i), c.getY(i), c.getZ(i))) goldTop = Math.max(goldTop, p.getY(i));
    assert.ok(Math.abs(goldTop - L.heightM) < 0.01, `${id}: the fish at the top (${goldTop})`);
  }
  // Nagoya's small keep stands 52.8 m to the south (the grid's), lower (26 m)
  const { p } = geom('nagoyacastle');
  let sTop = 0;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 40) sTop = Math.max(sTop, p.getY(i));   // scene z = -north
  assert.ok(Math.abs(sTop - 26) < 0.01, `the small keep's top ${sTop}`);
  // Osaka's top storey dark
  const o = geom('osakacastle');
  assert.ok(share(o.c, (r, g, b) => r + g + b < 0.45) > 0.01, 'Osaka\'s dark top storey');
});

test('v0.7.5: the TV tower: a lattice of members, the deck at 90 m, aviation lights, the antenna to 180 m', () => {
  const { p, g, lights } = geom('nagoyatv');
  const e = g.getAttribute('aExt'), f = g.getAttribute('aFac');
  let shell = 0, deck = [];
  for (let i = 0; i < e.count; i++) { if (e.getZ(i) > 0.5) shell++; if (f.getX(i) > 0 && p.getY(i) > 80 && p.getY(i) < 100) deck.push(p.getY(i)); }
  assert.ok(shell > 0 && shell < e.count / 4, `the shell a small share (${shell} of ${e.count})`);
  assert.ok(e.count / 3 > 1500, 'members, not a shaft');
  assert.ok(Math.abs(Math.min(...deck) - 87) < 0.5 && Math.abs(Math.max(...deck) - 94) < 0.5, 'the glazed deck from 87 to 94 m');
  assert.ok(lights.some((l) => l[3] === 1 && l[1] > 179), 'a flashing light at the top');
  assert.ok(lights.length >= 9);
  // the legs spread to about 47 m at the foot (OSM): the corners about 33 m out
  let foot = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.5) foot = Math.max(foot, Math.hypot(p.getX(i), p.getZ(i)));
  assert.ok(foot > 29 && foot < 34, `the foot's corners ${foot.toFixed(1)} m out`);
});

test('v0.7.5: the torii: six legs in the water, vermilion, the top beam about 24 m long with its ends rising', () => {
  const { p, c } = geom('torii');
  // the feet: the vertices at y 0 fall into six clusters (two pillars, four legs)
  const feet = [];
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0.01) continue;
    const x = p.getX(i), z = p.getZ(i);
    const near = feet.filter((cl) => cl.some((q) => Math.hypot(q[0] - x, q[1] - z) < 2.6));
    if (!near.length) feet.push([[x, z]]);
    else { near[0].push([x, z]); for (const cl of near.slice(1)) { near[0].push(...cl); feet.splice(feet.indexOf(cl), 1); } }
  }
  assert.equal(feet.length, 6, `${feet.length} feet`);
  assert.ok(share(c, isVermilion) > 0.6, 'vermilion');
  let span = 0, endY = 0, midY = 0;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i)), y = p.getY(i);
    if (y > 14) span = Math.max(span, r);
    if (r > 11.5) endY = Math.max(endY, y);
    if (r < 1.5 && y > 14) midY = Math.max(midY, y);
  }
  assert.ok(span > 11.8 && span < 12.6, `the top beam ${2 * span} m`);
  assert.ok(endY > midY + 0.8, `the ends rise (${endY.toFixed(2)} against ${midY.toFixed(2)})`);
});

test('v0.7.5: the Atomic Bomb Dome: broken walls of uneven height, the dome a bare frame to 25 m over its tower', () => {
  const { p, c, g } = geom('abombdome');
  const tops = new Set();
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 5 && y < 16.5) tops.add(Math.round(y * 2) / 2); }
  assert.ok(tops.size >= 10, `${tops.size} wall heights`);
  // the dome: thin dark members, open (no solid shell): above 19.5 m every vertex is close to a member's line
  let dark = 0, all = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 19.6) { all++; if (c.getX(i) < 0.25) dark++; }
  assert.ok(all > 300 && dark === all, `the frame: ${dark} of ${all} dark`);
  const tris = p.count / 3;
  assert.ok(tris > 800, `${tris}`);
  // the windows as dark bays (the facade's pattern), no lit floors
  const f = g.getAttribute('aFac');
  let bays = 0, lit = 0;
  for (let i = 0; i < f.count; i++) { if (f.getX(i) > 0) bays++; if (f.getW(i) > 0) lit++; }
  assert.ok(bays > f.count / 3 && lit === 0, 'empty windows, none lit');
});

test('v0.7.5: the ground under each from the installed terrain: the torii in the sea, the others on land', async () => {
  const { hf } = await tiledTerrain({ layers: ['h', 'w', 'c'], coasts: true });
  for (const id of NEW) {
    const L = byId(id);
    await hf.tiles.whenReady(L.x, L.y, 3000, 'test');
    const pts = [[0, 0], ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos(k * Math.PI / 4) * 0.8 * L.footprintM, Math.sin(k * Math.PI / 4) * 0.8 * L.footprintM])];
    const water = pts.map(([dx, dy]) => hf.waterAt(L.x + dx, L.y + dy));
    const h = pts.map(([dx, dy]) => hf.heightAt(L.x + dx, L.y + dy));
    if (id === 'torii') {
      assert.ok(water.every(Boolean) && h.every((v) => v === 0), `the torii in the sea: ${water} ${h}`);
    } else {
      assert.ok(!water.some(Boolean), `${id} on land`);
      assert.ok(Math.min(...h) > 1 && Math.max(...h) - Math.min(...h) < 6, `${id}: ground ${Math.min(...h).toFixed(1)} to ${Math.max(...h).toFixed(1)} m`);
    }
  }
});
