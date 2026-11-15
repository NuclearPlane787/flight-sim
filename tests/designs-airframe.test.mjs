// v0.5.3, Part 2: the airframe as data (src/sim/designs.js, src/sim/airframe-map.js). A design without an airframe is
// its base's; the field clamps, mirrors and round-trips; the map agrees with the parts' model's stations; engines and
// tanks ride the wing and clamp to a shorter one; the structure's mass, CG and inertias, the wing's fuel, the tail
// strike and the moved points follow; the checks; snapshots and the prediction carry an airframe design whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { predictSync } from '../src/sim/predict-core.js';
import { newDesign, designDef, normalizeDesign, defaultAirframe, fixAirframe, isBaseAirframe, designNumbers, AIRFRAME_RANGES, mountRange, airframe, designAirframe, codeLetter } from '../src/sim/designs.js';
import { airframeMap } from '../src/sim/airframe-map.js';
import { shapeOf } from '../src/sim/parts-aero.js';
import { typeById } from '../src/sim/types.js';

const IDS = ['a321neo', 'b787-9', 'b777-300er'];
const KT = 0.514444, DT = 1 / 120;
const withAf = (base, patch = {}, wing = null) => {
  const af = { ...defaultAirframe(base), ...patch };
  if (wing) { af.wingL = { ...af.wingL, ...wing }; af.wingR = { ...af.wingR, ...wing }; }
  return { ...newDesign(base), airframe: af };
};

test('a v2 design without an airframe gets its base\'s, exactly, and flies its base\'s numbers', () => {
  for (const id of IDS) {
    const d = newDesign(id); delete d.airframe;
    const n = normalizeDesign(d);
    assert.deepEqual(n.airframe, defaultAirframe(id));
    assert.ok(isBaseAirframe(n.airframe, id));
    assert.equal(n.airframe.wingL.dihedral, typeById(id).geo.WING.dihedralDeg, 'the base\'s dihedral to the bit');
    const def = designDef(n);
    assert.equal(def.data.PARTS_AERO, undefined); assert.equal(def.geo.AIRFRAME, undefined);
    assert.deepEqual(def.geo.EYES, typeById(id).geo.EYES);
    assert.deepEqual(def.geo.NACELLES.map((x) => [x.x, x.y, x.z]), typeById(id).geo.NACELLES.map((x) => [x.x, x.y, x.z]));
  }
});

test('the airframe field clamps to its ranges, snaps, mirrors, and round-trips', () => {
  const R = AIRFRAME_RANGES;
  const f = fixAirframe({ wingL: { span: 9, chord: -1, sweep: 99, dihedral: -99 }, wingR: { span: 0.1 }, mirror: true, tail: 7, fin: 0, plugFwd: 99, plugAft: -99 }, 'a321neo');
  assert.deepEqual(f.wingL, { span: R.span[1], chord: R.chord[0], sweep: R.sweep[1], dihedral: R.dihedral[0] });
  assert.deepEqual(f.wingR, f.wingL, 'mirror copies the left side');
  assert.equal(f.tail, R.tail[1]); assert.equal(f.fin, R.fin[0]); assert.equal(f.plugFwd, R.plugFwd[1]); assert.equal(f.plugAft, R.plugAft[0]);
  const g = fixAirframe({ wingL: { span: 1.123456 }, wingR: { span: 0.9 }, mirror: false }, 'b787-9');
  assert.equal(g.wingL.span, 1.12); assert.equal(g.wingR.span, 0.9); assert.equal(g.mirror, false);
  const d = withAf('b777-300er', { tail: 1.37, plugFwd: 2.5 });
  assert.deepEqual(normalizeDesign(JSON.parse(JSON.stringify(normalizeDesign(d)))), normalizeDesign(d));
  assert.equal(fixAirframe(null, 'a321neo').tail, 1);
});

