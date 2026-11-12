// v0.4.1, Indestructible (a setting): no crash ends the flight. A crash is a damage event, the crash points
// are skids on the ground, the landing card says what would have crashed, and the predicted path ends where
// a crash would have ended it. Off, nothing changes (sim-ground's crash tests, and the golden flight).
//   node --test tests/indestructible.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { createPredictionRun } from '../src/sim/predict-core.js';
import { createScorer, COST } from '../src/score.js';
import { verdict } from '../src/ui/score-panel.js';
import { airborne, onRunway, run, approachPilot, KT, FT, DEG } from './sim-helpers.mjs';

// sim-ground.test.mjs's descent into the ground, with the setting on; the events of the whole minute.
function descendInto(ground, opts = {}) {
  const sim = airborne({ massKg: 70000, altFt: (150 * FT + 4.12) / FT, iasKt: 140, flapLever: 4, gearDown: opts.gearDown ?? true, ground });
  sim.setIndestructible(true);
  const s = sim.state, events = [];
  run(sim, 60, () => {
    approachPilot(sim, opts.hard ? { vs: -1400, flareFt: 0 } : {});
    sim.controls.thrust = 0.2;
    events.push(...sim.events.splice(0));
  });
  return { s, events };
}
const reasons = (evs) => evs.filter((e) => e.type === 'damage').map((e) => e.reason);

test('the four crashes of the ground tests are damage events, once each, and the flight goes on', () => {
  const water = descendInto(() => ({ h: 0, kind: 'water' }));
  const grass = descendInto(() => ({ h: 0, kind: 'ground' }));
  const belly = descendInto(undefined, { gearDown: false });
  const hard = descendInto(undefined, { hard: true });
  for (const [what, r] of [['water', water], ['grass', grass], ['belly', belly], ['hard', hard]]) {
    assert.equal(r.s.crashed, null, what);
    assert.ok(!r.events.some((e) => e.type === 'crash'), `${what}: no crash event`);
    assert.ok(Number.isFinite(r.s.pos.z) && Number.isFinite(r.s.vel.x), `${what}: finite`);
  }
  assert.deepEqual(reasons(water.events).filter((x) => x === 'ditched').length, 1, reasons(water.events).join(', '));
  assert.equal(reasons(grass.events).filter((x) => x === 'ran off the runway').length, 1, reasons(grass.events).join(', '));
  assert.ok(reasons(belly.events).some((x) => /impact|strike/.test(x)), reasons(belly.events).join(', '));
  assert.ok(reasons(hard.events).some((x) => /collapsed/.test(x)), reasons(hard.events).join(', '));
  // The gear held: the hard landing's touchdown is an event like any other.
  assert.ok(hard.events.some((e) => e.type === 'touchdown'));
});

test('a belly landing slides to a stop on the skids, a little into the ground, each type', () => {
  for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
    const sim = createSim({ type });
    const D = sim.type.data, mass = type === 'a321neo' ? 70000 : 220000, fuel = type === 'a321neo' ? 8000 : 25000;
    sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 150 * FT + sim.type.geo.GROUND_Z, iasMs: 145 * KT, flapLever: 4, gearDown: false, fuelKg: fuel, payloadKg: mass - D.OEW - fuel });
    sim.setIndestructible(true);
    const s = sim.state;
    let deepest = 0;
    run(sim, 120, () => {
      approachPilot(sim);
      sim.controls.thrust = s.agl < 10 ? 0 : 0.25;
      sim.events.length = 0;
      deepest = Math.max(deepest, s.scrapeDepth);
    });
    assert.equal(s.crashed, null, type);
    assert.ok(s.scraping, `${type}: on its skids`);
    assert.ok(s.gs < 1, `${type}: stopped (${(s.gs / KT).toFixed(1)} kt)`);
    assert.ok(deepest < 0.6 && s.scrapeDepth < 0.25, `${type}: ${deepest.toFixed(2)} m deepest, ${s.scrapeDepth.toFixed(2)} m at rest`);
    assert.ok(Math.abs(s.roll) < 5 * DEG, `${type}: wings level (${(s.roll / DEG).toFixed(1)}°)`);
  }
});

