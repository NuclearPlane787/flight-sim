// v0.7.9, part 9 (briefs/V0-7-9.md): weather by place's second half.
// 1. A front that moves in time: `ends.frontKt` carries the blend along the route with the sim's time (weather.js
//    blendWeight(e, x, y, t)); still a pure function of place and time, so a snapshot's restore and a second sim read
//    the same air. No front: v0.7.8's weather to the byte.
// 2. The far end's weather drawn ahead: with two ends the cloud layers are drawn by place (clouds.js WXAHEAD79,
//    routeLayers(), the route's shader variants), and the flashes come from where the lightning is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from '../vendor/three.module.js';
import * as W from '../src/sim/weather.js';
import { presetWeather } from '../src/sim/weather-presets.js';
import { createSim } from '../src/sim/sim.js';
import { createClouds, routeLayers, routeLayerAt, routeThr, layerParams, coverThreshold, COVER_THR, THR_NONE, WXAHEAD79, CLOUD_VERT_ROUTE, CLOUD_FRAG_ROUTE, MAX_LAYERS } from '../src/world/clouds.js';

const KT = 0.514444;
const ENDS = { ax: 0, ay: 0, bx: 0, by: 600000 };   // 600 km north
const storm = () => presetWeather('thunderstorm', null), clear = () => presetWeather('clear', null);
const two = (front) => W.normalizeWeather({ ...storm(), dep: clear(), ends: front === undefined ? ENDS : { ...ENDS, frontKt: front } });

test('no front: the settings and the weight are what they were (t is not read)', () => {
  const s = two();
  assert.equal(W.hasTwoEnds(s), true);
  assert.equal('frontKt' in s.ends, false);
  assert.deepEqual(W.normalizeWeather({ ...s, ends: { ...ENDS, frontKt: 0 } }), s, 'a front of 0 is no front');
  assert.equal(JSON.stringify(W.withFront(s, 0)), JSON.stringify(s));
  for (const y of [0, 150000, 250000, 300000, 390000, 450000, 600000]) for (const t of [0, 600, 7200]) {
    assert.equal(W.blendWeight(s.ends, 0, y, t), W.blendWeight(s.ends, 0, y));
    assert.equal(W.frontShift(s.ends, t), 0);
  }
  assert.equal(W.blendWeight(s.ends, 0, 200000), 0); assert.equal(W.blendWeight(s.ends, 0, 400000), 1);
  assert.equal(W.frontKtOf(s), 0); assert.equal(W.frontKtOf(clear()), 0);
});

test('a front toward the departure: at a fixed place the destination\'s weather arrives, at frontKt along the route', () => {
  const s = two(30);
  assert.equal(s.ends.frontKt, 30); assert.equal(W.frontKtOf(s), 30);
  const y = 180000;                                   // in the departure's third (under 200 km)
  assert.equal(W.blendWeight(s.ends, 0, y, 0), 0);
  // the blend's near edge starts at 200 km and comes south at 30 kt: it reaches 180 km after 20 km / 15.43 m/s
  const tEdge = 20000 / (30 * KT);
  assert.equal(W.blendWeight(s.ends, 0, y, tEdge - 5), 0);
  assert.ok(W.blendWeight(s.ends, 0, y, tEdge + 60) > 0);
  let last = -1;
  for (let t = 0; t <= 6 * 3600; t += 600) { const w = W.blendWeight(s.ends, 0, y, t); assert.ok(w >= last); last = w; }
  assert.equal(last, 1, 'after six hours the storm is over the place');
  assert.ok(Math.abs(W.frontShift(s.ends, 3600) - (30 * KT * 3600) / 600000) < 1e-12);
  // the weight depends on the place along the route and the time alone: a point abeam has its foot's
  assert.equal(W.blendWeight(s.ends, 80000, 250000, 1800), W.blendWeight(s.ends, -3000, 250000, 1800));
  // the other way: the departure's weather follows the flight
  const r = two(-30);
  assert.equal(W.blendWeight(r.ends, 0, 420000, 0), 1);
  assert.ok(W.blendWeight(r.ends, 0, 420000, 3600) < 1);
  // clamped, and kept by a moved destination and by setting one end's weather
  assert.equal(two(500).ends.frontKt, W.FRONT_KT_MAX); assert.equal(two(-500).ends.frontKt, -W.FRONT_KT_MAX);
  assert.equal(W.moveDestination(s, 5000, 610000).ends.frontKt, 30);
  assert.equal(W.withEndWeather(s, 'dep', presetWeather('rain', null), ENDS).ends.frontKt, 30);
  assert.equal(JSON.parse(JSON.stringify(s)).ends.frontKt, 30, 'a save carries it');
  assert.deepEqual(W.normalizeWeather(JSON.parse(JSON.stringify(s))), s);
});

