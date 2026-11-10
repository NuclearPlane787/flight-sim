// v0.4.0: the cloud layers' cover, the fog's strength and lightning's stateless pieces (src/world/clouds.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { cloudNoise, coverThreshold, COVER_THR, layerParams, fogStrength, surfaceOrder, flashEnvelope, boltPaths, ihash, createClouds, MAX_LAYERS, MAX_SHAFTS, SHAFT_ORDER, shaftTopM, shaftGeometry } from '../src/world/clouds.js';
import { strikesBetween } from '../src/sim/lightning.js';

test('the cover thresholds give each okta its share of the sky', () => {
  for (let okta = 1; okta <= 7; okta++) {
    let n = 0, N = 40000;
    for (let i = 0; i < N; i++) { if (cloudNoise(i * 0.21 + 0.3, (i % 293) * 7.7 + i * 0.05, 4242 + okta) >= COVER_THR[okta]) n++; }
    assert.ok(Math.abs(n / N - okta / 8) < 0.08, `okta ${okta}: cover ${n / N}`);
  }
  assert.equal(coverThreshold(8), -1);
  assert.equal(coverThreshold(0), Infinity);
});

test('cloudNoise is deterministic and sane', () => {
  const v = cloudNoise(12.34, -56.7, 99);
  assert.equal(v, cloudNoise(12.34, -56.7, 99));
  assert.notEqual(v, cloudNoise(12.34, -56.7, 100));
  assert.ok(v > 0 && v < 1);
  // The hash matches the shader's formula's published values shape (0..1).
  const h = ihash(-3, 7, 5);
  assert.ok(h >= 0 && h < 1);
});

test('layerParams: no cloud for okta 0; base and top in metres; a layer has thickness', () => {
  assert.equal(layerParams({ okta: 0, baseFt: 3000, topFt: 4000 }, 0, 1), null);
  const l = layerParams({ okta: 5, baseFt: 3000, topFt: 3000 }, 1, 1);
  assert.ok(l.topM > l.baseM);
  assert.ok(Math.abs(l.baseM - 914.4) < 0.01);
  assert.ok(l.seed >= 0 && l.seed < 2 ** 24);
});

test('fogStrength: full inside an overcast, none above or below', () => {
  const l = layerParams({ okta: 8, baseFt: 3000, topFt: 5000 }, 0, 1);
  const layers = [l];
  assert.equal(fogStrength(layers, 500, 0, 0), 0);
  assert.equal(fogStrength(layers, 2000, 0, 0), 0);
  assert.equal(fogStrength(layers, 1200, 0, 0), 1);
  assert.ok(fogStrength(layers, l.baseM, 0, 0) > 0.3 && fogStrength(layers, l.baseM, 0, 0) < 0.7);
});

test('surfaceOrder: an overcast shows only its near face, and layers order around the camera', () => {
  const ovc = layerParams({ okta: 8, baseFt: 3000, topFt: 5000 }, 0, 1), bkn = layerParams({ okta: 6, baseFt: 3000, topFt: 5000 }, 0, 1);
  let o = surfaceOrder(ovc, 0, 500);
  assert.ok(o.base && !o.top);
  o = surfaceOrder(ovc, 0, 3000);
  assert.ok(!o.base && o.top);
  o = surfaceOrder(bkn, 0, 3000);
  assert.ok(o.base && o.top && o.orderBase < o.orderTop);
  // Below the camera: after the ground's lights; above it: before them.
  assert.ok(surfaceOrder(bkn, 0, 3000).orderTop > 10);
  assert.ok(surfaceOrder(bkn, 0, 500).orderBase < 0);
  // Below the layer: the far (top) surface draws first.
  o = surfaceOrder(bkn, 0, 500);
  assert.ok(o.orderTop < o.orderBase);
});

test('flashEnvelope: bright at once, gone within its life', () => {
  assert.ok(flashEnvelope(0, 1) > 0.8);
  assert.ok(flashEnvelope(0.1, 1) > 0.3);
  assert.equal(flashEnvelope(0.5, 1), 0);
  assert.equal(flashEnvelope(-0.1, 1), 0);
});

test('boltPaths: seeded, top to the ground, within budget', () => {
  const a = boltPaths(5, 1800, 60), b = boltPaths(5, 1800, 60);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, boltPaths(6, 1800, 60));
  const main = a[0];
  assert.equal(main[0][1], 1800);
  assert.equal(main[main.length - 1][1], 0);
  assert.ok(a.reduce((s, p) => s + p.length - 1, 0) <= 60);
});

test('strikesBetween stays silent without lightning', () => {
  assert.deepEqual(strikesBetween({ seed: 1, lightning: 0 }, 0, 100, 0, 0, []), []);
});

