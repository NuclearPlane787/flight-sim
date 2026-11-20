// v0.6.0 Part 5 steps 1-3 (briefs/V0-6-0.md, "Magnetic variation", "The sky's north", "The wind, true
// everywhere"): frame.js's magVar() with the region's model, the sky turned by the grid
// convergence, and the wind's true direction kept along the way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from '../vendor/three.module.js';
import { toMap, toGeo, magVar, magToGrid, convergence, convergenceAt, magModelInstalled } from '../src/world/frame.js';
import { setEastAsia } from '../src/world/region.js';
import { compileWeather, windAt, newWind, windTurnAt } from '../src/sim/weather.js';
import { createSky, azElToScene, skyNorthDeg } from '../src/world/sky.js';
import { sunHorizontal, moonHorizontal } from '../src/astro.js';
import { loadNodeRules, uninstallNodeRules, geoPart } from './v060-rules-helpers.mjs';

const DEG = Math.PI / 180, KT = 0.514444;
const plane = (la, lo) => -8.46 - 0.378 * (la - 36) + 0.082 * (lo - 127.5);   // v0.5.8's magVar, verbatim
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;
const PLACES = {
  gimpo: [37.5583, 126.7906], jeju: [33.5113, 126.493], gimhae: [35.1795, 128.9382],
  dokdo: [37.2414, 131.8644], baengnyeong: [37.9667, 124.6667], seoul: [37.5665, 126.978],
  haneda: [35.5523, 139.7798], narita: [35.7647, 140.3864], pudong: [31.1434, 121.8052],
  tsushima: [34.42, 129.33], pyongyang: [39.0392, 125.7625],
};
// Each test sets the flag and the model it needs, and puts v0.5.8 back after.
function withRules(on, fn) {
  setEastAsia(on);
  const g = loadNodeRules();
  try { return fn(g); } finally { uninstallNodeRules(); setEastAsia(false); }
}

test('the mask: its header, the saturated edge, and the margin keeps every inside cell at 0', () => {
  const k = geoPart('krmask');
  const h = k.header, q = new Uint8Array(k.values);
  assert.equal(q.length, h.nx * h.ny);
  assert.ok(h.marginM > h.cell * Math.SQRT2, 'the margin covers a bilinear tap\'s reach');
  assert.ok(Math.abs(h.marginM + h.bandM - 50000) <= 1000, 'the band ends about 50 km out');
  for (let i = 0; i < h.nx; i++) { assert.equal(q[i], 255); assert.equal(q[(h.ny - 1) * h.nx + i], 255); }
  for (let j = 0; j < h.ny; j++) { assert.equal(q[j * h.nx], 255); assert.equal(q[j * h.nx + h.nx - 1], 255); }
  assert.ok(h.zeroCells >= h.insideCells && h.insideCells > 70000, JSON.stringify(h));
  // The raster covers Korea's old square and Dokdo with 60 km to spare.
  assert.ok(h.x0 <= -460000 && h.y0 <= -460000 && h.x0 + h.nx * h.cell >= 460000 && h.y0 + h.ny * h.cell >= 460000);
});

test('magVar inside South Korea: the plane exactly, at the known places and across the mask\'s zero cells', () => {
  withRules(true, (g) => {
    assert.ok(magModelInstalled());
    for (const n of ['gimpo', 'jeju', 'gimhae', 'dokdo', 'baengnyeong', 'seoul']) {
      const [la, lo] = PLACES[n];
      assert.equal(g.krBlend(...toMap(la, lo)), 0, n);
      assert.equal(magVar(la, lo), plane(la, lo), n);
    }
    // Every cell whose 3x3 block is all 0 (inside the poly, or within a cell of it), 9 points in each.
    const { header: h, values } = geoPart('krmask');
    const q = new Uint8Array(values);
    let n = 0;
    for (let j = 1; j < h.ny - 1; j++) for (let i = 1; i < h.nx - 1; i++) {
      let z = true;
      for (let dj = -1; dj <= 1 && z; dj++) for (let di = -1; di <= 1; di++) if (q[(j + dj) * h.nx + i + di]) { z = false; break; }
      if (!z) continue;
      for (const fy of [0.01, 0.5, 0.99]) for (const fx of [0.01, 0.5, 0.99]) {
        const x = h.x0 + (i + fx) * h.cell, y = h.y0 + (j + fy) * h.cell;
        const [la, lo] = toGeo(x, y);
        if (magVar(la, lo) !== plane(la, lo)) assert.fail(`not the plane at cell ${i},${j}`);
        n++;
      }
    }
    assert.ok(n > 600000, `${n} points`);
  });
});

