// v0.7.4, Shane's item 9: LOC and APPR on the A321's FCU, flown by the Boeings' laws (src/sim/approach-laws.js).
// The FMA's LOC*, LOC, G/S* and G/S; capture and tracking on two finals in each region (an intercept from the side,
// under the glideslope); the AP's disconnect at 80 ft with the cavalry charge (no A321 autoland in v0.7.4); and the
// buttons' logic. The Boeings fly as before: their golden flights and autoland tests. (The autoland itself, from
// LAND at 400 ft, is tests/v074-loc-autoland.test.mjs; with AUTOLAND_ON false the AP lets go at 80 ft instead.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRegion, REGION_ID } from './region-run.mjs';
import { endOf, against, onFinal, NM, KT, FT, DEG } from './v074-cockpit-finals.mjs';
import { AUTOLAND_ON } from '../src/sim/autopilot.js';

const FINALS = {
  'east-asia': [['RKSS', '14L'], ['RJTT', '34R']],
  europe: [['EGLL', '27R'], ['EDDF', '25L']],
};

// An A321 12 nm out, 1.5 km right of the centreline, closing at 30°, level 2,500 ft above the threshold (under the
// glideslope), in CONF 3 with the gear down at 150 kt, AP1 and A/THR on, APPR pushed.
async function approach(icao, ident, { offM = 1500, apprBy = 'appr' } = {}) {
  const { createSim } = await import('../src/sim/sim.js');
  const { end, runway } = await endOf(icao, ident);
  const other = runway.ends.find((e) => e !== end);
  const hdgGrid = Math.atan2(other.x - end.x, other.y - end.y);
  const p = onFinal(end, 12, offM);
  const hdg = hdgGrid - Math.sign(offM) * 30 * DEG;
  const sim = createSim({ type: 'a321neo', ground: () => ({ h: end.elevM, kind: 'grass' }) });
  const altFt = Math.round((end.elevM / FT + 2500) / 100) * 100;
  const { gridToMag } = await import('../src/world/frame.js');
  const hdgMag = ((gridToMag(hdg, p.x, p.y) / DEG) % 360 + 360) % 360;
  sim.reset({ x: p.x, y: p.y, z: altFt * FT, hdg, onGround: false, iasMs: 150 * KT, flapLever: 3, gearDown: true, fuelKg: 5000, payloadKg: 15000,
    ap: { ap: true, athr: true, spdKt: 150, hdgDeg: Math.round(hdgMag), altFt } });
  sim.controls.gearDown = true; sim.controls.flapLever = 3;
  sim.ap.setIls({ x: end.x, y: end.y, hdgGrid, elev: end.elevM, gsDeg: 3 });
  sim.ap[apprBy]();
  const S = sim.state, seen = [];
  const out = { seen, maxXte: 0, maxDev: 0, disc: null, minAgl: 1e9 };
  const note = (m) => { if (seen[seen.length - 1] !== m) seen.push(m); };
  for (let i = 0; i < 600 * 120; i++) {
    sim.step(1 / 120);
    note(`${sim.ap.lateral}|${sim.ap.vertical}`);
    const a = against(end, S.pos.x, S.pos.y);
    const aglFt = S.agl / FT;
    if (out.landAt === undefined && sim.ap.vertical === 'LAND') out.landAt = aglFt;
    if (sim.ap.ap && /^(LOC|LAND)$/.test(sim.ap.lateral) && aglFt < 1500) out.maxXte = Math.max(out.maxXte, Math.abs(a.xte));
    if (sim.ap.ap && /^(G\/S|LAND)$/.test(sim.ap.vertical) && aglFt < 1500 && aglFt > 100) {
      const path = end.elevM + 50 * FT + Math.max(0, -a.along) * Math.tan(3 * DEG);
      out.maxDev = Math.max(out.maxDev, Math.abs(S.pos.z - path));
    }
    for (const e of sim.events) if (e.type === 'apDisconnect' && !out.disc) out.disc = { reason: e.reason, aglFt, xte: a.xte, apDiscWarn: false };
    sim.events.length = 0;
    if (out.disc && out.disc.apDiscWarn === false) out.disc.apDiscWarn = !!S.warnings?.apDisc;
    if (out.disc || S.crashed || a.along > 0) break;
  }
  out.ap = sim.ap; out.crashed = S.crashed;
  return out;
}

function checks(r, label) {
  const order = (m) => r.seen.findIndex((s) => s.includes(m));
  assert.ok(order('LOC*|') >= 0, `${label}: LOC* (${r.seen.join(' → ')})`);
  assert.ok(order('LOC|') > order('LOC*|'), `${label}: then LOC`);
  assert.ok(order('|G/S*') > order('LOC*|'), `${label}: G/S* after the localizer`);
  assert.ok(r.seen.findIndex((s) => s.endsWith('|G/S')) > order('|G/S*'), `${label}: then G/S`);
  assert.ok(r.maxXte < 10, `${label}: on the localizer below 1,500 ft, ${r.maxXte.toFixed(1)} m at most`);
  assert.ok(r.maxDev < 6, `${label}: on the glideslope below 1,500 ft, ${r.maxDev.toFixed(1)} m at most`);
  if (AUTOLAND_ON) {
    assert.ok(r.landAt <= 400 && r.landAt > 380, `${label}: LAND at ${r.landAt?.toFixed(0)} ft`);
    assert.equal(r.disc, null, `${label}: the AP stays on for the autoland`);
  } else {
    assert.ok(r.disc, `${label}: the AP let go`);
    assert.equal(r.disc.reason, 'approach');
    assert.ok(r.disc.aglFt < 80 && r.disc.aglFt > 60, `${label}: at ${r.disc.aglFt.toFixed(0)} ft`);
    assert.ok(r.disc.apDiscWarn, `${label}: with the AP-off warning (the cavalry charge)`);
  }
  assert.equal(r.crashed, null);
}

