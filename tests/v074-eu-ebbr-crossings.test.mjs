// v0.7.4, fix 1 ("Found while building v0.7.1"): a runway bends to every longer runway it crosses and is cut by each.
// Brussels's 01/19 crosses 07R/25L and, at its north end, 07L/25R: until v0.7.4 only the first was shaped (19's
// elevation was set to an [EST] 108.4 ft to hide most of the second, a lip of 0.2 to 0.3 m was left, and 19 was landed
// on only). Now: four bends a crossing (where each edge of the longer runway meets each side of 01/19), both cuts,
// 19's pavement end level with 07L/25R beside it and the published 113 ft read at its displaced threshold, both ways,
// and the ground along and beside the wheels' tracks across both crossings without a lip over 2 cm. A runway that
// crosses one longer runway keeps the two bends it had. From a process opened in Europe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { runwayCrossings, runwayRects, rectElev, profileAt, knotPairs, knotChainGlsl, MAX_KNOTS, CROSSING_LEVEL, CROSSINGS78, pavementEnd, ONE_WAY, aipTakesOff, aipLands, RUNWAY_SHOULDER_M } = await import('../src/world/runways.js');
  const { createTiledHeightfield } = await import('../src/world/heightfield.js');
  const { DATA, readGz, readJson, manifest } = await import('./tile-terrain.mjs');
  const load = () => JSON.parse(readFileSync(new URL('airports/EBBR.json', DATA)));
  const FT = 0.3048;

  test('knotPairs(): one or two bends pack as before; up to eight fill four vectors, an odd count repeating its last', () => {
    const none = [1e9, 0, 1e9, 0];
    assert.equal(MAX_KNOTS, 8);
    assert.deepEqual(knotPairs([]), [none, none, none, none]); assert.deepEqual(knotPairs(undefined), [none, none, none, none]);
    assert.deepEqual(knotPairs([[10, 1]]), [[10, 1, 10, 1], none, none, none]);                       // a single bend twice (v0.1.4's packing)
    assert.deepEqual(knotPairs([[10, 1], [20, 2]]), [[10, 1, 20, 2], none, none, none]);
    assert.deepEqual(knotPairs([[10, 1], [20, 2], [30, 3]]), [[10, 1, 20, 2], [30, 3, 30, 3], none, none]);
    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i * 10, i]);
    assert.deepEqual(knotPairs(eight), [[10, 1, 20, 2], [30, 3, 40, 4], [50, 5, 60, 6], [70, 7, 80, 8]]);
    assert.deepEqual(knotPairs([...eight, [90, 9]]), knotPairs(eight));                                // a ninth isn't drawn
  });

  test('the shaders\' chain is the profile: no bend, one, two, three, four and eight, against rectElev()', () => {
    // the GLSL text run as JavaScript (mix and clamp defined here), for both shaders' forms
    const mix = (a, b, t) => a + (b - a) * t, clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x)), max = Math.max;
    void mix; void clamp; void max;
    const body = knotChainGlsl({ pos: 'u', k: ['kn', 'kn2', 'kn3', 'kn4'], set: (e) => `return ${e};`,
      none: 'mix(b.z, b.w, clamp((u + b.x) / (2.0 * b.x), 0.0, 1.0))',
      first: (K) => `mix(b.z, ${K}.y, clamp((u + b.x) / max(${K}.x + b.x, 1e-3), 0.0, 1.0))`,
      last: (K) => `mix(${K}.w, b.w, clamp((u - ${K}.z) / max(b.x - ${K}.z, 1e-3), 0.0, 1.0))` });
    const fn = new Function('u', 'b', 'kn', 'kn2', 'kn3', 'kn4', 'mix', 'clamp', 'max', body);
    const V = (q) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
    const halfLen = 1500, e0 = 30, e1 = 42;
    for (const n of [0, 1, 2, 3, 4, 5, 8]) {
      const knots = Array.from({ length: n }, (_, i) => [-1200 + (2400 * (i + 0.5)) / Math.max(n, 1), 31 + ((i * 7) % 5)]);
      const rect = { halfLen, e0, e1, knots }, K = knotPairs(knots).map(V);
      for (let u = -halfLen - 20; u <= halfLen + 20; u += 3.7) {
        const g = fn(u, { x: halfLen, z: e0, w: e1 }, K[0], K[1], K[2], K[3], mix, clamp, max), c = rectElev(rect, u);
        assert.ok(Math.abs(g - c) < 1e-9, `${n} bends, u ${u}: the chain ${g}, rectElev ${c}`);
      }
    }
  });

  test("Brussels's 01/19: bent to both longer runways and cut by both; four bends a crossing, in order; both ways", () => {
    const ap = load(); runwayCrossings(ap);
    const s = ap.runways.find((r) => r.id === '01/19');
    assert.deepEqual(s.cutBy.map((p) => p.id).sort(), ['07L/25R', '07R/25L']);
    assert.equal(s.knots.length, 8);
    for (let i = 1; i < 8; i++) assert.ok(s.knots[i][0] > s.knots[i - 1][0], 'sorted along the runway');
    for (const r of ap.runways) if (r !== s) { assert.equal(r.knots.length, 0, r.id); assert.equal(r.cutBy.length, 0, r.id); }
    assert.equal(ONE_WAY.EBBR, undefined); assert.ok(aipTakesOff('EBBR', '19') && aipLands('EBBR', '19') && aipTakesOff('EBBR', '01') && aipLands('EBBR', '01'));
    // each bend is where one of a longer runway's drawn edges meets one of 01/19's two sides, at that runway's height there
    const p0 = pavementEnd(s.ends[0]), p1 = pavementEnd(s.ends[1]), sl = Math.hypot(p1.x - p0.x, p1.y - p0.y), ux = (p1.x - p0.x) / sl, uy = (p1.y - p0.y) / sl;
    const hwS = (s.widthM || 45) / 2 + RUNWAY_SHOULDER_M;
    let met = 0;
    for (const [ks, kh] of s.knots) for (const v of [-hwS, hwS]) for (const P of s.cutBy) {
      const q0 = pavementEnd(P.ends[0]), q1 = pavementEnd(P.ends[1]), pl = Math.hypot(q1.x - q0.x, q1.y - q0.y), px = (q1.x - q0.x) / pl, py = (q1.y - q0.y) / pl;
      const x = p0.x + ux * ks - uy * v, y = p0.y + uy * ks + ux * v, along = (x - q0.x) * px + (y - q0.y) * py, across = Math.abs(-(x - q0.x) * py + (y - q0.y) * px);
      if (Math.abs(across - ((P.widthM || 45) / 2 + RUNWAY_SHOULDER_M)) < 1e-6) { assert.ok(Math.abs(kh - profileAt(P, along, ap.elevM)) < 1e-9, `${P.id} at ${ks.toFixed(0)} m`); met++; }
    }
    assert.equal(met, 8);
    // 19: the pavement end level with 07L/25R beside it [EST]; the published 113 ft read at the displaced threshold
    const e19 = s.ends.find((e) => e.ident === '19'), last = s.knots[7];
    assert.ok(Math.abs(e19.elevM - last[1]) < 0.06, `the stub north of 07L/25R is level: ${e19.elevM} m at the end, ${last[1].toFixed(2)} m at the last bend`);
    assert.ok(sl - last[0] < 30, `${(sl - last[0]).toFixed(1)} m of stub`);
    assert.equal(e19.displacedM, 218);
    const atThr = profileAt(s, sl - 218, ap.elevM) / FT;
    assert.ok(Math.abs(atThr - 113) < 0.5, `19's threshold: ${atThr.toFixed(1)} ft (OurAirports: 113 ft)`);
  });

  test("the heightfield's and the terrain shader's rects: 01/19 as three of two bends each, the same profile; every other runway one rect", () => {
    const ap = load(); runwayCrossings(ap);
    const s = ap.runways.find((r) => r.id === '01/19'), p0 = pavementEnd(s.ends[0]), p1 = pavementEnd(s.ends[1]), len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const rects = runwayRects([ap]), mine = rects.filter((r) => r.runway === s);
    assert.equal(rects.length, 5); assert.equal(mine.length, 3);
    for (const r of rects) assert.ok(r.knots.length <= 2, `${r.runway.id}: ${r.knots.length} bends in one rect`);
    assert.deepEqual(mine.map((r) => r.part), [0, 1, 2]);
    // end to end with no gap, along the runway's own axis, and each rect's height is the runway's profile there
    let s0 = 0;
    for (const r of mine) {
      const sc = (r.cx - p0.x) * r.dx + (r.cy - p0.y) * r.dy;
      assert.ok(Math.abs(sc - r.halfLen - s0) < 1e-6, `part ${r.part} starts at ${(sc - r.halfLen).toFixed(3)} m, the last ended at ${s0.toFixed(3)} m`);
      for (let u = -r.halfLen; u <= r.halfLen; u += 0.5) assert.ok(Math.abs(rectElev(r, u) - profileAt(s, sc + u, ap.elevM)) < 1e-9, `part ${r.part}, ${(sc + u).toFixed(1)} m along`);
      s0 = sc + r.halfLen;
    }
    assert.ok(Math.abs(s0 - len) < 1e-6);
    for (const r of rects) if (r.runway !== s) { assert.equal(r.part, undefined); assert.equal(r.knots.length, 0); }
  });

  test('a runway that crosses one longer runway keeps its two bends (every airport of the region)', () => {
    const man = manifest();
    let one = 0, many = 0;
    for (const f of [...(man.airports || []), ...(man.airportsRegion || []), ...(man.airportsPending || [])]) {
      const ap = JSON.parse(readFileSync(new URL(f, DATA)));
      runwayCrossings(ap);
      for (const r of ap.runways) {
        // (v0.7.8, changed on purpose: with CROSSINGS78 a single crossing has four bends too, and two more where the longer
        // runway bends inside it, Prague's; with FS_CROSSINGS78=0 the two it had)
        if (r.cutBy.length === 1) { one++; assert.ok(r.knots.length <= (CROSSINGS78 ? 6 : 2) + (CROSSING_LEVEL[ap.icao]?.[r.id] ? 1 : 0), `${ap.icao} ${r.id}: ${r.knots.length}`); }
        if (r.cutBy.length > 1) { many++; assert.equal(`${ap.icao} ${r.id}`, 'EBBR 01/19'); }
      }
    }
    assert.ok(one >= 9, `${one} runways crossing one longer runway`); assert.equal(many, 1);
  });

  test('the ground along the wheels across both crossings: no lip over 2 cm, on 01/19 and on the two it crosses', async () => {
    const ap = load();
    const hf = await createTiledHeightfield(manifest(), DATA.href, { region: true, airports: [ap], readGz, readJson, layers: ['h'], maxTiles: 60 });
    runwayCrossings(ap);
    let worst = { d: 0 }, n = 0;
    for (const rw of ap.runways) {
      const p0 = pavementEnd(rw.ends[0]), p1 = pavementEnd(rw.ends[1]), len = Math.hypot(p1.x - p0.x, p1.y - p0.y), ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
      // the centreline and the main wheels' tracks of the three types (3.8 m, 4.9 m and 5.5 m either side), every 0.5 m
      for (const v of [0, 3.8, -3.8, 4.9, -4.9, 5.5, -5.5, 12, -12, 20, -20]) {
        let last = null;
        for (let s = 1; s <= len - 1; s += 0.5) {
          const h = hf.heightAt(p0.x + ux * s - uy * v, p0.y + uy * s + ux * v);
          if (last !== null) { const d = Math.abs(h - last); n++; if (d > worst.d) worst = { d, id: rw.id, s, v }; }
          last = h;
        }
      }
    }
    console.log(`# Brussels: ${n} half-metre steps along its three runways' tracks; the largest ${(worst.d * 100).toFixed(2)} cm (${worst.id}, ${worst.s} m along, ${worst.v} m off the centreline)`);
    assert.ok(worst.d <= 0.02, JSON.stringify(worst));
    // and 01/19's ground is its own profile everywhere along its centreline (within the patch's blend), both ends included
    const s = ap.runways.find((r) => r.id === '01/19'), p0 = pavementEnd(s.ends[0]), p1 = pavementEnd(s.ends[1]), len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const h = hf.heightAt(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f), want = profileAt(s, f * len, ap.elevM);
      // on a longer runway's pavement the ground is that runway's (the longer one wins): within the crossing's own cross-fall
      assert.ok(Math.abs(h - want) < 0.15, `${(f * 100).toFixed(0)} % along: ground ${h.toFixed(3)} m, 01/19's profile ${want.toFixed(3)} m`);
    }
  });
}
