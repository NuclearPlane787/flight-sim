// v0.5.0, flying designs: a four-engine 777 and a GE90 A321 with its gear lengthened take off and climb, then fly a
// 10 nm final and land (v0.5.2: and two designs made of parts), flown by the game's test pilot (tests/e2e-controller.js, run here in node with a stand-in
// for the page: window.__fs's sim and input). Flat ground at height 0; the runway along grid north from (0, 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { newDesign, designDef, designNumbers, addPart } from '../src/sim/designs.js';

const KT = 0.514444, FT = 0.3048, NM = 1852, DEG = Math.PI / 180, DT = 1 / 120;
const SRC = readFileSync(new URL('./e2e-controller.js', import.meta.url), 'utf8');

// The controller and a page-like loop: the controller, then the keyboard's lever into the controls (main.js), the
// sim stepped; the A/THR's lever back into the keyboard's while it drives.
function rig(design) {
  const sim = createSim({ type: design });
  const input = { lever: 0 };
  const window = { __fs: { sim, input } };
  new Function('window', SRC)(window);
  const ctl = window.__e2e, fly = window.__fsController;
  const events = [];
  const step = () => {
    fly(sim, DT);
    if (sim._core.athrDriving) input.lever = sim.controls.thrust; else sim.controls.thrust = input.lever;
    sim.step(DT);
    events.push(...sim.events); sim.events.length = 0;
  };
  return { sim, input, ctl, step, events, log: window.__e2eLog };
}

function takeoffAndClimb(design, lever) {
  const def = designDef(design);
  const r = rig(design), { sim, ctl, input } = r, s = sim.state;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: def.data.TAKEOFF_FLAP_LEVER, gearDown: true, fuelKg: 20000, payloadKg: def.defaults.pax * 84 });
  sim.controls.flapLever = def.data.TAKEOFF_FLAP_LEVER; sim.controls.spoilersArmed = true;
  ctl.rwyHdg = 0; ctl.vr = def.family === 'boeing' ? 160 : 145; ctl.phase = 'takeoff';
  input.lever = lever;
  let apOn = false, maxPitch = 0;
  for (let k = 0; k < 120 * 240; k++) {
    r.step();
    if (s.agl < 35 * FT) maxPitch = Math.max(maxPitch, s.pitch / DEG);   // the rotation's, not the climb's
    assert.equal(s.crashed, null, `${def.engineName}: crashed (${s.crashed}) at ${s.t.toFixed(1)} s: ${r.log.join(' | ')}`);
    if (!s.onGround && s.agl > 50 * FT) sim.controls.gearDown = false;
    if (!apOn && s.agl > 600 * FT && sim._core.airTime > 6) {
      apOn = true; ctl.phase = 'idle';
      sim.controls.pitch = sim.controls.roll = sim.controls.yaw = 0;
      const ap = sim.ap;
      ap.setHdg(0); ap.hdgSel?.(); ap.setAlt(8000); ap.setSpd(240);
      if (!ap.athr) ap.toggleAthr();
      ap.engageAp(); ap.levelChange();
    }
    if (apOn && s.pos.z > 3000 * FT && sim.controls.flapLever) sim.controls.flapLever = 0;
    if (apOn && s.pos.z > 7900 * FT) break;
  }
  return { sim, s, apOn, maxPitch, log: r.log };
}

function finalAndLand(design) {
  const def = designDef(design);
  const r = rig(design), { sim, ctl, input } = r, s = sim.state;
  const dist = 10 * NM, z = 15 + Math.tan(3 * DEG) * dist;
  const finalFlap = def.data.FINAL_FLAP_LEVER ?? 1;
  const ic = { x: 0, y: -dist, z, hdg: 0, onGround: false, iasMs: 180 * KT, flapLever: finalFlap, gearDown: false, fuelKg: 12000, payloadKg: def.defaults.pax * 84 };
  sim.reset(ic);
  if (s.vmm && s.vmm / KT + 10 > 180) sim.reset({ ...ic, iasMs: (Math.round(s.vmm / KT) + 10) * KT });
  sim.controls.flapLever = finalFlap;
  input.lever = sim.controls.thrust = Math.min(sim.controls.thrust, sim.leverClimb);
  const ap = sim.ap;
  ap.setSpd(Math.round(s.ias / KT)); ap.engageAp(); if (!ap.athr) ap.toggleAthr();
  ctl.axis = { tx: 0, ty: 0, ux: 0, uy: 1, hdg: 0, elev: 0 };
  ctl.phase = 'approach';
  let td = null;
  for (let k = 0; k < 120 * 400 && ctl.phase !== 'stopped'; k++) {
    r.step();
    assert.equal(s.crashed, null, `${def.engineName}: crashed (${s.crashed}) at ${s.t.toFixed(1)} s: ${r.log.join(' | ')}`);
    for (const e of r.events) if (e.type === 'touchdown' && !td) td = e;
    r.events.length = 0;
  }
  return { sim, s, td, phase: ctl.phase, log: r.log };
}

