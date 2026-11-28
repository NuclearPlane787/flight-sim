// v0.8.0 (part 7): the hydraulics' and the flaps' alerts (src/sim/checklists.js's hydAlerts) on real sims, on both
// families: one system low, a pump alone, two systems, the Boeings' flight control mode, the flaps and slats jammed
// with the landing's numbers; the notes follow state.hyd.eff; the yellow pump's step does its action; each clears with
// its repair. And the engine display's hydraulics boxes (src/ui/hyd-boxes.js) in a recording 2D context: with nothing
// failed every canvas call is what it was.
//   node --test tests/v080-hyd-checklists.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { armed } from '../src/sim/failures.js';
import { resolveDef } from '../src/sim/designs.js';
import { alertsOf, runStep, nextStep, landingNumbers } from '../src/sim/checklists.js';
import { createEnginesPanel } from '../src/ui/engines-panel.js';
import { createEicas } from '../src/ui/boeing/eicas.js';
import { hydSig } from '../src/ui/hyd-boxes.js';
import { run, KT, FT } from './sim-helpers.mjs';

const fail = (sim, kind, target = 0, seed = 12345) => sim.setFailures(armed(sim.failures, { kind, target, when: { type: 'now' } }, sim.state.t, seed));
const byId = (sim, id) => alertsOf(sim).find((a) => a.id === id);
const ids = (sim) => alertsOf(sim).map((a) => a.id);
const notes = (a) => a.steps.filter((s) => s.kind === 'note').map((s) => s.text);
function cruise(type, o = {}) {
  const sim = type ? createSim({ type }) : createSim();
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 12000 * FT, iasMs: 290 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 12000, ...o });
  return sim;
}
const slow = (type, lever) => cruise(type, { z: 3000 * FT, iasMs: 180 * KT, flapLever: lever });

test('nothing failed: the shared empty list, without making anything, on both families', () => {
  for (const t of [undefined, 'b787-9', 'b777-300er']) {
    const sim = cruise(t); run(sim, 2);
    assert.equal(sim.state.hyd.on, false);
    const a = alertsOf(sim), b = alertsOf(sim);
    assert.equal(a.length, 0); assert.equal(a, b, 'the same frozen list both times');
    assert.ok(Object.isFrozen(a));
  }
});

test('A321 green lost: HYD G SYS LO PR, a caution with the single chime; its notes follow state.hyd.eff', () => {
  const sim = cruise(); fail(sim, 'hyd-sys', 0); run(sim, 5);
  assert.deepEqual(ids(sim), ['hyd-0']);
  const a = byId(sim, 'hyd-0');
  assert.equal(a.level, 'caution'); assert.equal(a.aural, 'sc'); assert.equal(a.title, 'HYD G SYS LO PR');
  const N = notes(a), eff = sim.state.hyd.eff;
  assert.equal(N.includes('L/G: GRAVITY EXTENSION (SEE L/G)'), !eff.gear);
  assert.equal(N.includes('NORM BRK LOST: ALTN BRK'), eff.brake < 1 && eff.brake > 0.5);
  assert.equal(N.includes('N/W STEERING LOST'), eff.steer < 1);
  assert.equal(N.includes('REVERSER 1 LOST'), !eff.reverser[0]);
  assert.equal(N.includes('FLAPS SLOW'), eff.flaps > 0 && eff.flaps < 1);
  assert.equal(N.includes('SLATS SLOW'), eff.slats > 0 && eff.slats < 1);
  assert.ok(!eff.gear && N.includes('L/G: GRAVITY EXTENSION (SEE L/G)'), 'green carries the gear');
  assert.ok(N.includes('PTU: INOP'), 'the fluid lost: the PTU stops');
  assert.equal(N[N.length - 1], 'LDG DIST: INCREASED');
  assert.ok(!a.steps.some((s) => s.act), 'no yellow pump step for green');
  // The repair: the pressure back, the alert gone.
  sim.repair('all'); run(sim, 10);
  assert.deepEqual(alertsOf(sim), []);
});

