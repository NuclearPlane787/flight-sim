// v0.7.4, Shane's item 9 (the brief's part 1, item 9): the A321 lands itself in APPR with the AP on. Four finals,
// two in each region (Gimpo 14R, Haneda 34R; Heathrow 27R, Frankfurt 25L), in still air: each touchdown under
// 300 ft/min, within 1.5 m of the centreline and in the touchdown zone, the rollout on the centreline; the FMA's
// LAND, FLARE and ROLL OUT; the thrust to idle at 10 ft (the RETARD call's height in an autoland).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRegion, REGION_ID } from './region-run.mjs';
import { endOf, against, onFinal, NM, KT, FT, DEG } from './v074-cockpit-finals.mjs';

const FINALS = {
  'east-asia': [['RKSS', '14R'], ['RJTT', '34R']],
  europe: [['EGLL', '27R'], ['EDDF', '25L']],
};

async function autoland(icao, ident) {
  const { createSim } = await import('../src/sim/sim.js');
  const { end, runway } = await endOf(icao, ident);
  const other = runway.ends.find((e) => e !== end);
  const hdgGrid = Math.atan2(other.x - end.x, other.y - end.y);
  const sim = createSim({ type: 'a321neo', ground: () => ({ h: end.elevM, kind: 'runway' }) });
  const A = sim.type.data;
  const d = 10 * NM, p = onFinal(end, 10);
  const z = end.elevM + 50 * FT + Math.tan(3 * DEG) * d;
  sim.reset({ x: end.x - Math.sin(hdgGrid) * d, y: end.y - Math.cos(hdgGrid) * d, z, hdg: hdgGrid, onGround: false, iasMs: 150 * KT,
    flapLever: A.FLAP_LEVER ? A.FLAP_LEVER.length - 1 : 4, gearDown: true, fuelKg: 5000, payloadKg: 14000,
    ap: { ap: true, athr: true, spdKt: 150, hdgDeg: 0, altFt: Math.round((end.elevM / FT + 3000) / 100) * 100 } });
  sim.controls.gearDown = true; sim.controls.spoilersArmed = true;
  sim.ap.setIls({ x: end.x, y: end.y, hdgGrid, elev: end.elevM, gsDeg: 3 });
  sim.ap.setSpd(Math.round(sim.state.vls / KT + 5));
  sim.ap.appr();
  const S = sim.state, seen = new Set();
  const out = { seen, td: null, rolloutMax: 0, leverAt12: null, leverAt5: null, stopXte: 0, crashed: null, discAt: null };
  let touched = false;
  for (let i = 0; i < 500 * 120; i++) {
    sim.step(1 / 120);
    seen.add(`${sim.ap.lateral}|${sim.ap.vertical}`);
    const aglFt = S.agl / FT, a = against(end, S.pos.x, S.pos.y);
    if (!touched && aglFt < 12 && out.leverAt12 === null) out.leverAt12 = sim.controls.thrust;
    if (!touched && aglFt < 5 && out.leverAt5 === null) out.leverAt5 = sim.controls.thrust;
    for (const e of sim.events) {
      if (e.type === 'touchdown' && !touched) {
        touched = true;
        const t = against(end, e.x ?? S.pos.x, e.y ?? S.pos.y);
        out.td = { fpm: Math.abs(e.vsMs) / FT * 60, xte: t.xte, along: t.along };
      }
      if (e.type === 'apDisconnect' && !out.discAt) out.discAt = { reason: e.reason, gsKt: S.gs / KT, aglFt };
    }
    sim.events.length = 0;
    if (touched) {
      // The pilot's part of a rollout: the brakes (the AP steers).
      sim.controls.brakeL = sim.controls.brakeR = 0.5;
      out.rolloutMax = Math.max(out.rolloutMax, Math.abs(a.xte));
      out.stopXte = a.xte;
    }
    if (S.crashed || (touched && S.gs < 10 * KT)) break;
  }
  out.crashed = S.crashed;
  return out;
}

