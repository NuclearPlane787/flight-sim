// The 787-9's numbers, exactly as its documents give them, and the shape of its modules. Where a number is an estimate
// there's no test of the value, only of what it must add up to (tests/b787-9-performance.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A321 from '../src/sim/a321neo.js';
import * as A321G from '../src/geometry.js';
import * as A from '../src/sim/b787-9.js';
import * as G from '../src/geometry-b787-9.js';
import { TYPES } from '../src/sim/types.js';

test('it exports every name the A321neo\'s data and geometry modules export', () => {
  for (const k of Object.keys(A321)) assert.ok(k in A, `b787-9.js: ${k}`);
  for (const k of Object.keys(A321G)) assert.ok(k in G, `geometry-b787-9.js: ${k}`);
});

test('TCDS EASA.IM.A.115 Issue 30, 787-9: limits and weights', () => {
  assert.equal(A.VMO_KT, 350); assert.equal(A.MMO, 0.90);    // p.36
  assert.equal(A.MAX_ALT_FT, 43100);                         // p.36
  assert.equal(A.MTOW, 254692); assert.equal(A.MTW, 255372); // p.37
  assert.equal(A.MLW, 192776); assert.equal(A.MZFW, 181436); assert.equal(A.MIN_WEIGHT, 110677);
  assert.equal(A.MAC, 6.27126);                              // p.37
  // Fuel, p.35: each tank, and the total the table adds to (rounded: 101,085).
  assert.equal(A.FUEL_WING_EACH, 16716); assert.equal(A.FUEL_CENTER, 67653);
  assert.equal(A.FUEL_MAX, 101085);
  assert.equal(A.FUEL_DENSITY, 0.8);
});

test('the engine: GEnx-1B74/75/P2 ratings and shaft speeds (TCDS p.34, IM.E.102 pp.9, 15), EDB fuel flows', () => {
  assert.equal(A.T0_ENGINE, 341200);
  assert.ok(Math.abs(A.RATING.MCT - 305.1 / 341.2) < 0.001);
  assert.equal(A.N1_100_RPM, 2560); assert.equal(A.N2_100_RPM, 11377);
  assert.equal(A.FAN_BLADES, 18);
  // ICAO LTO points at sea level static: 2.722 / 2.218 / 0.689 kg/s at 100 / 85 / 30 %. The model is one TSFC, so within 15%.
  for (const [pct, ff] of [[1, 2.722], [0.85, 2.218], [0.30, 0.689]]) {
    const model = A.TSFC_C0 * A.T0_ENGINE * pct;
    assert.ok(Math.abs(model - ff) / ff < 0.15, `ff at ${pct * 100}%: ${model.toFixed(3)} vs ${ff}`);
  }
  assert.equal(A.FF_IDLE, 0.225);
});

test('ACAP 2-3, 2-6, 2-9, 4-3, 4-6, 7-4: dimensions', () => {
  assert.equal(G.LENGTH, 62.81); assert.equal(G.FUSELAGE_LENGTH, 62.00); assert.equal(G.SPAN, 60.12);
  assert.equal(A.SPAN, G.SPAN);
  assert.equal(G.HEIGHT, 17.02);
  assert.equal(G.FUSELAGE_WIDTH, 5.77); assert.equal(G.FUSELAGE_HEIGHT, 5.94);
  assert.equal(G.WHEELBASE, 25.83); assert.equal(G.TRACK, 9.80);
  assert.ok(Math.abs(G.GEAR.nose.x - G.GEAR.left.x - 25.83) < 1e-9);
  assert.equal(G.GEAR.left.y, 4.9); assert.equal(G.GEAR.right.y, -4.9);
  // The nose leg is 5.41 m from the nose.
  assert.ok(Math.abs(G.NOSE_X - G.GEAR.nose.x - 5.41) < 1e-9);
  // The nacelle's lip is 20.80 m from the nose, and the nacelle 9.91 m off the centreline.
  assert.ok(Math.abs(G.NOSE_X - (G.NACELLES[0].x + G.NACELLE_LENGTH / 2) - 20.80) < 1e-9);
  assert.equal(G.NACELLES[0].y, 9.91);
  assert.equal(A.STEER_TILLER, 70 * A.DEG);
  assert.equal(G.TURNING.steerMaxDeg, 70);
  assert.ok(Math.abs(A.WHEEL_R_MAIN - 0.6858) < 1e-3 && Math.abs(A.WHEEL_R_NOSE - 0.508) < 1e-3);
  assert.equal(G.TAILPLANE.span, 19.81);
  // The pilot's eye: 2.64 m aft of the nose, 0.53 m off the centreline.
  assert.ok(Math.abs(G.NOSE_X - G.EYES.captain.x - 2.64) < 1e-9);
  assert.equal(G.EYES.captain.y, 0.53); assert.equal(G.EYES.fo.y, -0.53);
});