// The code review's first finding: the front's place was frontKt·t from the flight's start, so a speed set an hour in
// moved the front an hour's worth in one frame, and "Still" threw it back.
test('a front set in flight goes on from where it stands; "Still" leaves it where it has come to; a moved destination keeps its metres', () => {
  const s0 = two(), y = 250000, T = 3600;
  const w0 = W.blendWeight(s0.ends, 0, y, T);
  assert.ok(w0 > 0 && w0 < 1);
  const s1 = W.withFront(s0, 30, T);                                  // "To departure", an hour in
  assert.deepEqual([s1.ends.frontKt, s1.ends.frontT0, 'frontM' in s1.ends], [30, T, false]);
  assert.equal(W.blendWeight(s1.ends, 0, y, T), w0, 'no jump at the moment it is set');
  assert.equal(W.blendWeight(s1.ends, 0, y, T - 600), w0, 'nor before it (a restore to an earlier time)');
  assert.ok(Math.abs(W.frontMetres(s1.ends, T + 1800) - 30 * KT * 1800) < 1e-6);
  assert.ok(W.blendWeight(s1.ends, 0, y, T + 1800) > w0);
  const s2 = W.withFront(s1, 0, T + 1800);                            // "Still", half an hour later
  assert.equal('frontKt' in s2.ends, false); assert.equal('frontT0' in s2.ends, false);
  assert.ok(Math.abs(s2.ends.frontM - 30 * KT * 1800) < 1e-6, 'the front stays where it has come to');
  for (const t of [0, T + 1800, T + 9000]) assert.equal(W.blendWeight(s2.ends, 0, y, t), W.blendWeight(s1.ends, 0, y, T + 1800));
  const s3 = W.withFront(s2, -30, T + 3600);                          // "To destination": back the way it came, from there
  assert.ok(Math.abs(W.frontMetres(s3.ends, T + 3600) - 30 * KT * 1800) < 1e-6);
  assert.ok(Math.abs(W.frontMetres(s3.ends, T + 5400)) < 1e-6);
  // set at the gate (t = 0) it is stored as before: the speed alone
  assert.deepEqual(Object.keys(W.withFront(s0, 30, 0).ends).sort(), ['ax', 'ay', 'bx', 'by', 'frontKt']);
  // a moved destination: the same metres, a new length
  const m = W.moveDestination(s1, 0, 400000);
  assert.equal(W.frontMetres(m.ends, T + 1800), W.frontMetres(s1.ends, T + 1800));
  assert.deepEqual([m.ends.frontKt, m.ends.frontT0], [30, T]);
  // an edited end and a save keep all three
  const e = W.withEndWeather(s3, 'dep', clear(), ENDS);
  assert.deepEqual([e.ends.frontKt, e.ends.frontT0, e.ends.frontM], [s3.ends.frontKt, s3.ends.frontT0, s3.ends.frontM]);
  assert.deepEqual(W.normalizeWeather(JSON.parse(JSON.stringify(s3))), s3);
});

