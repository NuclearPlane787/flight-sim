// v0.7.4, the code review's four faults in the A321's new autoflight, each tested:
//   1. the autoland's state (X.a3*) outlived a new flight, a rewind or a load, and then held the pedals;
//   2. the HDG knob (and setIls(null), LOC, APPR) in LAND left a mode that could never end, with the AP on;
//   3. a save from before v0.7.4 (and a rewind or a jump) left the A321 without its ILS (main.js's part is the loop's
//      re-sync and applyState(); here the sim's: the ILS isn't saved, and an old save restores clean);
//   4. TRK-FPA wasn't reset by a new flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION_ID } from './region-run.mjs';
import { endOf, NM, KT, FT, DEG } from './v074-cockpit-finals.mjs';

const A3 = ['a3Rollout', 'a3RollYaw', 'a3Align', 'a3AlignYaw', 'a3YawClear', 'a3FlareTau', 'a3Crab0', 'a3AlignI', 'a3AlignBI'];

async function onFinal14R() {
  const { createSim } = await import('../src/sim/sim.js');
  const { end, runway } = await endOf('RKSS', '14R');
  const other = runway.ends.find((e) => e !== end);
  const hdgGrid = Math.atan2(other.x - end.x, other.y - end.y);
  const sim = createSim({ type: 'a321neo', ground: () => ({ h: end.elevM, kind: 'runway' }) });
  const d = 10 * NM, z = end.elevM + 50 * FT + Math.tan(3 * DEG) * d;
  const ils = { x: end.x, y: end.y, hdgGrid, elev: end.elevM, gsDeg: 3 };
  const ic = { x: end.x - Math.sin(hdgGrid) * d, y: end.y - Math.cos(hdgGrid) * d, z, hdg: hdgGrid, onGround: false, iasMs: 150 * KT,
    flapLever: 4, gearDown: true, fuelKg: 5000, payloadKg: 14000, ap: { ap: true, athr: true, spdKt: 150, hdgDeg: 0, altFt: Math.round((end.elevM / FT + 3000) / 100) * 100 } };
  const start = () => {
    sim.reset(ic); sim.controls.gearDown = true; sim.controls.spoilersArmed = true;
    sim.ap.setIls(ils); sim.ap.setSpd(Math.round(sim.state.vls / KT + 5)); sim.ap.appr();
  };
  const until = (fn, s = 500) => { for (let i = 0; i < s * 120; i++) { if (fn()) return true; sim.step(1 / 120); } return false; };
  return { sim, end, hdgGrid, ils, start, until };
}