test('the map moves the base\'s wing stations where the parts\' model puts them', () => {
  for (const id of IDS) {
    const af = fixAirframe({ wingL: { span: 1.2, chord: 0.9, sweep: 5, dihedral: 7 }, mirror: true, tail: 1.4, fin: 0.8, plugAft: 3 }, id);
    const M = airframeMap(id, af), base = shapeOf(id, null), des = shapeOf(id, af);
    for (let k = 0; k < base.wingL.stations.length; k++) {
      const b = base.wingL.stations[k], n = des.wingL.stations[k];
      const [x, y, z] = M.wing(1, b.xle, b.y, b.z);
      assert.ok(Math.abs(x - n.xle) < 1e-9 && Math.abs(y - n.y) < 1e-9 && Math.abs(z - n.z) < 1e-9, `${id} wing station ${k}`);
    }
    for (let k = 0; k < base.tail.stations.length; k++) {
      const b = base.tail.stations[k], n = des.tail.stations[k];
      const [x, y, z] = M.tail(b.xle, b.y, b.z);
      assert.ok(Math.abs(x - n.xle) < 1e-9 && Math.abs(y - n.y) < 1e-9 && Math.abs(z - n.z) < 1e-9, `${id} tail station ${k}`);
    }
    for (let k = 0; k < base.fin.stations.length; k++) {
      const b = base.fin.stations[k], n = des.fin.stations[k];
      const [x, , z] = M.fin(b.xle, 0, b.z);
      assert.ok(Math.abs(x - n.xle) < 1e-9 && Math.abs(z - n.z) < 1e-9, `${id} fin station ${k}`);
    }
    // the identity
    const I = airframeMap(id, defaultAirframe(id));
    assert.ok(I.identity);
    assert.deepEqual(I.wing(1, 1, 5, 0.3), [1, 5, 0.3]);
  }
});

test('engines and wing tanks ride the changed wing, and a station past a shorter wing\'s limit is clamped', () => {
  // a swept-back wing carries the base's engines aft with its leading edge
  const d = withAf('a321neo', {}, { sweep: 8 });
  const def = designDef(d), G0 = typeById('a321neo').geo;
  assert.ok(def.geo.NACELLES[0].x < G0.NACELLES[0].x - 0.3, `nacelle x ${def.geo.NACELLES[0].x} vs ${G0.NACELLES[0].x}`);
  assert.equal(Math.abs(def.geo.NACELLES[0].y), Math.abs(G0.NACELLES[0].y));
  // the thrust point moves with it, and the crash point is the nacelle's low point
  assert.ok(Math.abs((def.geo.ENGINES[0].x - G0.ENGINES[0].x) - (def.geo.NACELLES[0].x - G0.NACELLES[0].x)) < 1e-9);
  // more dihedral lifts the outboard engines
  const up = designDef(withAf('b777-300er', {}, { dihedral: 8 })), B0 = typeById('b777-300er').geo;
  assert.ok(up.geo.NACELLES[0].z > B0.NACELLES[0].z + 0.05);
  // a 787 with a pair of wing tanks at their outermost station, on a wing cut to 0.8: clamped to 75 % of the shorter
  // semi-span, as normalising clamps any part
  const far = normalizeDesign({ ...newDesign('b787-9'), parts: [...newDesign('b787-9').parts, { kind: 'tank', mount: 'wing', side: 1, s: 99, kg: 4000 }] });
  const outer = Math.max(...far.parts.filter((p) => p.kind === 'tank').map((p) => p.s));
  const short = normalizeDesign({ ...far, airframe: { ...defaultAirframe('b787-9'), wingL: { ...defaultAirframe('b787-9').wingL, span: 0.8 } } });
  const tip = airframe('b787-9', short.airframe).tipYs[0];
  const now = Math.max(...short.parts.filter((p) => p.kind === 'tank').map((p) => p.s));
  assert.ok(now <= 0.75 * tip + 1e-9 && now < outer - 3, `outer ${outer} → ${now}`);
  assert.ok(mountRange('b787-9', { kind: 'tank', mount: 'wing', side: 1 }, short.airframe).hi < mountRange('b787-9', { kind: 'tank', mount: 'wing', side: 1 }).hi);
  // the design's sketch: a longer span puts the tip further out, a bigger chord more chord
  const long = designAirframe(designDef(withAf('a321neo', {}, { span: 1.3, chord: 1.2 })));
  const a0 = airframe('a321neo');
  assert.ok(long.tipY > a0.tipY * 1.2);
  assert.ok(Math.abs(long.chord(6) - 1.2 * a0.chord(a0.ys + (6 - a0.ys) / 1.3)) < 0.01);   // (the sketch's side 1.975 m, the planform's root 1.98)
});

