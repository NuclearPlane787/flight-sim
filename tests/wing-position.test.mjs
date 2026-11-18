// v0.5.6: the wing's position along the fuselage (airframe.wingX, metres aft; ROADMAP "Found while building v0.5.6").
// The main gear follows the wing (fork B2), so a shorter chord or less sweep brought the legs forward towards the CG:
// a 777 or 787 at 0.8 chord, or an A321 at −8° and 0.8, lifted its nose at 20 kt on a full-thrust take-off and struck
// its tail. Real designers move the wing to put the gear behind the CG: wingX moves the whole wing (both sides, its
// carry-through, its engines, tanks, fuel and main gear) along the fuselage, which stays. The take-off trim also takes
// the airframe's moves of what it carries (the engines on a swept wing) out of the base's schedule, so a 777 with 8°
// more sweep lifts its nose by itself at the base's speed (it did at 126 kt instead of 172).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A canvas that draws nothing, so the liveries paint without a DOM.
const ctx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 100 })
    : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const { newDesign, designDef, defaultAirframe, fixAirframe, isBaseAirframe, normalizeDesign, designNumbers, AIRFRAME_RANGES } = await import('../src/sim/designs.js');
const { airframeMap } = await import('../src/sim/airframe-map.js');
const { shapeOf } = await import('../src/sim/parts-aero.js');
const { createSim } = await import('../src/sim/sim.js');
const { createAircraft } = await import('../src/aircraft.js');
const { createWidebody } = await import('../src/widebody.js');
const { B777_300ER } = await import('../src/widebody-specs.js');
const { editAirframe, readout, afOutline, AF_KEYS, viewKey } = await import('../src/ui/warehouse.js');

const KT = 0.514444, DT = 1 / 120;
let n = 0;
const afOf = (base, wing = {}, wingX = 0) => {
  const af = defaultAirframe(base);
  return { ...af, wingL: { ...af.wingL, ...wing }, wingR: { ...af.wingR, ...wing }, ...(wingX ? { wingX } : {}) };
};
const designOf = (base, wing, wingX) => ({ ...newDesign(base, { id: `wp-${base}-${n++}` }), airframe: afOf(base, wing, wingX) });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('the field: −3 to +3 m in 0.1 m steps, absent at 0, a moved wing is not the base\'s airframe', () => {
  assert.deepEqual(AIRFRAME_RANGES.wingX, [-3, 3]);
  assert.equal(fixAirframe({ ...defaultAirframe('a321neo'), wingX: 9 }, 'a321neo').wingX, 3);
  assert.equal(fixAirframe({ ...defaultAirframe('a321neo'), wingX: -1.234 }, 'a321neo').wingX, -1.2);
  assert.equal('wingX' in fixAirframe({ ...defaultAirframe('b787-9'), wingX: 0 }, 'b787-9'), false, 'absent at 0');
  assert.equal('wingX' in defaultAirframe('b777-300er'), false);
  assert.equal(isBaseAirframe(afOf('b777-300er', {}, 0.5), 'b777-300er'), false);
  const d = normalizeDesign(designOf('b777-300er', {}, 1.5));
  assert.deepEqual(normalizeDesign(JSON.parse(JSON.stringify(d))), d, 'round-trips');
  assert.ok(designDef(d).data.PARTS_AERO, 'a moved wing flies from its parts');
});