// The code review's second finding: the predictive windshear's scan read each burst at the flight's start's weight.
test('under a front the scan weighs each burst at its own time; with no front the list is v0.7.8\'s', () => {
  // a storm at the destination with two cells, one at the field and one 100 km short of it; a clear departure with one
  const st = { ...storm(), microbursts: [{ x: 0, y: 600000, radiusM: 1200, dvKt: 40 }, { x: 0, y: 500000, radiusM: 1200, dvKt: 40 }] };
  const dp = { ...clear(), microbursts: [{ x: 0, y: 100000, radiusM: 1200, dvKt: 30 }] };
  const mk = (front) => W.normalizeWeather({ ...st, dep: dp, ends: front === undefined ? ENDS : { ...ENDS, frontKt: front } });
  const plain = W.compileWeather(mk());
  assert.ok(plain.two && plain.bursts.length === 3 && plain.bursts.every((b) => b.lambda0 === undefined && b.lambda > 0));
  for (const b of plain.bursts) assert.equal(W.burstLambda(plain, b, 7200), b.lambda);
  const C = W.compileWeather(mk(60));
  const all = W.compileWeather(st).bursts.length + W.compileWeather(dp).bursts.length;
  assert.equal(C.bursts.length, all, 'none dropped: a burst of the far end may be reached by the front later');
  assert.ok(all > 0, 'the storm has bursts');
  let rose = 0;
  for (const b of C.bursts) {
    assert.ok(b.lambda0 > 0 && (b.mine === 'dep' || b.mine === 'dest'));
    assert.equal(W.burstLambda(C, b, 0), b.lambda);
    const k = W.blendWeight(C.ends, b.x, b.y, 9000);
    assert.equal(W.burstLambda(C, b, 9000), b.lambda0 * (b.mine === 'dep' ? 1 - k : k));
    if (W.burstLambda(C, b, 9000) > W.burstLambda(C, b, 0)) rose++;
  }
  // a storm's cell that the front has reached is as strong as its own weather makes it
  const farT = 600000 / (60 * KT);
  for (const b of C.bursts.filter((q) => q.mine === 'dest')) assert.equal(W.burstLambda(C, b, farT), b.lambda0);
  // ... and the departure's own cell is gone from the scan once the storm's weather has come over it
  const depB = C.bursts.find((q) => q.mine === 'dep');
  assert.ok(W.burstLambda(C, depB, 0) === depB.lambda0 && W.burstLambda(C, depB, farT) === 0);
  // away from the destination: a far-end cell behind the front's line drops out of the scan
  const Cb = W.compileWeather(mk(-60)), mid = Cb.bursts.find((q) => q.mine === 'dest' && q.y === 500000);
  assert.ok(W.burstLambda(Cb, mid, 0) === mid.lambda0 && W.burstLambda(Cb, mid, 3 * 3600) < mid.lambda0);
  assert.equal(rose, 0, 'these three sit where the weight is already whole at the start');
});

test('the look, the local air and the wind all read the front at the same time', () => {
  const s = two(40), y = 190000, t = 1500;
  const w = W.blendWeight(s.ends, 0, y, t);
  assert.ok(w > 0 && w < 1, `in the blend: ${w}`);
  const look0 = W.weatherAt(s, 0, y, 0, 0), look = W.weatherAt(s, 0, y, 0, t);
  assert.equal(look0.precip.kind, 'none'); assert.ok(look.precip.rate > 0, 'the rain has come');
  const f = W.createWeatherFollower();
  assert.equal(f.at(s, 0, y, 0), null, 'at the start the place is the departure\'s clear air (drawn as the default)');
  const a = f.at(s, 0, y, t);
  assert.ok(a && a.precip.rate > 0);
  assert.equal(f.at(s, 0, y, t + 0.5), a, 'the same object until the weight moves by a step');
  const C = W.compileWeather(s);
  assert.equal(W.localWeather(C, 0, y, 0), C.A);
  const L = W.localWeather(C, 0, y, t);
  assert.ok(Math.abs(L.w - w) < 1e-12 && L.qnh < C.A.qnh && L.qnh > C.B.qnh);
  const Wa = W.newWind(), Wb = W.newWind(), Wc = W.newWind();
  W.windAt(C, 0, y, 3000, 3000, 0, 1, 0, 30, Wa);
  W.windAt(C, 0, y, 3000, 3000, t, 1, 0, 30, Wb);
  W.windAt(C.B, 0, y, 3000, 3000, t, 1, 0, 30, Wc);
  assert.equal(Math.hypot(Wa.meanN, Wa.meanE), 0, 'calm at the start');
  assert.ok(Math.hypot(Wb.meanN, Wb.meanE) > 0.5 && Math.hypot(Wb.meanN, Wb.meanE) < Math.hypot(Wc.meanN, Wc.meanE), 'part of the storm\'s wind later');
});

