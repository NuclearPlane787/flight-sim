// v0.4.0, Part 4: rain and snow around the camera, drops on the windshield.
//   node --test tests/weather-precip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createPrecip, ceilingM, fallAt, relativeAir, fillParticles, fillDrops, fallSpeed, BOX_M, RAIN_MAX, DROPS_MAX } from '../src/world/precip.js';
import { calmWeather, normalizeWeather } from '../src/sim/weather.js';

const rain = (rate = 0.8, extra = {}) => normalizeWeather({ precip: { kind: 'rain', rate }, ...extra });
const make = () => { const scene = new THREE.Scene(); return { scene, p: createPrecip(scene, {}) }; };
const camera = (y = 100, near = 0.25) => { const c = new THREE.PerspectiveCamera(60, 1.6, near, 1000); c.position.set(0, y, 0); c.updateMatrixWorld(); return c; };
const state = { pos: { x: 0, y: 0, z: 100 }, vel: { x: 70, y: 0, z: 0 }, wind: { x: 0, y: 0, z: 0 }, tas: 70, hdg: 0, pitch: 0, roll: 0 };

test('clear weather: both objects hidden, no draw calls, instanced', () => {
  const { p, scene } = make();
  p.setWeather(calmWeather());
  p.update({ camera: camera(), state, dt: 1 / 60 });
  assert.equal(p.stats.drawCalls, 0);
  assert.equal(p.objects.particles.visible, false);
  assert.equal(p.objects.drops.visible, false);
  assert.equal(scene.children.length, 3);   // v0.4.2: and the wiper
  assert.equal(p.objects.wiper.visible, false);
  assert.ok(p.objects.particles.geometry.isInstancedBufferGeometry);
  p.setWeather(null);
  assert.equal(p.stats.drawCalls, 0);
});

test('rain: one draw outside, two in a seat; none again when it stops', () => {
  const { p } = make();
  p.setWeather(rain());
  p.update({ camera: camera(), state, dt: 1 / 60 });
  assert.equal(p.stats.drawCalls, 1);
  assert.ok(p.stats.particles > 0 && p.stats.particles <= RAIN_MAX);
  // A seat, by the flag or by the near plane only the seats use.
  for (let i = 0; i < 300; i++) p.update({ camera: camera(), state, dt: 1 / 60, cockpit: true });
  assert.equal(p.stats.drawCalls, 2);
  assert.ok(p.stats.drops > 0 && p.stats.drops <= DROPS_MAX);
  p.update({ camera: camera(100, 0.05), state, dt: 1 / 60 });
  assert.equal(p.stats.drawCalls, 2);
  p.update({ camera: camera(100, 0.25), state, dt: 1 / 60 });
  assert.equal(p.stats.drawCalls, 1);
  p.setWeather(calmWeather());
  p.update({ camera: camera(), state, dt: 1 / 60 });
  assert.equal(p.stats.drawCalls, 0);
});

test('the rate sets the particle count; heavy rain is within the budget', () => {
  const { p } = make();
  p.setWeather(rain(1));
  p.update({ camera: camera(), state, dt: 1 / 60 });
  const heavy = p.stats.particles;
  assert.equal(heavy, RAIN_MAX);
  p.setWeather(rain(0.1));
  p.update({ camera: camera(), state, dt: 1 / 60 });
  assert.ok(p.stats.particles < heavy / 3);
});

test('rate 0 is clear, whatever the kind says', () => {
  const { p } = make();
  p.setWeather(normalizeWeather({ precip: { kind: 'rain', rate: 0 } }));
  p.update({ camera: camera(), state, dt: 1 / 60 });
  assert.equal(p.stats.drawCalls, 0);
});

test('the air relative to the aircraft, in the scene frame', () => {
  const v = relativeAir({ vel: { x: 70, y: -20, z: -3 }, wind: { x: 5, y: 2, z: 0 } }, 6);
  assert.deepEqual(v, [5 - 70, 0 - 6 + 3, -(2 + 20)]);
  // No wind field (an old state): just the fall and the motion.
  assert.deepEqual(relativeAir({ vel: { x: 0, y: 0, z: 0 } }, 6), [0, -6, -0]);
  assert.ok(fallSpeed('rain', 1) > fallSpeed('rain', 0));
  assert.ok(fallSpeed('snow', 1) < 2);
});

test('nothing moves while paused, or on a frame with no time', () => {
  const { p } = make();
  p.setWeather(rain());
  const cam = camera();
  p.update({ camera: cam, state, dt: 1 / 60 });
  const u = () => p.objects.particles.material.uniforms.uOffset.value.toArray();
  const before = u();
  p.update({ camera: cam, state, dt: 1 / 60, paused: true });
  p.update({ camera: cam, state, dt: 0 });
  assert.deepEqual(u(), before);
  p.update({ camera: cam, state, dt: 1 / 60 });
  assert.notDeepEqual(u(), before);
});