test('magVar beyond: WMM2025 at Haneda, Narita and Pudong; flag off (or no model) is the plane everywhere', () => {
  withRules(true, () => {
    assert.ok(Math.abs(magVar(...PLACES.haneda) - -7.85) < 0.05, String(magVar(...PLACES.haneda)));
    assert.ok(Math.abs(magVar(...PLACES.narita) - -7.82) < 0.05, String(magVar(...PLACES.narita)));
    assert.ok(Math.abs(magVar(...PLACES.pudong) - -6.56) < 0.05, String(magVar(...PLACES.pudong)));
    assert.ok(Math.abs(magVar(...PLACES.pyongyang) - -9.28) < 0.05);
    // The heading conversions read the same model (through map x, y, no toMap): 0.01° of magVar.
    const [x, y] = toMap(...PLACES.haneda);
    const viaConv = wrap180((magToGrid(0, x, y) + convergence(PLACES.haneda[1])) / DEG);
    assert.ok(Math.abs(viaConv - magVar(...PLACES.haneda)) < 1e-6, `${viaConv}`);
  });
  withRules(false, () => {
    for (const [la, lo] of Object.values(PLACES)) assert.equal(magVar(la, lo), plane(la, lo));
  });
  assert.ok(!magModelInstalled());
  setEastAsia(true);
  try { for (const [la, lo] of Object.values(PLACES)) assert.equal(magVar(la, lo), plane(la, lo)); }
  finally { setEastAsia(false); }
});

// A line from a to b, every 250 m: the weight never falls, magVar never jumps.
function along(g, a, b, n = 2000) {
  const [x0, y0] = toMap(...a), [x1, y1] = toMap(...b);
  const out = [];
  for (let k = 0; k <= n; k++) {
    const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
    const [la, lo] = toGeo(x, y);
    out.push({ w: g.krBlend(x, y), v: magVar(la, lo), d: Math.hypot(x - x0, y - y0) });
  }
  return out;
}
function checkBand(rows, label, maxStep) {
  let worst = 0;
  for (let k = 1; k < rows.length; k++) {
    assert.ok(rows[k].w >= rows[k - 1].w - 1e-12, `${label}: the weight falls at ${rows[k].d.toFixed(0)} m`);
    worst = Math.max(worst, Math.abs(rows[k].v - rows[k - 1].v));
  }
  assert.ok(worst < maxStep, `${label}: a step of ${worst}°`);
  return worst;
}

test('the band: continuous and monotone from Busan to Tsushima and on to Fukuoka, and across the DMZ', () => {
  withRules(true, (g) => {
    const sea = along(g, PLACES.gimhae, [33.59, 130.45]);
    const s1 = checkBand(sea, 'Busan-Fukuoka', 0.005);
    assert.equal(sea[0].w, 0);
    assert.equal(sea[sea.length - 1].w, 1);
    const ts = g.krBlend(...toMap(...PLACES.tsushima));
    assert.ok(ts > 0.1 && ts < 0.9, `Tsushima's weight ${ts}`);
    const dmz = along(g, PLACES.seoul, PLACES.pyongyang);
    const s2 = checkBand(dmz, 'Seoul-Pyongyang', 0.005);
    assert.equal(dmz[0].w, 0);
    assert.equal(dmz[dmz.length - 1].w, 1);
    assert.ok(Math.abs(dmz[dmz.length - 1].v - g.wmmVar(...toMap(...PLACES.pyongyang))) < 1e-12);
    // Where the band starts and ends on the way north (the poly's edge is about 50 km from Seoul).
    const first = dmz.find((r) => r.w > 0).d, full = dmz.find((r) => r.w === 1).d;
    assert.ok(full - first > 35000 && full - first < 55000, `${first} .. ${full}`);
    console.log(`band: Busan-Fukuoka worst step ${s1.toExponential(2)}°, Seoul-Pyongyang ${s2.toExponential(2)}°; north of Seoul it runs ${(first / 1000).toFixed(1)}-${(full / 1000).toFixed(1)} km`);
  });
});

