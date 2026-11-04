// The 777-300ER's numbers, exactly as its documents give them, and the shape of its modules. Where a number is an estimate
// there's no test of the value, only of what it must add up to (tests/b777-300er-performance.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A321 from '../src/sim/a321neo.js';
import * as A321G from '../src/geometry.js';
import * as A from '../src/sim/b777-300er.js';
import * as G from '../src/geometry-b777-300er.js';
import { TYPES, TYPE_LIST } from '../src/sim/types.js';
import { GE90_115B } from '../src/audio/engine-sounds.js';

test('it exports every name the A321neo\'s data and geometry modules export', () => {
  for (const k of Object.keys(A321)) assert.ok(k in A, `b777-300er.js: ${k}`);
  for (const k of Object.keys(A321G)) assert.ok(k in G, `geometry-b777-300er.js: ${k}`);
});

test('TCDS EASA.IM.A.003 Issue 20, -300ER, and ACAP 2-2: limits and weights', () => {
  assert.equal(A.MAX_ALT_FT, 43100);                         // TCDS p.26
  assert.equal(A.MTOW, 351534); assert.equal(A.MTW, 352441); // TCDS p.26 §13a, ACAP 2-2
  assert.equal(A.FUEL_WING_EACH, 31300);
  assert.equal(A.MLW, 251290);                               // TCDS p.26, ACAP 2-2
  assert.equal(A.MZFW, 237682);                              // ACAP 2-2 (the TCDS lists 239,950 kg)
  assert.equal(A.MAC, 7.08); assert.equal(A.S, 427.8);       // TCDS pp.25–26
  assert.equal(A.FUEL_MAX, 145570);                          // ACAP 2-2
  assert.ok(A.FUEL_WING_EACH * 2 + A.FUEL_CENTER === A.FUEL_MAX);
  assert.ok(A.TYRE_LIMIT_KT > 200 && A.TYRE_LIMIT_KT < 206); // 235 mph, TCDS p.27
  assert.equal(A.VAPP_MLW_KT, 150);                          // Boeing's approach speed table
});

test('the engine: GE90-115B ratings and shaft speeds (IM.E.002), EDB fuel flows, and the same numbers as the sound', () => {
  assert.equal(A.T0_ENGINE, 513950);
  assert.ok(Math.abs(A.RATING.MCT - 489.30 / 513.95) < 0.001);
  assert.equal(A.N1_100_RPM, 2355); assert.equal(A.N2_100_RPM, 9332);
  assert.equal(A.N1_MAX_PCT, 110.5); assert.equal(A.N2_MAX_PCT, 121);
  assert.equal(A.FAN_BLADES, 22);
  assert.equal(GE90_115B.fanBlades, A.FAN_BLADES);
  assert.ok(Math.abs(GE90_115B.n1Hz - A.N1_100_RPM / 6000) < 1e-9 && Math.abs(GE90_115B.n2Hz - A.N2_100_RPM / 6000) < 1e-9);
  // ICAO LTO points at sea level static: 4.600 / 3.566 / 1.073 kg/s at 100 / 85 / 30 %. The model is one TSFC, so within 15%.
  for (const [pct, ff] of [[1, 4.6], [0.85, 3.566], [0.30, 1.073]]) {
    const model = A.TSFC_C0 * A.T0_ENGINE * pct;
    assert.ok(Math.abs(model - ff) / ff < 0.15, `ff at ${pct * 100}%: ${model.toFixed(3)} vs ${ff}`);
  }
  assert.equal(A.FF_IDLE, 0.341);
});