test('the offset stays inside the box', () => {
  const { p } = make();
  p.setWeather(rain());
  const cam = camera();
  for (let i = 0; i < 2000; i++) p.update({ camera: cam, state: { ...state, vel: { x: 250, y: -90, z: 30 } }, dt: 1 / 60 });
  for (const c of p.objects.particles.material.uniforms.uOffset.value.toArray()) assert.ok(c >= 0 && c < BOX_M);
});

test('seeded: the same weather makes the same particles, and the seed changes them', () => {
  const a = new Float32Array(400), b = new Float32Array(400), c = new Float32Array(400);
  fillParticles(a, 7); fillParticles(b, 7); fillParticles(c, 8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const d = new Float32Array(400), e = new Float32Array(400);
  fillDrops(d, 7); fillDrops(e, 7);
  assert.deepEqual(d, e);
  for (const x of a) assert.ok(x >= 0 && x < 1);
});

test('below the lowest cloud base only', () => {
  const clouds = [{ okta: 8, baseFt: 3000, topFt: 9000 }, { okta: 4, baseFt: 1200, topFt: 2000 }, { okta: 0, baseFt: 300, topFt: 500 }];
  const w = rain(1, { clouds });
  assert.ok(Math.abs(ceilingM(w) - 1200 * 0.3048) < 1e-6);   // the okta-0 layer doesn't count
  assert.equal(fallAt(100, ceilingM(w)), 1);
  assert.equal(fallAt(ceilingM(w) + 100, ceilingM(w)), 0);
  const { p } = make();
  p.setWeather(w);
  p.update({ camera: camera(1000), state, dt: 1 / 60 });
  assert.equal(p.stats.drawCalls, 0);
  assert.equal(p.objects.particles.visible, false);
  p.update({ camera: camera(100), state, dt: 1 / 60 });
  assert.equal(p.objects.particles.visible, true);
});

test('with no layers the fall stops at a default top, far above the approach', () => {
  const c = ceilingM(rain());
  assert.ok(c > 3000 && c < 8000);
  assert.equal(fallAt(1000, c), 1);
  assert.equal(fallAt(11000, c), 0);
});

test('createPrecip copes with the world uniforms missing', () => {
  const scene = new THREE.Scene();
  const p = createPrecip(scene);
  p.setWeather(null);
  p.update({ camera: camera(), state: {}, dt: 1 / 60 });
  assert.equal(p.stats.kind, 'none');
});

test('snow: the same system, set to snow', () => {
  const { p } = make();
  p.setWeather(normalizeWeather({ precip: { kind: 'snow', rate: 0.5 }, tempC: -5 }));
  p.update({ camera: camera(), state, dt: 1 / 60 });
  assert.equal(p.stats.kind, 'snow');
  assert.equal(p.stats.drawCalls, 1);
  assert.equal(p.objects.particles.material.uniforms.uSnow.value, 1);
});

// v0.4.2: the wiper, in a seat in the rain: on the seat's side of the aircraft, sweeping below 230 kt, parked above.
test('the wiper: shown in a seat in the rain, on the seat’s side, parked above 230 kt', () => {
  const { p } = make();
  p.setWeather({ ...calmWeather(), preset: 'x', seed: 2, precip: { kind: 'rain', rate: 0.8 } });
  const cam = camera();
  cam.near = 0.05;                         // a seat view
  const st = { ...state, ias: 70, pos: { x: 0, y: 0, z: cam.position.y }, pitch: 0, hdg: 0, roll: 0 };
  // The captain sits left of the centreline: the camera 0.55 m to the left (scene −x with the heading north).
  cam.position.x = -0.55;
  for (let i = 0; i < 300; i++) p.update({ camera: cam, origin: { x: 0, y: 0 }, state: st, dt: 1 / 60 });
  assert.equal(p.objects.wiper.visible, true);
  const u = p.objects.drops.material.uniforms;
  assert.equal(u.uWipe.value.w, -1, 'the captain’s side');
  assert.ok(u.uWipeT.value.z > 0 && u.uWipeT.value.x > 0, 'sweeping');
  cam.position.x = 0.55;
  p.update({ camera: cam, origin: { x: 0, y: 0 }, state: st, dt: 1 / 60 });
  assert.equal(u.uWipe.value.w, 1, 'the first officer’s side');
  p.update({ camera: cam, origin: { x: 0, y: 0 }, state: { ...st, ias: 260 * 0.514444 }, dt: 1 / 60 });
  assert.ok(u.uWipeT.value.z < 0 && u.uWipeT.value.x === 0, 'parked at 260 kt');
});
