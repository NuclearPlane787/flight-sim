// What the Boeing screens decide (src/ui/boeing/logic.js): the FMA's windows and boxes, the MCP's
// lights, the IAS/MACH window, the flap indicator and the estimates.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/ui/boeing/logic.js';
import * as A from '../src/sim/b787-9.js';

const FT = 0.3048;
const air = (over = {}) => ({ onGround: false, agl: 5000 * FT, pos: { z: 5000 * FT }, vs: 0, ...over });

test('FMA: the windows, armed modes and the status', () => {
  const m = L.fmaModes({ ap: true, athr: true, thrustMode: 'SPD', lateral: 'LNAV', vertical: 'VNAV PTH', armedLateral: 'LOC', armedVertical: 'G/S' }, air());
  assert.deepEqual([m.thr, m.roll, m.pitch, m.armRoll, m.armPitch, m.status], ['SPD', 'LNAV', 'VNAV PTH', 'LOC', 'G/S', 'A/P']);
  const off = L.fmaModes({ ap: false, athr: false, thrustMode: 'SPD', lateral: 'HDG SEL', vertical: 'ALT' }, air());
  assert.equal(off.thr, '', 'the A/T off blanks its window');
  assert.equal(off.status, 'FLT DIR');
  assert.equal(off.roll, 'HDG SEL');
});

test('FMA: blank on the ground until TO/GA', () => {
  const g = air({ onGround: true, agl: 0 });
  assert.equal(L.fmaModes({ lateral: 'HDG SEL', vertical: 'ALT' }, g).pitch, '');
  const t = L.fmaModes({ athr: true, thrustMode: 'THR REF', lateral: 'TO/GA', vertical: 'TO/GA', armedLateral: 'LNAV' }, g);
  assert.deepEqual([t.thr, t.roll, t.pitch, t.armRoll], ['THR REF', 'TO/GA', 'TO/GA', 'LNAV']);
});

test('FMA: LAND 3 on both beams under 1,500 ft', () => {
  const ap = { ap: true, lateral: 'LOC', vertical: 'G/S' };
  assert.equal(L.fmaModes(ap, air({ agl: 2000 * FT })).status, 'A/P');
  const m = L.fmaModes(ap, air({ agl: 1200 * FT }));
  assert.deepEqual([m.status, m.armRoll, m.armPitch], ['LAND 3', 'ROLLOUT', 'FLARE']);
  assert.equal(L.fmaModes({ ap: true, lateral: 'ROLLOUT', vertical: 'FLARE' }, air({ onGround: true, agl: 0 })).status, 'LAND 3');
  assert.equal(L.fmaModes({ ap: false, lateral: 'LOC', vertical: 'G/S' }, air({ agl: 1200 * FT })).status, 'FLT DIR');
});

test('FMA: a box for 10 s after a change, none for the first value or a blank', () => {
  const b = L.createBoxes();
  b.track('r', 'LNAV', 0);
  assert.equal(b.boxed('r', 1), false, 'the first value is no change');
  b.track('r', 'LOC', 1000);
  assert.equal(b.boxed('r', 1000), true);
  assert.equal(b.boxed('r', 10999), true);
  assert.equal(b.boxed('r', 11000), false);
  b.track('r', '', 12000);
  assert.equal(b.boxed('r', 12000), false);
});

test('MCP: lit when active, armed when armed', () => {
  const l = L.mcpLights({ ap: true, athr: true, thrustMode: 'THR', lateral: 'HDG SEL', vertical: 'FLCH SPD', armedLateral: 'LNAV', armedVertical: 'VNAV' });
  assert.deepEqual([l.ap, l.at, l.hdgsel, l.flch, l.lnav, l.vnav, l.althold], [2, 2, 2, 2, 1, 1, 0]);
  assert.equal(L.mcpLights({ athr: true, thrustMode: '' }).at, 1, 'the A/T with no mode is armed');
  const a = L.mcpLights({ ap: true, lateral: 'LNAV', vertical: 'VNAV ALT', armedLateral: 'LOC', armedVertical: 'G/S' });
  assert.deepEqual([a.lnav, a.vnav, a.app, a.loc], [2, 2, 1, 0], 'APP armed lights APP, not LOC');
  const c = L.mcpLights({ ap: true, lateral: 'LOC', vertical: 'G/S' });
  assert.deepEqual([c.loc, c.app], [0, 2]);
  const lo = L.mcpLights({ ap: true, lateral: 'LOC', vertical: 'ALT' });
  assert.deepEqual([lo.loc, lo.app, lo.althold], [2, 0, 2]);
  assert.equal(L.mcpLights({ ap: false, lateral: 'HDG SEL', vertical: 'ALT' }).hdgsel, 0, 'with the A/P off nothing is active');
});