test('the structure\'s mass, CG and inertias follow the parts', () => {
  for (const id of IDS) {
    const B = typeById(id).data;
    const tail = designDef(withAf(id, { tail: 1.5 })).data;
    assert.ok(tail.OEW > B.OEW && tail.CG_OEW_X < B.CG_OEW_X, `${id} a bigger tail: heavier, the CG aft`);
    const longW = designDef(withAf(id, {}, { span: 1.3 })).data;
    assert.ok(longW.OEW > B.OEW + 0.04 * B.OEW, `${id} a 30 % longer wing weighs more than 4 % of OEW`);
    // a longer wing rolls slower: its roll inertia (at the same mass) grows by more than the mass alone would
    assert.ok(longW.DESIGN_DIXX > 0.1 * B.IXX_ZFW_PER_KG * B.OEW, `${id} ΔIxx ${longW.DESIGN_DIXX}`);
    assert.ok(longW.FUEL_WING_EACH > 1.25 * B.FUEL_WING_EACH && longW.FUEL_MAX > B.FUEL_MAX, 'the wing holds more fuel');
    const plugs = designDef(withAf(id, { plugFwd: 5, plugAft: 5 })).data;
    assert.ok(plugs.OEW > B.OEW && plugs.DESIGN_DIYY > 0, `${id} plugs: heavier, more pitch inertia`);
    const shortB = designDef(withAf(id, { plugFwd: -4, plugAft: -4 })).data;
    assert.ok(shortB.OEW < B.OEW && shortB.DESIGN_DIYY < 0);
    const fwd = designDef(withAf(id, { plugFwd: 5 })).data;
    assert.ok(fwd.CG_OEW_X > B.CG_OEW_X, 'a forward plug moves the CG forward');
  }
});

test('the moved points: the cockpit and nose gear with the forward plug, the tail strike with the aft plug, the tips with the wing', () => {
  for (const id of IDS) {
    const G0 = typeById(id).geo, A0 = typeById(id).data;
    const def = designDef(withAf(id, { plugFwd: 4, plugAft: 3 }));
    assert.ok(Math.abs(def.geo.EYES.captain.x - (G0.EYES.captain.x + 4)) < 1e-9);
    assert.ok(Math.abs(def.geo.GEAR.nose.x - (G0.GEAR.nose.x + 4)) < 1e-9);
    assert.equal(def.geo.GEAR.left.x, G0.GEAR.left.x, 'the main gear stays under the wing');
    assert.ok(Math.abs(def.geo.TAIL_STRIKE_POINT.x - (G0.TAIL_STRIKE_POINT.x - 3)) < 1e-9);
    assert.ok(def.data.PITCH_TAILSTRIKE_DEG < A0.PITCH_TAILSTRIKE_DEG - 1, `${id} tail strike ${def.data.PITCH_TAILSTRIKE_DEG}`);
    const w = designDef(withAf(id, {}, { span: 1.2 }));
    const tip = w.geo.CRASH_POINTS.find((c) => c.why === 'wingtip strike' && c.y > 0), tip0 = G0.CRASH_POINTS.find((c) => c.why === 'wingtip strike' && c.y > 0);
    assert.ok(tip.y > tip0.y * 1.15);
    assert.ok(Math.abs(w.geo.DESIGN_SHAPE.spanM - (G0.FUSELAGE_WIDTH + (G0.SPAN - G0.FUSELAGE_WIDTH) * 1.2)) < 0.3, `span ${w.geo.DESIGN_SHAPE.spanM}`);
  }
});

test('the checks: the static margin, Cnβ, the stall speed, the tail strike, the span\'s code letter', () => {
  for (const id of IDS) {
    const n0 = designNumbers(designDef(newDesign(id))).airframe;
    assert.ok(Math.abs(n0.staticMarginMac - n0.staticMarginBaseMac) < 1e-12 && n0.staticMarginMac > 0.05);
    assert.equal(n0.codeLetter, typeById(id).icaoCode);
    const small = designNumbers(designDef(withAf(id, { tail: 0.6 }))).airframe;
    const big = designNumbers(designDef(withAf(id, { tail: 1.6 }))).airframe;
    assert.ok(small.staticMarginMac < n0.staticMarginMac - 0.05 && big.staticMarginMac > n0.staticMarginMac + 0.08);
    const fin = designNumbers(designDef(withAf(id, { fin: 0.6 }))).airframe;
    assert.ok(fin.cnBeta < 0.5 * n0.cnBeta);
    const wing = designNumbers(designDef(withAf(id, {}, { span: 1.3 }))).airframe;
    assert.ok(wing.stallKt < n0.stallKt * 0.92 && wing.approachKt < n0.approachKt);
    assert.ok(wing.spanM > n0.spanM * 1.2);
    // the CG behind the neutral point: ballast far aft on a small tail
    const aft = designNumbers(designDef({ ...withAf(id, { tail: 0.6 }), parts: [...newDesign(id).parts, { kind: 'ballast', x: -100, kg: 6000 }] })).airframe;
    assert.ok(aft.staticMarginMac < small.staticMarginMac);
  }
  assert.equal(codeLetter(35.8), 'C'); assert.equal(codeLetter(60.12), 'E'); assert.equal(codeLetter(64.8), 'E'); assert.equal(codeLetter(45), 'D'); assert.equal(codeLetter(79.9), 'F');
});