test('the map, the strips and the plugs move with the wing; the fuselage and the tails stay', () => {
  for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
    const wx = 1.5, M0 = airframeMap(base, afOf(base, { chord: 0.9 })), M = airframeMap(base, afOf(base, { chord: 0.9 }, wx));
    for (const [x, y, z] of [[2, 3, 0], [-4, 12, 1], [0, 1.5, -1]]) {
      const a = M0.wing(1, x, y, z), b = M.wing(1, x, y, z);
      assert.ok(near(b[0], a[0] - wx) && near(b[1], a[1]) && near(b[2], a[2]), `${base}: the wing's points ${wx} m aft`);
    }
    assert.ok(near(M.cuts.fwd, M0.cuts.fwd - wx) && near(M.cuts.aft, M0.cuts.aft - wx), `${base}: the plugs' cuts with the wing's root`);
    assert.equal(M.bodyX(10), 10); assert.deepEqual(M.tail(-20, 3, 2), M0.tail(-20, 3, 2)); assert.deepEqual(M.fin(-20, 0, 4), M0.fin(-20, 0, 4));
    const S0 = shapeOf(base, afOf(base)), S = shapeOf(base, afOf(base, {}, wx));
    S.wingL.stations.forEach((s, i) => assert.ok(near(s.xle, S0.wingL.stations[i].xle - wx) && near(s.c, S0.wingL.stations[i].c), `${base}: strip ${i}`));
    assert.deepEqual(S.tail, S0.tail); assert.deepEqual(S.body, S0.body);
  }
});

test('the mass, the fuel and the main gear go with the wing', () => {
  for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
    const B = designDef(newDesign(base, { id: `wp-b-${base}` })), D = designDef(designOf(base, {}, 2));
    const A0 = B.data, A = D.data;
    // the wing's structure and the two engines move 2 m aft: a fifth to a third of the empty weight
    const frac = (A0.CG_OEW_X - A.CG_OEW_X) / 2;
    assert.ok(frac > 0.2 && frac < 0.45, `${base}: the empty CG ${(frac * 100).toFixed(0)} % of the wing's move`);
    assert.ok(near(A.CG_WING_FUEL_X, A0.CG_WING_FUEL_X - 2, 1e-6) && near(A.CG_CENTER_FUEL_X, A0.CG_CENTER_FUEL_X - 2, 1e-9), `${base}: the fuel`);
    assert.ok(near(D.geo.GEAR.left.x, B.geo.GEAR.left.x - 2) && near(D.geo.GEAR.right.x, B.geo.GEAR.right.x - 2) && near(D.geo.GEAR.nose.x, B.geo.GEAR.nose.x), `${base}: the main legs, not the nose leg`);
    assert.ok(near(D.geo.WHEELBASE, B.geo.WHEELBASE + 2), `${base}: the wheelbase`);
    D.geo.NACELLES.forEach((x, i) => assert.ok(near(x.x, B.geo.NACELLES[i].x - 2, 1e-9), `${base}: engine ${i + 1}`));
  }
});

test('the numbers follow: aft, the nose wheel carries more, the tail strikes later, and it\'s steadier in pitch', () => {
  for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
    const a0 = designNumbers(designDef(designOf(base, { chord: 0.9 }))).airframe, a1 = designNumbers(designDef(designOf(base, { chord: 0.9 }, 1))).airframe;
    assert.ok(a1.noseLoad > a0.noseLoad + 0.005 && a1.noseLoadThrust > a0.noseLoadThrust + 0.005, `${base}: the nose wheel's share`);
    assert.ok(a1.tailStrikeDeg > a0.tailStrikeDeg, `${base}: the tail-strike angle`);
    assert.ok(a1.staticMarginMac > a0.staticMarginMac + 0.02, `${base}: the static margin`);
  }
});

// TOGA from a standstill with the take-off flaps, hands off, light (the empty weight and 5 t of fuel, as the nose
// wheel's check): the IAS (kt) at which the nose wheel leaves the runway, or null if the tail struck first.
const FLAP = { 'a321neo': 1, 'b787-9': 2, 'b777-300er': 2 };
function noseLift(des, light = true, mass = 0) {
  const A = designDef(des).data, sim = createSim({ type: des });
  const fuel = light ? 5000 : Math.min(A.FUEL_MAX * 0.3, mass * 0.25), payload = light ? 0 : Math.max(0, mass - A.OEW - fuel);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: FLAP[des.base], gearDown: true, fuelKg: fuel, payloadKg: payload });
  sim.controls.parkingBrake = false; sim.controls.thrust = 1;
  for (let t = 0; t < 90; t += DT) {
    sim.step(DT);
    const s = sim.state;
    if (s.crashed) return null;
    if (s.ias > 15 * KT && !s.wow.nose) return s.ias / KT;
  }
  return Infinity;
}

