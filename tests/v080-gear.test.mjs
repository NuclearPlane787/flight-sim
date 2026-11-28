// v0.8.0, part 6, the gear: each leg's position under the gear failures (failures.js, sim.js's updateLegs() and
// collapseStep()), the gravity extension, the repairs; then landings at Gimpo's 14R on the A321neo and the 787-9 with
// the gear up, a leg up and a leg collapsing (tests/v080-gear-land.mjs flies them with the game's test pilot): under
// the limits (failures.js's BELLY) each slides to a stop on the runway, over them (12 ft/s at the first touch, 25° of
// bank) each crashes; and the landing card says what kind of landing it was (score.js's gearLanding()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { armed, GRAVITY_GEAR_S, BELLY, L_NOLOCK, L_COLLAPSE, L_GONE, G_NOEXT, G_GRAV } from '../src/sim/failures.js';
import { gearLanding, gearAtTouchdown } from '../src/score.js';
import { verdict, gearLine } from '../src/ui/score-panel.js';
import { land, line, KT, FT, DT } from './v080-gear-land.mjs';

const TYPES = ['a321neo', 'b787-9'];
const run = (sim, s) => { for (let i = 0; i < s / DT; i++) sim.step(DT); sim.events.length = 0; };
// In the air at 3,000 ft, level, gear up, the autopilot holding it (so nothing but the gear moves).
function aloft(type, plan) {
  const sim = createSim({ type });
  sim.reset({ x: 0, y: 0, z: 3000 * FT, hdg: 0, onGround: false, iasMs: 200 * KT, flapLever: 1, gearDown: false, fuelKg: 8000, payloadKg: 12000,
    ap: { ap: true, athr: true, spdKt: 200, hdgDeg: 0, altFt: 3000 } });
  sim.controls.gearDown = false;
  if (plan) sim.setFailures(plan);
  run(sim, 1);
  return sim;
}
const legs = (sim) => sim.state.gearLegs.map((v) => +v.toFixed(3));

