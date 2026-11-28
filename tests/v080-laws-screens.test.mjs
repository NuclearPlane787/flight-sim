// v0.8.0, part 7: the PFDs' marks for the degraded laws, drawn in node into a recording 2D context (no browser).
// The A321's: ALTN LAW (as before) or DIRECT LAW, USE MAN PITCH TRIM in direct law, the amber crosses at ±67° in
// place of the green "=", and the FCU's LAW label (LAW NORM / LAW ALTN / LAW DIR, from the law that flies). The
// Boeings': the autopilot's status line blank in the secondary and direct modes.
// With the normal law every canvas call is what it was: set FS_LAWS_BASE to an earlier copy of the game's folder
// (the pushed v0.7.9's, for example) and the A321's and the Boeings' PFDs are drawn by both, call by call, and
// compared; without it that test is skipped.
//   FS_LAWS_BASE=/path/to/older/flight-sim node --test tests/v080-laws-screens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createSim } from '../src/sim/sim.js';
import { createPfd } from '../src/ui/pfd.js';
import { createBoeingPfd } from '../src/ui/boeing/pfd.js';

const KT = 0.514444, FT = 0.3048, DT = 1 / 120;
const C = { amber: '#ffa515', green: '#3cff4e' };

// Records every call and every property set, in order, with its arguments.
function recCanvas(w) {
  const log = [], texts = [];
  const st = { font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000' };
  const px = () => { const m = /([\d.]+)px/.exec(st.font); return m ? +m[1] : 10; };
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return (s) => { log.push(['measureText', String(s)]); return { width: String(s).length * px() * 0.56 }; };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return (...a) => { log.push([p, ...a]); return { addColorStop: (...b) => log.push(['addColorStop', ...b]) }; };
      if (p === 'fillText') return (s, x, y) => { log.push(['fillText', String(s), x, y]); texts.push({ s: String(s), x, y, col: st.fillStyle, font: st.font }); };
      if (p in st) return st[p];
      return (...a) => { log.push([p, ...a]); };
    },
    set(t, p, v) { st[p] = v; log.push(['=', p, v]); return true; },
  });
  return { cv: { ctx, w, h: w, begin() {} }, log, texts };
}
function aloft(type, { law, iasKt = 250, flapLever = 0, gearDown = false, ap } = {}) {
  const sim = type ? createSim({ type }) : createSim();
  sim.reset({ x: 0, y: 0, hdg: 30, onGround: false, z: 9000 * FT, iasMs: iasKt * KT, flapLever, gearDown, fuelKg: 9000, payloadKg: 12000, law, ap });
  for (let i = 0; i < 120 * 6; i++) sim.step(DT);
  return sim;
}
const drawn = (make, sim, now = 1000) => {
  const r = recCanvas(800);
  make(r.cv).draw({ state: sim.state, ap: sim.ap, controls: sim.controls, sim }, now);
  return r;
};
const has = (texts, s, col) => texts.some((t) => t.s === s && (!col || t.col === col));

test('A321 PFD: ALTN LAW in alternate; DIRECT LAW and USE MAN PITCH TRIM in direct; amber crosses for the green "="', () => {
  const n = drawn(createPfd, aloft(null));
  assert.ok(!has(n.texts, 'ALTN LAW') && !has(n.texts, 'DIRECT LAW') && !has(n.texts, 'USE MAN PITCH TRIM'));
  const a = drawn(createPfd, aloft(null, { law: 'alternate' }));
  assert.ok(has(a.texts, 'ALTN LAW', C.amber)); assert.ok(!has(a.texts, 'USE MAN PITCH TRIM'));
  const d = drawn(createPfd, aloft(null, { law: 'direct' }));
  assert.ok(has(d.texts, 'DIRECT LAW', C.amber)); assert.ok(has(d.texts, 'USE MAN PITCH TRIM', C.amber));
  assert.ok(!has(d.texts, 'ALTN LAW'));
  // The bank marks: green strokes in normal law; amber in the others.
  const strokesIn = (log, col) => { let cur = null, k = 0; for (const e of log) { if (e[0] === '=' && e[1] === 'strokeStyle') cur = e[2]; if (e[0] === 'stroke' && cur === col) k++; } return k; };
  assert.ok(strokesIn(a.log, C.amber) >= strokesIn(n.log, C.amber) + 2, 'two amber crosses');
  assert.ok(strokesIn(n.log, C.green) >= strokesIn(a.log, C.green) + 4, 'the four green strokes of the "=" gone');
});