test('magVar costs: flag off as v0.5.8, flag on small', () => {
  const time = (fn) => {
    for (let i = 0; i < 2e5; i++) fn(i);
    const t0 = performance.now(); let s = 0;
    for (let i = 0; i < 1e6; i++) s += fn(i);
    return [(performance.now() - t0), s];
  };
  const [off] = time((i) => magVar(37.56 + i * 1e-7, 126.79 + i * 1e-7));
  const on = withRules(true, () => time((i) => magVar(35.55 + i * 1e-7, 139.78 + i * 1e-7))[0]);
  console.log(`magVar, 1e6 calls: flag off ${off.toFixed(1)} ms, flag on (Haneda, moving) ${on.toFixed(1)} ms`);
  assert.ok(on < 1000, `${on} ms`);
});

test('the new airports\' runways: their magnetic headings from the grid, Gimhae\'s from the plane', () => {
  const man = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
  assert.equal(man.airportsRegion.length, 14);   // (eight until v0.6.1's Yancheng, nine until v0.6.3's five)
  withRules(true, () => {
    for (const f of man.airportsRegion) {
      const a = JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
      assert.ok(Math.abs(a.magVarDeg - magVar(a.lat, a.lon)) < 0.05, `${a.icao} magVarDeg ${a.magVarDeg} vs ${magVar(a.lat, a.lon)}`);
      if (a.icao === 'RKPK') assert.equal(magVar(a.lat, a.lon), plane(a.lat, a.lon));
      for (const r of a.runways) for (const e of r.ends) {
        const want = e.hdgTrueDeg - magVar(e.lat, e.lon);
        assert.ok(Math.abs(wrap180(e.hdgMagDeg - want)) < 0.2, `${a.icao} ${e.ident}: ${e.hdgMagDeg} vs ${want}`);
      }
    }
  });
});

// ---- the sky's north
const skyUniforms = () => ({ uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
  uSkyAmb: { value: new THREE.Color() }, uNight: { value: 0 } });
const MS = Date.UTC(2026, 10, 20, 5, 0);   // 14:00 JST
const MS_NIGHT = Date.UTC(2026, 10, 24, 14, 0);