function cruising(design, { z = 3000, kt = 250, thrust = 0.75 } = {}) {
  const sim = createSim({ type: design });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z, iasMs: kt * KT, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 15000 });
  sim.controls.thrust = thrust;
  return sim;
}

test('a snapshot carries an airframe design whole and flies on to 1e-9; the prediction flies it', () => {
  const d = withAf('b787-9', { tail: 1.3, plugAft: 2 }, { span: 1.1, sweep: 3 });
  const a = cruising(d, { thrust: 0.6 });
  for (let i = 0; i < 1200; i++) a.step(DT);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  assert.deepEqual(snap.design.airframe, normalizeDesign(d).airframe);
  const b = createSim();
  b.restore(snap);
  for (let i = 0; i < 2400; i++) { a.controls.roll = b.controls.roll = i < 400 ? 0.4 : 0; a.step(DT); b.step(DT); }
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(a.state.pos[k] - b.state.pos[k]) < 1e-9, k);
  const s2 = a.snapshot();
  const { samples } = predictSync(s2, { maxMinutes: 1 });
  const last = samples[samples.length - 1];
  const same = createSim(); same.restore(JSON.parse(JSON.stringify(s2)));
  while (same.state.t < last.t - 1e-9) same.step(1 / 30);
  assert.ok(Math.hypot(same.state.pos.x - last.x, same.state.pos.y - last.y, same.state.pos.z - last.z) < 1e-6);
  // and it isn't the base airframe's path
  const plain = JSON.parse(JSON.stringify(s2)); plain.design = { ...plain.design, airframe: defaultAirframe('b787-9') };
  const p = predictSync(plain, { maxMinutes: 1 }).samples;
  assert.ok(Math.hypot(p[p.length - 1].x - last.x, p[p.length - 1].y - last.y, p[p.length - 1].z - last.z) > 1);
});

test('a v0.5.2 save (a design without the field) restores and flies as it did', () => {
  const d = newDesign('a321neo', { count: 4, engine: 'leap-1a' });
  const a = cruising(d);
  for (let i = 0; i < 600; i++) a.step(DT);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const old = JSON.parse(JSON.stringify(snap)); delete old.design.airframe;
  const b = createSim(), c = createSim();
  b.restore(snap); c.restore(old);
  for (let i = 0; i < 1200; i++) { b.step(DT); c.step(DT); }
  assert.equal(b.state.pos.x, c.state.pos.x); assert.equal(b.state.pos.z, c.state.pos.z);
});

// ---- the reviewer's findings (v0.5.3 run), fixed ----
import { partsModel, partsInto, clmaxDelta, wingClmax } from '../src/sim/parts-aero.js';
import { addPart } from '../src/sim/designs.js';

test('the take-off trim keeps ballast\'s CG move: a hair of airframe change doesn\'t switch the schedule', () => {
  for (const [id, x] of [['a321neo', -9], ['b787-9', -15]]) {
    const d0 = normalizeDesign(addPart(newDesign(id), { kind: 'ballast', kg: 6000, x }));
    const ths = (af) => { const s = createSim({ type: { ...d0, airframe: { ...defaultAirframe(id), ...af } } }); s.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 1 }); return s._core.thsTakeoff; };
    const a = ths({}), b = ths({ tail: 1.01 });
    assert.ok(Math.abs(a - b) < 0.2 * Math.PI / 180, `${id}: ${a * 57.3}° → ${b * 57.3}°`);
  }
});