test('flying into the ground at 280 kt and 100 m/s down: it bounces off, never more than 1.5 m in (v0.4.2: 6 m before the hard stop)', () => {
  const sim = createSim({ type: 'b777-300er' });
  const D = sim.type.data;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 600, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 230000 - D.OEW - 30000 });
  sim.setIndestructible(true);
  const s = sim.state;
  let deepest = 0, hitVs = null;
  run(sim, 60, () => {
    sim.controls.pitch = s.pitch > -35 * DEG && s.agl > 20 ? -1 : 0;
    sim.controls.thrust = 0.8;
    sim.events.length = 0;
    deepest = Math.max(deepest, s.scrapeDepth);
    if (s.scraping && hitVs === null) hitVs = s.vs;
  });
  assert.ok(hitVs < -60, `hit at ${hitVs?.toFixed(0)} m/s`);
  assert.equal(s.crashed, null);
  assert.ok(deepest < 1.5, `${deepest.toFixed(2)} m deep at worst`);
  assert.ok(Number.isFinite(s.pos.z) && s.pos.z > 0, `${s.pos.z}`);
});

test('v0.4.2: into a 30% hillside at 250 kt on the autopilot, the nose stays within 1.5 m of the ground', () => {
  const hill = (x, y) => ({ h: Math.max(0, (y - 3000) * 0.3), kind: 'ground' });
  const sim = createSim({ type: 'b777-300er', ground: hill });
  const D = sim.type.data;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 300, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 230000 - D.OEW - 30000,
    ap: { ap: true, athr: true, spdKt: 250, altFt: 1000 } });
  sim.setIndestructible(true);
  const s = sim.state;
  let deepest = 0, hit = false;
  run(sim, 45, () => { sim.events.length = 0; deepest = Math.max(deepest, s.scrapeDepth); hit ||= s.scraping; });
  assert.ok(hit, 'it hit the hill');
  assert.equal(s.crashed, null);
  assert.ok(deepest < 1.5, `${deepest.toFixed(2)} m deep at worst (v0.4.1: 4.4 m)`);
  assert.ok(Number.isFinite(s.pos.z) && s.pos.z >= hill(s.pos.x, s.pos.y).h - 2, 'on or over the hill');
});

test('v0.4.2: a gear-up landing gets a landing card, each type', () => {
  for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
    const sim = createSim({ type });
    const D = sim.type.data, mass = type === 'a321neo' ? 70000 : 220000, fuel = type === 'a321neo' ? 8000 : 25000;
    sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 150 * FT + sim.type.geo.GROUND_Z, iasMs: 145 * KT, flapLever: 4, gearDown: false, fuelKg: fuel, payloadKg: mass - D.OEW - fuel });
    sim.setIndestructible(true);
    const s = sim.state, sc = createScorer();
    let res = null, touchdowns = 0;
    run(sim, 150, () => {
      approachPilot(sim);
      sim.controls.thrust = s.agl < 10 ? 0 : 0.25;
      const evs = sim.events.splice(0);
      touchdowns += evs.filter((e) => e.type === 'touchdown').length;
      res = sc.update(s, evs) || res;
      return !!res;
    });
    assert.ok(res, `${type}: a card`);
    const p = res.parts.find((q) => q.name === 'Would have crashed');
    assert.ok(p && /impact|strike/.test(p.value), `${type}: ${JSON.stringify(p)}`);
    // (this pilot's gear-up arrivals aren't gentle: the 787's tail touches first at about 1,800 ft/min)
    assert.ok(res.touchdown.vsFpm > 0 && res.touchdown.vsFpm < 2500, `${type}: ${res.touchdown.vsFpm.toFixed(0)} ft/min`);
    assert.ok(touchdowns >= 1 && touchdowns <= 3, `${type}: ${touchdowns} touchdowns (the first, and a bounce or two)`);
  }
});

test('a tail strike on over-rotation: one tail strike event, then the take-off goes on', () => {
  const sim = onRunway({ massKg: 85000, flapLever: 1 });
  sim.setIndestructible(true);
  const s = sim.state, c = sim.controls, events = [];
  c.thrust = 1;
  run(sim, 60, () => {
    if (s.ias > 135 * KT) c.pitch = s.pitch < 12 * DEG ? 1 : 0;
    events.push(...sim.events.splice(0));
  });
  assert.equal(s.crashed, null);
  assert.ok(events.some((e) => e.type === 'tailstrike'));
  assert.deepEqual(reasons(events), ['tail strike']);
  assert.ok(events.some((e) => e.type === 'liftoff') && s.agl > 100, `flying: ${s.agl.toFixed(0)} m up`);
});