test('ACAP 2-4, 2-7, 4-4, 4-6, 7-5: dimensions', () => {
  assert.equal(G.LENGTH, 73.86); assert.equal(G.FUSELAGE_LENGTH, 73.08); assert.equal(G.SPAN, 64.80);
  assert.equal(A.SPAN, G.SPAN);
  assert.ok(G.HEIGHT > 18.24 && G.HEIGHT < 18.85);
  assert.equal(G.FUSELAGE_WIDTH, 6.20); assert.equal(G.FUSELAGE_HEIGHT, 6.20);
  assert.equal(G.WHEELBASE, 31.22); assert.equal(G.TRACK, 10.97);
  assert.ok(Math.abs(G.GEAR.nose.x - G.GEAR.left.x - 31.22) < 1e-9);
  assert.equal(G.GEAR.left.y, 5.485); assert.equal(G.GEAR.right.y, -5.485);
  assert.ok(Math.abs(G.NOSE_X - G.GEAR.nose.x - 5.89) < 1e-9);
  assert.ok(Math.abs(G.NOSE_X - (G.NACELLES[0].x + G.NACELLE_LENGTH / 2) - 25.76) < 1e-9);
  assert.equal(G.NACELLES[0].y, 9.61); assert.equal(G.NACELLE_DIAMETER, 3.96);
  assert.ok(Math.abs(G.NOSE_X - G.WING.rootX - 26.89) < 1e-9);
  assert.ok(Math.abs(G.NOSE_X - G.WING.tipLeX - 48.50) < 1e-9 && Math.abs(G.NOSE_X - G.WING.tipTeX - 49.11) < 1e-9);
  assert.equal(A.STEER_TILLER, 70 * A.DEG);
  assert.equal(G.TURNING.steerMaxDeg, 70); assert.equal(G.TURNING.wingtip, 45.2); assert.equal(G.TURNING.tail, 42.8);
  assert.ok(Math.abs(A.WHEEL_R_MAIN - 0.6604) < 1e-3 && Math.abs(A.WHEEL_R_NOSE - 0.5461) < 1e-3);
  assert.equal(G.TAILPLANE.span, 21.53);
  assert.equal(G.BOGIE.axles, 3); assert.equal(G.BOGIE.axleSpacing, 1.45); assert.equal(G.BOGIE.tread, 1.40);
  // The pilot's eye: 2.26 m aft of the nose (3.63 m ahead of the nose gear), 0.53 m off the centreline. Its height: see geometry-b777-300er.js.
  assert.ok(Math.abs(G.NOSE_X - G.EYES.captain.x - 2.26) < 1e-9);
  assert.equal(G.EYES.captain.y, 0.53); assert.equal(G.EYES.fo.y, -0.53);
  // Between the side windows' foot and top as [ACAP] 2-4 draws them, which the stated 5.51 m (z +0.06) isn't.
  assert.ok(G.EYES.captain.z > 0.37 && G.EYES.captain.z < 0.99, `eye z ${G.EYES.captain.z.toFixed(2)}`);
});

test('the flap lever: the 777\'s seven detents, and every one has a configuration, a VFE, a next and a manoeuvre speed', () => {
  assert.deepEqual(A.FLAP_LEVER, ['UP', '1', '5', '15', '20', '25', '30']);
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
  // Keys 6 to 0 go to UP, 5, 15, 20, 30.
  assert.deepEqual(A.FLAP_KEYS.map((i) => A.FLAP_LEVER[i]), ['UP', '5', '15', '20', '30']);
  assert.equal(A.FLAP_LEVER[A.TAKEOFF_FLAP_LEVER], '20');
  assert.equal(A.FAMILY, 'boeing'); assert.equal(A.LEVER_LAW, 'boeing'); assert.ok(A.VMM_FACTOR > 1);
});

test('the registry entry: in the picker, code E, and a registration of its own', () => {
  const t = TYPES['b777-300er'];
  assert.ok(TYPE_LIST().includes(t));
  assert.equal(t.icaoCode, 'E'); assert.equal(t.sound, GE90_115B);
  assert.equal(t.data, A); assert.equal(t.geo, G);
  for (const o of Object.values(TYPES)) if (o !== t) assert.notEqual(o.registration, t.registration);
  assert.ok(t.score.high < A.PITCH_TAILSTRIKE_DEG);
  assert.equal(t.limits.MTOW, A.MTOW); assert.equal(t.picker.spanM, G.SPAN);
});

test('the tail\'s geometry: the strike point within 0.25 m of the side view\'s skin', () => {
  // [ACAP] 2-7's underside at 57 m from the nose is 0.30 m above the belly line: z ≈ −2.80. The point is above it, for the semi-levered gear (geometry-b777-300er.js).
  assert.ok(Math.abs(G.TAIL_STRIKE_POINT.z - (-2.80)) < 0.25);
  assert.ok(Math.abs(G.NOSE_X - G.TAIL_STRIKE_POINT.x - 57) < 0.1);
});
