// v0.8.0: the engine screens' switches and failure messages, drawn in node into a recording 2D context (no browser):
// the A321's engine panel (ENG MASTER under each engine, ECAM's messages in the lower part) and the Boeings' EICAS
// (FUEL CONTROL, the messages listed); each switch's rectangle hit-tests to its engine; with nothing failed, no
// messages and the spoilers and brakes as before.
//   node --test tests/v080-warn-screens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { armed } from '../src/sim/failures.js';
import { newDesign, resolveDef } from '../src/sim/designs.js';
import { createEnginesPanel } from '../src/ui/engines-panel.js';
import { createEicas } from '../src/ui/boeing/eicas.js';
import { switchFace, switchSig, rectAt } from '../src/ui/engine-row.js';
import { run, KT, FT } from './sim-helpers.mjs';

// A canvas stub whose context records every fillText with its colour, and measures text as 0.56 em a character.
function recCanvas(w) {
  const texts = [];
  const st = { font: '10px sans-serif', fillStyle: '#000' };
  const px = () => { const m = /([\d.]+)px/.exec(st.font); return m ? +m[1] : 10; };
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return (s) => ({ width: String(s).length * px() * 0.56 });
      if (p === 'fillText') return (s, x, y) => texts.push({ s: String(s), x, y, col: st.fillStyle });
      if (p in st) return st[p];
      return () => {};
    },
    set(t, p, v) { st[p] = v; return true; },
  });
  return { cv: { ctx, w, h: w * 0.62, begin() { texts.length = 0; } }, texts };
}
function cruise(type) {
  const sim = type ? createSim({ type }) : createSim();
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 12000 * FT, iasMs: 290 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 12000 });
  return sim;
}
const fail = (sim, kind, target = 0, seed = 8) => sim.setFailures(armed(sim.failures, { kind, target, when: { type: 'now' } }, sim.state.t, seed));
const view = (sim) => ({ state: sim.state, controls: sim.controls, ap: {}, timeScale: 1 });
const has = (texts, s, col) => texts.some((t) => t.s === s && (!col || t.col === col));
const C = { red: '#ff2b2b', amber: '#ffa515', cyan: '#2fe3ff', green: '#3cff4e', white: '#f2f2f2' };

test('switchFace: ON/RUN, OFF/CUTOFF, START with its progress, the short reason, FIRE', () => {
  assert.deepEqual(switchFace({ sw: true, lit: true }, 'airbus'), { text: 'ON', col: 'green', fire: false, progress: -1 });
  assert.equal(switchFace({ sw: false, lit: false }, 'boeing').text, 'CUTOFF');
  assert.equal(switchFace({ sw: true, lit: true }, 'boeing').text, 'RUN');
  const st = switchFace({ sw: true, lit: false, start: 15, startS: 30 }, 'airbus');
  assert.equal(st.text, 'START'); assert.equal(st.progress, 0.5); assert.equal(st.col, 'cyan');
  assert.equal(switchFace({ sw: true, lit: false, block: 'altitude' }, 'airbus').text, 'TOO HIGH');
  assert.equal(switchFace({ sw: true, lit: true, fire: true }, 'airbus').fire, true);
  assert.equal(switchFace({}, 'airbus').text, 'ON', 'a state without switches (the dev pages\' mocks): on');
  assert.notEqual(switchSig({ engines: [{ sw: true, lit: true }] }), switchSig({ engines: [{ sw: false, lit: false }] }));
  assert.equal(rectAt([{ x: 10, y: 10, w: 20, h: 10, i: 3 }], 15, 15), 3);
  assert.equal(rectAt([{ x: 10, y: 10, w: 20, h: 10, i: 3 }], 50, 15), -1);
});

test('A321 panel, nothing failed: two ENG MASTER switches ON, no messages, spoilers and brakes drawn', () => {
  const sim = cruise(); run(sim, 0.5);
  const { cv, texts } = recCanvas(400);
  const p = createEnginesPanel(cv); p.setType(resolveDef('a321neo'));
  p.draw(view(sim));
  assert.ok(has(texts, 'MASTER'));
  assert.equal(texts.filter((t) => t.s === 'ON' && t.col === C.green).length, 2);
  assert.ok(has(texts, 'SPOILERS') && has(texts, 'BRAKES'));
  assert.ok(!texts.some((t) => /FIRE|FAIL/.test(t.s)));
  // The switches' rectangles: under each engine, 0 left, 1 right.
  assert.equal(p.switchAt(0.135 * 400, 0.345 * 400), 0);
  assert.equal(p.switchAt(0.385 * 400, 0.345 * 400), 1);
  assert.equal(p.switchAt(0.26 * 400, 0.345 * 400), -1);
  assert.equal(p.switchAt(0.135 * 400, 0.2 * 400), -1);
});