test('the sim: with a front the air at the aircraft changes with time though it stands still, and a restore reads the same air', () => {
  const s = two(60);
  const run = (restoreAt) => {
    const sim = createSim();
    sim.setWeather(s);
    sim.reset({ x: 0, y: 195000, hdg: 0, onGround: true, parkingBrake: true });
    let snap = null;
    const out = [];
    for (let i = 0; i < 120 * 60; i++) {
      sim.step(1 / 60);
      if (i === restoreAt) { snap = sim.snapshot(); sim.restore(snap); }
      if (i % 600 === 599) out.push([sim.state.t, sim.state.wind?.kt ?? 0, sim.state.altInd]);
    }
    return out;
  };
  const a = run(-1), b = run(1800);
  assert.deepEqual(b, a, 'the same flight with a snapshot taken and restored at 30 s');
  // 5 km south of the blend's edge at 60 kt: the edge passes at about 162 s, and the QNH starts down (the altimeter reads up)
  const sim = createSim(); sim.setWeather(s); sim.reset({ x: 0, y: 195000, hdg: 0, onGround: true, parkingBrake: true });
  const alt0 = sim.state.altInd;
  for (let i = 0; i < 100 * 60; i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.state.altInd - alt0) < 0.01, 'before the front arrives nothing has changed (but the struts settling)');
  for (let i = 0; i < 400 * 60; i++) sim.step(1 / 60);
  // (500 s: the blend's edge is 10 km past the aircraft, the weight 0.008, the QNH 0.1 hPa down: the altimeter 0.8 m up)
  assert.ok(sim.state.altInd > alt0 + 0.5, `the pressure falls as the storm arrives: ${alt0} -> ${sim.state.altInd}`);
});

test('the clouds by place: the two ends\' layers paired by their bases, with the look\'s own seeds; each end\'s own at its end', () => {
  const s = two();
  const pairs = routeLayers(s), dest = W.endWeather(s, 'dest');
  assert.ok(pairs.length >= 1 && pairs.length <= MAX_LAYERS);
  assert.deepEqual(routeLayers(clear()), []);
  const lb = dest.clouds.slice().sort((p, q) => p.baseFt - q.baseFt);
  pairs.forEach((P, i) => {
    assert.equal(P.A.okta, 0); assert.equal(P.A.thr, THR_NONE); assert.equal(P.A.cov, 0);   // the departure is clear
    const own = layerParams(lb[i], i, dest.seed);
    assert.equal(P.seed, own.seed); assert.equal(P.scale, own.scale);
    assert.equal(P.B.thr, coverThreshold(lb[i].okta)); assert.equal(P.B.baseM, own.baseM); assert.equal(P.B.topM, own.topM);
    assert.equal(P.A.baseM, own.baseM, 'an end with no layer takes the other\'s heights');
    const at1 = routeLayerAt(P, 1), at0 = routeLayerAt(P, 0), mid = routeLayerAt(P, 0.5);
    assert.equal(at1.thr, own.thr); assert.equal(at1.baseM, own.baseM); assert.equal(at1.topM, own.topM); assert.equal(at1.seed, own.seed);
    assert.equal(at0.thr, THR_NONE); assert.equal(at0.okta, 0);
    assert.ok(mid.thr < THR_NONE && mid.thr > own.thr);
    // halfway the cover is half the destination's, as the camera's own weather has it (blendSettings() rounds it)
    assert.ok(Math.abs(mid.thr - routeThr(lb[i].okta / 2)) < 1e-12);
    // the camera's own weather pairs the same way: the look's blended layer i has this seed
    const look = W.weatherAt(s, 0, 300000);
    assert.equal(layerParams(look.clouds[i], i, look.cloud.seed).seed, P.seed);
  });
  // two overcasts stay solid all the way; an overcast and a broken layer are never "solid" between
  const P = routeLayers(W.normalizeWeather({ ...storm(), clouds: [{ okta: 8, baseFt: 2000, topFt: 6000 }], dep: { ...clear(), clouds: [{ okta: 8, baseFt: 4000, topFt: 5000 }] }, ends: ENDS }))[0];
  assert.equal(routeLayerAt(P, 0.5).okta, 8); assert.equal(routeLayerAt(P, 0.5).baseM, (2000 + 4000) / 2 * 0.3048);
});