function fakeUniforms() {
  return { uNight: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uSkyAmb: { value: new THREE.Color(0.3, 0.3, 0.3) } };
}
function counted(scene) { let v = 0; scene.traverse((o) => { if (o.isMesh && o.visible) v++; }); return v; }

test('clear weather: nothing draws, even after a storm', () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500000);
  const clouds = createClouds(scene, fakeUniforms());
  const n0 = counted(scene);
  assert.equal(n0, 0);
  const frame = (alt, t = 0) => { cam.position.set(0, alt, 0); cam.updateMatrixWorld(); clouds.update({ camera: cam, origin: { x: 0, y: 0 }, state: { t }, dt: 1 / 60, paused: false }); };
  frame(500);
  assert.equal(counted(scene), 0);
  clouds.setWeather({ seed: 2, clouds: [{ okta: 8, baseFt: 3000, topFt: 5000 }], lightning: 1, aloft: { fromDeg: 270, kt: 30 } });
  frame(500);
  assert.equal(counted(scene), 1, 'an overcast from below: one face');
  frame(1200);
  assert.equal(scene.getObjectByName('cloud-fog').visible, true, 'fog shells inside');
  frame(3000);
  assert.equal(counted(scene), 1, 'an overcast from above: one face, no fog');
  clouds.setWeather(null);
  frame(3000);
  assert.equal(counted(scene), 0, 'hidden again');
  assert.equal(clouds.stats.drawCalls, 0);
});

test('lightning flashes from sim time, and nothing when it stands still or lightning is 0', () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500000);
  cam.position.set(0, 1000, 0); cam.updateMatrixWorld();
  const clouds = createClouds(scene, fakeUniforms());
  const w = { seed: 4, clouds: [{ okta: 6, baseFt: 3000, topFt: 5000 }], lightning: 1 };
  clouds.setWeather(w);
  const origin = { x: 0, y: 0 };
  let saw = false, boltSeen = false;
  let tf = 0;
  for (let i = 0; i < 6000 && !(saw && boltSeen); i++) {
    tf = i / 60;
    clouds.update({ camera: cam, origin, state: { t: tf }, dt: 1 / 60, paused: false });
    if (clouds.stats.flash > 0) saw = true;
    if (clouds.stats.bolts) boltSeen = true;
  }
  assert.ok(saw, 'a flash in 100 s of lightning 1');
  assert.ok(boltSeen, 'a bolt near the camera in 100 s of lightning 1');
  // Frozen sim: t doesn't advance, no new flashes; the flash in flight just stands.
  // Run on until a flash is in the air, then stop the clock there.
  for (let i = 0; i < 20000 && !(clouds.stats.flash > 0.05); i++) { tf += 1 / 60; clouds.update({ camera: cam, origin, state: { t: tf }, dt: 1 / 60, paused: false }); }
  const flash0 = clouds.stats.flash, bolts0 = clouds.stats.bolts;
  assert.ok(flash0 > 0.05, 'caught a flash');
  for (let i = 0; i < 30; i++) clouds.update({ camera: cam, origin, state: { t: tf }, dt: 1 / 60, paused: true });
  assert.equal(clouds.stats.flash, flash0, 'paused: the flash stands');
  assert.equal(clouds.stats.bolts, bolts0, 'paused: no new bolt');
  // Same t window, same flashes: deterministic.
  const a = strikesBetween(w, 0, 50, 0, 0, []);
  const b = strikesBetween(w, 0, 50, 0, 0, []);
  assert.deepEqual(a, b);
  clouds.setWeather({ seed: 4, clouds: w.clouds, lightning: 0 });
  for (let i = 0; i < 200; i++) clouds.update({ camera: cam, origin, state: { t: i / 60 }, dt: 1 / 60, paused: false });
  assert.equal(clouds.stats.flash, 0);
  assert.equal(clouds.stats.bolts, 0);
  assert.equal(MAX_LAYERS, 3);
});