if (REGION_ID === 'east-asia') {
  test('1. a new flight after an autoland\'s ROLL OUT: the pedals are the pilot\'s', async () => {
    const { sim, end, hdgGrid, start, until } = await onFinal14R();
    start();
    assert.ok(until(() => sim.ap.vertical === 'ROLL OUT' && sim.state.gs > 80 * KT && sim.state.gs < 125 * KT));
    sim.reset({ x: end.x, y: end.y, z: end.elevM, hdg: hdgGrid, onGround: true, fuelKg: 5000, payloadKg: 14000 });
    for (const k of A3) assert.ok(!sim.snapshot().core[k], `${k} cleared by the reset`);
    sim.controls.yaw = 0.5; sim.step(1 / 120);
    assert.equal(sim.controls.yaw, 0.5, 'the player\'s pedal stays where the player put it');
  });

  test('1. a rewind to before the autoland, the AP off: the pedals are the pilot\'s; and a save without the a3 keys', async () => {
    const { sim, start, until } = await onFinal14R();
    start();
    const early = sim.snapshot();
    assert.ok(until(() => sim.ap.vertical === 'ROLL OUT' && sim.state.gs > 80 * KT && sim.state.gs < 125 * KT));
    sim.restore(early);
    sim.ap.ap = false;
    sim.controls.yaw = 0.5; sim.step(1 / 120);
    assert.equal(sim.controls.yaw, 0.5);
    // A save from before v0.7.4: no a3 keys at all, restored over a sim mid-rollout.
    start();
    assert.ok(until(() => sim.ap.vertical === 'ROLL OUT' && sim.state.gs > 80 * KT));
    const old = JSON.parse(JSON.stringify(early));
    for (const k of A3) delete old.core[k];
    sim.restore(old);
    for (const k of A3) assert.ok(!sim.snapshot().core[k], `${k} off after an old save`);
    sim.ap.ap = false; sim.controls.yaw = -0.3; sim.step(1 / 120);
    assert.equal(sim.controls.yaw, -0.3);
  });

  test('1. the AP\'s own let-go at the rollout\'s end centres the pedals once, then leaves them', async () => {
    const { sim, start, until } = await onFinal14R();
    start();
    assert.ok(until(() => !sim.ap.ap && sim.state.onGround));
    sim.step(1 / 120);
    assert.equal(sim.controls.yaw, 0);
    sim.controls.yaw = 0.4; sim.step(1 / 120);
    assert.equal(sim.controls.yaw, 0.4);
  });

  test('2. in LAND the HDG and V/S knobs, TRK-FPA, LOC, APPR and the ALT pull do nothing; the autoland goes on', async () => {
    const { sim, start, until } = await onFinal14R();
    start();
    assert.ok(until(() => sim.ap.vertical === 'LAND' && sim.state.agl / FT < 300));
    const ap = sim.ap;
    ap.setHdg(ap.hdgDeg + 20); ap.setVs(-500); ap.setFpa(-2); ap.toggleTrkFpa(); ap.levelChange();
    assert.equal(ap.loc(), false); assert.equal(ap.appr(), false);
    assert.equal(ap.lateral, 'LAND'); assert.equal(ap.vertical, 'LAND');
    assert.equal(ap.armedLateral, ''); assert.equal(ap.armedVertical, ''); assert.equal(ap.trkFpa, false);
    let td = false;
    assert.ok(until(() => {
      for (const e of sim.events) if (e.type === 'touchdown') td = true;
      sim.events.length = 0;
      if (td) sim.controls.brakeL = sim.controls.brakeR = 0.5;   // the pilot's brakes
      return !ap.ap;
    }, 200), `${ap.lateral} ${ap.vertical} at ${(sim.state.agl / FT).toFixed(0)} ft`);
    assert.ok(td, 'it landed'); assert.ok(sim.state.gs < 35 * KT, 'and the AP let go at the rollout\'s end');
  });

  test('2. the ILS gone (or moved) in LAND: the AP lets go, with the warning, out of the autoland\'s modes', async () => {
    for (const change of ['gone', 'moved']) {
      const { sim, ils, start, until } = await onFinal14R();
      start();
      assert.ok(until(() => sim.ap.vertical === 'LAND'));
      sim.ap.setIls(ils);   // the same beam again (syncNav's every re-sync): nothing
      assert.ok(sim.ap.ap && sim.ap.vertical === 'LAND');
      sim.events.length = 0;
      sim.ap.setIls(change === 'gone' ? null : { ...ils, x: ils.x + 400 });
      assert.equal(sim.ap.ap, false, change);
      assert.ok(sim.events.some((e) => e.type === 'apDisconnect' && e.reason === 'ils'));
      assert.ok(!/LAND|FLARE|ROLL/.test(sim.ap.lateral + sim.ap.vertical), `${sim.ap.lateral} ${sim.ap.vertical}`);
      sim.step(1 / 120);
      assert.ok(sim.state.warnings.apDisc, 'the AP-off warning (the cavalry charge)');
    }
  });

  test('3. the ILS isn\'t saved; a pre-v0.7.4 snapshot restores with nothing armed, then LOC arms and captures', async () => {
    const { createSim } = await import('../src/sim/sim.js');
    const { AP_FIELDS } = await import('../src/sim/autopilot.js');
    assert.ok(!AP_FIELDS.includes('ils'));
    const sim = createSim({ type: 'a321neo' });
    sim.reset({ x: 1500, y: -20000, z: 900, hdg: -30 * DEG, onGround: false, iasMs: 160 * KT, flapLever: 2, gearDown: false, fuelKg: 5000, payloadKg: 15000,
      ap: { ap: true, athr: true, spdKt: 160, hdgDeg: 330, altFt: 3000 } });
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    assert.ok(!('ils' in snap.ap));
    for (const k of ['armedLateral', 'armedVertical', 'trkFpa', 'fpaDeg']) delete snap.ap[k];
    const b = createSim({ type: 'a321neo' });
    b.restore(snap);
    assert.equal(b.ap.armedLateral, ''); assert.equal(b.ap.armedVertical, ''); assert.equal(b.ap.trkFpa, false); assert.equal(b.ap.fpaDeg, 0);
    assert.equal(b.ap.ils, null, 'no ILS until main.js derives it');
    b.ap.setIls({ x: 0, y: 0, hdgGrid: 0, elev: 0, gsDeg: 3 });   // what syncNav() does after the load
    assert.equal(b.ap.loc(), true);
    let got = false;
    for (let i = 0; i < 120 * 120 && !got; i++) { b.step(1 / 120); got = b.ap.lateral === 'LOC'; }
    assert.ok(got, b.ap.lateral);
  });

  test('3. main.js re-derives the A321\'s ILS after a load without one, and its loop re-syncs after a rewind or a jump', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(src, /if \(st\.sim\?\.ap && !\('ils' in st\.sim\.ap\)\) syncNav\(\);/);
    assert.match(src, /if \(\(ap\.setIls \|\| ap\.setRoute\) && navKeyNow\(\) !== navKey\) syncNav\(\);/);
  });

  test('4. a new flight opens in HDG-V/S', async () => {
    const { createSim } = await import('../src/sim/sim.js');
    const sim = createSim({ type: 'a321neo' });
    sim.reset({ x: 0, y: 0, z: 1500, hdg: 0, onGround: false, iasMs: 250 * KT, fuelKg: 5000, payloadKg: 15000, ap: { ap: true, athr: true, spdKt: 250, hdgDeg: 0, altFt: 5000 } });
    sim.ap.toggleTrkFpa(); sim.ap.setFpa(-3);
    assert.equal(sim.ap.trkFpa, true);
    sim.reset({ x: 0, y: 0, z: 1500, hdg: 0, onGround: false, iasMs: 250 * KT, fuelKg: 5000, payloadKg: 15000 });
    assert.equal(sim.ap.trkFpa, false); assert.equal(sim.ap.fpaDeg, 0);
  });
}