test('moving the wing aft puts the tail-sitters back on their nose wheels: 0.8 chord on the Boeings (2 m), −8° and 0.8 on the A321 (1 m)', () => {
  for (const [base, wing, wx] of [['a321neo', { chord: 0.8, sweep: -8 }, 1], ['b787-9', { chord: 0.8 }, 2], ['b777-300er', { chord: 0.8 }, 2]]) {
    const v0 = noseLift(newDesign(base, { id: `wp-l-${base}` }));
    const bad = noseLift(designOf(base, wing, 0)), good = noseLift(designOf(base, wing, wx));
    assert.ok(bad === null || bad < 40, `${base} ${JSON.stringify(wing)} where the wing was: the nose lifts at ${bad?.toFixed(0)} kt`);
    assert.ok(good > 0.85 * v0, `${base} with the wing ${wx} m aft: ${good?.toFixed(0)} kt (the base's ${v0.toFixed(0)})`);
    const a = designNumbers(designDef(designOf(base, wing, wx))).airframe, b = designNumbers(designDef(newDesign(base, { id: `wp-n-${base}` }))).airframe;
    assert.ok(Math.abs(a.noseLoadThrust - b.noseLoadThrust) < 0.006, `${base}: the share with full thrust ${(a.noseLoadThrust * 100).toFixed(1)} %, the base's ${(b.noseLoadThrust * 100).toFixed(1)} %`);
  }
});

test('the take-off trim takes out what the airframe moved: a 777 with 8° more sweep lifts its nose at the base\'s speed', () => {
  const v0 = noseLift(newDesign('b777-300er', { id: 'wp-s0' }), false, 300000), v = noseLift(designOf('b777-300er', { sweep: 8 }), false, 300000);
  assert.ok(Math.abs(v / v0 - 1) < 0.03, `${v.toFixed(1)} kt against the base's ${v0.toFixed(1)}`);
  // and a wing moved aft on the base's shape, its engines with it
  const w = noseLift(designOf('b777-300er', {}, 2), false, 300000);
  assert.ok(Math.abs(w / v0 - 1) < 0.03, `wing 2 m aft: ${w.toFixed(1)} kt`);
});

test('the models build with a moved wing', () => {
  const dA = designDef(designOf('a321neo', { chord: 0.8, sweep: -8 }, 1));
  assert.doesNotThrow(() => createAircraft({ def: dA }));
  const dB = designDef(designOf('b777-300er', { chord: 0.8 }, 2));
  assert.doesNotThrow(() => createWidebody(B777_300ER, { def: dB }));
});

test('the warehouse: a Position slider for the wing, As the base puts it back, the nose wheel\'s note points to it', () => {
  assert.ok(AF_KEYS.wing.includes('wingX'));
  const d = designOf('b777-300er', { chord: 0.8 });
  const e = editAirframe(d, 'wingX', 1.24, 1);
  assert.equal(e.airframe.wingX, 1.2);
  assert.equal(editAirframe(d, 'wingX', 9, -1).airframe.wingX, 3);
  assert.equal('wingX' in editAirframe(e, 'reset', 'wing', 1).airframe, false);
  assert.notEqual(viewKey(e), viewKey(d), 'the model rebuilds');
  const O0 = afOutline('b777-300er', d.airframe), O1 = afOutline('b777-300er', e.airframe);
  assert.ok(near(O1.wingL[0][0], O0.wingL[0][0] - 1.2), 'the green outline moves');
  assert.deepEqual(O1.bodyTop, O0.bodyTop);
  const r = readout(d, { airframe: true }), nose = r.rows.find((x) => x.k === 'nose');
  assert.notEqual(nose.level, 'ok');
  assert.ok(r.issues.some((i) => /Position/.test(i.text)), r.issues.map((i) => i.text).join(' | '));
});