test('the nose wheel\'s load with full thrust: the bases keep some, a design that sits on its tail under thrust goes below zero', () => {
  for (const id of IDS) assert.ok(designNumbers(designDef(newDesign(id))).airframe.noseLoadThrust > 0.01, id);
  const tips = designNumbers(designDef(withAf('b787-9', { plugAft: 6 }))).airframe;
  assert.ok(tips.noseLoadThrust < 0 && tips.noseLoad > 0.05, 'standing it looks fine, under thrust it isn\'t');
  assert.ok(designNumbers(designDef(withAf('b787-9', { plugFwd: 6, plugAft: 2 }))).airframe.noseLoadThrust > 0.02);
});

test('the landing score\'s pitch band follows a sooner tail strike', () => {
  const T = typeById('b787-9'), def = designDef(withAf('b787-9', { plugAft: 6 }));
  const sooner = T.data.PITCH_TAILSTRIKE_DEG - def.data.PITCH_TAILSTRIKE_DEG;
  assert.ok(sooner > 1 && Math.abs(def.score.high - (T.score.high - sooner)) < 1e-9 && def.score.best < def.score.high);
  assert.deepEqual(designDef(newDesign('b787-9')).score, T.score);
});

test('the sim\'s fast maximum-lift path is the parts\' model\'s own sum', () => {
  for (const id of IDS) {
    const af = { ...defaultAirframe(id), wingL: { span: 1.2, chord: 0.9, sweep: 5, dihedral: 4 }, wingR: { span: 1.1, chord: 1.1, sweep: -3, dihedral: 2 } };
    const P = partsModel(id, af), Pb = partsModel(id);
    for (const [slat, flap, M] of [[0, 0, 0.3], [22, 21, 0.2], [30, 30, 0.25], [0, 0, 0.85]]) {
      const o = {}, ob = {}, s = { alpha: 0.05, beta: 0, M, phat: 0, qhat: 0, rhat: 0, adothat: 0, slat, flap, gear: 0, doors: 0, sb: 0, gsp: 0, spL: 0, spR: 0, ail: 0, rud: 0, ths: 0, hWing: 100 };
      partsInto(P, s, o); partsInto(Pb, s, ob);
      assert.equal(wingClmax(P, slat, flap, M), o.clmax);
      assert.equal(clmaxDelta({ design: P, base: Pb }, slat, flap, M), o.clmax - ob.clmax);
    }
  }
});

test('Indestructible\'s skids are the changed airframe\'s crash points: low engines scrape instead of ending the flight', () => {
  for (const id of IDS) {
    const d = withAf(id, {}, { dihedral: -3 });   // the slider's bottom: the engines on the ground standing (red in the warehouse)
    const plain = createSim({ type: d, ground: () => ({ h: 0, kind: 'runway' }) });
    plain.reset({ x: 0, y: 0, hdg: 0, onGround: true });
    for (let i = 0; i < 120; i++) plain.step(DT);
    assert.equal(plain.state.crashed, 'engine strike', `${id}: without Indestructible it ends`);
    const sim = createSim({ type: d, ground: () => ({ h: 0, kind: 'runway' }) });
    sim.setIndestructible(true);
    sim.reset({ x: 0, y: 0, hdg: 0, onGround: true });
    for (let i = 0; i < 120 * 3; i++) sim.step(DT);
    assert.equal(sim.state.crashed, null, id);
    assert.ok(sim.state.scraping && sim.state.scrapeDepth < 0.6, `${id}: scraping ${sim.state.scraping}, ${sim.state.scrapeDepth} m`);
  }
});

test('a design whose engines touch the ground standing can be saved but not flown (the reviewer\'s finding 4)', async () => {
  const { readout } = await import('../src/ui/warehouse.js');
  for (const id of IDS) {
    assert.equal(designNumbers(designDef(newDesign(id))).touchesGround, false, `${id} base`);
    const low = withAf(id, {}, { dihedral: -3 });
    assert.equal(designNumbers(designDef(low)).touchesGround, true, `${id} at −3° dihedral`);
    const r = readout(low);
    assert.ok(r.canSave && !r.canFly, `${id}: Save yes, Fly it no`);
  }
  const ge90 = newDesign('a321neo', { engine: 'ge90-115b' });
  assert.equal(designNumbers(designDef(ge90)).touchesGround, true);
  assert.equal(designNumbers(designDef({ ...ge90, gearExtendM: 1.5 })).touchesGround, false);
  assert.ok(readout({ ...ge90, gearExtendM: 1.5 }).canFly);
});
