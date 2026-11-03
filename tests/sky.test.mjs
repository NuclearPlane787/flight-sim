// Node tests for the sky's light (src/world/sky.js): v0.1.4's day, the darkening through
// twilight, the night that never goes black, and setTime on a real date.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightingAt, luminance, createSky, bvColor, SUN_ELEVATION_DEG } from '../src/world/sky.js';
import * as THREE from '../vendor/three.module.js';
import { kstMs } from '../src/clock.js';

const near = (a, b, eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps);

test('with the sun at v0.1.4\'s 35° the light is v0.1.4\'s', () => {
  const L = lightingAt(SUN_ELEVATION_DEG);
  assert.ok(near(L.sunColor, [1.0, 0.94, 0.86]), String(L.sunColor));
  assert.ok(near(L.skyAmb, [0.38, 0.46, 0.58]), String(L.skyAmb));
  assert.ok(near(L.zenith, [0.075, 0.20, 0.52]));
  assert.ok(near(L.horizon, [0.58, 0.68, 0.82]));
  assert.ok(near(L.hazeTint, [0.36, 0.46, 0.62]));
  assert.ok(near(L.glow, [0, 0, 0]) && near(L.belt, [0, 0, 0]) && L.shadow === 0);
  assert.equal(L.night, 0);
  assert.equal(L.stars, 0);
  assert.equal(L.exposure, 1);
  // the same with a Moon up by day
  assert.ok(near(lightingAt(35, 40, 1).skyAmb, [0.38, 0.46, 0.58]));
});

test('the light darkens monotonically from +10° to −18°', () => {
  let prev = null;
  for (let h = 10; h >= -18; h -= 0.25) {
    const L = lightingAt(h, -30, 0);
    const v = [luminance(L.sunColor), luminance(L.skyAmb), luminance(L.zenith), luminance(L.horizon)];
    if (prev) v.forEach((x, i) => assert.ok(x <= prev[i] + 1e-12, `channel ${i} at ${h}°: ${x} > ${prev[i]}`));
    prev = v;
  }
  assert.equal(luminance(lightingAt(-6).sunColor), 0);
});

test('night is never pitch black, and a high full Moon lights it more', () => {
  const day = luminance(lightingAt(35).skyAmb);
  const dark = luminance(lightingAt(-30, -20, 0).skyAmb);
  const moon = luminance(lightingAt(-30, 60, 1).skyAmb);
  assert.ok(dark > 0.02 * day && dark < 0.05 * day, `moonless ${dark / day}`);
  assert.ok(moon > 1.5 * dark && moon < 0.12 * day, `full moon ${moon / day}`);
  assert.ok(luminance(lightingAt(-30, 15, 1).skyAmb) < moon, 'a low Moon gives less');
  assert.ok(luminance(lightingAt(-30, 60, 0.3).skyAmb) < moon, 'a crescent gives less');
});

test('uNight is ~0 at +5° and ~1 at −12°; stars from −6° to −15°', () => {
  assert.ok(lightingAt(5).night < 0.01);
  assert.ok(lightingAt(-12).night > 0.99);
  assert.ok(lightingAt(-6).stars < 0.01);
  assert.ok(lightingAt(-15).stars > 0.99);
  assert.ok(lightingAt(-12).exposure > 1.3);
});

test('star colours run blue to orange with B−V', () => {
  const b = bvColor(-0.3), o = bvColor(1.6);
  assert.ok(b[2] > b[0] && o[0] > o[2]);
  assert.ok(near(bvColor(null), bvColor(0.4)));
});