const CASES = [
  { name: 'a four-engine 777-300ER', design: newDesign('b777-300er', { id: 'fly-4x777', count: 4 }), lever: 1 },
  // Two GE90s on an A321 at full thrust: a thrust-to-weight over 1 and a thrust line far below the CG, which pitches it
  // up on the runway into a tail strike (the physics: tests/designs.test.mjs's numbers). Its pilot takes off at about
  // a third of the lever, which is still more thrust than the A321neo's own TOGA.
  { name: 'a GE90 A321 with 1.5 m longer gear', design: newDesign('a321neo', { id: 'fly-ge90-a321', engine: 'ge90-115b', gearExtendM: 1.5 }), lever: 0.3 },
  // v0.5.2, designs made of parts: four LEAP-1As (a pair over the wing) with two wing tanks; a 787 with a LEAP-1A pair
  // over the wing beside its GEnx (mixed engines, each its own thrust). Their pilots take off part way (light, the
  // A321's full thrust would lift its nose: the warehouse warns past 0.8).
  { name: 'an A321 with a LEAP pair over the wing and two wing tanks', design: addPart(addPart(newDesign('a321neo', { id: 'fly-overwing' }),
    { kind: 'engine', engine: 'leap-1a', mount: 'overwing', side: 1, s: 9.5 }), { kind: 'tank', mount: 'wing', side: 1, s: 12, kg: 3000 }), lever: 0.55 },
  { name: 'a 787-9 with a LEAP-1A pair over the wing', design: addPart(newDesign('b787-9', { id: 'fly-787-mixed' }), { kind: 'engine', engine: 'leap-1a', mount: 'overwing', side: 1, s: 15 }), lever: 0.8 },
];
for (const C of CASES) {
  test(`${C.name} takes off, climbs on the autopilot and lands`, () => {
    const def = designDef(C.design), N = designNumbers(def);
    assert.ok(N.engines.every((e) => e.clearRestM > 0), 'the nacelles clear the ground at rest');
    assert.ok(N.cgShiftMac > -0.12 && N.cgShiftMac < 0.25, `the CG within the warehouse's limits: ${(N.cgShiftMac * 100).toFixed(1)} % MAC`);
    const up = takeoffAndClimb(C.design, C.lever);
    assert.ok(up.apOn, `climbed out to the AP: ${up.log.join(' | ')}`);
    assert.ok(up.s.pos.z > 7900 * FT, `climbed to 8,000 ft: ${(up.s.pos.z / FT).toFixed(0)} ft`);
    assert.equal(up.s.engines.length, def.engineCount);
    assert.ok(up.maxPitch < def.data.PITCH_TAILSTRIKE_DEG + 6);
    const down = finalAndLand(C.design);
    assert.ok(down.td, `touched down: ${down.log.join(' | ')}`);
    assert.ok(down.td.vsMs > -3, `a landing, not an arrival: ${down.td.vsMs.toFixed(2)} m/s`);
    assert.ok(Math.abs(down.td.x) < 30 && down.td.y > -50 && down.td.y < 1500, `on the runway: ${down.td.x.toFixed(1)}, ${down.td.y.toFixed(0)} m`);
    assert.equal(down.phase, 'stopped', `stopped: ${down.log.join(' | ')}`);
    if (process.env.SIM_DEBUG) console.log(C.name, '| up:', up.log.join(' | '), '| 8,000 ft at', up.s.t.toFixed(0), 's | down:', down.log.join(' | '), '| td', JSON.stringify({ vs: +down.td.vsMs.toFixed(2), g: +down.td.g.toFixed(2), x: +down.td.x.toFixed(1), y: +down.td.y.toFixed(0), pitch: +(down.td.pitch / DEG).toFixed(1) }));
  });
}
