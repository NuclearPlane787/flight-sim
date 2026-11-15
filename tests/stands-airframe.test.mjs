// v0.5.3 (the run's extra time): a design with its own airframe gets the stands that fit its own span and length,
// parks with its own nose on the stop mark, and frees the parked traffic for its own size. The base types and a
// design on its base's airframe get exactly what they did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { newDesign, designDef, defaultAirframe } from '../src/sim/designs.js';
import { createGateFlow } from '../src/ground/gate-flow.js';
import { standsFor, standGeo, pushMinBack, lineBehind, buildTaxiGraph } from '../src/ground/taxi.js';
import { standHeading, sizedFootprint, pointInPoly } from '../src/world/traffic-layout.js';

const here = new URL('..', import.meta.url).pathname;
const ICAOS = ['RKSS', 'RKPC', 'RKSI'];
function bootAirport(i) {
  const ap = JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8'));
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
  return ap;
}
const AP = Object.fromEntries(ICAOS.map((i) => [i, bootAirport(i)]));
const BASES = ['a321neo', 'b787-9', 'b777-300er'];
let n = 0;
const design = (base, patch) => designDef({ ...newDesign(base, { id: `st-${base}-${n++}` }), airframe: { ...defaultAirframe(base), ...patch } });
const wingOf = (base, k) => { const a = defaultAirframe(base); return { wingL: { ...a.wingL, span: k }, wingR: { ...a.wingR, span: k } }; };

test('the base types, and a design on its base\'s airframe, get the same stands as before', () => {
  for (const b of BASES) {
    const T = typeById(b), D = designDef(newDesign(b, { id: `same-${b}` }));
    assert.equal(D.geo.DESIGN_SHAPE, undefined, `${b}: no design shape on the base's airframe`);
    assert.equal(standGeo(T.geo), T.geo, 'standGeo leaves a type alone');
    for (const i of ICAOS) assert.deepEqual(standsFor(AP[i], D).map((s) => s.ref), standsFor(AP[i], T).map((s) => s.ref), `${b} ${i}`);
  }
  for (const i of ICAOS) assert.equal(standsFor(AP[i], typeById('a321neo')), AP[i].stands, 'the A321: the data\'s own array');
});

test('a longer wing gets only the stands that fit it: a code D A321, a code F+ 777', () => {
  const cases = [['a321neo', 1.3, 52], ['b787-9', 1.3, 80], ['b777-300er', 1.3, 84]];
  for (const [b, k, span] of cases) {
    const D = design(b, wingOf(b, k)), T = typeById(b);
    const G = standGeo(D.geo);
    assert.ok(G.SPAN > T.geo.SPAN * 1.2, `${b}: the design's span (${G.SPAN.toFixed(1)} m)`);
    for (const i of ICAOS) {
      const base = standsFor(AP[i], T), mine = standsFor(AP[i], D);
      // a bigger aircraft never gets a stand its base couldn't use; the A321 (base code C: every stand) loses some
      const refs = new Set(base.map((s) => s.ref));
      assert.ok(mine.every((s) => refs.has(s.ref)), `${b} ${i}: only its base's stands`);
      assert.ok(mine.length >= 1 && mine.length <= base.length, `${b} ${i}: ${mine.length} of ${base.length}`);
      if (b === 'a321neo') assert.ok(mine.length < base.length, `${i}: fewer stands for a code D A321 (${mine.length} of ${base.length})`);
      // each one clears the buildings at the design's size
      for (const s of mine) {
        const h = standHeading(AP[i], s);
        const fp = sizedFootprint({ span: Math.max(span, G.SPAN), length: G.LENGTH }, s.x, s.y, h);
        for (const bl of AP[i].buildings) assert.ok(!pointInPoly(fp[0].cx, fp[0].cy, bl.points), `${b} ${i} ${s.ref} in a building`);
      }
      console.log(`  ${b} span ×${k} at ${i}: ${mine.length} of ${base.length} stands (${G.SPAN.toFixed(1)} m)`);
    }
  }
});

test('a stretched design parks with its own nose on the stop mark, with its pushback line behind its own tail', () => {
  for (const b of BASES) {
    const D = design(b, { plugFwd: 6, plugAft: 6 }), T = typeById(b);
    const G = standGeo(D.geo);
    assert.ok(Math.abs(G.NOSE_X - (T.geo.NOSE_X + 6)) < 0.5, `${b}: the nose ${G.NOSE_X.toFixed(2)} (base ${T.geo.NOSE_X.toFixed(2)})`);
    assert.ok(Math.abs(G.LENGTH - (T.geo.LENGTH + 12)) < 1e-9, `${b}: the length`);
    const i = 'RKSI', ap = AP[i];
    const list = standsFor(ap, D);
    assert.ok(list.length >= 3, `${b}: ${list.length} stands at ${i}`);
    const sim = createSim(), gate = createGateFlow({ sim, airports: Object.values(AP) });
    sim.setType?.(D);
    gate.setType(D);
    const ref = list[0].ref;
    const r = gate.start({ origin: i, stand: ref, depRunway: ap.runways[0].ends[0].ident, fuelKg: 20000, payloadKg: 10000 });
    assert.ok(r && r.points.length >= 2, `${b}: a route from ${ref}`);
    const s = sim.state, st = gate.stand;
    const nose = [s.pos.x + Math.sin(s.hdg) * G.NOSE_X, s.pos.y + Math.cos(s.hdg) * G.NOSE_X];
    assert.ok(Math.hypot(nose[0] - st.x, nose[1] - st.y) < 0.01, `${b}: the design's nose on the stop mark`);
    const line = lineBehind(buildTaxiGraph(ap), s.pos.x, s.pos.y, s.hdg, pushMinBack(G));
    assert.ok(line && line.s >= G.LENGTH - G.NOSE_X, `${b}: a taxi line behind the stretched tail`);
  }
});