for (const type of TYPES) {
  test(`${type}: the normal extension fails: the doors open, the legs stay up; the gravity extension drops them in about ${GRAVITY_GEAR_S} s`, () => {
    const sim = aloft(type, armed(null, { kind: 'gear-noext' }, 0, 3));
    sim.controls.gearDown = true;
    run(sim, 20);
    assert.deepEqual(legs(sim), [0, 0, 0]);
    assert.equal(sim.state.gearPos, 0);
    assert.equal(sim.state.gearDoors, 1, 'the doors open');
    assert.ok(sim.state.gearSys & G_NOEXT);
    assert.ok(sim.gravityGear());
    assert.ok(sim.state.gearSys & G_GRAV);
    run(sim, GRAVITY_GEAR_S * 0.5);
    const half = legs(sim);
    assert.ok(half.every((v) => v > 0.3 && v < 0.7), `half way at ${GRAVITY_GEAR_S / 2} s: ${half}`);
    run(sim, GRAVITY_GEAR_S * 0.5 + 0.5);
    assert.deepEqual(legs(sim), [1, 1, 1], 'down and locked');
    assert.ok(sim.state.gearPos > 0.99);
    // and the lever up again doesn't raise them: a gravity extension stays down
    sim.controls.gearDown = false; run(sim, 15);
    assert.deepEqual(legs(sim), [1, 1, 1]);
  });

  test(`${type}: with the gravity extension failed too, the legs stay up whatever is done`, () => {
    const sim = aloft(type, armed(armed(null, { kind: 'gear-noext' }, 0, 3), { kind: 'gear-nograv' }, 0, 4));
    sim.controls.gearDown = true; run(sim, 2);
    sim.gravityGear(); run(sim, GRAVITY_GEAR_S + 10);
    assert.deepEqual(legs(sim), [0, 0, 0]);
    assert.equal(sim.state.gearPos, 0);
  });

  for (const leg of [0, 1, 2]) {
    test(`${type}: leg ${leg} won't lock: it stays up, the other two come down, gearPos their mean (the "too low, gear" condition holds); the repair brings it down`, () => {
      const sim = aloft(type, armed(null, { kind: 'gear-nolock', target: leg }, 0, 5));
      sim.controls.gearDown = true; run(sim, 20);
      const L = legs(sim);
      for (let i = 0; i < 3; i++) assert.equal(L[i], i === leg ? 0 : 1, `legs ${L}`);
      assert.ok(Math.abs(sim.state.gearPos - 2 / 3) < 1e-9);
      assert.ok(sim.state.gearPos < 0.99, 'too low, gear: gearPos < 0.99');
      assert.ok(sim.state.gearLegFlags[leg] & L_NOLOCK);
      sim.gravityGear(); run(sim, GRAVITY_GEAR_S + 5);
      assert.equal(legs(sim)[leg], 0, 'not even by gravity');
      assert.ok(sim.repair('all'));
      run(sim, 15);
      assert.deepEqual(legs(sim), [1, 1, 1]);
      assert.equal(sim._core.gOn, 0, 'one position for all again');
      assert.equal(sim.state.gearPos, 1);
    });
  }

  test(`${type}: each gear failure repaired puts the gear where the lever says, one position for all`, () => {
    for (const [plan, lever] of [
      [armed(null, { kind: 'gear-noext' }, 0, 3), true],
      [armed(null, { kind: 'gear-noext' }, 0, 3), false],
      [armed(armed(null, { kind: 'gear-noext' }, 0, 3), { kind: 'gear-nograv' }, 0, 4), true],
      [armed(null, { kind: 'gear-nolock', target: 1 }, 0, 5), false],
      [armed(null, { kind: 'gear-collapse', target: 2 }, 0, 6), true],
    ]) {
      const sim = aloft(type, plan);
      sim.controls.gearDown = true; run(sim, 3); sim.gravityGear(); run(sim, 5);
      assert.equal(sim._core.gOn, 1, 'each leg its own while failed');
      assert.ok(sim.repair('all'));
      sim.controls.gearDown = lever; run(sim, GRAVITY_GEAR_S + 15);
      const want = lever ? 1 : 0;
      assert.deepEqual(legs(sim), [want, want, want], `${plan.items.map((i) => i.kind)} lever ${lever}: ${legs(sim)}`);
      assert.equal(sim._core.gOn, 0, `${plan.items.map((i) => i.kind)}: gOn back to 0`);
      assert.equal(sim.state.gearPos, want);
    }
  });

  test(`${type}: a leg armed to collapse is down and locked until the landing`, () => {
    const sim = aloft(type, armed(null, { kind: 'gear-collapse', target: 2 }, 0, 7));
    sim.controls.gearDown = true; run(sim, 20);
    assert.deepEqual(legs(sim), [1, 1, 1]);
    assert.ok(sim.state.gearPos > 0.99, 'the warnings see the gear down');
    assert.ok(sim.state.gearLegFlags[2] & L_COLLAPSE);
  });
}

// ---- the landings ----
// Each landing's numbers, for the report (SIM_DEBUG=1 prints them).
const ROWS = [];
const show = (r) => { ROWS.push(line(r)); if (process.env.SIM_DEBUG) console.log(line(r)); };

function slid(r, label, { scrapes = true } = {}) {
  assert.equal(r.crashed, null, `${label}: crashed (${r.crashed}): ${line(r)}`);
  assert.ok(r.stopped, `${label}: stopped: ${line(r)}`);
  assert.ok(r.onPavement, `${label}: at rest on the runway: ${line(r)}`);
  assert.ok(Math.abs(r.stop.xte) < 10, `${label}: near the centreline: ${line(r)}`);
  assert.ok(r.slideM > 500 && r.slideM < 1500, `${label}: slid ${r.slideM.toFixed(0)} m (a real one 600 to 1,200 m)`);
  // At rest: on the belly the skids hold it (0.00 m); with a leg down the braked tyres of a leaning aircraft creep at
  // 1 to 1.6 cm/s (gear.js's strut force along the body's z and its slip-based brake: the lead's, reported), so a leg
  // case is held to 0.15 m in 6 s and a belly to 0.02.
  const legDown = r.state.gearLegs.some((v) => v > 0.98);
  assert.ok(r.creep < (legDown ? 0.15 : 0.02), `${label}: at rest, no creep: ${r.creep.toFixed(3)} m in the last 6 s`);
  assert.ok(r.state.gs < 0.05, `${label}: at rest: ${r.state.gs.toFixed(3)} m/s`);
  assert.ok(r.bounceAir < 0.25, `${label}: no bounce back into the air: ${r.bounceAir.toFixed(2)} s`);
  assert.ok(r.maxBank < BELLY.bank / (Math.PI / 180), `${label}: the bank on the ground within the limit`);
  assert.ok(!r.events.some((e) => e.type === 'liftoff'), `${label}: no lift-off on the slide`);
  if (scrapes) assert.ok(r.events.some((e) => e.type === 'scrape'), `${label}: scraped`);
  assert.ok(r.card, `${label}: a landing card`);
}

