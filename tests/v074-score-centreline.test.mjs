// v0.7.4, Shane's item 8: the centreline part of the landing score. "5.7m is only a tiny fraction of the runway's
// width. Maybe let landing on the very edge be 0, and closer and closer to the center is full marks, not a steep
// dropoff." 10 within 1.5 m, then a straight line to 0 where the outer main wheel's outer edge reaches the runway's
// edge, from the runway's own width and the gear of the type or design being flown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COST, RATE, scoreFor, createScorer, landingRunway, centrelineEdge, centrelineScore, gearOuterM, CENTRE_FULL_M } from '../src/score.js';
import { TYPES } from '../src/sim/types.js';
import { designDef, newDesign } from '../src/sim/designs.js';

const rate = (cross, edge) => scoreFor(COST.centreline(cross, edge), RATE.centreline[0]);
const A321 = TYPES.a321neo.geo, B787 = TYPES['b787-9'].geo, B777 = TYPES['b777-300er'].geo;

test('the gear: the outer main wheel\'s outer edge from each type\'s own numbers', () => {
  assert.ok(Math.abs(gearOuterM(A321) - (7.59 / 2 + 0.465 + 0.22)) < 0.02, `${gearOuterM(A321)}`);
  assert.ok(Math.abs(gearOuterM(B787) - (9.80 / 2 + 0.76 + 21 * 0.0254 / 2)) < 1e-9, `${gearOuterM(B787)}`);
  assert.ok(Math.abs(gearOuterM(B777) - (10.97 / 2 + 0.70 + 21 * 0.0254 / 2)) < 1e-9, `${gearOuterM(B777)}`);
});

test('the edge: about 18 m for the A321 on a 45 m runway, 16 m for the 777, more on a 60 m runway', () => {
  assert.ok(Math.abs(centrelineEdge(45, A321) - 18.02) < 0.03, `${centrelineEdge(45, A321)}`);
  assert.ok(Math.abs(centrelineEdge(45, B777) - 16.05) < 0.03, `${centrelineEdge(45, B777)}`);
  assert.ok(Math.abs(centrelineEdge(60, A321) - 25.52) < 0.03 && Math.abs(centrelineEdge(60, B777) - 23.55) < 0.03);
  assert.equal(centrelineEdge(45, null), centrelineEdge(45, A321));     // no type set: the A321neo's
  assert.equal(centrelineEdge(undefined, A321), centrelineEdge(45, A321)); // no width known: 45 m
  assert.ok(centrelineEdge(12, B777) >= CENTRE_FULL_M + 1);             // a strip narrower than the gear: never a zero-width line
});

test('1.5 m gives 10, the edge 0, and a straight line between', () => {
  const edge = centrelineEdge(45, A321);
  for (const d of [0, 0.5, 1, 1.5, -1.5]) assert.equal(rate(d, edge), 10, `${d} m`);
  assert.equal(rate(edge, edge), 0); assert.equal(rate(edge + 5, edge), 0); assert.equal(rate(-40, edge), 0);
  // the line itself, before rounding: equal steps, symmetric
  const mid = (CENTRE_FULL_M + edge) / 2;
  assert.ok(Math.abs(centrelineScore(mid, edge) - 5) < 1e-12);
  assert.equal(centrelineScore(-7, edge), centrelineScore(7, edge));
  let last = 10;
  for (let d = 1.5; d <= edge; d += 0.25) { const s = centrelineScore(d, edge); assert.ok(s <= last + 1e-12); last = s; }
  // and the rounded score is that line's (the cost is made for scoreFor)
  for (let d = 0; d <= 30; d += 0.37) assert.equal(rate(d, edge), Math.round(centrelineScore(d, edge)), `${d} m`);
});

test("Shane's 5.7 m in an A321 on a 45 m runway: 7 of 10 (it was about 3)", () => {
  assert.equal(rate(5.7, centrelineEdge(45, A321)), 7);
  assert.equal(scoreFor(0.25 * (Math.sqrt(1 + (5.7 / 4) ** 2) - 1), 0.16), 3);   // v0.5.4 to v0.7.3's rule, for the record
});

test('a 60 m runway is kinder at the same distance; a wider gear is stricter', () => {
  assert.equal(rate(5.7, centrelineEdge(60, A321)), 8);
  assert.equal(rate(12, centrelineEdge(45, A321)), 4); assert.equal(rate(12, centrelineEdge(60, A321)), 6);
  assert.equal(rate(12, centrelineEdge(45, B777)), 3);
});

// The scorer itself: the runway's own width and the flown gear reach the part.
const mk = (widthM) => [{ id: '09/27', widthM, ends: [{ ident: '09', x: 0, y: 0 }, { ident: '27', x: 3000, y: 0 }] }];
function land(def, widthM, cross) {
  const sc = createScorer();
  if (def) sc.setType(def);
  const s = { t: 10, ias: 70, gs: 70, vs: 0, onGround: true, nz: 1, pos: { x: 400, y: -cross, z: (def || TYPES.a321neo).geo.GROUND_Z } };
  sc.setLanding(landingRunway(mk(widthM), 400, -cross, Math.PI / 2));
  sc.update(s, [{ type: 'touchdown', vsMs: -130 / 196.85, g: 1, x: 400, y: -cross, bank: 0, pitch: 5.5 * Math.PI / 180, surface: 'runway' }]);
  s.t += 30; s.gs = 5;
  const res = sc.update(s, []);
  return res.parts.find((p) => p.name === 'From centreline');
}

test('the scorer: 5.7 m on a 45 m runway scores 7 in the A321, the 60 m runway 8; the edge is on the row', () => {
  const p = land(TYPES.a321neo, 45, 5.7);
  assert.equal(p.score, 7); assert.equal(p.value, 5.7); assert.ok(Math.abs(p.edgeM - 18.02) < 0.03, `${p.edgeM}`);
  assert.equal(land(TYPES.a321neo, 60, 5.7).score, 8);
  assert.equal(land(TYPES['b777-300er'], 45, 12).score, 3);
  assert.equal(land(null, 45, 5.7).score, 7);                              // no type set: the A321neo's gear
  assert.equal(land(TYPES.a321neo, 45, 1.5).score, 10);
  assert.equal(land(TYPES.a321neo, 45, 18.1).score, 0);
});

test('a design with its gear moved out (a wider wing carries the legs with it) is scored by where its wheels are', () => {
  const d = newDesign('a321neo');
  d.airframe = { ...d.airframe, wingL: { ...(d.airframe && d.airframe.wingL), span: 1.3 }, wingR: { ...(d.airframe && d.airframe.wingR), span: 1.3 } };
  let def = null;
  try { def = designDef(d); } catch { def = null; }
  if (!def || !(gearOuterM(def.geo) > gearOuterM(A321) + 0.05)) {
    // the design store's shape differs here: move the legs directly, as applyAirframeGeo() does
    const geo = { ...A321, GEAR: { ...A321.GEAR, left: { ...A321.GEAR.left, y: A321.GEAR.left.y + 1.5 }, right: { ...A321.GEAR.right, y: A321.GEAR.right.y - 1.5 } } };
    def = { ...TYPES.a321neo, geo };
  }
  const out = gearOuterM(def.geo);
  assert.ok(out > gearOuterM(A321) + 0.05, `${out}`);
  const p = land(def, 45, 12), base = land(TYPES.a321neo, 45, 12);
  assert.ok(Math.abs(p.edgeM - (22.5 - out)) < 0.011, `${p.edgeM} ${out}`);
  assert.ok(p.score < base.score, `${p.score} < ${base.score}`);
});
