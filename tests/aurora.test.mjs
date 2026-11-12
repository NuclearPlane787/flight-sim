// v0.4.3: the aurora (src/world/sky.js, aurora() in the dome's shader). Shane: "let's add auroras to the night sky. Not like
// right up against the plane but very visible at a distance" — every clear night, green curtains with red tops, low in
// the north. It's part of the dome's shader (no draw call of its own) and shows as the stars do: none by day, all of it
// on a dark night, less under cloud. The pictures are tests/cloud/v043-shots.cjs's.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createSky, AURORA_GAIN } from '../src/world/sky.js';

const kstMs = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
function makeSky() {
  const uniforms = { uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
    uSkyAmb: { value: new THREE.Color() }, uNight: { value: 0 } };
  const sky = createSky(new THREE.Scene(), uniforms, { UNIFORMS_GLSL: '' });
  return { sky, u: sky.mesh.material.uniforms };
}

test('none by day, all of it on a clear night, as the stars', () => {
  const { sky, u } = makeSky();
  sky.setTime(kstMs(2026, 11, 12, 14), 37.56, 126.8);
  assert.equal(u.uAurora.value, 0, 'by day');
  sky.setTime(kstMs(2026, 11, 12, 18, 0), 37.56, 126.8);   // sunset about 17:25: early twilight
  assert.ok(u.uAurora.value < 0.5, `twilight: ${u.uAurora.value.toFixed(2)}`);
  sky.setTime(kstMs(2026, 11, 12, 23), 37.56, 126.8);
  assert.ok(u.uAurora.value > 0.99, `night: ${u.uAurora.value.toFixed(2)}`);
  assert.equal(u.uAurora.value, u.uStarVis.value);
});

test('an overcast sky takes most of it', () => {
  const { sky, u } = makeSky();
  sky.setTime(kstMs(2026, 11, 12, 23), 37.56, 126.8);
  sky.setWeather({ visM: 20000, clouds: [{ okta: 8, baseFt: 3000, topFt: 6000, baseM: 914, topM: 1829 }] });
  const cam = new THREE.PerspectiveCamera();
  sky.update(cam, 300);
  assert.ok(u.uAurora.value < 0.15, `under overcast: ${u.uAurora.value.toFixed(2)}`);
});

test('it is in the dome\'s shader, adds no draw call, and has a brightness', () => {
  const { sky } = makeSky();
  const fs = sky.mesh.material.fragmentShader;
  assert.ok(/vec3 aurora\(vec3 d\)/.test(fs) && /aurora\(d\) \* uAurora/.test(fs));
  assert.ok(AURORA_GAIN > 0 && AURORA_GAIN < 0.5);
  sky.setTime(kstMs(2026, 11, 12, 23), 37.56, 126.8);
  assert.equal(sky.drawCalls, 1 + (sky.stars && sky.stars.visible ? 1 : 0));
});