test('the flap lever: the 787\'s ten detents, and every one has a configuration, a VFE, a next and a manoeuvre speed', () => {
  assert.deepEqual(A.FLAP_LEVER, ['UP', '1', '5', '10', '15', '17', '18', '20', '25', '30']);
  let prevVfe = Infinity, prevFlap = -1;
  for (const k of A.FLAP_LEVER) {
    const c = A.CONFIGS[k];
    assert.ok(c, k);
    assert.ok(A.VFE_KT[k] > 0 && A.VFE_KT[k] <= prevVfe, `VFE ${k}`);
    prevVfe = A.VFE_KT[k];
    assert.ok(c.flap >= prevFlap); prevFlap = c.flap;
    assert.ok(k in A.NEXT_CONFIG && k in A.VREF_ADD_KT);
    assert.equal(A.configOfSurfaces(c.slat, c.flap), k, `surfaces of ${k}`);
  }
  assert.equal(A.VFE_KT.UP, A.VMO_KT);
  for (const i of A.FLAP_KEYS) assert.ok(i >= 0 && i < A.FLAP_LEVER.length);
  assert.ok(A.TAKEOFF_FLAP_LEVER >= 0 && A.TAKEOFF_FLAP_LEVER < A.FLAP_LEVER.length);
  assert.ok(A.TYRE_LIMIT_KT > 200 && A.TYRE_LIMIT_KT < 206); // 235 mph
  assert.equal(A.VAPP_MLW_KT, 153);                          // Boeing's approach speed table
});

test('the registry entry reads the module: limits and picker numbers match the documents', () => {
  const t = TYPES['b787-9'];
  assert.equal(t.limits.MTOW, A.MTOW); assert.equal(t.limits.MLW, A.MLW); assert.equal(t.limits.MZFW, A.MZFW);
  assert.equal(t.limits.OEW, A.OEW); assert.equal(t.limits.FUEL_MAX, A.FUEL_MAX);
  assert.equal(t.limits.PAX_MAX, 420);             // TCDS p.38, the exit limit
  assert.equal(t.picker.lengthM, G.LENGTH); assert.equal(t.picker.spanM, G.SPAN);
  assert.equal(t.picker.mtowT, Math.round(A.MTOW / 1000));
  assert.equal(t.icaoCode, 'E');
  assert.equal(t.data, A); assert.equal(t.geo, G);
  // The best touchdown pitch keeps its bowl clear of the tail.
  assert.ok(t.score.high < A.PITCH_TAILSTRIKE_DEG);
  // The maximum payload a loadsheet can carry is what the setup's numbers leave.
  assert.ok(A.OEW + t.defaults.pax * t.limits.PAX_KG + t.defaults.cargoKg <= A.MZFW);
});

test('the tail-strike pitch comes from the geometry, with the mains unloaded and at the strut\'s stroke', () => {
  const dx = G.GEAR.left.x - G.TAIL_STRIKE_POINT.x;
  const dz = G.TAIL_STRIKE_POINT.z - (G.GEAR.left.z - A.GEAR_DATA.main.staticComp);
  const deg = Math.atan2(dz, dx) / A.DEG;
  assert.ok(Math.abs(deg - A.PITCH_TAILSTRIKE_DEG) < 0.1, `${deg.toFixed(2)}°`);
});