const runFinals = (region) => {
  for (const [icao, ident] of FINALS[region]) {
    test(`${region} ${icao} ${ident}: APPR captures and tracks LOC and G/S, then LAND at 400 ft`, async () => {
      const r = await approach(icao, ident);
      console.log(`${icao} ${ident}: ${r.seen.join(' → ')}; xte ${r.maxXte.toFixed(2)} m, dev ${r.maxDev.toFixed(2)} m, LAND at ${r.landAt?.toFixed(0)} ft`);
      checks(r, `${icao} ${ident}`);
    });
  }
};

if (inRegion('europe', import.meta.url)) runFinals('europe');

if (REGION_ID === 'east-asia') {
  runFinals('east-asia');

  test('from the left, LOC alone: LOC* and LOC, the vertical stays ALT', async () => {
    const r = await approach('RKSS', '14L', { offM: -1500, apprBy: 'loc' });
    assert.ok(r.seen.some((s) => s.startsWith('LOC|')), r.seen.join(' → '));
    assert.ok(!r.seen.some((s) => s.includes('G/S')), 'no glideslope with LOC alone');
  });

  test('the buttons: nothing to arm without an ILS; LOC and APPR arm, disarm and leave; a heading in LOC is HDG', async () => {
    const { createSim } = await import('../src/sim/sim.js');
    const sim = createSim({ type: 'a321neo' });
    sim.reset({ x: 0, y: -20000, z: 900, hdg: 0, onGround: false, iasMs: 160 * KT, flapLever: 2, gearDown: false, fuelKg: 5000, payloadKg: 15000,
      ap: { ap: true, athr: true, spdKt: 160, hdgDeg: 0, altFt: 3000 } });
    const ap = sim.ap;
    assert.equal(ap.loc(), false); assert.equal(ap.appr(), false);
    assert.equal(ap.armedLateral, '');
    ap.setIls({ x: 0, y: 0, hdgGrid: 0, elev: 0, gsDeg: 3 });
    ap.loc(); assert.equal(ap.armedLateral, 'LOC'); assert.equal(ap.armedVertical, '');
    ap.loc(); assert.equal(ap.armedLateral, '');
    ap.appr(); assert.equal(ap.armedLateral, 'LOC'); assert.equal(ap.armedVertical, 'G/S');
    ap.appr(); assert.equal(ap.armedLateral, ''); assert.equal(ap.armedVertical, '');
    // Turning the heading in HDG keeps LOC armed (the intercept); in LOC it's HDG, and LOC no longer armed.
    ap.appr(); ap.setHdg(10); assert.equal(ap.armedLateral, 'LOC');
    for (let i = 0; i < 120 * 20 && ap.lateral === 'HDG'; i++) sim.step(1 / 120);
    assert.ok(ap.lateral === 'LOC*' || ap.lateral === 'LOC', ap.lateral);
    ap.setHdg(20); assert.equal(ap.lateral, 'HDG'); assert.equal(ap.armedLateral, '');
    // The ILS gone (a new destination with none): out of the approach modes.
    ap.appr(); for (let i = 0; i < 120 * 5; i++) sim.step(1 / 120);
    ap.setIls(null);
    assert.equal(ap.armedLateral, ''); assert.equal(ap.armedVertical, '');
    assert.ok(ap.lateral === 'HDG' && !/G\/S/.test(ap.vertical));
    // A snapshot keeps the armed modes but not the ILS (the review: main.js's syncNav() derives it from the plan after
    // every load, rewind and jump); a save from before v0.7.4 (no such fields) loads with none.
    ap.setIls({ x: 0, y: 0, hdgGrid: 0, elev: 0, gsDeg: 3 }); ap.appr();
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const b = createSim({ type: 'a321neo' }); b.restore(snap);
    assert.equal(b.ap.armedVertical, 'G/S'); assert.ok(!('ils' in snap.ap)); assert.equal(b.ap.ils, null);
    for (const k of ['armedLateral', 'armedVertical', 'ils', 'trkFpa', 'fpaDeg']) delete snap.ap[k];
    const c = createSim({ type: 'a321neo' }); c.restore(snap);
    for (let i = 0; i < 120; i++) c.step(1 / 120);
    assert.ok(!c.ap.armedLateral && !c.ap.ils && !c.ap.trkFpa, 'an old save: nothing armed, no ILS, HDG-V/S');
  });
}