for (const type of TYPES) {
  test(`${type}: gear up (left up, no failure) at Gimpo 14R: a belly landing that slides to a stop on the runway; the card says so, half off`, () => {
    const r = land(type, 'up'); show(r); slid(r, `${type} up`);
    assert.deepEqual(r.legsAtTd, [0, 0, 0]);
    assert.ok(r.firstSink < BELLY.vs / (FT / 60));
    const g = r.card.gear;
    assert.equal(g.text, 'Gear-up landing');
    assert.equal(g.failure, false);
    assert.ok(g.scraped.includes('engine strike'), `the nacelles scraped: ${g.scraped}`);
    const row = r.card.parts.find((p) => p.name === 'Gear up');
    assert.equal(row.kind, 'penalty'); assert.equal(row.rule, 'half');
    assert.ok(r.card.points <= 50, `half off: ${r.card.points}`);
    assert.ok(!r.card.parts.some((p) => p.name === 'Would have crashed'), 'no would-be crash: it was survived');
    assert.match(gearLine(r.card.gear), /Gear-up landing: on the engines/);
    assert.match(verdict(r.card), /gear was still up/);
  });

  test(`${type}: the gear stuck up (both extensions failed): a belly landing, no deduction for it`, () => {
    const r = land(type, 'nograv'); show(r); slid(r, `${type} nograv`);
    assert.equal(r.card.gear.text, 'Gear-up landing');
    assert.equal(r.card.gear.failure, true);
    const row = r.card.parts.find((p) => p.name === 'Gear up');
    assert.equal(row.minus, 0); assert.equal(row.rule, 'no deduction');
    assert.ok(r.card.points >= 80, `scored on the touchdown as any landing: ${r.card.points}`);
    assert.match(verdict(r.card), /belly/);
  });

  test(`${type}: the gravity extension's gear carries the aircraft on landing`, () => {
    const r = land(type, 'grav'); show(r);
    assert.equal(r.crashed, null, line(r));
    assert.ok(r.stopped && r.onPavement, line(r));
    assert.deepEqual(r.legsAtTd, [1, 1, 1]);
    assert.ok(!r.events.some((e) => e.type === 'scrape'), 'on its wheels: nothing scraped');
    assert.equal(r.card.gear, undefined);
  });

  for (const leg of [0, 1, 2]) {
    test(`${type}: leg ${leg} up (won't lock): it lands on the other two, slides to a stop on the runway; the card says so`, () => {
      const r = land(type, `nolock-${leg}`); show(r); slid(r, `${type} nolock-${leg}`);
      assert.equal(r.legsAtTd[leg], 0);
      const g = r.card.gear;
      assert.equal(g.text, `Landed with the ${['nose', 'left main', 'right main'][leg]} gear up`);
      assert.equal(g.failure, true);
      if (leg > 0) assert.ok(Math.sign(r.stop.xte) === (leg === 1 ? -1 : 1) || Math.abs(r.stop.xte) < 3, `drifts to the side it leans: ${r.stop.xte.toFixed(1)}`);
      assert.match(verdict(r.card), /one piece/);
    });
  }

  test(`${type}: the right main collapses on the roll (seed 7: 4.8 s in) and at the touchdown (seed 4): it slides to a stop on the runway`, () => {
    for (const seed of [7, 4]) {
      const r = land(type, 'collapse-2', { seed }); show(r); slid(r, `${type} collapse seed ${seed}`);
      const ev = r.events.find((e) => e.type === 'gearCollapse');
      assert.equal(ev?.leg, 2);
      assert.ok(r.state.gearLegFlags[2] & L_GONE);
      assert.equal(r.state.gearLegs[2], 0);
      assert.equal(r.card.gear.text, `Right main gear collapsed ${seed === 7 ? 'on the roll' : 'at the touchdown'}`);
      assert.equal(r.card.gear.failure, true);
    }
  });

  test(`${type}: over the limits it crashes: 12 ft/s at the first touch with the gear up; 25° of bank, gear up or a main leg up`, () => {
    // (the pilot holds 900 ft/min to the ground; the flare's last pull leaves 12 ft/s, 710 to 740 ft/min, at the touch)
    const hard = land(type, 'up', { sinkFpm: -900 }); show(hard);
    assert.ok(hard.crashed, `12 ft/s: ${line(hard)}`);
    assert.ok(hard.firstSink > 690, `about 12 ft/s at the first touch: ${line(hard)}`);
    const bank = land(type, 'up', { bankDeg: 25 }); show(bank);
    assert.equal(bank.crashed, 'wingtip strike', line(bank));
    for (const b of [25, -25]) {
      const one = land(type, 'nolock-1', { bankDeg: b }); show(one);
      assert.ok(one.crashed, `${b}°: ${line(one)}`);
    }
    // and 9 ft/s, just under the first touch's 10, is survived
    const firm = land(type, 'up', { sinkFpm: -540 }); show(firm);
    assert.equal(firm.crashed, null, line(firm));
    assert.ok(firm.stopped && firm.onPavement, line(firm));
  });
}