test('A321: a law forced by the hydraulics shows on the PFD (state.law), with controls.law at normal', async () => {
  const { armed } = await import('../src/sim/failures.js');
  const sim = aloft(null, { gearDown: true, flapLever: 1, iasKt: 180 });
  for (const t of [0, 1]) sim.setFailures(armed(sim.failures, { kind: 'hyd-sys', target: t, when: { type: 'now' } }, sim.state.t, 3));
  for (let i = 0; i < 120 * 3; i++) sim.step(DT);
  assert.equal(sim.controls.law, 'normal'); assert.equal(sim.state.law, 'direct');
  const d = drawn(createPfd, sim);
  assert.ok(has(d.texts, 'DIRECT LAW', C.amber) && has(d.texts, 'USE MAN PITCH TRIM', C.amber));
});

test('Boeing PFD: the autopilot status line blank in secondary and direct; the normal mode\'s as before', () => {
  for (const type of ['b787-9', 'b777-300er']) {
    const n = aloft(type, { ap: { ap: true } }), rn = drawn(createBoeingPfd, n);
    const status = rn.texts.filter((t) => Math.abs(t.y - 0.116 * 800) < 0.5).map((t) => t.s);
    assert.ok(status.length > 0, `${type}: the normal mode's status line shows something (${status.join('|')})`);
    for (const law of ['secondary', 'direct']) {
      const sim = aloft(type, { law }); const r = drawn(createBoeingPfd, sim);
      assert.equal(sim.state.law, law);
      const st2 = r.texts.filter((t) => Math.abs(t.y - 0.116 * 800) < 0.5 && t.s !== 'A/P').map((t) => t.s);
      assert.deepEqual(st2, [], `${type} ${law}: ${st2.join('|')} (normal: ${status.join('|')})`);
    }
  }
});

const BASE = process.env.FS_LAWS_BASE;
test('the normal law: every canvas call of the A321\'s and the Boeings\' PFDs as the earlier copy draws them', { skip: !BASE && 'FS_LAWS_BASE not set' }, async () => {
  const old = await import(pathToFileURL(join(BASE, 'src/ui/pfd.js')).href);
  const oldB = await import(pathToFileURL(join(BASE, 'src/ui/boeing/pfd.js')).href);
  const cases = [
    [null, {}], [null, { iasKt: 150, flapLever: 4, gearDown: true }], [null, { ap: { ap: true } }],
    ['b787-9', {}], ['b787-9', { ap: { ap: true } }], ['b777-300er', { iasKt: 160, flapLever: 5, gearDown: true }],
  ];
  let calls = 0;
  for (const [type, o] of cases) {
    const sim = aloft(type, o);
    const mk = type ? [createBoeingPfd, oldB.createBoeingPfd] : [createPfd, old.createPfd];
    // The same instance drawn three times (the FMA's boxes and trends carry from one frame to the next).
    const a = recCanvas(800), b = recCanvas(800);
    const pa = mk[0](a.cv), pb = mk[1](b.cv);
    for (const now of [1000, 1400, 9000]) {
      pa.draw({ state: sim.state, ap: sim.ap, controls: sim.controls, sim }, now);
      pb.draw({ state: sim.state, ap: sim.ap, controls: sim.controls, sim }, now);
      for (let i = 0; i < 12; i++) sim.step(DT);
    }
    assert.equal(sim.state.law, 'normal');
    assert.deepEqual(a.log, b.log, `${type || 'a321'} ${JSON.stringify(o)}`);
    calls += a.log.length;
  }
  assert.ok(calls > 3000, `${calls} calls compared`);
});
