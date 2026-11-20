// v0.6.0, Part 5 steps 5-7: the altimeter's local rules (briefs/V0-6-0.md). Inches of mercury in Japan (the BARO's unit, the
// typed and turned settings, 29.92 as standard, Shift+B in the local unit), the transition by place (14,000 ft /
// FL140 in Korea and Japan, 3,000 m / 3,600 m in China), the METAR's three forms, China's metres on the PFDs, and
// with the region's flag off, v0.5.8's strings and numbers.
//   node --test tests/v060-rules-baro.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// The screens' modules want a little DOM (as tests/weather-screens.test.mjs gives them).
function makeEl() {
  const e = {
    children: [], dataset: {}, style: {}, title: '', className: '', textContent: '', innerHTML: '', l: {}, q: {},
    classList: { toggle() {}, add() {} },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; },
    querySelector(s) { return (this.q[s] ??= makeEl()); },
    addEventListener(t, f) { (this.l[t] ??= []).push(f); },
    contains() { return false; },
    scrollWidth: 0,
  };
  return e;
}
const keyListeners = [];
globalThis.document = { createElement: makeEl };
globalThis.window = { addEventListener(t, f) { if (t === 'keydown') keyListeners.push(f); } };

const { setEastAsia, setGeoRules, rulesAt, countryAt } = await import('../src/world/region.js');
const { createGeoRules } = await import('../src/world/geo-rules.js');
const { inHgToHpa, hpaToInHg, STD_INHG_HPA, HPA_PER_INHG } = await import('../src/sim/atmosphere.js');
const { createSim } = await import('../src/sim/sim.js');
const { calmWeather, normalizeWeather } = await import('../src/sim/weather.js');
const { metarOf, metarFormOf } = await import('../src/sim/weather-presets.js');
const { typedBaro, baroText, baroValueText, createFcu, metricAltOn, toggleMetricAlt, inchesOf } = await import('../src/ui/fcu.js');
const { createMcp } = await import('../src/ui/boeing/mcp.js');
const { createPfd, baroLabel, transLevelFt, metricAlt } = await import('../src/ui/pfd.js');
const { createBoeingPfd } = await import('../src/ui/boeing/pfd.js');
const { airborne, run, KT, FT } = await import('./sim-helpers.mjs');

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const part = (name) => {
  const header = JSON.parse(readFileSync(DATA + name + '.json', 'utf8'));
  const buf = gunzipSync(readFileSync(DATA + header.file));
  return { header, values: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
setGeoRules(createGeoRules({ magvar: part('magvar'), country: part('country') }));
const originOf = (icao) => JSON.parse(readFileSync(DATA + `airports/${icao}.json`, 'utf8')).origin;
const [HND, PVG, GMP] = ['RJTT', 'ZSPD', 'RKSS'].map(originOf);
const viaJson = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
const wx = (o) => ({ ...calmWeather(), preset: 'custom', ...o });
const flag = (on, fn) => { setEastAsia(on); try { return fn(); } finally { setEastAsia(false); } };

// A sim in the air at (x, y), at altitude zM (true; in calm air with the baro standard, the reading).
function aloft([x, y], zM, { hdg = 0 } = {}) {
  const sim = createSim({});
  sim.reset({ x, y, hdg, onGround: false, z: zM, iasMs: 250 * KT, flapLever: 0, gearDown: false, payloadKg: 15000, fuelKg: 9000 });
  return sim;
}
// One step (with a vertical speed set first: twice, so the state's V/S has it, as tests/weather.test.mjs does).
const tick = (s, vd) => {
  if (vd !== undefined) { s._core.vd = vd; s.step(1 / 120); s._core.vd = vd; }
  s.step(1 / 120); s.events.length = 0;
};

test('the places: Haneda is Japan, Pudong China, Gimpo Korea, and with the flag off everywhere is Korea', () => {
  flag(true, () => {
    assert.equal(countryAt(...HND), 'JP');
    assert.equal(countryAt(...PVG), 'CN');
    assert.equal(countryAt(...GMP), 'KR');
    assert.equal(rulesAt(...HND).baroUnit, 'inHg');
    assert.equal(rulesAt(...PVG).transAltM, 3000);
    assert.equal(rulesAt(...PVG).transLevelM, 3600);
  });
  assert.equal(countryAt(...HND), 'KR');
  assert.equal(rulesAt(...PVG).transAltM, 14000 * 0.3048, 'the very double v0.5.8 used');
});

test('inches of mercury: the conversions, and 29.92 is 1013.21 hPa', () => {
  assert.equal(HPA_PER_INHG, 33.86389);
  assert.equal(inHgToHpa(29.92).toFixed(2), '1013.21');
  assert.equal(STD_INHG_HPA, inHgToHpa(29.92));
  assert.equal(inchesOf(1013.25), 29.92);
  assert.equal(inchesOf(1014.9), 29.97);
  assert.equal(inchesOf(inHgToHpa(30.12)), 30.12);
  near(hpaToInHg(inHgToHpa(28.5)), 28.5, 1e-12, 'round trip');
  assert.equal(baroText({ hpa: STD_INHG_HPA, std: false, inHg: true }), '29.92');
  assert.equal(baroText({ hpa: 1013.25, std: true, inHg: true }), 'STD');
  assert.equal(baroValueText({ hpa: 1001.6, std: false }), '1002');
});

test('typing a setting in inches: 29.92 or 2992 sets exactly STD_INHG_HPA; hPa typing is unchanged', () => {
  assert.equal(typedBaro('29.92', true), STD_INHG_HPA);
  assert.equal(typedBaro('2992', true), STD_INHG_HPA);
  assert.equal(typedBaro('30.1', true), inHgToHpa(30.1));
  assert.equal(typedBaro('3012', true), inHgToHpa(30.12));
  assert.equal(typedBaro('12', true), null, 'out of range');
  assert.equal(typedBaro('', true), null);
  // v0.5.8's, unchanged:
  assert.equal(typedBaro('1005'), 1005);
  assert.equal(typedBaro('2992'), null);
  assert.equal(typedBaro('12'), null);
});

// The FCU and the MCP, on a fake DOM with a fake sim (as tests/weather-screens.test.mjs drives them).
function strip(create, baro) {
  const calls = [], hud = { poke() {} }, sim = {
    baro,
    setBaro(h) { calls.push(['setBaro', h]); this.baro = { ...this.baro, hpa: h, std: false }; },
    setBaroStd(on) { calls.push(['std', on]); this.baro = { ...this.baro, std: !!on }; },
    setBaroUnit(inHg) { calls.push(['unit', inHg]); this.baro = inHg ? { ...this.baro, inHg: true } : { hpa: this.baro.hpa, std: this.baro.std }; },
  };
  const panel = create(makeEl(), hud), view = { state: { pos: { x: HND[0], y: HND[1], z: 0 }, vs: 0 }, ap: {}, sim };
  panel.update(view);
  const win = { dataset: { k: 'baro' } };
  const ev = (deltaY) => ({ target: { closest: (q) => (q === '.fsui-win' ? win : null) }, preventDefault() {}, stopPropagation() {}, deltaMode: 1, deltaX: 0, deltaY });
  const button = (k) => ({ target: { closest: (q) => (q === '.fsui-btn' ? { dataset: { k } } : null) }, stopPropagation() {} });
  const key = (k) => keyListeners.forEach((f) => f({ key: k, shiftKey: false, preventDefault() {}, stopImmediatePropagation() {} }));
  const kinds = panel.el.children.map((c) => c.dataset.k);
  return { calls, panel, sim, view, kinds, wheel: (d = 1) => panel.el.l.wheel[0](ev(d)), click: () => panel.el.l.click[0](ev(1)), btn: (k) => panel.el.l.click[0](button(k)), key };
}

for (const [name, create, metricK] of [['FCU', createFcu, 'metric'], ['MCP', createMcp, 'mtrs']]) {
  test(`${name}: the unit's button, turning in 0.01 inHg, typing 29.92, and METRIC ALT / MTRS (flag on)`, () => flag(true, () => {
    const s = strip(create, { hpa: 1013.25, std: false });
    assert.ok(s.kinds.includes('unit') && s.kinds.includes(metricK), s.kinds.join(','));
    s.btn('unit');
    assert.deepEqual(s.calls.at(-1), ['unit', true]);
    s.panel.update(s.view);
    s.wheel(1);   // 29.92 (from 1013.25) + 0.01
    assert.deepEqual(s.calls.at(-1), ['setBaro', inHgToHpa(29.93)]);
    s.wheel(-1); s.wheel(-1);
    assert.deepEqual(s.calls.at(-1), ['setBaro', inHgToHpa(29.91)]);
    s.click(); s.panel.update(s.view);
    for (const k of '29.92') s.key(k);
    s.key('Enter');
    assert.deepEqual(s.calls.at(-1), ['setBaro', STD_INHG_HPA]);
    s.click();
    for (const k of '3005') s.key(k);
    s.key('Enter');
    assert.deepEqual(s.calls.at(-1), ['setBaro', inHgToHpa(30.05)]);
    s.btn('unit');
    assert.deepEqual(s.calls.at(-1), ['unit', false]);
    s.panel.update(s.view);
    s.wheel(1);
    assert.deepEqual(s.calls.at(-1), ['setBaro', 1019], 'back in hPa: 30.05 inHg is 1017.6, so 1018 + 1');
    // METRIC ALT / MTRS: off by itself in Japan, the click turns it on.
    assert.equal(metricAltOn(s.view), false);
    s.btn(metricK);
    assert.equal(metricAltOn(s.view), true);
    s.btn(metricK);
    assert.equal(metricAltOn(s.view), false);
    keyListeners.length = 0;
  }));

  test(`${name}: with the flag off, no new buttons and v0.5.8's steps`, () => {
    const s = strip(create, { hpa: 1013.25, std: false });
    assert.ok(!s.kinds.includes('unit') && !s.kinds.includes(metricK), s.kinds.join(','));
    s.wheel(1);
    assert.deepEqual(s.calls.at(-1), ['setBaro', 1014]);
    s.click(); s.panel.update(s.view);
    for (const k of '29.92') s.key(k);   // the point closes the window, as in v0.5.8 (not a key the window takes)
    assert.deepEqual(s.calls.at(-1), ['setBaro', 1014]);
    keyListeners.length = 0;
  });
}

test('the sim: the unit is the pilot\'s, Shift+B sets the local QNH in the local unit', () => flag(true, () => {
  const sim = aloft(HND, 600);
  sim.setWeather(wx({ qnh: 1014.9 }));
  assert.deepEqual(sim.baro, { hpa: 1013.25, std: false });
  sim.setLocalQnh();
  assert.deepEqual(sim.baro, { hpa: 1014.9, std: false, inHg: true }, 'Japan: inches');
  assert.equal(baroText(sim.baro), '29.97');
  sim.setBaroUnit(false);
  assert.deepEqual(sim.baro, { hpa: 1014.9, std: false });
  const k = aloft(GMP, 600);
  k.setWeather(wx({ qnh: 1014.9 }));
  k.setBaroUnit(true); k.setLocalQnh();
  assert.deepEqual(k.baro, { hpa: 1014.9, std: false }, 'Korea: hPa');
  const c = aloft(PVG, 600);
  c.setLocalQnh();
  assert.equal(c.baro.inHg, undefined, 'China: hPa');
}));

test('the alert at 14,000 ft in Japan, with 29.92 in inches counting as standard', () => flag(true, () => {
  const up = aloft(HND, 14500 * FT);
  up.setBaroUnit(true);
  up.setBaro(inHgToHpa(30.12));
  for (let i = 0; i < 30; i++) tick(up);
  assert.equal(up.state.baroAlert, true, 'QNH set above 14,000 ft');
  up.setBaro(STD_INHG_HPA); tick(up);
  assert.equal(up.state.baroAlert, false, '29.92 in inches is the standard setting');
  up.setBaro(inHgToHpa(29.93)); tick(up);
  assert.equal(up.state.baroAlert, true, '29.93 is not');
  up.setBaro(1013.25); tick(up);
  assert.equal(up.state.baroAlert, false, '1013.25 still is');
  const low = aloft(HND, 13500 * FT);
  low.setBaro(1020); tick(low);
  assert.equal(low.state.baroAlert, false, 'below the transition altitude');
  low.setBaroStd(true); tick(low, 8);
  assert.equal(low.state.baroAlert, true, 'STD descending below FL140');
}));

test('the alert at 3,000 m climbing and 3,600 m descending in China (Korea: 14,000 ft both)', () => flag(true, () => {
  const at = (place, zM) => { const s = aloft(place, zM); s.setWeather(wx({ qnh: 1020 })); s.setLocalQnh(); tick(s); return s; };
  // QNH set: the reading is the altitude. Above 3,000 m in China, climbing or level: the reminder.
  const c1 = at(PVG, 3150); tick(c1, -8);
  assert.ok(c1.state.altInd > 3000 && c1.state.altInd < 3600, String(c1.state.altInd));
  assert.equal(c1.state.baroAlert, true, 'China: QNH above 3,000 m, climbing');
  const c0 = at(PVG, 2850); tick(c0, -8);
  assert.ok(c0.state.altInd < 3000);
  assert.equal(c0.state.baroAlert, false, 'China: below 3,000 m on QNH');
  const k1 = at(GMP, 3150); tick(k1, -8);
  assert.equal(k1.state.baroAlert, false, 'Korea: 3,150 m on QNH is below 14,000 ft');
  // STD set descending: below 3,600 m (the level) in China; above it nothing.
  const d1 = at(PVG, 3500); d1.setBaroStd(true); tick(d1, 8);
  assert.ok(d1.state.altInd < 3600);
  assert.equal(d1.state.baroAlert, true, 'China: STD descending below 3,600 m');
  const d0 = at(PVG, 3800); d0.setBaroStd(true); tick(d0, 8);
  assert.ok(d0.state.altInd > 3600);
  assert.equal(d0.state.baroAlert, false, 'China: STD above 3,600 m');
  const kd = at(GMP, 3800); kd.setBaroStd(true); tick(kd, 8);
  assert.equal(kd.state.baroAlert, true, 'Korea: STD descending below FL140');
}));

test('the flag off: Haneda and Pudong are Korea (the alert at 14,000 ft, hPa, no metres), as v0.5.8', () => {
  const p = aloft(PVG, 3150);
  p.setWeather(wx({ qnh: 1020 })); p.setLocalQnh(); tick(p, -8);
  assert.equal(p.state.baroAlert, false);
  assert.deepEqual(p.baro, { hpa: 1020, std: false });
  const h = aloft(HND, 14500 * FT);
  h.setWeather(wx({ qnh: 1014.9 })); h.setLocalQnh(); tick(h);
  assert.deepEqual(h.baro, { hpa: 1014.9, std: false }, 'no inches with the flag off');
  assert.equal(h.state.baroAlert, true);
  const view = { state: p.state, ap: { altFt: 10000 }, sim: p };
  assert.equal(metricAltOn(view), false);
  toggleMetricAlt(view);
  assert.equal(metricAltOn(view), false, 'the toggle does nothing with the flag off');
  assert.equal(transLevelFt(p.state), 14000);
  assert.equal(baroText(h.baro), '1015');
});

test('the METAR line: Korea as now, Japan Q1014 ... RMK A2997, China\'s wind in MPS; flag off as v0.5.8', () => {
  const rain = normalizeWeather(wx({ wind: { fromDeg: 250, kt: 15, gustKt: 25 }, visM: 4000, tempC: 12, qnh: 1008,
    precip: { kind: 'rain', rate: 0.2 }, clouds: [{ okta: 6, baseFt: 1200, topFt: 3000 }, { okta: 8, baseFt: 3000, topFt: 8000 }] }));
  const jp = normalizeWeather(wx({ wind: { fromDeg: 220, kt: 8 }, qnh: 1014.9, tempC: 20 }));
  const kr0 = metarOf(rain, 'RKPC'), cal0 = metarOf(calmWeather(), 'RKSI'), jp0 = metarOf(jp, 'RJTT'), cn0 = metarOf(jp, 'ZSPD');
  assert.equal(kr0, 'RKPC 25015G25KT 4000 -RA BKN012 OVC030 12/10 Q1008');
  assert.equal(cal0, 'RKSI 00000KT CAVOK 15/07 Q1013');
  assert.equal(jp0, 'RJTT 22008KT CAVOK 20/12 Q1014', 'flag off: Korea\'s form everywhere');
  assert.equal(cn0, 'ZSPD 22008KT CAVOK 20/12 Q1014');
  flag(true, () => {
    assert.equal(metarOf(rain, 'RKPC'), kr0);
    assert.equal(metarOf(calmWeather(), 'RKSI'), cal0);
    assert.equal(metarOf(jp, 'RJTT'), 'RJTT 22008KT CAVOK 20/12 Q1014 RMK A2997');
    assert.equal(metarOf(calmWeather(), 'RJAA'), 'RJAA 00000KT CAVOK 15/07 Q1013 RMK A2992');
    assert.equal(metarOf(jp, 'ZSPD'), 'ZSPD 22004MPS CAVOK 20/12 Q1014');
    assert.equal(metarOf(rain, 'ZSSS'), 'ZSSS 25008G13MPS 4000 -RA BKN012 OVC030 12/10 Q1008');
    assert.equal(metarOf(calmWeather(), 'ZSQD'), 'ZSQD 00000MPS CAVOK 15/07 Q1013');
    assert.equal(metarFormOf('', { arrival: { x: HND[0], y: HND[1] } }), 'jp', 'no code: the arrival\'s country');
    assert.equal(metarFormOf('RKPK'), 'kr');
  });
});

test('the PFDs: inches as 29.92 (Airbus QNH 29.92, Boeing 29.92 IN), metres in China, FL by China\'s level', () => flag(true, () => {
  const draw = (make, view) => {
    const calls = { text: [] };
    const ctx = new Proxy({ fillText: (t) => calls.text.push(String(t)), measureText: (t) => ({ width: String(t).length * 10 }), createLinearGradient: () => ({ addColorStop() {} }) },
      { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    make({ ctx, w: 1000, h: 1000, begin() {} }).draw(view, 0);
    return calls.text;
  };
  const hnd = aloft(HND, 900);
  hnd.setWeather(wx({ qnh: 1014.9 })); hnd.setLocalQnh(); tick(hnd);
  const vh = { state: hnd.state, ap: { altFt: 9000 }, sim: hnd };
  const a = draw(createPfd, vh), b = draw(createBoeingPfd, vh);
  assert.ok(a.includes('QNH ') && a.includes('29.97'), a.join('|'));
  assert.ok(b.includes('29.97 IN'), b.join('|'));
  assert.ok(!a.includes('M') && !b.some((t) => / M$/.test(t)), 'no metres in Japan');
  const pvg = aloft(PVG, 3000);
  pvg.setLocalQnh(); tick(pvg);
  const vp = { state: pvg.state, ap: { altFt: 9800 }, sim: pvg };
  const m = metricAlt(vp);
  assert.deepEqual(m, { m: Math.round(pvg.state.altInd), selM: 2987 });
  const a2 = draw(createPfd, vp), b2 = draw(createBoeingPfd, vp);
  assert.ok(a2.includes(String(m.m)) && a2.includes('M') && a2.includes('2987 M'), a2.join('|'));
  assert.ok(b2.includes(`${m.m} M`) && b2.includes('2987 M'), b2.join('|'));
  assert.ok(a2.includes('QNH ') && a2.includes('1013'), 'hPa in China');
  assert.equal(transLevelFt(pvg.state), 11811);
  assert.equal(transLevelFt(hnd.state), 14000);
  // Airbus's selected altitude off the tape reads as a level above China's transition level.
  const vq = { state: pvg.state, ap: { altFt: 12000 }, sim: pvg };
  assert.ok(draw(createPfd, vq).includes('FL120'));
  // The pilot's choice holds until the country changes.
  toggleMetricAlt(vp);
  assert.equal(metricAlt(vp), null);
  assert.equal(metricAlt(vp), null, 'still off in China');
  assert.equal(metricAlt(vh), null, 'Japan: its own default');
  assert.notEqual(metricAlt(vp), null, 'back in China: on by itself again');
}));

test('the flag off: the PFDs draw v0.5.8\'s text at Pudong (no metres, 1013 HPA, FL from 14,000 ft)', () => {
  const draw = (make, view) => {
    const calls = { text: [] };
    const ctx = new Proxy({ fillText: (t) => calls.text.push(String(t)), measureText: (t) => ({ width: String(t).length * 10 }), createLinearGradient: () => ({ addColorStop() {} }) },
      { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    make({ ctx, w: 1000, h: 1000, begin() {} }).draw(view, 0);
    return calls.text;
  };
  const pvg = aloft(PVG, 3000); tick(pvg);
  const vq = { state: pvg.state, ap: { altFt: 12000 }, sim: pvg };
  const a = draw(createPfd, vq), b = draw(createBoeingPfd, vq);
  assert.ok(!a.includes('M') && !a.some((t) => / M$/.test(t)) && !b.some((t) => / M$/.test(t)));
  assert.ok(a.includes('12000'), 'not a flight level below 14,000 ft');
  assert.ok(b.includes('1013 HPA'));
  assert.deepEqual(baroLabel(vq), { std: false, hpa: 1013 });
});

test('a snapshot round trip with the unit set: restores IN and flies on exactly; a save without it is hPa', () => flag(true, () => {
  const a = aloft(HND, 3000);
  a.ap.setAlt?.(12000); a.ap.engageAp?.();
  a.setWeather(wx({ qnh: 1009.3, wind: { fromDeg: 200, kt: 12 } }));
  a.setLocalQnh();
  run(a, 5);
  const snap = viaJson(a.snapshot());
  assert.equal(snap.core.baroIn, true);
  const b = createSim({});
  b.restore(snap);
  assert.deepEqual(b.baro, a.baro);
  // A v0.5.8 save has no unit: hPa, and it flies the same (the unit is a display choice only).
  const old = viaJson(snap); delete old.core.baroIn;
  const c = createSim({});
  c.restore(old);
  assert.deepEqual(c.baro, { hpa: a.baro.hpa, std: false });
  run(a, 120); run(b, 120); run(c, 120);
  for (const k of ['x', 'y', 'z']) {
    near(b.state.pos[k], a.state.pos[k], 1e-6, `restored ${k}`);
    assert.equal(c.state.pos[k], b.state.pos[k], `the unit doesn't change the flight (${k})`);
  }
  assert.equal(b.state.altInd, c.state.altInd);
}));