test('rain shafts: one draw for the set, placed in the map frame, gone without cells', () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500000);
  const clouds = createClouds(scene, fakeUniforms());
  const shaft = scene.getObjectByName('rain-shafts');
  const origin = { x: 1000, y: 2000 };
  const frame = () => { cam.position.set(0, 500, 0); cam.updateMatrixWorld(); clouds.update({ camera: cam, origin, state: { t: 0 }, dt: 1 / 60, paused: false }); };
  assert.equal(shaft.visible, false);
  frame();
  assert.equal(clouds.stats.drawCalls, 0);

  // A storm under a layer: the set costs exactly one draw more than the same sky without cells.
  const sky = { seed: 2, clouds: [{ okta: 4, baseFt: 2500, topFt: 6000 }, { okta: 7, baseFt: 4000, topFt: 32000 }] };
  clouds.setWeather(sky);
  frame();
  const without = clouds.stats.drawCalls;
  const cells = [{ x: 4000, y: 9000, radiusM: 1200, dvKt: 40 }, { x: -3000, y: 500, radiusM: 2000, dvKt: 50 }, { x: 20000, y: -7000, radiusM: 800, dvKt: 30 }];
  clouds.setWeather({ ...sky, microbursts: cells });
  frame();
  assert.equal(clouds.stats.drawCalls, without + 1);
  assert.equal(clouds.stats.shafts, 3);
  assert.equal(shaft.visible, true);
  assert.equal(shaft.geometry.instanceCount, 3);
  assert.ok(Math.abs(shaft.material.uniforms.uShaftTop.value - 2500 * 0.3048) < 1e-6, 'up to the lowest base');

  // Each cell's scene position: X = map x - origin x, Z = -(map y - origin y), and it follows the origin.
  const at = (i) => [shaft.position.x + shaft.geometry.attributes.aCell.getX(i), shaft.position.z + shaft.geometry.attributes.aCell.getY(i), shaft.geometry.attributes.aCell.getZ(i)];
  const check = () => cells.forEach((c, i) => {
    const [x, z, r] = at(i);
    assert.ok(Math.abs(x - (c.x - origin.x)) < 1e-3 && Math.abs(z + (c.y - origin.y)) < 1e-3, `cell ${i}`);
    assert.equal(r, c.radiusM);
  });
  check();
  origin.x = -5000; origin.y = 40000;
  frame();
  check();

  // Cells with no cloud at all: a hand-set microburst in a clear sky still draws, to the default top.
  clouds.setWeather({ seed: 2, clouds: [], microbursts: [cells[0]] });
  frame();
  assert.equal(shaft.visible, true);
  assert.equal(clouds.stats.drawCalls, 1);
  assert.equal(shaft.material.uniforms.uShaftTop.value, shaftTopM([]));

  // No cells, or clear: hidden and free.
  clouds.setWeather({ ...sky, microbursts: [] });
  frame();
  assert.equal(shaft.visible, false);
  assert.equal(clouds.stats.drawCalls, without);
  clouds.setWeather({ ...sky, microbursts: cells });
  frame();
  clouds.setWeather(null);
  frame();
  assert.equal(shaft.visible, false);
  assert.equal(counted(scene), 0);
  assert.equal(clouds.stats.drawCalls, 0);
  assert.equal(clouds.stats.shafts, 0);
});

test('rain shafts: a full set is still one mesh, and the buffer holds it', () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500000);
  cam.position.set(0, 300, 0); cam.updateMatrixWorld();
  const clouds = createClouds(scene, fakeUniforms());
  const many = Array.from({ length: MAX_SHAFTS + 5 }, (_, i) => ({ x: i * 1000, y: -i * 700, radiusM: 1000, dvKt: 40 }));
  clouds.setWeather({ seed: 3, clouds: [], microbursts: many });
  clouds.update({ camera: cam, origin: { x: 0, y: 0 }, state: { t: 0 }, dt: 1 / 60, paused: false });
  assert.equal(clouds.stats.shafts, MAX_SHAFTS);
  assert.equal(counted(scene), 1);
  assert.equal(clouds.stats.drawCalls, 1);
});

test('rain shafts sort between the layers, wherever the camera is', () => {
  const a = layerParams({ okta: 6, baseFt: 3000, topFt: 5000 }, 0, 1), b = layerParams({ okta: 6, baseFt: 9000, topFt: 12000 }, 1, 1), c = layerParams({ okta: 6, baseFt: 20000, topFt: 25000 }, 2, 1);
  [a, b, c].forEach((l, i) => {
    const above = surfaceOrder(l, i, 100), below = surfaceOrder(l, i, 12000 + 20000);
    assert.ok(above.orderBase < SHAFT_ORDER && above.orderTop < SHAFT_ORDER, 'a layer above the camera draws first');
    assert.ok(below.orderBase > SHAFT_ORDER && below.orderTop > SHAFT_ORDER, 'a layer below the camera draws over');
  });
  assert.ok(SHAFT_ORDER > -999 && SHAFT_ORDER < 1, 'after the sky, before the ground\'s transparent things');
  assert.ok(Math.abs(shaftTopM([a, b]) - 3000 * 0.3048) < 1e-6);
  assert.ok(shaftTopM([]) > 1000);
});

test('rain shafts: the column is wound outward, walls and top', () => {
  const g = shaftGeometry(), P = g.attributes.position, I = g.index;
  const v = (i) => new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i));
  for (let k = 0; k < I.count; k += 3) {
    const a = v(I.getX(k)), b = v(I.getX(k + 1)), c = v(I.getX(k + 2));
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const mid = a.clone().add(b).add(c).divideScalar(3);
    if (a.y === 1 && b.y === 1 && c.y === 1) assert.ok(n.y > 0, 'the cap faces up');
    else assert.ok(n.x * mid.x + n.z * mid.z > 0, 'a wall faces out');
  }
});
