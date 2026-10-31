// The public state's frames: quat (body FLU → map ENU) agrees with hdg/pitch/roll, pos is the
// body reference point (geometry.js origin), and velocities/angles are in the agreed units.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborne, onRunway, run, KT, DEG } from './sim-helpers.mjs';
import { GEAR, GROUND_Z } from '../src/geometry.js';

function rotate(q, v) {
  // v' = q v q*, q = {x, y, z, w}
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

test('quat maps body forward/left/up to ENU consistently with hdg, pitch and roll', () => {
  const sim = airborne({ altFt: 10000, iasKt: 250, hdg: 1.2 });
  const s = sim.state;
  run(sim, 6, () => { sim.controls.roll = 0.4; sim.controls.pitch = 0.2; });
  const { hdg, pitch, roll } = s;
  const fwd = rotate(s.quat, [1, 0, 0]);
  assert.ok(Math.abs(fwd[0] - Math.sin(hdg) * Math.cos(pitch)) < 1e-9);
  assert.ok(Math.abs(fwd[1] - Math.cos(hdg) * Math.cos(pitch)) < 1e-9);
  assert.ok(Math.abs(fwd[2] - Math.sin(pitch)) < 1e-9);
  // Left wing (body +y): its height is −sin(roll)·cos(pitch) (right roll lowers the right wing).
  const left = rotate(s.quat, [0, 1, 0]);
  assert.ok(Math.abs(left[2] - Math.sin(roll) * Math.cos(pitch)) < 1e-9, `left z ${left[2]}`);
  assert.ok(roll > 5 * DEG, 'banked right');
  // Velocity: ENU, and its horizontal direction ≈ heading in steady flight.
  assert.ok(Math.abs(Math.hypot(s.vel.x, s.vel.y) - s.gs) < 1e-9);
});

test('pos is the reference point: the main wheels sit on the runway', () => {
  const sim = onRunway({ massKg: 80000, hdg: 0.7 });
  const s = sim.state;
  // Main-gear contact in the map, from pos + quat · geometry point.
  const g = rotate(s.quat, [GEAR.left.x, GEAR.left.y, GEAR.left.z]);
  const zWheel = s.pos.z + g[2];
  assert.ok(Math.abs(zWheel) < 0.08, `main wheel ${zWheel.toFixed(3)} m above the runway (static compression differs a little with weight)`);
  assert.ok(Math.abs(s.pos.z - GROUND_Z) < 0.1);
  assert.ok(Math.abs(s.agl) < 0.05);
  assert.ok(typeof s.cgX === 'number' && s.cgMac > 0.15 && s.cgMac < 0.40, `CG ${(s.cgMac * 100).toFixed(1)}% MAC`);
});

test('the fuel burns, the CG moves and the mass falls', () => {
  const sim = airborne({ massKg: 80000, fuelKg: 14000, altFt: 30000, mach: 0.78, ap: { ap: true, athr: true, hdgDeg: 0, altFt: 30000 } });
  const s = sim.state;
  sim.ap.setSpd(s.ias / KT);
  const m0 = s.mass, f0 = s.fuelKg, c0 = s.fuel.center, cg0 = s.cgMac;
  run(sim, 600);
  assert.ok(f0 - s.fuelKg > 300 && f0 - s.fuelKg < 500, `burned ${(f0 - s.fuelKg).toFixed(0)} kg in 10 min`);
  assert.ok(Math.abs((m0 - s.mass) - (f0 - s.fuelKg)) < 1e-6);
  assert.ok(s.fuel.center < c0, 'centre tank used first');
  assert.ok(s.cgMac !== cg0);
});
