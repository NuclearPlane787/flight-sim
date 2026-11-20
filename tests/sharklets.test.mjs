// v0.5.3 (the run's extra time, one of briefs/V0-5-3.md's extras): the A321's sharklets can come off in the warehouse.
// Without them: the span 34 m (the parts' tip, 17.0 m a side) not 35.8, about 8 % less effective aspect ratio (more
// induced drag in the climb and cruise, a slightly flatter lift curve), 2 × 200 kg [EST] off the wingtips; the model
// has no sharklets. With them (the default), and on the Boeings (no such switch), nothing changes.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { newDesign, normalizeDesign, defaultAirframe, isBaseAirframe, designDef, designNumbers } from '../src/sim/designs.js';
import { partsModel, partsNumbers } from '../src/sim/parts-aero.js';
import { airframeMap } from '../src/sim/airframe-map.js';
import { editAirframe } from '../src/ui/warehouse.js';
import { createSim } from '../src/sim/sim.js';

const off = (d, extra = {}) => normalizeDesign({ ...d, airframe: { ...d.airframe, sharklets: false, ...extra } });

test('the field: on by default on the A321, absent on the Boeings; off is not the base airframe', () => {
  assert.equal(defaultAirframe('a321neo').sharklets, true);
  for (const b of ['b787-9', 'b777-300er']) {
    assert.equal('sharklets' in defaultAirframe(b), false);
    assert.equal('sharklets' in normalizeDesign({ ...newDesign(b), airframe: { ...defaultAirframe(b), sharklets: false } }).airframe, false, `${b}: no sharklets to take off`);
  }
  const d = newDesign('a321neo', { id: 'sh-1' });
  assert.equal(isBaseAirframe(d.airframe, 'a321neo'), true);
  const o = off(d);
  assert.equal(o.airframe.sharklets, false);
  assert.equal(isBaseAirframe(o.airframe, 'a321neo'), false);
  // an old v0.5.3 design without the key keeps them
  const { sharklets, ...old } = d.airframe;
  assert.equal(normalizeDesign({ ...d, airframe: old }).airframe.sharklets, true);
});

test('the warehouse: the switch, undoable as any edit; "As the base" on the wing puts them back', () => {
  const d = newDesign('a321neo', { id: 'sh-2' });
  const o = editAirframe(d, 'sharklets', false);
  assert.equal(o.airframe.sharklets, false);
  assert.equal(editAirframe(o, 'sharklets', true).airframe.sharklets, true);
  assert.equal(editAirframe(o, 'reset', 'wing').airframe.sharklets, true);
  assert.equal(editAirframe(newDesign('b787-9'), 'sharklets', false).airframe.sharklets, undefined, 'no switch on a Boeing');
});

test('the span and the numbers: 34.0 m, code C still, and the aerodynamics', () => {
  const d = newDesign('a321neo', { id: 'sh-3' }), o = off(d);
  const M = airframeMap('a321neo', o.airframe);
  assert.ok(Math.abs(M.span - 34.0) < 0.15, `span ${M.span.toFixed(2)} m`);
  assert.equal(airframeMap('a321neo', d.airframe).span.toFixed(2), '35.80');
  const n = designNumbers(designDef(o)).airframe, n0 = designNumbers(designDef(d)).airframe;
  assert.ok(Math.abs(n.spanM - 34.0) < 0.15 && n.codeLetter === 'C', `${n.spanM} ${n.codeLetter}`);
  // the parts' wing: the same area, about 8 % less effective aspect ratio
  const pn = partsNumbers(partsModel('a321neo', o.airframe)), pb = partsNumbers(partsModel('a321neo', d.airframe));
  assert.ok(Math.abs(pn.wingAreaM2 - pb.wingAreaM2) < 1e-9);
  assert.ok(Math.abs(pn.aspectRatio / pb.aspectRatio - 1 / 1.08) < 1e-9, `${pn.aspectRatio} / ${pb.aspectRatio}`);
  // a little lighter, the stall about the same (a flatter lift curve, the same CLmax)
  assert.ok(designDef(o).data.OEW < designDef(d).data.OEW - 350 && designDef(o).data.OEW > designDef(d).data.OEW - 450, 'about 400 kg off');
  assert.ok(Math.abs(n.stallKt - n0.stallKt) < 3, `stall ${n.stallKt} against ${n0.stallKt}`);
});

// 250 kt at 10,000 ft, clean, the A/THR holding the speed and e2e-controller.js the height, 40 s: the lever it needs.
const KT = 0.514444, FT = 0.3048, DT = 1 / 120;
const SRC = readFileSync(new URL('./e2e-controller.js', import.meta.url), 'utf8');
function cruiseLever(design) {
  const def = designDef(design), sim = createSim({ type: design }), input = { lever: 0 };
  const window = { __fs: { sim, input } };
  new Function('window', SRC)(window);
  const fly = window.__fsController, s = sim.state;
  sim.reset({ x: 0, y: 0, z: 10000 * FT, hdg: 0, onGround: false, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 12000, payloadKg: def.defaults.pax * 84 });
  sim.controls.flapLever = 0; sim.controls.gearDown = false;
  input.lever = sim.controls.thrust;
  sim.ap.setSpd(250); if (!sim.ap.athr) sim.ap.toggleAthr();
  let sum = 0, n = 0;
  for (let k = 0; k < 120 * 40; k++) {
    fly(sim, DT);
    if (sim._core.athrDriving) input.lever = sim.controls.thrust; else sim.controls.thrust = input.lever;
    sim.step(DT); sim.events.length = 0;
    if (k > 120 * 20) { sum += sim.controls.thrust; n++; }
  }
  return { lever: sum / n, crashed: !!s.crashed, iasErr: s.ias / KT - 250, dzFt: s.pos.z / FT - 10000 };
}

test('in the sim: more thrust to hold 250 kt without them, the same with them', () => {
  const d = newDesign('a321neo', { id: 'sh-4' });
  const a = cruiseLever(d), b = cruiseLever(off(d)), c = cruiseLever(normalizeDesign({ ...d, airframe: { ...d.airframe, sharklets: true } }));
  for (const r of [a, b]) assert.ok(!r.crashed && Math.abs(r.iasErr) < 5 && Math.abs(r.dzFt) < 300, JSON.stringify(r));
  assert.equal(c.lever, a.lever, 'sharklets on: the base airframe, to the bit');
  assert.ok(b.lever > a.lever + 0.003, `the lever without sharklets ${b.lever.toFixed(4)} against ${a.lever.toFixed(4)}`);
  console.log(`  250 kt at 10,000 ft: lever ${a.lever.toFixed(4)} with sharklets, ${b.lever.toFixed(4)} without`);
});