test('A321 two systems: HYD G + Y SYS LO PR, a warning with the CRC: the law, the RAT, LAND ASAP', () => {
  const sim = cruise(); fail(sim, 'hyd-sys', 0); fail(sim, 'hyd-sys', 2); run(sim, 6);
  const a = alertsOf(sim)[0];
  assert.equal(a.id, 'hyd2-02'); assert.equal(a.level, 'warning'); assert.equal(a.aural, 'crc'); assert.equal(a.title, 'HYD G + Y SYS LO PR');
  assert.ok(!ids(sim).includes('hyd-0') && !ids(sim).includes('hyd-2'), 'one warning, not two cautions');
  const N = notes(a);
  assert.equal(sim.state.law, 'alternate');
  assert.ok(N.includes('ALTN LAW: PROT LOST') && N.includes('DIRECT LAW WHEN L/G DN: USE MAN PITCH TRIM'));
  assert.ok(sim.state.hyd.rat > 0); assert.ok(N.includes('RAT: OUT'));
  assert.ok(N.includes('L/G: GRAVITY EXTENSION (SEE L/G)') && N.includes('FLAPS: LOCKED') && N.includes('LDG DIST: INCREASED'));
  assert.equal(N[N.length - 1], 'LAND ASAP');
  assert.ok(!a.steps.some((s) => s.act), 'yellow\'s fluid lost: no yellow pump step');
  // Green and blue: its own title.
  const b = cruise(); fail(b, 'hyd-sys', 0); fail(b, 'hyd-sys', 1); run(b, 6);
  assert.equal(alertsOf(b)[0].title, 'HYD G + B SYS LO PR');
  b.repair('all'); run(b, 12);
  assert.ok(!alertsOf(b).some((x) => x.id.startsWith('hyd')), 'repaired: no hydraulics alert');
});

test('A321 yellow low with its fluid: YELLOW ELEC PUMP ON, a switch step that does sim.hydPump', () => {
  // Green drained (the PTU stops) and engine 2 out (yellow's engine pump): yellow has fluid but no pump.
  const sim = cruise(); fail(sim, 'hyd-sys', 0); fail(sim, 'eng-flameout', 1); run(sim, 5);
  const a = byId(sim, 'hyd2-02');
  assert.ok(a, 'G + Y');
  const k = a.steps.findIndex((s) => s.act && s.act.name === 'hydPump');
  assert.ok(k >= 0);
  assert.equal(a.steps[k].text, 'YELLOW ELEC PUMP ..... ON'); assert.deepEqual(a.steps[k].act.arg, ['Y-ELEC', true]);
  assert.equal(a.steps[k].done, false); assert.equal(nextStep(a), k);
  assert.equal(runStep(sim, a.steps[k]), true);
  run(sim, 5);
  assert.ok(sim.state.hyd.p[2] > 0.5, 'yellow back');
  assert.ok(!byId(sim, 'hyd2-02'), 'the warning gone'); assert.ok(byId(sim, 'hyd-0'), 'green alone left');
  assert.equal(byId(sim, 'hydpump-EDP2'), undefined, 'engine 2 out: its pump\'s message inhibited (the engine\'s alert stands)');
  assert.ok(byId(sim, 'eng-1'));
});

test('a pump alone: HYD G ENG 1 PUMP LO PR (the PTU feeding green); HYD PRESS ENG L on the 787; HYD PRESS DEM C', () => {
  const sim = cruise(); fail(sim, 'hyd-pump', 0); run(sim, 5);
  assert.deepEqual(ids(sim), ['hydpump-EDP1']);
  const a = byId(sim, 'hydpump-EDP1');
  assert.equal(a.title, 'HYD G ENG 1 PUMP LO PR'); assert.equal(a.level, 'caution'); assert.equal(a.aural, 'sc');
  assert.deepEqual(notes(a), ['G SYS PRESS: BY PTU']);
  sim.repair('all'); run(sim, 10); assert.deepEqual(alertsOf(sim), []);
  // An engine's flameout costs its pump, but the engine's own alert stands for it (no pump message).
  const f = cruise(); fail(f, 'eng-flameout', 0); run(f, 5);
  assert.ok(f.state.hyd.on && f.state.hyd.p[0] > 0.5, 'green by the PTU');
  assert.deepEqual(ids(f), ['eng-0']);
  const b = cruise('b787-9'); fail(b, 'hyd-pump', 0); run(b, 5);
  const p = byId(b, 'hydpump-EDP1');
  assert.equal(p.title, 'HYD PRESS ENG L'); assert.equal(p.aural, 'beeper'); assert.deepEqual(notes(p), ['SYS L PRESSURE: DEMAND PUMP']);
  const c = cruise('b787-9'); fail(c, 'hyd-elec', 0); run(c, 5);
  assert.equal(byId(c, 'hydpump-dem0').title, 'HYD PRESS DEM L');
  // The centre's electric pumps are all it has (the 787): the system goes, not a pump message.
  const d = cruise('b787-9'); fail(d, 'hyd-elec', 1); run(d, 5);
  assert.ok(byId(d, 'hyd-1') && !byId(d, 'hydpump-dem1'));
});