test('A321 panel, an engine fire: ECAM\'s title in red, the actions in cyan, FIRE by engine 1\'s switch', () => {
  const sim = cruise(); sim.controls.thrust = 0.5;
  fail(sim, 'eng-fire', 0); fail(sim, 'eng-flameout', 1);
  run(sim, 0.5);
  const { cv, texts } = recCanvas(400);
  const p = createEnginesPanel(cv); p.setType(resolveDef('a321neo'));
  p.draw(view(sim));
  assert.ok(has(texts, 'ENG 1 FIRE', C.red));
  assert.ok(has(texts, '-THR LEVER 1 .... IDLE', C.cyan));
  assert.ok(has(texts, '-ENG MASTER 1 .... OFF', C.cyan));
  assert.ok(has(texts, 'ENG 2 FAIL', C.amber), 'the other alert\'s title');
  assert.ok(has(texts, 'FIRE ', C.red), 'FIRE by the switch');
  assert.ok(!has(texts, 'SPOILERS'), 'the messages in the spoilers\' place');
  // The lower part's messages stay inside the panel's width and above the memo line.
  for (const t of texts.filter((x) => /FIRE|FAIL|^-/.test(x.s) && x.y > 0.36 * 400)) assert.ok(t.y < 0.59 * 400, t.s);
  // A click on engine 1's switch: the hit test gives 0, and the action cuts it off.
  const i = p.switchAt(0.135 * 400, 0.345 * 400);
  assert.equal(i, 0);
  assert.equal(sim.engineSwitch(i), true);
  p.draw(view(sim));
  assert.ok(has(texts, 'OFF', C.white));
});

test('EICAS (787): FUEL CONTROL RUN/CUTOFF, FIRE ENG L red and ENG FAIL R amber above the OFF lines', () => {
  const sim = cruise('b787-9'); sim.controls.thrust = 0.5;
  run(sim, 0.3);
  const { cv, texts } = recCanvas(400);
  const e = createEicas(cv); e.setType(resolveDef('b787-9'));
  e.draw(view(sim));
  assert.ok(has(texts, 'FUEL CTRL'));
  assert.equal(texts.filter((t) => t.s === 'RUN').length, 2);
  assert.ok(!texts.some((t) => /FIRE|FAIL/.test(t.s)));
  fail(sim, 'eng-fire', 0); fail(sim, 'eng-flameout', 1);
  run(sim, 0.3);
  e.draw(view(sim));
  const fire = texts.find((t) => t.s === 'FIRE ENG L'), engf = texts.find((t) => t.s === 'ENG FAIL R');
  assert.equal(fire.col, C.red); assert.equal(engf.col, C.amber);
  assert.ok(fire.y < engf.y, 'warnings first');
  const i = e.switchAt(0.335 * 400, 0.594 * 400);
  assert.equal(i, 1);
  sim.engineSwitch(1, false); run(sim, 0.1);
  e.draw(view(sim));
  assert.ok(has(texts, 'CUTOFF'));
});

test('a four-engine design: four switches on each screen, each hit-testing to its engine', () => {
  const d = newDesign('b777-300er', { id: 'x4', count: 4 });
  const sim = cruise(d); run(sim, 0.3);
  const { cv, texts } = recCanvas(400);
  const e = createEicas(cv); e.setType(resolveDef(d));
  e.draw(view(sim));
  const runs = texts.filter((t) => t.s === 'RUN');
  assert.equal(runs.length, 4);
  // Each word's centre (text drawn left-aligned from its left edge) hit-tests to its own engine, left to right.
  const got = runs.map((t) => e.switchAt(t.x + 0.012 * 400, t.y));
  assert.deepEqual(got, [0, 1, 2, 3]);
  const { cv: cv2, texts: t2 } = recCanvas(400);
  const p = createEnginesPanel(cv2); p.setType(resolveDef(d));
  p.draw(view(sim));
  assert.equal(t2.filter((t) => t.s === 'ON').length, 4);
});