test('the sky: the sun, the Moon and the stars turn by the convergence at the camera with the flag on', () => {
  const [la, lo] = PLACES.haneda;
  const s = sunHorizontal(MS, la, lo);
  const conv = convergence(lo) / DEG;
  assert.ok(Math.abs(conv - 7.13) < 0.01 && Math.abs(convergence(PLACES.gimpo[1]) / DEG - -0.41) < 0.01);
  // Flag off: v0.5.8's sky, the true azimuth on the map.
  setEastAsia(false);
  assert.equal(skyNorthDeg(lo), 0);
  let u = skyUniforms();
  createSky(new THREE.Scene(), u, { UNIFORMS_GLSL: '' }).setTime(MS, la, lo);
  assert.ok(u.uSunDir.value.angleTo(azElToScene(s.azDeg, s.altRefractedDeg)) < 1e-9);
  // Flag on: the true azimuth turned by the convergence.
  setEastAsia(true);
  try {
    assert.equal(skyNorthDeg(lo), conv);
    u = skyUniforms();
    const sky = createSky(new THREE.Scene(), u, { UNIFORMS_GLSL: '' });
    sky.setTime(MS, la, lo);
    const d = u.uSunDir.value;
    assert.ok(d.angleTo(azElToScene(s.azDeg - conv, s.altRefractedDeg)) < 1e-9);
    const gridAz = Math.atan2(d.x, -d.z) / DEG;
    assert.ok(Math.abs(wrap180(gridAz - (s.azDeg - conv))) < 1e-6, `${gridAz} vs ${s.azDeg - conv}`);
    assert.equal(sky.state.sunAzDeg, s.azDeg, 'the state keeps the true azimuth (the Sky window)');
    console.log(`Haneda 14:00 JST: the sun's true azimuth ${s.azDeg.toFixed(2)}°, on the map ${gridAz.toFixed(2)}° (convergence ${conv.toFixed(2)}°)`);
    // The stars and the Moon by night: Dubhe through the star matrix, and the Moon's direction.
    sky.setTime(MS_NIGHT, la, lo);
    const M = sky.mesh.material.uniforms.uStarMat.value;
    const ra = 165.93 * DEG, dec = 61.75 * DEG;
    const v = new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).applyMatrix3(M);
    const u2 = skyUniforms(), off = createSky(new THREE.Scene(), u2, { UNIFORMS_GLSL: '' });
    setEastAsia(false);
    off.setTime(MS_NIGHT, la, lo);
    const v0 = new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).applyMatrix3(off.mesh.material.uniforms.uStarMat.value);
    const turned = v0.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), conv * DEG);   // about up: clockwise az = −turn
    assert.ok(v.angleTo(turned) < 1e-9, `Dubhe off by ${v.angleTo(turned)}`);
    const m = moonHorizontal(MS_NIGHT, la, lo);
    assert.ok(u.uMoonDir.value.angleTo(azElToScene(m.azDeg - conv, m.altRefractedDeg)) < 1e-9, 'the Moon turned');
    assert.ok(u2.uMoonDir.value.angleTo(azElToScene(m.azDeg, m.altRefractedDeg)) < 1e-9, 'the Moon, flag off');
  } finally { setEastAsia(false); }
});

// ---- the wind
const haneda = toMap(...PLACES.haneda), gimpo = toMap(...PLACES.gimpo);
// trueWind: the tag v0.6.0's presets and Weather tab put on new weather (weather-presets.js).
const wx = (extra = {}) => ({ refX: haneda[0], refY: haneda[1], wind: { fromDeg: 270, kt: 10, gustKt: 0 }, aloft: { fromDeg: 280, kt: 40 }, trueWind: true, ...extra });
const trueFrom = (W, x, y) => { const lo = toGeo(x, y)[1]; return ((Math.atan2(-W.meanE, -W.meanN) + convergence(lo)) / DEG + 360) % 360; };
function windHere(C, x, y, agl = 5) { return windAt(C, x, y, agl, agl, 0, 0, 0, 0, newWind()); }

test('the wind at the arrival: v0.5.8\'s arithmetic to the bit, flag on or off', () => {
  for (const on of [false, true]) withRules(on, () => {
    const C = compileWeather(wx());
    // v0.5.8's compileWeather: vec(from, kt) = magToGrid at (refX, refY), "from" to "going".
    const a = magToGrid(270 * DEG, haneda[0], haneda[1]), v = 10 * KT;
    assert.equal(C.sfN, -v * Math.cos(a));
    assert.equal(C.sfE, -v * Math.sin(a));
    assert.equal(windTurnAt(C, haneda[0], haneda[1]), 0);
    const W = windHere(C, haneda[0], haneda[1], 10);
    assert.equal(W.meanN, C.sfN); assert.equal(W.meanE, C.sfE);
    // Gusts, shear, turbulence and a burst: the same doubles at the reference with the flag on as off.
    const C2 = compileWeather(wx({ wind: { fromDeg: 270, kt: 10, gustKt: 25 }, turbulence: 'moderate', shear: { ftAgl: 500, fromDeg: 90, kt: 20 }, microbursts: [{ x: haneda[0] + 2000, y: haneda[1], radiusM: 1000, dvKt: 30 }] }));
    const W1 = windAt(C2, haneda[0], haneda[1], 300, 300, 12.5, 0.6, 0.8, 35, newWind());
    setEastAsia(!on);
    const W2 = windAt(C2, haneda[0], haneda[1], 300, 300, 12.5, 0.6, 0.8, 35, newWind());
    setEastAsia(on);
    assert.deepEqual(W1, W2);
  });
});