test('787-9 left and centre lost: a caution each, and FLIGHT CONTROL MODE (secondary); 777 the same words', () => {
  const sim = cruise('b787-9'); fail(sim, 'hyd-sys', 0); fail(sim, 'hyd-sys', 1); run(sim, 6);
  assert.deepEqual(ids(sim), ['hyd-0', 'hyd-1', 'law']);
  const L = byId(sim, 'hyd-0');
  assert.equal(L.title, 'HYD PRESS SYS L'); assert.equal(L.level, 'caution'); assert.equal(L.aural, 'beeper');
  assert.equal(byId(sim, 'hyd-1').title, 'HYD PRESS SYS C');
  const N = notes(L), eff = sim.state.hyd.eff;
  assert.equal(N.includes('GEAR: ALTN GEAR EXTENSION (SEE GEAR DISAGREE)'), !eff.gear);
  assert.ok(N.includes('THRUST REVERSER L: INOP') && N.includes('FLAPS: INOP') && N.includes('LANDING DISTANCE: INCREASED'));
  assert.equal(sim.state.law, 'secondary');
  const law = byId(sim, 'law');
  assert.equal(law.title, 'FLIGHT CONTROL MODE'); assert.equal(law.level, 'caution'); assert.equal(law.aural, 'beeper');
  assert.ok(notes(law).includes('AUTOPILOT NOT AVAILABLE') && notes(law).includes('NO ENVELOPE PROTECTION'));
  assert.ok(notes(law).includes('RAT: DEPLOYED'));
  // One system alone: no flight control mode caution.
  const one = cruise('b787-9'); fail(one, 'hyd-sys', 2); run(one, 6);
  assert.deepEqual(ids(one), ['hyd-2']);
  assert.ok(notes(byId(one, 'hyd-2')).includes('THRUST REVERSER R: INOP'));
  // All three: direct, PRI FLIGHT COMPUTERS.
  const all = cruise('b777-300er'); for (const s of [0, 1, 2]) fail(all, 'hyd-sys', s); run(all, 6);
  assert.equal(byId(all, 'law').title, 'PRI FLIGHT COMPUTERS');
  sim.repair('all'); run(sim, 12);
  assert.ok(!alertsOf(sim).some((a) => a.id.startsWith('hyd') || a.id === 'law'));
});

