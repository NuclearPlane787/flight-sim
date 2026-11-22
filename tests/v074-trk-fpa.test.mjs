// v0.7.4, Shane's item 9: the A321's HDG-V/S / TRK-FPA button. In TRK-FPA the HDG window is a track over the ground
// (with decimals) and the V/S window a flight path angle, −9.9° to +9.9°; the AP flies them. TRK holds a track within
// 0.2° in a 20 kt crosswind; HDG drifts with the wind as it should. The FCU's FPA window and the FMA's names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { calmWeather } from '../src/sim/weather.js';
import { gridToMag } from '../src/world/frame.js';
import { typedFpa, fpaText, fcuLights } from '../src/ui/fcu.js';

const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180;
const wrap360 = (d) => ((d % 360) + 360) % 360;
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;

function windy(kt = 20, fromDeg = 270) {
  const sim = createSim({ type: 'a321neo' });
  if (kt) sim.setWeather({ ...calmWeather(), preset: 'x', seed: 1, turbulence: 'none', wind: { fromDeg, kt, gustKt: 0 }, aloft: { fromDeg, kt } });
  sim.reset({ x: 0, y: 0, z: 5000 * FT, hdg: 0, onGround: false, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 8000, payloadKg: 15000,
    ap: { ap: true, athr: true, spdKt: 250, hdgDeg: 0, altFt: 5000 } });
  return sim;
}
const run = (sim, s) => { for (let i = 0, n = Math.round(s / (1 / 120)); i < n; i++) sim.step(1 / 120); };
const trackMag = (s) => wrap360(gridToMag(Math.atan2(s.vel.x, s.vel.y), s.pos.x, s.pos.y) / DEG);
const hdgMag = (s) => wrap360(gridToMag(s.hdg, s.pos.x, s.pos.y) / DEG);

test('TRK holds a typed track within 0.2° in a 20 kt crosswind (and HDG drifts)', () => {
  const sim = windy(20, 270);
  sim.ap.toggleTrkFpa();
  assert.equal(sim.ap.trkFpa, true);
  sim.ap.setHdg(5.25);
  run(sim, 90);
  let worst = 0;
  for (let i = 0; i < 60; i++) { run(sim, 1); worst = Math.max(worst, Math.abs(angDiff(trackMag(sim.state), 5.25))); }
  assert.ok(worst < 0.2, `the track within ${worst.toFixed(3)}° of 005.25`);
  // It crabs into the wind from the left: the heading is left of the track.
  assert.ok(angDiff(hdgMag(sim.state), 5.25) < -2, `heading ${hdgMag(sim.state).toFixed(2)}`);
  // The same in HDG: the heading is held and the track drifts right.
  sim.ap.toggleTrkFpa();
  sim.ap.setHdg(5.25);
  run(sim, 90);
  assert.ok(Math.abs(angDiff(hdgMag(sim.state), 5.25)) < 0.2);
  assert.ok(angDiff(trackMag(sim.state), 5.25) > 2, `HDG drifts: track ${trackMag(sim.state).toFixed(2)}`);
});

test('FPA flies the angle over the ground, −3.0° and +2.5°, and ALT captures from it', () => {
  const sim = windy(0);
  sim.ap.toggleTrkFpa();
  sim.ap.setAlt(2000);
  sim.ap.setFpa(-3);
  assert.equal(sim.ap.vertical, 'V/S');
  assert.equal(sim.ap.fpaDeg, -3);
  run(sim, 30);
  const s = sim.state, fpa = () => Math.atan2(s.vs, s.gs) / DEG;
  assert.ok(Math.abs(fpa() + 3) < 0.15, `FPA ${fpa().toFixed(2)}°`);
  run(sim, 400);
  assert.ok(/ALT/.test(sim.ap.vertical), sim.ap.vertical);
  assert.ok(Math.abs(s.pos.z / FT - 2000) < 60, `${(s.pos.z / FT).toFixed(0)} ft`);
  sim.ap.setAlt(4000); sim.ap.setFpa(2.5);
  run(sim, 30);
  assert.ok(Math.abs(fpa() - 2.5) < 0.15, `FPA ${fpa().toFixed(2)}°`);
  // The limits: ±9.9° in tenths.
  sim.ap.setFpa(-12.34); assert.equal(sim.ap.fpaDeg, -9.9);
  sim.ap.setFpa(1.26); assert.equal(sim.ap.fpaDeg, 1.3);
});

test('the button converts V/S and FPA so the path does not jump; a snapshot keeps TRK-FPA', () => {
  const sim = windy(0);
  sim.ap.setVs(-1000);
  run(sim, 20);
  const gsKt = sim.state.gs / KT;
  sim.ap.toggleTrkFpa();
  const want = Math.atan((-1000 * FT / 60) / sim.state.gs) / DEG;
  assert.ok(Math.abs(sim.ap.fpaDeg - want) < 0.051, `${sim.ap.fpaDeg} for ${want.toFixed(2)} at ${gsKt.toFixed(0)} kt`);
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  const b = createSim({ type: 'a321neo' }); b.restore(snap);
  assert.equal(b.ap.trkFpa, true); assert.equal(b.ap.fpaDeg, sim.ap.fpaDeg);
  sim.ap.toggleTrkFpa();
  assert.equal(sim.ap.trkFpa, false);
  assert.ok(Math.abs(sim.ap.vsFpm + 1000) <= 100, `back to ${sim.ap.vsFpm}`);
});

test('the FCU: the FPA window typed and shown; the LOC and APPR lights', () => {
  assert.equal(typedFpa('-3'), -3);
  assert.equal(typedFpa('-3.5'), -3.5);
  assert.equal(typedFpa('-35'), -3.5);
  assert.equal(typedFpa('12'), 1.2);
  assert.equal(typedFpa('9.9'), 9.9);
  assert.equal(typedFpa('-'), null);
  assert.equal(fpaText(-3), '−3.0');
  assert.equal(fpaText(0), '+0.0');
  assert.equal(fpaText(2.46), '+2.5');
  assert.deepEqual(fcuLights({ lateral: 'HDG', vertical: 'ALT', armedLateral: 'LOC', armedVertical: '' }), { appr: 0, loc: 2 });
  assert.deepEqual(fcuLights({ lateral: 'HDG', vertical: 'ALT', armedLateral: 'LOC', armedVertical: 'G/S' }), { appr: 2, loc: 0 });
  assert.deepEqual(fcuLights({ lateral: 'LOC', vertical: 'G/S', armedLateral: '', armedVertical: '' }), { appr: 2, loc: 0 });
  assert.deepEqual(fcuLights({ lateral: 'HDG', vertical: 'V/S' }), { appr: 0, loc: 0 });
});