test('the wind at the departure: Gimpo keeps the true direction set at Haneda (v0.5.8 was 7.5° off)', () => {
  const at = (on) => withRules(on, () => {
    const C = compileWeather(wx());
    const H = windHere(C, haneda[0], haneda[1]), G = windHere(C, gimpo[0], gimpo[1]);
    return { h: trueFrom(H, ...haneda), g: trueFrom(G, ...gimpo), sh: Math.hypot(H.meanN, H.meanE), sg: Math.hypot(G.meanN, G.meanE) };
  });
  const on = at(true), off = at(false);
  assert.ok(Math.abs(wrap180(on.g - on.h)) < 0.01, `${on.g} vs ${on.h}`);
  assert.ok(Math.abs(on.sg - on.sh) < 1e-12);
  assert.ok(Math.abs(wrap180(off.g - off.h)) > 6, `v0.5.8: ${off.g} vs ${off.h}`);
  // The tower's magnetic reading at Gimpo: the true wind less Gimpo's variation (the plane there).
  const magG = (on.g - plane(...PLACES.gimpo) + 360) % 360;
  console.log(`wind set 270°M at Haneda: true ${on.h.toFixed(3)}° there; at Gimpo true ${on.g.toFixed(3)}° (${magG.toFixed(1)}°M), v0.5.8 ${off.g.toFixed(3)}°`);
  // Calm stays calm: nothing to turn.
  withRules(true, () => {
    const C = compileWeather(null);
    assert.equal(C.windOn, false);
    const W = windHere(C, gimpo[0], gimpo[1]);
    assert.ok(W.n === 0 && W.e === 0 && W.d === 0);
  });
});

test('convergenceAt(x, y) is convergence(toGeo(x, y)[1]) to roundoff', () => {
  for (const [la, lo] of Object.values(PLACES)) {
    const [x, y] = toMap(la, lo);
    assert.ok(Math.abs(convergenceAt(x, y) - convergence(lo)) < 1e-12);
  }
});

// The reviewer's finding (19 Nov): a v0.5.8 save's weather has no `trueWind` tag, and its wind
// keeps its grid direction everywhere, so the save flies as it did; new weather is tagged.
test('the wind: v0.5.8\'s settings (no tag) never turn; new presets and the Weather tab\'s settings are tagged', async () => {
  const { presetWeather, weatherFromForm, weatherForm } = await import('../src/sim/weather-presets.js');
  const { normalizeWeather, isDefaultWeather } = await import('../src/sim/weather.js');
  withRules(true, () => {
    const old = compileWeather(wx({ trueWind: undefined }));
    assert.equal(windTurnAt(old, gimpo[0], gimpo[1]), 0, 'an old save\'s wind does not turn');
    const W = windHere(old, gimpo[0], gimpo[1], 10);
    assert.equal(W.meanN, old.sfN); assert.equal(W.meanE, old.sfE);
    assert.notEqual(windTurnAt(compileWeather(wx()), gimpo[0], gimpo[1]), 0, 'new weather turns away from its reference');
    const ctx = { refX: haneda[0], refY: haneda[1], seed: 7 };
    const p = presetWeather('gusty-crosswind', ctx);
    assert.equal(p.trueWind, true);
    assert.equal(normalizeWeather(JSON.parse(JSON.stringify(p))).trueWind, true, 'a new save keeps the tag');
    assert.equal(weatherFromForm(weatherForm(normalizeWeather(wx({ trueWind: undefined })), ctx), null, ctx).trueWind, true, 'set again in the Weather tab: new weather');
    assert.equal('trueWind' in normalizeWeather(wx({ trueWind: undefined })), false);
    assert.equal(isDefaultWeather({ trueWind: true }), true, 'the tag alone is no weather');
  });
  withRules(false, () => {
    const p = presetWeather('gusty-crosswind', { refX: 0, refY: 0, seed: 7 });
    assert.equal('trueWind' in p, false, 'with the region off the settings are v0.5.8\'s, key for key');
  });
});