test('A321 flaps jammed at 1, lever FULL: F/CTL FLAPS LOCKED; the lever back ticks the step; the landing\'s numbers', () => {
  const sim = slow(undefined, 1); run(sim, 1);
  sim.controls.flapLever = 1; run(sim, 25);   // slats 18, flaps 0 (CONF 1 above the 1+F speed? the sim decides)
  fail(sim, 'flaps-jam'); sim.controls.flapLever = 4; run(sim, 40);
  const st = sim.state, a = byId(sim, 'flaps-jam');
  assert.ok(a); assert.equal(a.level, 'caution'); assert.equal(a.aural, 'sc');
  assert.equal(a.title, 'F/CTL FLAPS LOCKED', 'the lever asks for more than they give');
  assert.equal(a.steps[0].kind, 'fly'); assert.equal(a.steps[0].done, false);
  const LN = landingNumbers(st, 'airbus', 'a321neo');
  assert.ok(Math.abs(LN.vapp - (st.vls / KT + 5)) < 0.01, 'VAPP is the sim\'s own VLS + 5');
  assert.ok(LN.vlsFull < LN.vls && LN.factor > 1.1 && LN.factor < 2.5, `factor ${LN.factor}`);
  const N = notes(a);
  assert.ok(N.includes(`VAPP: VLS + 5 = ${Math.round(LN.vapp)} KT`));
  assert.ok(N.includes(`LDG DIST: × ${LN.factor.toFixed(2)} (VS CONF FULL)`));
  assert.ok(N.includes('GPWS FLAP MODE ..... OFF'));
  assert.ok(N.includes(`SLATS ${Math.round(st.slatDeg)}° FLAPS ${Math.round(st.flapDeg)}°`));
  // The lever back where the flaps are: the step ticked.
  const m = /TO (\S+)\)/.exec(a.steps[0].text); assert.ok(m);
  sim.controls.flapLever = ['0', '1', '2', '3', 'FULL'].indexOf(m[1]); run(sim, 1);
  assert.equal(byId(sim, 'flaps-jam').steps[0].done, true);
  // The full-flap VLS from the type's lift tables: with the surfaces at landing flap the factor is 1.
  assert.ok(Math.abs(landingNumbers({ vls: 70, slatDeg: 27, flapDeg: 34 }, 'airbus', 'a321neo').factor - 1) < 1e-9);
  sim.repair('all'); run(sim, 1);
  assert.equal(byId(sim, 'flaps-jam'), undefined);
});

test('slats jammed: F/CTL SLATS FAULT on the A321; SLATS DRIVE and FLAPS DRIVE on the 787 with Boeing\'s words', () => {
  const a = slow(undefined, 0); run(a, 1); fail(a, 'slats-jam'); run(a, 1);
  const s = byId(a, 'slats-jam');
  assert.equal(s.title, 'F/CTL SLATS FAULT'); assert.equal(s.steps[0].done, true, 'the lever where the slats are');
  a.controls.flapLever = 2; run(a, 5);
  assert.equal(byId(a, 'slats-jam').title, 'F/CTL SLATS LOCKED');
  const b = slow('b787-9', 2); run(b, 1); fail(b, 'slats-jam'); fail(b, 'flaps-jam'); b.controls.flapLever = 9; run(b, 5);
  const t = ids(b);
  assert.ok(t.includes('slats-jam') && t.includes('flaps-jam'));
  const f = byId(b, 'flaps-jam');
  assert.equal(f.title, 'FLAPS DRIVE'); assert.equal(f.aural, 'beeper'); assert.equal(byId(b, 'slats-jam').title, 'SLATS DRIVE');
  assert.match(f.steps[0].text, /^FLAP LEVER ..... FLAPS \d+$/);
  assert.ok(notes(f).some((x) => /^APPROACH SPEED: VREF \+ 5 = \d+ KT$/.test(x)));
  assert.ok(notes(f).some((x) => /^LANDING DISTANCE: × \d\.\d\d \(VS FLAPS 30\)$/.test(x)));
  b.repair('all'); run(b, 1);
  assert.ok(!ids(b).some((x) => x.endsWith('-jam')));
});

test('on the ground with nothing failed (engines shut down at the gate): no hydraulics alerts', () => {
  const g = createSim(); g.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 1, gearDown: true, fuelKg: 8000, payloadKg: 10000 });
  run(g, 1); g.engineSwitch(0, false); g.engineSwitch(1, false); run(g, 10);
  assert.ok(g.state.hyd.on);
  assert.deepEqual(alertsOf(g), []);
});

// ---- the screens: a recording context (every call and property set, in order) ----
function recCanvas(w) {
  const calls = [];
  const st = { font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000' };
  const px = () => { const m = /([\d.]+)px/.exec(st.font); return m ? +m[1] : 10; };
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return (s) => ({ width: String(s).length * px() * 0.56 });
      if (p in st) return st[p];
      return (...a) => { calls.push([p, ...a.map((x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : String(x)))].join(' ') + ' ' + st.fillStyle + ' ' + st.strokeStyle); };
    },
    set(t, p, v) { st[p] = v; calls.push('set ' + String(p) + ' ' + v); return true; },
  });
  return { cv: { ctx, w, h: w * 0.62, begin() { calls.length = 0; } }, calls };
}
const viewOf = (sim, st) => ({ state: st || sim.state, controls: sim.controls, ap: {}, timeScale: 1 });
const texts = (calls) => calls.filter((c) => c.startsWith('fillText ')).map((c) => c.split(' ')[1]);
const panels = [['a321neo', undefined, createEnginesPanel], ['b787-9', 'b787-9', createEicas], ['b777-300er', 'b777-300er', createEicas]];