test('with the gear down and nothing failed, nothing of the belly is reached: no scrape, no gear row (both types)', () => {
  for (const type of TYPES) {
    const r = land(type, 'down'); show(r);
    assert.equal(r.crashed, null); assert.ok(r.stopped);
    assert.ok(!r.events.some((e) => e.type === 'scrape' || e.type === 'failure'));
    assert.equal(r.card.gear, undefined);
    assert.ok(!r.card.parts.some((p) => p.kind === 'penalty'), r.card.parts.map((p) => p.name).join(', '));
  }
});

test('Indestructible keeps its own behaviour on a gear-up landing: damage events, not scrapes, and its own card', () => {
  const r = land('a321neo', 'up', { setup: (sim) => sim.setIndestructible(true) });
  assert.equal(r.crashed, null);
  assert.ok(r.events.some((e) => e.type === 'damage'), 'damage events');
  assert.ok(!r.events.some((e) => e.type === 'scrape'), 'no belly scrapes');
  assert.equal(r.card.gear, undefined);
  assert.ok(r.card.parts.some((p) => p.name === 'Would have crashed'));
});

test("the card's words: gearLanding() and gearAtTouchdown()", () => {
  assert.deepEqual(gearAtTouchdown({ gearLegs: [1, 1, 1], failures: [] }), {});
  assert.deepEqual(gearAtTouchdown({}), {}, 'a state from before v0.8.0');
  assert.deepEqual(gearAtTouchdown({ gearLegs: [0, 1, 1], failures: [{ kind: 'gear-nolock', target: 0 }] }), { gearLegs: [0, 1, 1], gearFailure: true });
  assert.equal(gearLanding({}), null);
  assert.equal(gearLanding({ gearLegs: [0, 0, 1] }).text, 'Landed with the nose and left main gear up');
  assert.equal(gearLanding({ gearLegs: [0, 0, 1] }).short, 'Nose + left up');
  assert.equal(gearLanding({ gearLegs: [1, 0, 1] }).short, 'Left main up');
  assert.equal(gearLanding({ gearLegs: [0, 1, 1] }).short, 'Nose gear up');
  assert.equal(gearLanding({ gearLegs: [0, 0, 0] }).short, 'Gear up');
  assert.equal(gearLanding({ gearLegs: [1, 1, 1], t: 10 }, [], [{ t: 14, leg: 2 }]).short, 'Right main collapsed');
  assert.equal(gearLanding({ gearLegs: [1, 1, 1], t: 10 }, [], [{ t: 9.5, leg: 1 }]).text, 'Left main gear collapsed at the touchdown');
  assert.equal(gearLanding({ gearLegs: [1, 1, 1], t: 10 }, [], [{ t: 14, leg: 1 }]).text, 'Left main gear collapsed on the roll');
  assert.equal(gearLanding({ gearLegs: [0, 1, 0], t: 10 }, [], [{ t: 9.6, leg: 2 }]).text, 'Landed with the nose gear up, the right main collapsed');
  assert.equal(gearLine({ text: 'Gear-up landing', scraped: ['engine strike', 'tail strike', 'engine strike'] }), '<div class="fssc-td fssc-gear">Gear-up landing: on the engines and the tail</div>');
  assert.equal(gearLine(undefined), '');
});

test('the landings, for the report', { skip: !process.env.SIM_DEBUG }, () => { console.log(ROWS.join('\n')); });