function checks(r, label) {
  const has = (m) => [...r.seen].some((s) => s.includes(m));
  assert.equal(r.crashed, null, label);
  assert.ok(has('LAND|LAND'), `${label}: LAND (${[...r.seen].join(', ')})`);
  assert.ok(has('|FLARE'), `${label}: FLARE`);
  assert.ok(has('ROLL OUT|ROLL OUT'), `${label}: ROLL OUT`);
  assert.ok(r.td, `${label}: touched down`);
  assert.ok(r.td.fpm < 300 && r.td.fpm > 0, `${label}: ${r.td.fpm.toFixed(0)} ft/min at touchdown`);
  assert.ok(Math.abs(r.td.xte) < 1.5, `${label}: ${r.td.xte.toFixed(2)} m off the centreline at touchdown`);
  assert.ok(r.td.along > 150 && r.td.along < 900, `${label}: ${r.td.along.toFixed(0)} m past the threshold (the touchdown zone)`);
  assert.ok(r.rolloutMax < 3, `${label}: the rollout ${r.rolloutMax.toFixed(2)} m off at most`);
  assert.ok(r.leverAt12 > 0.05, `${label}: thrust still on at 12 ft (${r.leverAt12})`);
  assert.ok(r.leverAt5 < r.leverAt12, `${label}: retarding by 5 ft (${r.leverAt5})`);
  assert.equal(r.discAt?.reason, 'rollout', `${label}: the AP lets go at the rollout's end, not before`);
}

const run = (region) => {
  for (const [icao, ident] of FINALS[region]) {
    test(`${region} ${icao} ${ident}: the A321 autolands in still air`, async () => {
      const r = await autoland(icao, ident);
      console.log(`${icao} ${ident}: ${[...r.seen].join(', ')}; td ${JSON.stringify(r.td)}; rollout ${r.rolloutMax.toFixed(2)} m; lever ${r.leverAt12?.toFixed(3)} → ${r.leverAt5?.toFixed(3)}; off ${JSON.stringify(r.discAt)}`);
      checks(r, `${icao} ${ident}`);
    });
  }
};
if (inRegion('europe', import.meta.url)) run('europe');
if (REGION_ID === 'east-asia') run('east-asia');

// In a crosswind: the decrab from 150 ft (the pedals yaw the nose onto the course while the bank holds the track) and
// the rollout's stiffer law. Wider limits than the still-air finals': a 20 kt crosswind leaves about 2.5° of crab.
if (REGION_ID === 'east-asia') {
  test('a crosswind autoland (10 and 20 kt): decrabbed, near the centreline, the rollout on it', async () => {
    const { createSim } = await import('../src/sim/sim.js');
    const { calmWeather } = await import('../src/sim/weather.js');
    for (const kt of [10, 20]) {
      const sim = createSim({ type: 'a321neo', ground: () => ({ h: 20, kind: 'runway' }) });
      sim.setWeather({ ...calmWeather(), preset: 'x', seed: 1, turbulence: 'none', wind: { fromDeg: 90, kt, gustKt: 0 }, aloft: { fromDeg: 90, kt: kt * 1.3 } });
      const d = 10 * NM;
      sim.reset({ x: 0, y: -d, z: 20 + 15 + Math.tan(3 * DEG) * d, hdg: 0, onGround: false, iasMs: 150 * KT, flapLever: 4, gearDown: true, fuelKg: 5000, payloadKg: 14000,
        ap: { ap: true, athr: true, spdKt: 150, hdgDeg: 0, altFt: 3000 } });
      sim.controls.spoilersArmed = true;
      sim.ap.setIls({ x: 0, y: 0, hdgGrid: 0, elev: 20, gsDeg: 3 });
      sim.ap.setSpd(Math.round(sim.state.vls / KT + 5)); sim.ap.appr();
      let td = null, rmax = 0;
      for (let i = 0; i < 500 * 120; i++) {
        sim.step(1 / 120);
        const S = sim.state;
        for (const e of sim.events) if (e.type === 'touchdown' && !td) td = { fpm: Math.abs(e.vsMs) / FT * 60, x: e.x, crab: Math.atan2(Math.sin(S.hdg), Math.cos(S.hdg)) / DEG };
        sim.events.length = 0;
        if (td) { sim.controls.brakeL = sim.controls.brakeR = 0.5; rmax = Math.max(rmax, Math.abs(S.pos.x)); }
        if (S.crashed || (td && S.gs < 10 * KT)) break;
      }
      console.log(`${kt} kt: ${JSON.stringify(td)}; rollout ${rmax.toFixed(2)} m`);
      assert.equal(sim.state.crashed, null);
      assert.ok(td && td.fpm < 300, `${kt} kt: ${td?.fpm.toFixed(0)} ft/min`);
      assert.ok(Math.abs(td.crab) < 3, `${kt} kt: ${td.crab.toFixed(1)}° of crab at the wheels`);
      assert.ok(Math.abs(td.x) < 2.5, `${kt} kt: ${td.x.toFixed(2)} m off at the wheels`);
      assert.ok(rmax < 4, `${kt} kt: the rollout ${rmax.toFixed(2)} m off at most`);
    }
  });
}