test('the setting: in a snapshot only when on, and a restore takes it from the snapshot', () => {
  const a = airborne({ altFt: 3000, iasKt: 200 });
  const off = a.snapshot();
  assert.equal('options' in off, false, 'off writes nothing (old saves restore the same)');
  a.setIndestructible(true);
  assert.equal(a.state.indestructible, true);
  const on = a.snapshot();
  assert.deepEqual(on.options, { indestructible: true });
  const b = createSim();
  b.restore(on);
  assert.equal(b.state.indestructible, true);
  b.restore(off);
  assert.equal(b.state.indestructible, false);
  // Off, a crash is a crash (sim-ground.test.mjs has the rest).
  const c = onRunway({ massKg: 85000, flapLever: 1 });
  c.controls.thrust = 1;
  run(c, 60, () => { if (c.state.ias > 135 * KT) c.controls.pitch = 1; });
  assert.equal(c.state.crashed, 'tail strike');
});

test('the predicted path ends at the first scrape, as it would have at the crash', () => {
  // Gear up and nose down into the flat sea: off, the run ends in a crash; on, at the first skid's touch.
  const mk = (on) => {
    const sim = airborne({ massKg: 70000, altFt: 1500, iasKt: 160, gearDown: false, ap: { ap: true, athr: true, spdKt: 160, vsFpm: -1500, altFt: 0 } });
    sim.setIndestructible(on);
    const r = createPredictionRun(sim.snapshot(), {});
    while (!r.advance(2000));
    return r;
  };
  const off = mk(false), on = mk(true);
  assert.equal(off.reason, 'crash');
  assert.equal(on.reason, 'crash');
  const tEnd = (r) => r.samples[r.samples.length - 1].t;
  assert.ok(Math.abs(tEnd(on) - tEnd(off)) < 2, `${tEnd(on)} vs ${tEnd(off)}`);
});

test('the card: what would have crashed costs as much as missing the runway, and says so', () => {
  const sc = createScorer();
  const s = { t: 100, ias: 70, gs: 70, vs: 0, onGround: true, nz: 1, pos: { x: 400, y: 0, z: 4 }, indestructible: true };
  sc.update({ ...s, t: 98, onGround: false }, [{ type: 'damage', reason: 'hard landing: gear collapsed' }]);
  sc.update(s, [{ type: 'touchdown', vsMs: -6, g: 2.9, x: 400, y: 0, bank: 0, pitch: 5 * DEG, surface: 'runway' }]);
  let res = null;
  for (let i = 0; i < 40 && !res; i++) { s.t += 1; s.gs = Math.max(0, s.gs - 5); res = sc.update(s, []); }
  const p = res.parts.find((q) => q.name === 'Would have crashed');
  assert.ok(p, JSON.stringify(res.parts));
  assert.equal(p.value, 'gear collapsed');
  assert.equal(p.cost, COST.crash);
  assert.equal(res.grade, 'F');
  assert.equal(res.indestructible, true);
  assert.deepEqual(res.damage, ['hard landing: gear collapsed']);
  assert.equal(verdict(res), 'Without Indestructible, that was a crash (hard landing: gear collapsed).');
  // Damage long before the touchdown (a scrape at the take-off, cleared at the lift-off, or an hour before) doesn't count.
  const sc2 = createScorer(), s2 = { ...s, gs: 70 };
  sc2.update({ ...s2, t: 10, onGround: false }, [{ type: 'damage', reason: 'wingtip strike' }]);
  let r2 = sc2.update({ ...s2, t: 100 }, [{ type: 'touchdown', vsMs: -1, g: 1.2, x: 400, y: 0, bank: 0, pitch: 5 * DEG, surface: 'runway' }]);
  for (let i = 0, t = 100; i < 40 && !r2; i++) { t += 1; r2 = sc2.update({ ...s2, t, gs: Math.max(0, 70 - 5 * i) }, []); }
  assert.equal(r2.parts.find((q) => q.name === 'Would have crashed'), undefined);
  assert.equal(r2.indestructible, true);
});