test('the route\'s shaders: each anchor replaced once, the weight and the heights in the vertex shader, the threshold in the fragment\'s', () => {
  assert.equal(WXAHEAD79, process.env.FS_WXAHEAD79 !== '0');
  for (const k of ['uRoute', 'uRouteShift', 'uAlt', 'vW', 'uOrigin']) assert.ok(CLOUD_VERT_ROUTE.includes(k), k);
  for (const k of ['uOkta2', 'routeThr(', 'vW', 'ROUTE_THR[9]']) assert.ok(CLOUD_FRAG_ROUTE.includes(k), k);
  assert.ok(/thin79 = 1\.0 - smoothstep\(0\.0, 1\.0, oktaHere\)/.test(CLOUD_FRAG_ROUTE), 'under one okta the layer is thin and soft-edged');
  assert.ok(!/uniform float [^;]*\buThr\b/.test(CLOUD_FRAG_ROUTE) && !/\buCov\b/.test(CLOUD_FRAG_ROUTE), 'the single weather\'s uniforms are gone from the variant');
  // the table: whole oktas are COVER_THR's own thresholds, none is above the noise's reach, halves lie between
  for (let k = 1; k <= 8; k++) assert.equal(routeThr(k), COVER_THR[k]);
  assert.equal(routeThr(0), THR_NONE); assert.ok(THR_NONE > 1);
  assert.ok(routeThr(3.5) < COVER_THR[3] && routeThr(3.5) > COVER_THR[4]);
  assert.ok(CLOUD_FRAG_ROUTE.includes(COVER_THR[4].toFixed(4)));
});

function fakeUniforms() {
  return { uNight: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uSkyAmb: { value: new THREE.Color(0.3, 0.3, 0.3) },
    uOrigin: { value: new THREE.Vector2() }, uCamPos: { value: new THREE.Vector3() } };
}
const shown = (scene) => { const v = []; scene.traverse((o) => { if (o.isMesh && o.visible) v.push(o.name); }); return v; };

test('in the departure\'s clear third the destination\'s layers draw all the same, by place; a single weather draws as before', () => {
  if (!WXAHEAD79) return;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500000);
  const clouds = createClouds(scene, fakeUniforms());
  const frame = (y, alt, t = 0) => { cam.position.set(0, alt, -y); cam.updateMatrixWorld(); clouds.update({ camera: cam, origin: { x: 0, y: 0 }, state: { t }, dt: 1 / 60, paused: false }); };
  const s = two();
  const look = W.createWeatherFollower();
  clouds.setWeather(look.at(s, 0, 100000));           // the camera's weather there: the default (null)
  frame(100000, 10000);
  assert.deepEqual(shown(scene), [], 'without the route, a clear sky all round (v0.7.8)');
  clouds.setRoute(s);
  frame(100000, 10000);
  const v = shown(scene);
  assert.ok(v.includes('cloud-top') && v.includes('cloud-base'), `the storm's layers are drawn from the clear third: ${v}`);
  assert.equal(clouds.stats.fog, 0, 'and the camera is in clear air');
  const mats = []; scene.traverse((o) => { if (o.isMesh && o.visible && /^cloud-/.test(o.name)) mats.push(o.material); });
  for (const m of mats) { assert.equal(m.vertexShader, CLOUD_VERT_ROUTE); assert.deepEqual(m.uniforms.uRoute.value.toArray(), [0, 0, 0, 1 / 600000]); }
  assert.equal(mats[0].uniforms.uOkta2.value.x, 0); assert.ok(mats[0].uniforms.uOkta2.value.y > 0);
  // a front moves the shader's weight with the sim's time
  clouds.setRoute(two(30));
  frame(100000, 10000, 3600);
  let m0 = null; scene.traverse((o) => { if (!m0 && o.isMesh && o.visible && /^cloud-/.test(o.name)) m0 = o.material; });
  assert.ok(Math.abs(m0.uniforms.uRouteShift.value - W.frontShift(two(30).ends, 3600)) < 1e-12);
  // back to one weather: the single weather's shaders again
  clouds.setRoute(storm()); clouds.setWeather(storm());
  frame(100000, 300);
  scene.traverse((o) => { if (o.isMesh && o.visible && /^cloud-/.test(o.name)) assert.notEqual(o.material.vertexShader, CLOUD_VERT_ROUTE); });
  assert.ok(shown(scene).length >= 1);
});

test('the flashes come from where the storm is: none behind in the clear, some ahead', () => {
  if (!WXAHEAD79) return;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500000);
  const clouds = createClouds(scene, fakeUniforms());
  const s = two();
  clouds.setWeather(null); clouds.setRoute(s);
  let flashes = 0, where = [];
  for (let i = 0; i < 60 * 240; i++) {
    cam.position.set(0, 10000, -100000); cam.updateMatrixWorld();
    clouds.update({ camera: cam, origin: { x: 0, y: 0 }, state: { t: i / 60 }, dt: 1 / 60, paused: false });
    if (clouds.stats.flash > 0) { flashes++; let m = null; scene.traverse((o) => { if (!m && o.isMesh && /^cloud-/.test(o.name)) m = o.material; }); where.push(m.uniforms.uFlashPos.value.y); }
  }
  assert.ok(flashes > 10, `${flashes} frames with a flash in four minutes`);
  assert.ok(where.every((y) => y > 200000), 'every flash lies in the blend or the storm, north of the clear third');
});

