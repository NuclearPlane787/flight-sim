// v0.8.0: the page's side of the warnings (src/ui/alerts.js) on a real sim, in node with a small DOM stub: the master
// lights dark with nothing failed and no panel made; a fire lights MASTER WARN and starts its loop; a click on the
// light puts it out and stops the aural, the panel staying; a new alert lights it again; a caution plays its one-shot
// once; the SILENCE button acknowledges everything; the panel goes when the last alert clears.
//   node --test tests/v080-alert-lights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { armed } from '../src/sim/failures.js';
import { run, KT, FT } from './sim-helpers.mjs';

// ---- a DOM just big enough for alerts.js ----
function el(tag) {
  const e = {
    tagName: tag.toUpperCase(), children: [], parent: null, style: {}, dataset: {}, hidden: false, innerHTML: '', className: '', title: '', tabIndex: 0,
    listeners: {},
    classList: { set: new Set(), toggle(c, on) { on = on === undefined ? !this.set.has(c) : on; on ? this.set.add(c) : this.set.delete(c); return on; }, contains(c) { return this.set.has(c); }, add(c) { this.set.add(c); } },
    appendChild(c) { c.parent = e; e.children.push(c); return c; },
    remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); e.parent = null; },
    addEventListener(t, f) { (e.listeners[t] ||= []).push(f); },
    click() { for (const f of e.listeners.click || []) f({ target: e, preventDefault() {}, stopPropagation() {} }); },
    querySelector(sel) { const cls = sel.replace(/^\./, ''); const walk = (n) => { for (const c of n.children) { if ((' ' + c.className + ' ').includes(' ' + cls + ' ')) return c; const r = walk(c); if (r) return r; } return null; }; return walk(e); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 60 }; },
    closest() { return null; }, contains() { return false; },
  };
  return e;
}
globalThis.document = { createElement: el, head: el('head'), querySelector: () => null };
globalThis.window = { innerWidth: 1440, innerHeight: 900, addEventListener() {} };

const { createAlerts } = await import('../src/ui/alerts.js');

function rig(type) {
  const sim = type ? createSim({ type }) : createSim();
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 12000 * FT, iasMs: 290 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 12000 });
  const hudEl = el('div');
  for (const c of ['fsui-pfd', 'fsui-eng']) { const p = hudEl.appendChild(el('div')); p.className = 'fsui-panel ' + c; Object.assign(p.style, { left: '12px', top: '70px', width: '387px', height: '240px' }); }
  hudEl.querySelector('fsui-pfd').appendChild(el('button')).className = 'fsui-silence';
  const calls = [];
  const P = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect(x) { return x; }, start() {}, gain: P(), frequency: P(), type: '' });
  const ctx = { currentTime: 0, createGain: node, createOscillator: node, createBiquadFilter: node };
  const synth = { alertOut: { ctx, bus: node() } };
  const al = createAlerts({ sim, hudEl, synth });
  return { sim, hudEl, al, calls };
}
const lights = (hudEl) => hudEl.children.find((c) => c.className.includes('fsal-lights'));

test('nothing failed: the lights dark, no panel; a fire lights MASTER WARN and opens the panel', () => {
  const { sim, hudEl, al } = rig();
  run(sim, 0.3); al.update();
  assert.deepEqual(al.lit, { warning: false, caution: false });
  assert.equal(al.panel, null);
  assert.equal(hudEl.children.filter((c) => c.className.includes('fsal-panel')).length, 0);
  const [warnBtn, cautBtn] = lights(hudEl).children;
  assert.equal(warnBtn.dataset.alert, 'warn'); assert.equal(cautBtn.dataset.alert, 'caut');
  assert.equal(warnBtn.innerHTML, 'MASTER<br>WARN');
  sim.setFailures(armed(null, { kind: 'eng-fire', target: 0, when: { type: 'now' } }, sim.state.t, 8));
  run(sim, 0.2); al.update();
  assert.deepEqual(al.lit, { warning: true, caution: false });
  assert.equal(al.aural, 'crc');
  assert.ok(al.panel);
  assert.match(al.panel.innerHTML, /ENG 1 FIRE/);
  assert.match(al.panel.innerHTML, /data-step="1" data-act="engineSwitch"/);
  assert.equal(warnBtn.classList.contains('on'), true);
  // A click on the light: out, the panel stays.
  warnBtn.click();
  assert.equal(al.lit.warning, false); assert.ok(al.panel);
  al.update(); assert.equal(al.aural, null, 'the CRC stops with the light');
  assert.equal(warnBtn.classList.contains('on'), false);
  // Another alert: a caution lights MASTER CAUT; the fire's light stays out.
  sim.setFailures(armed(sim.failures, { kind: 'eng-flameout', target: 1, when: { type: 'now' } }, sim.state.t, 3));
  run(sim, 0.2); al.update();
  assert.deepEqual(al.lit, { warning: false, caution: true });
  // The SILENCE button acknowledges everything.
  hudEl.querySelector('fsui-pfd').children[0].click();
  assert.deepEqual(al.lit, { warning: false, caution: false });
  // A new warning sounds and lights again.
  sim.setFailures(armed(sim.failures, { kind: 'eng-fire', target: 1, when: { type: 'now' } }, sim.state.t, 8));
  run(sim, 0.2); al.update();
  assert.equal(al.lit.warning, true); assert.equal(al.aural, 'crc', 'a new warning sounds again');
  // Everything repaired: the lights out, the panel gone.
  sim.repair('all'); run(sim, 60); al.update();
  assert.deepEqual(al.lit, { warning: false, caution: false });
  assert.equal(al.panel, null);
});

test('the Boeings\' lights read WARNING and CAUTION', () => {
  const { hudEl, al, sim } = rig('b787-9');
  run(sim, 0.1); al.update();
  sim.setFailures(armed(null, { kind: 'eng-seize', target: 0, when: { type: 'now' } }, sim.state.t, 1));
  run(sim, 0.2); al.update();
  const [w, c] = lights(hudEl).children;
  sim.setFailures(armed(sim.failures, { kind: 'eng-fire', target: 1, when: { type: 'now' } }, sim.state.t, 8));
  run(sim, 0.2); al.update();
  assert.equal(al.aural, 'bell', 'the Boeing\'s fire bell');
  w.click(); al.update(); assert.equal(al.aural, null);
  assert.equal(w.innerHTML, 'WARNING'); assert.equal(c.innerHTML, 'CAUTION');
  assert.equal(al.lit.caution, true);
  c.click();
  assert.equal(al.lit.caution, false);
});