test('setTime over Seoul: 14:00 is day, 23:00 is night, and it is cheap', () => {
  const uniforms = { uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
    uSkyAmb: { value: new THREE.Color() }, uNight: { value: 0 } };
  const scene = new THREE.Scene();
  const sky = createSky(scene, uniforms, { UNIFORMS_GLSL: '' });
  // Before setTime: v0.1.4's afternoon.
  assert.ok(Math.abs(uniforms.uSunColor.value.g - 0.94) < 1e-6);
  sky.setTime(kstMs(2026, 11, 1, 14, 0), 37.56, 126.8);
  assert.ok(sky.state.sunAltDeg > 25 && sky.state.sunAltDeg < 40, String(sky.state.sunAltDeg));
  assert.ok(uniforms.uNight.value === 0 && Math.abs(uniforms.uSkyAmb.value.b - 0.58) < 1e-9);
  sky.setTime(kstMs(2026, 11, 24, 23, 0), 37.56, 126.8);
  assert.ok(sky.state.sunAltDeg < -40 && uniforms.uNight.value === 1);
  assert.ok(sky.state.moonIllum > 0.95 && sky.state.moonAltDeg > 40, JSON.stringify(sky.state));
  assert.ok(uniforms.uSunDir.value.y < 0, 'the sun\'s direction stays honest below the horizon');
  // Per frame: a 60 fps clock at 600x, the worst case (every call recomputes).
  const t0 = kstMs(2026, 11, 9, 23, 0), n = 2000;
  const a = performance.now();
  for (let i = 0; i < n; i++) sky.setTime(t0 + i * 10000, 37.56, 126.8);
  const each = (performance.now() - a) / n;
  // At 1x most frames return at once.
  const b = performance.now();
  for (let i = 0; i < n; i++) sky.setTime(t0 + 1e7 + i * 16.7, 37.56, 126.8);
  const avg = (performance.now() - b) / n;
  console.log(`setTime: ${(each * 1000).toFixed(1)} µs recomputing, ${(avg * 1000).toFixed(2)} µs average at 1x`);
  assert.ok(each < 0.1 && avg < 0.02);
});

test('the stars are where they are: Betelgeuse and Dubhe through the sky\'s matrix', async () => {
  const { precessFromJ2000, equatorialToHorizontal } = await import('../src/astro.js');
  const { azElToScene } = await import('../src/world/sky.js');
  const uniforms = { uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
    uSkyAmb: { value: new THREE.Color() }, uNight: { value: 0 } };
  const sky = createSky(new THREE.Scene(), uniforms, { UNIFORMS_GLSL: '' });
  const ms = kstMs(2026, 11, 9, 23, 0), lat = 37.56, lon = 126.8;
  sky.setTime(ms, lat, lon);
  const M = sky.mesh.material.uniforms.uStarMat.value;
  for (const [ra, dec] of [[88.79, 7.41], [165.93, 61.75]]) {
    const v = new THREE.Vector3(Math.cos(dec * Math.PI / 180) * Math.cos(ra * Math.PI / 180),
      Math.cos(dec * Math.PI / 180) * Math.sin(ra * Math.PI / 180), Math.sin(dec * Math.PI / 180)).applyMatrix3(M);
    const p = precessFromJ2000(ra, dec, ms);
    const h = equatorialToHorizontal(p.raDeg, p.decDeg, ms, lat, lon);
    const want = azElToScene(h.azDeg, h.altDeg);
    assert.ok(v.angleTo(want) < 1e-6, `${ra},${dec}: off by ${v.angleTo(want)}`);
    console.log(`RA ${ra} Dec ${dec}: az ${h.azDeg.toFixed(1)}°, alt ${h.altDeg.toFixed(1)}°`);
  }
});

test('v0.2.1: the faint stars are brighter, first magnitude as before, and the fill carries on', async () => {
  const { starBrightness, starGeometry, STAR_GAMMA, FILL_FAINT } = await import('../src/world/sky.js');
  const v020 = (m) => 1.4 * Math.pow(10, -0.4 * (m - 1) * 0.72);
  assert.ok(STAR_GAMMA < 0.72);
  assert.ok(Math.abs(starBrightness(1) - v020(1)) < 1e-12, 'first magnitude unchanged');
  for (const m of [4, 5, 6.5]) assert.ok(starBrightness(m) > 1.5 * v020(m), `mag ${m}: ${starBrightness(m)} vs ${v020(m)}`);
  // Brighter stars stay brighter.
  for (let m = -1.5; m < FILL_FAINT; m += 0.5) assert.ok(starBrightness(m) > starBrightness(m + 0.5));
  // The fill runs on past the catalogue's 6.5.
  assert.ok(FILL_FAINT > 6.5 && FILL_FAINT <= 9);
  // starGeometry's colours use it (a white B−V 0.3 star: its brightest channel is 1).
  const g = starGeometry({ stars: [10, 20, 6.5, 0.3, 30, -40, 2.0, 0.3] });
  const c = g.attributes.aCol.array;
  assert.ok(Math.abs(Math.max(c[0], c[1], c[2]) - starBrightness(6.5)) < 1e-6);
  assert.ok(Math.abs(Math.max(c[3], c[4], c[5]) - starBrightness(2.0)) < 1e-6);
});
