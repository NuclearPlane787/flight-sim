// The ISA against the ICAO standard atmosphere table, and the airspeed conversions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isa, iasFromTas, tasFromIas, mach, machFromIas, iasFromMach } from '../src/sim/atmosphere.js';

const KT = 0.514444;
// ICAO Doc 7488 table (geopotential altitude) values: h (m), T (K), p (Pa), rho (kg/m³), a (m/s).
const TABLE = [
  [0, 288.15, 101325, 1.2250, 340.29],
  [1000, 281.65, 89875, 1.1116, 336.43],
  [3000, 268.65, 70108, 0.90912, 328.58],
  [5000, 255.65, 54020, 0.73612, 320.53],
  [8000, 236.15, 35600, 0.52517, 308.06],
  [11000, 216.65, 22632, 0.36392, 295.07],
  [15000, 216.65, 12045, 0.19367, 295.07],
  [20000, 216.65, 5474.9, 0.088035, 295.07],
];

test('ISA matches the standard table', () => {
  for (const [h, T, p, rho, a] of TABLE) {
    const s = isa(h);
    assert.ok(Math.abs(s.T - T) < 0.01, `T at ${h} m: ${s.T}`);
    assert.ok(Math.abs(s.p - p) / p < 5e-4, `p at ${h} m: ${s.p}`);
    assert.ok(Math.abs(s.rho - rho) / rho < 5e-4, `rho at ${h} m: ${s.rho}`);
    assert.ok(Math.abs(s.a - a) < 0.05, `a at ${h} m: ${s.a}`);
  }
});

test('IAS, TAS and Mach are kept apart', () => {
  // At sea level, CAS = TAS.
  assert.ok(Math.abs(iasFromTas(100, 0) - 100) < 1e-6);
  // FL350, M0.78: CAS ≈ 265 kt, TAS ≈ 450 kt (standard E6B values).
  const h = 35000 * 0.3048;
  const ias = iasFromMach(0.78, h);
  assert.ok(Math.abs(ias / KT - 264.6) < 1.5, `CAS ${ias / KT}`);
  const tas = tasFromIas(ias, h);
  assert.ok(Math.abs(tas / KT - 450) < 3, `TAS ${tas / KT}`);
  assert.ok(Math.abs(mach(tas, h) - 0.78) < 1e-9);
  assert.ok(Math.abs(machFromIas(ias, h) - 0.78) < 1e-9);
  // FL100, 250 kt CAS ≈ 290 kt TAS.
  const tas10 = tasFromIas(250 * KT, 3048);
  assert.ok(Math.abs(tas10 / KT - 289) < 3, `TAS ${tas10 / KT}`);
  // Round trip.
  for (const h2 of [0, 2000, 7000, 12000]) {
    const t = tasFromIas(120, h2);
    assert.ok(Math.abs(iasFromTas(t, h2) - 120) < 1e-9);
  }
});