test('IAS/MACH: Mach above FL260, and the two ways round', () => {
  assert.equal(L.usesMach({ pos: { z: 25000 * FT } }), false);
  assert.equal(L.usesMach({ pos: { z: 27000 * FT } }), true);
  const z = 35000 * FT, kt = L.ktOfMach(0.85, z);
  assert.ok(kt > 280 && kt < 295, `M.85 at FL350 is about 288 kt: ${kt}`);
  assert.ok(Math.abs(L.machOfKt(kt, z) - 0.85) < 1e-6);
  assert.equal(L.speedText(kt, { pos: { z } }), '.85');
  assert.equal(L.speedText(146, { pos: { z: 1000 * FT } }), '146');
});

test('IAS/MACH: what a typed speed means', () => {
  const z = 35000 * FT, m84 = L.ktOfMach(0.84, z);
  for (const t of ['84', '.84', '0.84']) assert.ok(Math.abs(L.typedSpeedKt(t, z) - m84) < 1e-9, t);
  assert.equal(L.typedSpeedKt('280', z), 280);
  assert.equal(L.typedSpeedKt('', z), null);
  assert.equal(L.typedSpeedKt('.', z), null);
});

test('the altitude alert: 900 to 200 ft away', () => {
  assert.equal(L.altAlert(34000, 35000), false);
  assert.equal(L.altAlert(34200, 35000), true);
  assert.equal(L.altAlert(34850, 35000), false);
});

test('AIRSPEED LOW: 5 kt under the minimum manoeuvring speed, in the air', () => {
  const K = 0.514444, st = { onGround: false, vmm: 150 * K };
  assert.equal(L.speedLow({ ...st, ias: 146 * K }), false);
  assert.equal(L.speedLow({ ...st, ias: 144 * K }), true);
  assert.equal(L.speedLow({ ...st, ias: 144 * K, onGround: true }), false);
  assert.equal(L.speedLow({ onGround: false, ias: 50, vmm: 0 }), false);
});

test('the flap indicator follows the type\'s detents', () => {
  const n = A.FLAP_LEVER.length - 1;
  const at = (cfg) => ({ slatDeg: A.CONFIGS[cfg].slat, flapDeg: A.CONFIGS[cfg].flap });
  A.FLAP_LEVER.forEach((cfg, i) => assert.ok(Math.abs(L.flapFraction(A, at(cfg)) - i / n) < 1e-9, cfg));
  // Halfway between two detents is halfway between their marks.
  const i = A.FLAP_LEVER.indexOf('5'), j = A.FLAP_LEVER.indexOf('10');
  const mid = { slatDeg: A.CONFIGS['5'].slat, flapDeg: (A.CONFIGS['5'].flap + A.CONFIGS['10'].flap) / 2 };
  assert.ok(Math.abs(L.flapFraction(A, mid) - (i + j) / 2 / n) < 1e-9);
  const moving = L.flapLabel(A, { flapLever: j, ...at('5') });
  assert.deepEqual(moving, { text: '10', moving: true });
  assert.deepEqual(L.flapLabel(A, { flapLever: j, ...at('10') }), { text: '10', moving: false });
});

test('the thrust reference\'s rating follows the phase', () => {
  assert.equal(L.thrustRefMode(air({ onGround: true }), {}), 'TO');
  assert.equal(L.thrustRefMode(air({ vs: 10 }), {}), 'CLB');
  assert.equal(L.thrustRefMode(air({ vs: 0 }), { thrustMode: 'SPD' }), 'CRZ');
  assert.equal(L.thrustRefMode(air({ agl: 5000 * FT }), { lateral: 'TO/GA' }), 'G/A');
  assert.equal(L.refPhi('TO', A), A.RATING.TOGA);
  assert.equal(L.refPhi('CLB', A), A.RATING.CL);
});

test('the estimates: EGT and N2 rise with N1 and stay under their limits', () => {
  assert.ok(L.egtEstimate(A.N1_IDLE) < 500);
  assert.ok(L.egtEstimate(A.N1_TOGA) > 800 && L.egtEstimate(A.N1_TOGA) < L.EGT_RED);
  assert.equal(L.egtEstimate(0, 12), 12, 'a stopped engine reads the ambient');
  assert.ok(L.n2Estimate(21) > 60 && L.n2Estimate(97) > L.n2Estimate(21) && L.n2Estimate(97) < 105);
});