// The code review's seventh finding: the switch had no hash. One line of SHA-256s over every cloud part's shader text
// and uniform names (tests/v079-clouds-hash.mjs), taken from the frozen pushed v0.7.8 at 02:27 on 2026-11-24.
const V078_CLOUDS = 'cloud-base:589195c0e4de cloud-top:589195c0e4de cloud-base:589195c0e4de cloud-top:589195c0e4de cloud-base:589195c0e4de cloud-top:589195c0e4de cloud-fog:ddb78125064d lightning-flash:d07fb988979b lightning-light:- lightning-bolt:ed383188c791 rain-shafts:544cb33b3231';
test('the clouds\' materials are the pushed v0.7.8\'s: switched off with a two-end weather, and switched on with a single one', () => {
  const run = (env, args = []) => execFileSync(process.execPath, [new URL('./v079-clouds-hash.mjs', import.meta.url).pathname, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
  assert.equal(run({ FS_WXAHEAD79: '0' }, ['--route']), V078_CLOUDS);
  assert.equal(run({ FS_WXAHEAD79: '0' }), V078_CLOUDS);
  assert.equal(run({ FS_WXAHEAD79: '' }), V078_CLOUDS);
  const on = run({ FS_WXAHEAD79: '' }, ['--route']);
  assert.notEqual(on, V078_CLOUDS);
  assert.equal(on.split(' ').slice(6).join(' '), V078_CLOUDS.split(' ').slice(6).join(' '), 'the fog, the flash, the bolt and the shafts are untouched by a route');
});

// The code review's sixth finding: at an end the camera's layer is that end's own (an overcast departure is solid).
test('at an end the layer at the camera is that end\'s own cover', () => {
  const pair = { seed: 1, scale: 1, A: { okta: 8, baseM: 600, topM: 1500 }, B: { okta: 5, baseM: 900, topM: 2000 } };
  assert.equal(routeLayerAt(pair, 0, {}).okta, 8); assert.equal(routeLayerAt(pair, 1, {}).okta, 5);
  assert.equal(routeLayerAt(pair, 0.001, {}).okta, 7); assert.equal(routeLayerAt(pair, 0.5, {}).okta, 7);
  assert.equal(routeLayerAt({ ...pair, B: { ...pair.B, okta: 8 } }, 0.5, {}).okta, 8);
  assert.equal(routeLayerAt({ ...pair, A: { ...pair.A, okta: 0 } }, 0, {}).okta, 0);
});

test('switched off (FS_WXAHEAD79=0) the clouds take no route', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as THREE from ${JSON.stringify(new URL('../vendor/three.module.js', import.meta.url).href)};
    const C = await import(${JSON.stringify(new URL('../src/world/clouds.js', import.meta.url).href)});
    const W = await import(${JSON.stringify(new URL('../src/sim/weather.js', import.meta.url).href)});
    const P = await import(${JSON.stringify(new URL('../src/sim/weather-presets.js', import.meta.url).href)});
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500000);
    const u = { uNight: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uSkyAmb: { value: new THREE.Color(0.3, 0.3, 0.3) } };
    const clouds = C.createClouds(scene, u);
    const s = W.normalizeWeather({ ...P.presetWeather('thunderstorm', null), dep: P.presetWeather('clear', null), ends: { ax: 0, ay: 0, bx: 0, by: 600000 } });
    clouds.setWeather(null); clouds.setRoute(s);
    cam.position.set(0, 10000, -100000); cam.updateMatrixWorld();
    clouds.update({ camera: cam, origin: { x: 0, y: 0 }, state: { t: 1 }, dt: 1 / 60, paused: false });
    let n = 0; scene.traverse((o) => { if (o.isMesh && o.visible) n++; });
    console.log(C.WXAHEAD79, n);`], { env: { ...process.env, FS_WXAHEAD79: '0' }, encoding: 'utf8' }).trim();
  assert.equal(out, 'false 0');
});