test('the engine display, nothing failed: every canvas call the same as without state.hyd at all; hydSig empty', () => {
  for (const [id, t, make] of panels) {
    const sim = cruise(t); run(sim, 1);
    const A = recCanvas(400), B = recCanvas(400);
    const pa = make(A.cv), pb = make(B.cv); pa.setType(resolveDef(id)); pb.setType(resolveDef(id));
    pa.draw(viewOf(sim));
    const bare = { ...sim.state }; delete bare.hyd;
    pb.draw(viewOf(sim, bare));
    assert.ok(A.calls.length > 50);
    assert.deepEqual(A.calls, B.calls, id);
    assert.equal(hydSig(sim.state), '');
  }
});

test('the engine display with the hydraulics failing: G B Y (L C R) green with pressure, amber without, RAT', () => {
  const sim = cruise(); fail(sim, 'hyd-sys', 0); fail(sim, 'hyd-sys', 2); run(sim, 6);
  const R = recCanvas(400), p = createEnginesPanel(R.cv); p.setType(resolveDef('a321neo'));
  p.draw(viewOf(sim));
  const col = (s) => { const c = R.calls.find((x) => x.startsWith('fillText ' + s + ' ')); return c && c.split(' ').slice(-2)[0]; };
  assert.equal(col('G'), '#ffa515'); assert.equal(col('Y'), '#ffa515'); assert.equal(col('B'), '#3cff4e');
  assert.equal(col('RAT'), '#3cff4e');
  assert.match(hydSig(sim.state), /^101R$/);
  const b = cruise('b787-9'); fail(b, 'hyd-sys', 0); fail(b, 'hyd-sys', 1); run(b, 6);
  const Q = recCanvas(400), e = createEicas(Q.cv); e.setType(resolveDef('b787-9'));
  e.draw(viewOf(b));
  const colB = (s) => { const c = Q.calls.find((x) => x.startsWith('fillText ' + s + ' ')); return c && c.split(' ').slice(-2)[0]; };
  assert.equal(colB('L'), '#ffa515'); assert.equal(colB('C'), '#ffa515'); assert.equal(colB('R'), '#3cff4e');
  assert.equal(colB('RAT'), '#3cff4e');
  assert.ok(Q.calls.some((c) => c.startsWith('fillText HYD PRESS SYS L ')), 'its caution listed');
});

test('the gear\'s system lost (green; the 787\'s centre), lever down in flight: the gear caution, its gravity step, the legs down in about 30 s', () => {
  for (const [t, sys, title] of [[undefined, 0, 'L/G GEAR NOT DOWNLOCKED'], ['b787-9', 1, 'GEAR DISAGREE']]) {
    const sim = cruise(t, { z: 3000 * FT, iasMs: 180 * KT }); fail(sim, 'hyd-sys', sys); run(sim, 6);
    sim.controls.gearDown = true; run(sim, 2);
    const g = byId(sim, 'gear');
    assert.ok(g, (t || 'a321') + ': the gear caution'); assert.equal(g.title, title);
    const k = g.steps.findIndex((s) => s.act && s.act.name === 'gravityGear');
    assert.ok(k >= 0);
    assert.equal(runStep(sim, g.steps[k]), true);
    let tDown = -1;
    for (let i = 0; i < 90 && tDown < 0; i++) { run(sim, 1); if (sim.state.gearLegs.every((p) => p >= 0.999)) tDown = i + 1; }
    assert.ok(tDown > 5 && tDown < 60, `down in ${tDown} s`);
    assert.equal(byId(sim, 'gear'), undefined, 'the caution clears');
    assert.ok(byId(sim, 'hyd-' + sys), 'the system\'s own caution stays');
  }
});
