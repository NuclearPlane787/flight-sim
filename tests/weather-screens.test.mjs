// v0.4.0: the cockpit screens' wind, track and altimeter setting, on a recording canvas and a fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

const elements = [];
function makeEl() {
  const e = {
    children: [], dataset: {}, style: {}, title: '', className: '', textContent: '', innerHTML: '', l: {}, q: {},
    classList: { toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(s) { return (this.q[s] ??= makeEl()); },
    addEventListener(t, f) { (this.l[t] ??= []).push(f); },
    contains() { return false; },
    scrollWidth: 0,
  };
  elements.push(e);
  return e;
}
const keyListeners = [];
globalThis.document = { createElement: makeEl };
globalThis.window = { addEventListener(t, f) { if (t === 'keydown') keyListeners.push(f); } };

const { windReadout, airbusWindText, airbusWindArrow, createNd } = await import('../src/ui/nd.js');
const { boeingWindText, boeingWindArrow, createBoeingNd } = await import('../src/ui/boeing/nd.js');
const { createPfd, shownAltFt, shownGroundFt, baroLabel } = await import('../src/ui/pfd.js');
const { createBoeingPfd } = await import('../src/ui/boeing/pfd.js');
const { createFcu, typedBaro, baroText } = await import('../src/ui/fcu.js');
const { createMcp } = await import('../src/ui/boeing/mcp.js');
const { gridToMag } = await import('../src/world/frame.js');
const { magDeg, angDiff, DEG, KT, FT } = await import('../src/ui/common.js');

function fakeCv(s = 1000) {
  const calls = { text: [], translate: [], line: [] };
  const ctx = new Proxy({
    fillText: (t) => calls.text.push(String(t)),
    translate: (x, y) => calls.translate.push([x, y]),
    lineTo: (x, y) => calls.line.push([x, y]),
    measureText: (t) => ({ width: String(t).length * 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  return { ctx, w: s, h: s, begin() {}, calls };
}
const fakeState = (over) => new Proxy({
  pos: { x: 10000, y: 20000, z: 1000 }, vel: { x: 0, y: 100, z: 0 }, hdg: 0, gs: 100, tas: 130, ias: 130,
  wind: { x: 0, y: 0, z: 0, meanX: 0, meanY: 0 }, warnings: {}, modes: {}, altInd: 1000, groundH: 10, ...over,
}, { get: (t, k) => (k in t ? t[k] : 0) });

test('the readout uses the mean wind, FROM, in degrees magnetic and knots', () => {
  const r = windReadout({ x: 30, y: -20, meanX: 10, meanY: 0 }, 0, 0);
  const want = ((Math.round(gridToMag(Math.atan2(-10, 0), 0, 0) / DEG) % 360) + 360) % 360;
  assert.equal(r.kt, Math.round(10 * KT));
  assert.equal(r.dirDeg, want);
});

test('each maker: text and arrow thresholds', () => {
  const w = (kt, d) => ({ kt, dirDeg: d });
  assert.equal(airbusWindText(w(25, 270), 90), '---/---');
  assert.equal(airbusWindText(w(25, 7), 200), '007/25');
  assert.equal(airbusWindText(w(0, 0), 200), '000/0');
  assert.equal(airbusWindArrow(w(1, 7), 200), false);
  assert.equal(airbusWindArrow(w(3, 7), 200), true);
  assert.equal(boeingWindText(w(0, 0), 200), '');
  assert.equal(boeingWindText(w(25, 7), 90), '');
  assert.equal(boeingWindText(w(25, 7), 200), '007°/ 25');
  assert.equal(boeingWindArrow(w(5, 7), 200), false);
  assert.equal(boeingWindArrow(w(6, 7), 200), true);
});

test('the NDs print the wind and put the track off the heading by the drift', () => {
  // Heading north, drifting right: ground velocity is east of north.
  const vel = { x: 15, y: 100, z: 0 };
  const st = fakeState({ vel, wind: { x: 20, y: 0, z: 0, meanX: 20, meanY: 0 } });
  const view = { state: st, waypoints: [] };
  const a = fakeCv(), nd = createNd(a, { airports: [], coast: null }); nd.draw(view);
  const expText = airbusWindText(windReadout(st.wind, st.pos.x, st.pos.y), st.tas * KT);
  assert.ok(a.calls.text.includes(expText), a.calls.text.join('|'));
  const hm = magDeg(0, st.pos.x, st.pos.y), trk = magDeg(Math.atan2(vel.x, vel.y), st.pos.x, st.pos.y), dA = angDiff(trk, hm) * DEG;
  const R = 600, cx = 500;
  assert.ok(a.calls.translate.some(([x]) => Math.abs(x - (cx + Math.sin(dA) * (R - 12))) < 1), 'A321 diamond off the heading');

  const b = fakeCv(), bnd = createBoeingNd(b, { airports: [], coast: null }); bnd.draw(view);
  assert.ok(b.calls.text.includes(boeingWindText(windReadout(st.wind, st.pos.x, st.pos.y), st.tas * KT)));
  assert.ok(b.calls.line.some(([x]) => Math.abs(x - (500 + Math.sin(dA) * 700)) < 1), 'Boeing track line off the heading');
});

test('PFD altitude comes from the altimeter, and the setting prints each maker\'s way', () => {
  const st = fakeState({ altInd: 5000 / FT, pos: { x: 0, y: 0, z: 1000 } });
  assert.ok(Math.abs(shownAltFt(st) - 5000) < 1e-6);
  // 1000 m true over ground at 10 m: 990 m below the 5,000 ft reading.
  assert.ok(Math.abs(shownGroundFt(st) - (5000 - 990 * FT)) < 1e-6);
  assert.deepEqual(baroLabel({ sim: { baro: { hpa: 998.2, std: false } } }), { std: false, hpa: 998 });
  assert.equal(baroLabel({}).hpa, 1013);

  const run = (make, baro) => { const cv = fakeCv(); make(cv).draw({ state: st, sim: { baro }, ap: {} }, 0); return cv.calls.text; };
  const ab = run(createPfd, { hpa: 998, std: false });
  assert.ok(ab.includes('QNH ') && ab.includes('998'), ab.join('|'));
  assert.ok(ab.includes('50'), 'hundreds of the indicated 5,000 ft');
  assert.ok(run(createPfd, { hpa: 998, std: true }).includes('STD'));
  assert.ok(run(createBoeingPfd, { hpa: 1020, std: false }).includes('1020 HPA'));
  assert.ok(run(createBoeingPfd, { hpa: 1020, std: true }).includes('STD'));
});

test('typing a setting', () => {
  assert.equal(typedBaro('1005'), 1005);
  assert.equal(typedBaro('992'), 992);
  assert.equal(typedBaro('12'), null);
  assert.equal(typedBaro('2992'), null);
  assert.equal(typedBaro(''), null);
  assert.equal(baroText({ hpa: 1013.25, std: false }), '1013');
  assert.equal(baroText({ hpa: 1013.25, std: true }), 'STD');
});

function strip(create) {
  const calls = [], hud = { poke() {} }, sim = {
    baro: { hpa: 1013.25, std: false },
    setBaro(h) { calls.push(['setBaro', h]); this.baro = { hpa: h, std: false }; },
    setBaroStd(on) { calls.push(['std', on]); this.baro = { ...this.baro, std: !!on }; },
  };
  const panel = create(makeEl(), hud), view = { state: { pos: { z: 0 }, vs: 0 }, ap: {}, sim };
  panel.update(view);
  const win = { dataset: { k: 'baro' } }, ev = {
    target: { closest: (q) => (q === '.fsui-win' ? win : null) }, preventDefault() {}, stopPropagation() {}, deltaMode: 1, deltaX: 0, deltaY: 1,
  };
  const btn = { dataset: { k: 'std' } }, btnEv = { target: { closest: (q) => (q === '.fsui-btn' ? btn : null) }, stopPropagation() {} };
  const key = (k) => keyListeners.forEach((f) => f({ key: k, shiftKey: false, preventDefault() {}, stopImmediatePropagation() {} }));
  return { calls, panel, sim, view, wheel: () => panel.el.l.wheel[0](ev), click: () => panel.el.l.click[0](ev), std: () => panel.el.l.click[0](btnEv), key };
}

for (const [name, create] of [['FCU', createFcu], ['MCP', createMcp]]) {
  test(`${name}: scroll, type and STD`, () => {
    const s = strip(create);
    s.wheel();
    assert.deepEqual(s.calls.at(-1), ['setBaro', 1014]);
    s.click(); s.panel.update(s.view);
    for (const k of '1005') s.key(k);
    s.key('Enter');
    assert.deepEqual(s.calls.at(-1), ['setBaro', 1005]);
    s.click();
    for (const k of '12') s.key(k);
    s.key('Enter');
    assert.deepEqual(s.calls.at(-1), ['setBaro', 1005], 'nonsense ignored');
    s.std();
    assert.deepEqual(s.calls.at(-1), ['std', true]);
    s.panel.update(s.view);
    s.std();
    assert.deepEqual(s.calls.at(-1), ['std', false]);
    keyListeners.length = 0;
  });
}

test('no view.sim: the strip stays alive and shows 1013', () => {
  const panel = createFcu(makeEl(), { poke() {} });
  panel.update({ state: { pos: { z: 0 }, vs: 0 }, ap: {} });
  assert.equal(baroText(null), '1013');
  keyListeners.length = 0;
});
