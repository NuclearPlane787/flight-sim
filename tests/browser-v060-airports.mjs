// briefs/V0-6-0.md Part 3's "Done when", at one of the region's airports, headless, with EAST_ASIA_ON on (?eastasia=1):
//   1. a gate start at a stand standsFor() offers for the type (the setup's list, gate-flow.js standList());
//   2. the pushback (Shift+G, at 4×), checked on pavement and clear of the buildings;
//   3. a taxi along the game's own route to the hold short of a runway (a test-only pure pursuit on the route,
//      run at 4× by extra sim steps), checked on pavement, clear of the buildings, stopping with the nose at the hold;
//   4. the line-up and a take-off by the test pilot (tests/e2e-controller.js): rotation, positive climb, gear up, 1,500 ft;
//   5. skip to final at the airport's longest ILS runway and a landing by the test pilot: on the runway, the card naming
//      it, B or better.
// A widebody (type b787-9 or b777-300er) does 1 and 2 only (its code E stands and pushback).
// Pictures "Claude outputs/flight-sim/v060-<icao>-<what>[-night][-<type>].png", the clock fixed at 13:00 (day) or
// 22:00 (night) local time (Japan and Korea UTC+9, China UTC+8).
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 18 -- node games/flight-sim/tests/browser-v060-airports.mjs ZSPD day
// Env: E2E_URL (default http://127.0.0.1:8014/games/flight-sim/), STAND, DEP, ARR (override the picks).

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildTaxiGraph, routeFromStand } from '../src/ground/taxi.js';
import { standList } from '../src/ground/gate-flow.js';
import { standHeading } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';
import { REGION } from '../src/world/regions.js';
import { canTakeOff, canLand, runwayUse, circlingOnly } from '../src/world/runways.js';
import { zoneMs, zoneOfIcao } from '../src/clock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const ICAO = (process.argv[2] || 'ZSPD').toUpperCase();
const MODE = process.argv[3] === 'night' ? 'night' : 'day';
const TYPE = process.argv[4] || 'a321neo';
const WIDE = TYPE !== 'a321neo';
// v0.7.0: 13:00 or 22:00 on 19 November 2026 in the airport's own zone (clock.js; UTC+9, +8 and +10 in East Asia as
// before, the United Kingdom's and Central European time in Europe: run with FS_REGION=europe for a European airport).
const CLOCK_MS = zoneMs(2026, 11, 19, MODE === 'day' ? 13 : 22, 0, 0, zoneOfIcao(ICAO));
const FT = 3.28084, KT = 1.943844, NM = 1852;
// v0.6.1: E2E_EXTRA adds to the page's query ("&pending=1" for an airport still in the manifest's airportsPending),
// E2E_PREFIX names the pictures (v060 by default).
const EXTRA = process.env.E2E_EXTRA || '', PREFIX = process.env.E2E_PREFIX || 'v060';
const tag = (what) => `${PREFIX}-${ICAO.toLowerCase()}-${what}${MODE === 'night' ? '-night' : ''}${WIDE ? '-' + TYPE : ''}.png`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

// ---- the plan, worked out here with the game's own modules (as main.js boots the airport) ----
const ap = JSON.parse(readFileSync(path.join(here, '..', REGION.data, `airports/${ICAO}.json`), 'utf8'));   // v0.7.0: the run's region's folder
for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
const typeDef = typeById(TYPE);
const offered = standList(ap, typeDef);
const g = buildTaxiGraph(ap);
const ends = ap.runways.flatMap((r) => r.ends);
let STAND = process.env.STAND, DEP = process.env.DEP;
if (!STAND || !DEP) {
  // Among the first gates the setup offers, the stand and runway end with the shortest taxi (the run's real time).
  let best = null;
  for (const st of offered.filter((s) => s.gate).slice(0, 12)) for (const e of ends) {
    if (DEP && e.ident !== DEP) continue;
    if (!DEP && !canTakeOff(ICAO, e.ident)) continue;   // v0.7.0: not from an end nothing takes off from (runways.js ONE_WAY: Frankfurt's 25R, Madrid's 32s and 18s)
    if (STAND && st.ref !== STAND) continue;
    const r = routeFromStand(buildTaxiGraph(ap), st, e);
    if (r && (!best || r.lengthM < best.len)) best = { st: st.ref, dep: e.ident, len: r.lengthM };
  }
  STAND ||= best?.st ?? offered[0].ref; DEP ||= best?.dep ?? ends[0].ident;
}
// The longest runway with an ILS; the end in the departure's direction if both have one.
// (v0.7.3: an airport with no ILS at all, Innsbruck: the longest runway with an end that is landed on straight in)
const straightIn = (e) => canLand(ICAO, e.ident) && runwayUse(ICAO, e.ident) !== 'standby' && !circlingOnly(ICAO, e.ident);
const ilsRw = ap.runways.filter((r) => r.ends.some((e) => e.ils && canLand(ICAO, e.ident) && runwayUse(ICAO, e.ident) !== 'standby')).sort((p, q) => q.lengthM - p.lengthM)[0]   // (v0.7.0: an end that is landed on, and not a standby runway)
  || ap.runways.filter((r) => r.ends.some(straightIn)).sort((p, q) => q.lengthM - p.lengthM)[0];
const depEnd = ends.find((e) => e.ident === DEP);
const ARR = process.env.ARR || (() => {
  let cand = ilsRw.ends.filter((e) => e.ils && canLand(ICAO, e.ident));
  if (!cand.length) cand = ilsRw.ends.filter(straightIn);
  const same = cand.find((e) => Math.abs(((e.hdgGridDeg - depEnd.hdgGridDeg + 540) % 360) - 180) < 45);
  return (same || cand[0]).ident;
})();
console.log(`${ICAO} ${MODE} ${TYPE}: stand ${STAND} (offered ${offered.length} of ${ap.stands.length}), dep ${DEP}, arr ${ARR} (longest ILS runway ${ilsRw.id}, ${ilsRw.lengthM} m)`);

const URL0 = `${BASE}?test&eastasia=1&origin=${ICAO}&dep=${DEP}&dest=${ICAO}&arr=${ARR}&start=gate&stand=${encodeURIComponent(STAND)}&view=orbit&type=${TYPE}${EXTRA}`;
const profile = mkdtempSync(path.join(tmpdir(), 'fs-v060-ap-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 30, null, { timeout: 120000 });
  console.log(`boot ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const clockNow = () => page.evaluate((ms) => window.__fs.clock.set(ms), CLOCK_MS);
  const look = (yaw, pitch, dist) => page.evaluate(([y, p, d]) => { const L = window.__fs.rig.looks.orbit; L.yaw = y; L.pitch = p; L.dist = d; }, [yaw, pitch, dist]);
  const shot = async (what, settle = 1200) => { await clockNow(); await page.waitForTimeout(settle); await page.screenshot({ path: path.join(OUT, tag(what)) }); console.log('  picture', tag(what)); };
  const st = () => page.evaluate(() => { const fs = window.__fs, s = fs.sim.state; return { phase: fs.gate.phase, status: fs.gate.status, t: s.t, x: s.pos.x, y: s.pos.y, hdg: s.hdg, gs: s.gs * 1.943844, agl: s.agl * 3.28084, vs: s.vs, onGround: s.onGround, crashed: s.crashed || fs.crashed || null, ias: s.ias * 1.943844 }; });

  // The checker: pavement (aprons, taxiways' widths, runways), buildings, sampled from the controller.
  await page.evaluate(([icao]) => {
    const fs = window.__fs, a = fs.airports.find((q) => q.icao === icao);
    const bb = (P) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
    const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const aprons = a.aprons.map((p) => ({ P: p.points, b: bb(p.points) }));
    const blds = a.buildings.map((p) => ({ P: p.points, b: bb(p.points), name: p.name, kind: p.kind }));
    const segs = [];
    for (const t of a.taxiways) for (let i = 1; i < t.points.length; i++) segs.push([t.points[i - 1], t.points[i], t.widthM / 2]);
    const rws = a.runways.map((r) => { const [e0, e1] = r.ends, p0 = e0.pavementEnd, p1 = e1.pavementEnd, L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      return { p0, ux: (p1[0] - p0[0]) / L, uy: (p1[1] - p0[1]) / L, L, half: r.widthM / 2 }; });
    const segD = (x, y, [A, B]) => { const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy; let t = l2 ? ((x - A[0]) * dx + (y - A[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - A[0] - t * dx, y - A[1] - t * dy); };
    // metres outside the pavement (0 on it)
    const offPave = (x, y) => {
      for (const p of aprons) if (x >= p.b[0] && x <= p.b[2] && y >= p.b[1] && y <= p.b[3] && inPoly(x, y, p.P)) return 0;
      // metres outside the nearest apron's edge (OSM's aprons often meet with a few metres between them)
      let apronOff = Infinity;
      for (const p of aprons) { if (x < p.b[0] - 40 || x > p.b[2] + 40 || y < p.b[1] - 40 || y > p.b[3] + 40) continue;
        for (let i = 1; i < p.P.length; i++) apronOff = Math.min(apronOff, segD(x, y, [p.P[i - 1], p.P[i]])); }
      for (const r of rws) { const s = (x - r.p0[0]) * r.ux + (y - r.p0[1]) * r.uy, c = Math.abs(-(x - r.p0[0]) * r.uy + (y - r.p0[1]) * r.ux); if (s >= -5 && s <= r.L + 5 && c <= r.half + 2) return 0; }
      let best = apronOff;
      for (const sg of segs) { const d = segD(x, y, sg) - sg[2] - 3; if (d <= 0) return 0; if (d < best) best = d; }   // 3 m of shoulder
      return best;
    };
    const inBuilding = (x, y) => { for (const p of blds) if (x >= p.b[0] && x <= p.b[2] && y >= p.b[1] && y <= p.b[3] && inPoly(x, y, p.P)) return p; return null; };
    const geo = fs.sim.type.geo;
    window.__chk = { on: false, n: 0, off: 0, maxOff: 0, offAt: null, bld: [], wing: 0, lastT: -1,
      reset() { Object.assign(this, { n: 0, off: 0, maxOff: 0, offAt: null, bld: [], wing: 0 }); },
      sample(s) {
        if (s.t - this.lastT < 0.25) return;
        this.lastT = s.t;
        const fx = Math.sin(s.hdg), fy = Math.cos(s.hdg), rx = fy, ry = -fx;   // forward, right
        const at = (f, r) => [s.pos.x + fx * f + rx * r, s.pos.y + fy * f + ry * r];
        const wheels = [at(geo.GEAR.nose.x, 0), at(geo.GEAR.left.x, geo.GEAR.left.y), at(geo.GEAR.right.x, geo.GEAR.right.y)];
        this.n++;
        let worst = 0;
        for (const [x, y] of wheels) worst = Math.max(worst, offPave(x, y));
        if (worst > 0) { this.off++; if (worst > this.maxOff) { this.maxOff = worst; this.offAt = [Math.round(s.pos.x), Math.round(s.pos.y)]; } }
        for (const [x, y] of [at(geo.NOSE_X, 0), at(0, 0), at(geo.TAIL_X, 0)]) { const b = inBuilding(x, y); if (b && this.bld.length < 5) this.bld.push(`${b.kind} ${b.name || ''} at ${Math.round(x)},${Math.round(y)}`); }
        for (const side of [1, -1]) if (inBuilding(...at(-3, side * geo.SPAN / 2))) this.wing++;
      },
      report() { return { samples: this.n, offPavement: this.off, maxOffM: +this.maxOff.toFixed(1), offAt: this.offAt, buildings: this.bld, wingtipsOverBuildings: this.wing }; },
    };
    const prev = window.__fsController;
    window.__fsController = (sim, dt) => { if (window.__chk.on) window.__chk.sample(sim.state); prev?.(sim, dt); };
  }, [ICAO]);

  // ---- 1. the gate ----
  const g0 = await page.evaluate(() => { const fs = window.__fs, s = fs.sim.state, gt = fs.gate; return { stand: gt.stand?.ref, hdg: gt.stand?.hdgGridDeg, fixed: !!gt.stand?.hdgFixed, route: gt.route ? { n: gt.route.points.length, lengthM: Math.round(gt.route.lengthM), text: gt.route.text } : null, status: gt.status, onGround: s.onGround }; });
  check('gate start at the stand asked for', g0.stand === STAND && g0.onGround, JSON.stringify(g0));
  check('a taxi route from the stand', !!g0.route, g0.route?.text || g0.status);
  await page.evaluate(() => { window.__fs.input.lever = 0; window.__chk.on = true; });
  await page.getByText('Hide panels').click({ timeout: 3000 }).catch(() => console.log('  (no Hide panels button)'));
  await look(0.7, 0.5, WIDE ? 140 : 110);
  await shot('gate', 3500);

  // ---- 2. the pushback ----
  await page.keyboard.press('Shift+KeyG');
  await page.waitForTimeout(600);
  const ts = await page.evaluate(() => window.__fs.setTimeScale(4));
  const p1 = await st();
  check('pushback started by Shift+G, at 4x', p1.phase === 'pushback' && ts === 4, `${p1.phase}, rate ${ts}`);
  await page.waitForTimeout(3500);
  await look(2.0, 0.55, WIDE ? 150 : 110);
  await page.evaluate(() => window.__fs.setTimeScale(1));
  await shot('pushback', 1500);
  await page.evaluate(() => window.__fs.setTimeScale(4));
  const tp = Date.now();
  while ((await st()).phase === 'pushback' && Date.now() - tp < 240000) await page.waitForTimeout(500);
  const p2 = await st();
  const pbChk = await page.evaluate(() => { const r = window.__chk.report(); window.__chk.reset(); return r; });
  const pbEnd = await page.evaluate(() => { const fs = window.__fs, s = fs.sim.state, p = fs.gate.points; return { phase: fs.gate.phase, toRouteM: p && p.length ? Math.round(Math.hypot(p[0][0] - s.pos.x, p[0][1] - s.pos.y)) : null }; });
  check('pushback completes onto the taxi line', p2.phase === 'taxi' && !p2.crashed, JSON.stringify(pbEnd));
  check('pushback on pavement, clear of buildings', pbChk.maxOffM < 6 && !pbChk.buildings.length, JSON.stringify(pbChk));
  if (WIDE) {
    await look(2.6, 0.6, 160);
    await shot('pushback-done', 1500);
  } else {
    // ---- 3. the taxi ----
    const plan = await page.evaluate(([icao, dep]) => {
      const fs = window.__fs, KTs = 1.943844, s0 = fs.sim.state;
      const P = (fs.gate.points || []).map((p) => [p[0], p[1]]);
      const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const total = cum[cum.length - 1];
      const ptAt = (s) => { s = Math.max(0, Math.min(total, s)); let i = 1; while (i < P.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [P[i - 1][0] + f * (P[i][0] - P[i - 1][0]), P[i - 1][1] + f * (P[i][1] - P[i - 1][1])]; };
      const hdgAt = (s) => { const a = ptAt(s - 2), b = ptAt(s + 2); return Math.atan2(b[0] - a[0], b[1] - a[1]); };
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      const noseX = fs.sim.type.geo.NOSE_X;
      const T = window.__taxi = { P, total, s: 0, done: false, extra: 6, steps: 0, maxErr: 0 };
      fs.sim.controls.parkingBrake = false;
      const prev = window.__fsController;
      const drive = (sim) => {
        const s = sim.state, c = sim.controls;
        // the projection of the reference point (by the main gear) on the route, searched forward
        let bestS = T.s, bd = Infinity;
        for (let q = T.s - 10; q <= T.s + 60; q += 1) { const p = ptAt(q), d = Math.hypot(p[0] - s.pos.x, p[1] - s.pos.y); if (d < bd) { bd = d; bestS = q; } }
        T.s = Math.max(T.s, bestS); T.cross = bd; T.maxErr = Math.max(T.maxErr, bd);
        const left = total - T.s - noseX;                 // the nose to the hold
        if (left < 1.5) T.done = true;
        const L = 24, tgt = ptAt(T.s + L);
        const want = Math.atan2(tgt[0] - s.pos.x, tgt[1] - s.pos.y);
        const err = wrap(want - s.hdg);
        c.yaw = Math.max(-1, Math.min(1, err * 2.5));
        let turn = 0; for (let q = 0; q <= 70; q += 10) turn = Math.max(turn, Math.abs(wrap(hdgAt(T.s + q) - s.hdg)));
        let target = turn > 1.0 ? 6 : turn > 0.5 ? 10 : turn > 0.25 ? 15 : 25;
        if (left < 150) target = Math.min(target, 8);
        if (left < 30) target = Math.min(target, 4);
        if (T.done) target = 0;
        const v = s.gs * KTs;
        fs.input.lever = !T.done && v < target - 2 ? 0.3 : 0;
        c.thrust = fs.input.lever;
        c.brakeL = c.brakeR = T.done ? 1 : v > target + 1 ? Math.min(1, 0.3 + (v - target) * 0.1) : 0;
        c.pitch = 0; c.roll = 0;
      };
      window.__fsController = (sim, dt) => {
        prev?.(sim, dt);
        drive(sim);
        if (!T.done) for (let k = 0; k < T.extra && !sim.state.crashed; k++) { sim.step(1 / 120); T.steps++; window.__chk.sample(sim.state); }
      };
      return { n: P.length, total: Math.round(total), text: fs.gate.route?.text, hold: fs.gate.route?.hold };
    }, [ICAO, DEP]);
    console.log('taxi route:', JSON.stringify(plan));
    const tt = Date.now();
    let shotTaxi = false, last = null;
    for (;;) {
      last = await page.evaluate(() => { const T = window.__taxi, s = window.__fs.sim.state; return { s: Math.round(T.s), total: Math.round(T.total), done: T.done, gs: +(s.gs * 1.943844).toFixed(1), crossM: +T.cross?.toFixed(1), maxErrM: +T.maxErr.toFixed(1), crashed: s.crashed || window.__fs.crashed || null }; });
      if ((last.done && last.gs < 0.5) || last.crashed || Date.now() - tt > 540000) break;
      if (!shotTaxi && last.s > last.total * 0.4) {
        shotTaxi = true;
        await page.evaluate(() => { window.__taxi.extra = 0; });
        await look(0.5, 0.5, 120);
        await shot('taxiway', 1500);
        await page.evaluate(() => { window.__taxi.extra = 6; });
      }
      await page.waitForTimeout(500);
    }
    const txChk = await page.evaluate(() => { const r = window.__chk.report(); window.__chk.reset(); return r; });
    const hold = await page.evaluate(([dep]) => {
      const fs = window.__fs, s = fs.sim.state, R = fs.runwayEnds(fs.plan.origin, dep), ax = fs.runwayAxis(R.end, R.other), geo = fs.sim.type.geo;
      const nx = s.pos.x + Math.sin(s.hdg) * geo.NOSE_X, ny = s.pos.y + Math.cos(s.hdg) * geo.NOSE_X;
      const across = (x, y) => Math.abs(-(x - ax.tx) * ax.uy + (y - ax.ty) * ax.ux);
      const h = window.__taxi.P[window.__taxi.P.length - 1];
      return { noseFromCL: Math.round(across(nx, ny)), half: R.runway.widthM / 2, noseToHoldM: +Math.hypot(nx - h[0], ny - h[1]).toFixed(1), holdFromCL: Math.round(across(h[0], h[1])), noseBeforeEndM: Math.round(-((nx - ax.px) * ax.ux + (ny - ax.py) * ax.uy)), holdRef: fs.gate.route?.hold?.ref ?? null, toThresholdM: Math.round(Math.hypot(s.pos.x - R.end.x, s.pos.y - R.end.y)), simMin: +(s.t / 60).toFixed(1) };
    }, [DEP]);
    check('taxied the route to the hold without crashing', last.done && !last.crashed, JSON.stringify(last));
    check('taxi on pavement, clear of buildings', txChk.maxOffM < 6 && !txChk.buildings.length, JSON.stringify(txChk));
    // (v0.7.1: or stopped before the pavement's end on the runway's own axis, where a taxiway or a starter strip joins
    // the runway from its end: Manchester's 23L. noseBeforeEndM is how far the nose is short of the pavement's end.)
    check(`stopped at the hold short of ${DEP}`, hold.noseToHoldM < 8 && (hold.noseFromCL > hold.half || hold.noseBeforeEndM > 5), JSON.stringify(hold));
    await look(2.6, 0.5, 110);
    await shot('hold', 1500);

    // ---- 4. line up and take off ----
    await page.evaluate(([dep]) => {
      const fs = window.__fs, s0 = fs.sim.state, R = fs.runwayEnds(fs.plan.origin, dep), ax = fs.runwayAxis(R.end, R.other);
      const along = (s0.pos.x - ax.px) * ax.ux + (s0.pos.y - ax.py) * ax.uy;
      const a0 = Math.max(along, 0) + 60;
      const P = [[s0.pos.x, s0.pos.y]];
      for (let k = 0; k <= 8; k++) P.push([ax.px + ax.ux * (a0 + k * 50), ax.py + ax.uy * (a0 + k * 50)]);
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      const T = window.__taxi; T.done = false; T.extra = 2;
      const L = window.__lineup = { ax, done: false };
      fs.sim.controls.parkingBrake = false;
      window.__fsController = (sim) => {
        const s = sim.state, c = sim.controls;
        const al = (s.pos.x - ax.px) * ax.ux + (s.pos.y - ax.py) * ax.uy, cr = -(s.pos.x - ax.px) * ax.uy + (s.pos.y - ax.py) * ax.ux;
        let i = 1; while (i < P.length - 1 && Math.hypot(P[i][0] - s.pos.x, P[i][1] - s.pos.y) < 20) i++;
        if (al > a0 - 10) i = Math.max(i, 2);
        const tgt = P[i], want = Math.atan2(tgt[0] - s.pos.x, tgt[1] - s.pos.y), err = wrap(want - s.hdg);
        L.cross = cr; L.hdgErr = wrap(s.hdg - ax.hdg) * 57.3; L.along = al;
        // on the centreline: roll on slowly along it (heading plus a pull to the line, damped by the yaw rate)
        // until straight, then stop gently
        if (!L.roll && al > a0 - 5 && Math.abs(cr) < 3) { L.roll = al; }
        if (L.roll && !L.done && al > L.roll + 30 && Math.abs(cr) < 1 && Math.abs(L.hdgErr) < 0.7 && Math.abs(s.r) < 0.01) L.done = true;
        const steer = L.roll ? wrap(ax.hdg - s.hdg) + Math.max(-0.15, Math.min(0.15, cr * 0.03)) - s.r * 1.5 : err;
        c.yaw = Math.max(-1, Math.min(1, steer * 2.5));
        const v = s.gs * 1.943844, target = L.done ? 0 : L.roll ? 5 : 7;
        fs.input.lever = v < target - 2 ? 0.3 : 0; c.thrust = fs.input.lever;
        c.brakeL = c.brakeR = L.done ? 0.3 : v > target + 1 ? 0.5 : 0;
        if (!L.roll) for (let k = 0; k < T.extra && !s.crashed; k++) sim.step(1 / 120);
      };
    }, [DEP]);
    const tl = Date.now();
    let lu = null;
    for (;;) { lu = await page.evaluate(() => ({ ...window.__lineup, ax: undefined, gs: window.__fs.sim.state.gs * 1.943844 })); if ((lu.done && lu.gs < 0.5) || Date.now() - tl > 180000) break; await page.waitForTimeout(500); }
    const rem = await page.evaluate(([dep]) => { const fs = window.__fs, R = fs.runwayEnds(fs.plan.origin, dep); return Math.round(window.__lineup.ax.len - window.__lineup.along); }, [DEP]);
    check(`lined up on ${DEP}`, lu.done, `cross ${lu.cross?.toFixed(1)} m, hdg ${lu.hdgErr?.toFixed(1)}°, ${rem} m of runway ahead`);
    await look(0, 0.18, 70);
    await shot('runway', 1500);

    await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
    await page.evaluate(([dep]) => {
      const fs = window.__fs, R = fs.runwayEnds(fs.plan.origin, dep), ax = fs.runwayAxis(R.end, R.other);
      window.__e2e.rwyHdg = ax.hdg; window.__e2e.rwyAxis = ax; window.__e2e.vr = 145; window.__e2e.phase = 'takeoff';
      fs.sim.controls.parkingBrake = false; fs.sim.controls.brakeL = fs.sim.controls.brakeR = 0;
      fs.input.lever = 1;
    }, [DEP]);
    const waitFor = async (fn, ms, label) => { const t1 = Date.now(); for (;;) { const s = await st(); if (fn(s)) return s; if (s.crashed) throw new Error(`crashed waiting for ${label}: ${s.crashed}`); if (Date.now() - t1 > ms) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s)}`); await page.waitForTimeout(200); } };
    const lift = await waitFor((s) => !s.onGround && s.agl > 50, 120000, 'lift-off');
    await page.keyboard.press('KeyG');
    const up = await waitFor((s) => s.agl > 1500, 120000, '1,500 ft');
    const to = await page.evaluate(() => ({ log: window.__e2eLog.slice(), gearDown: window.__fs.sim.controls.gearDown, gearPos: window.__fs.sim.state.gearPos }));
    check('take-off: rotation, lift-off, positive climb, gear up, 1,500 ft', !!to.log.find((l) => l.includes('rotate')) && up.vs > 0 && !to.gearDown,
      `${to.log.join('; ')}; at 1,500 ft vs ${(up.vs * 196.85).toFixed(0)} fpm, gear lever ${to.gearDown ? 'down' : 'up'}`);

    // ---- 5. skip to final and land ----
    await page.evaluate(() => { window.__e2e.phase = 'idle'; window.__fs.skipToFinal(); });
    await page.waitForTimeout(1800);
    // The run's time (the guard's slots are shared): the autopilot flies the 3 deg path down by V/S (about 950 fpm
    // at 180 kt) at 8x, to 2,500 ft above the runway; then 1x and the test pilot, as from the skip's own start.
    const elevFt = await page.evaluate(() => { const fs = window.__fs, d = fs.dest, e = (d.end.elevM ?? d.airport.elevM) * 3.28084;
      fs.ap.setAlt(e + 2000); fs.ap.setVs(-1000); return e; });
    await page.evaluate(() => window.__fs.setTimeScale(8));
    const tc = Date.now();
    while (Date.now() - tc < 120000) { const s = await st(); if (s.crashed) throw new Error('crashed on final: ' + s.crashed); if (s.agl < 2500) break; await page.waitForTimeout(250); }
    await page.evaluate(() => window.__fs.setTimeScale(1));
    await page.evaluate(() => {
      const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
      window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
      window.__e2e.phase = 'approach';
    });
    const toGo = () => page.evaluate(() => { const s = window.__fs.sim.state, a = window.__e2e.axis; return -((s.pos.x - a.tx) * a.ux + (s.pos.y - a.ty) * a.uy) / 1852; });
    const tf = Date.now();
    while ((await toGo()) > 3 && Date.now() - tf < 600000) { const s = await st(); if (s.crashed) throw new Error('crashed on final: ' + s.crashed); await page.waitForTimeout(500); }
    await look(0.25, 0.12, 90);
    await shot('final', 300);
    await waitFor((s) => s.onGround, 300000, 'touchdown');
    await page.waitForFunction(() => window.__fsLastScore, null, { timeout: 180000 });
    await page.waitForFunction(() => window.__e2e.phase === 'stopped', null, { timeout: 120000 }).catch(() => {});
    const land = await page.evaluate(() => { const fs = window.__fs, r = window.__fsLastScore; return { grade: r.grade, points: r.points, offRunway: !!r.offRunway, runway: fs.scorer.landing?.end?.ident ?? null, card: document.getElementById('score')?.textContent.replace(/\s+/g, ' ').slice(0, 300), parts: r.parts.map((p) => `${p.name} ${p.value}${p.unit || ''}`).join(', ') }; });
    check(`landed on ${ARR}, the card naming it`, !land.offRunway && land.runway === ARR && (land.card || '').includes(ARR), `${land.runway}; card: ${land.card}`);
    check('landing score B or better', land.grade === 'A' || land.grade === 'B', `${land.grade} ${land.points}: ${land.parts}`);
    console.log('controller log:', (await page.evaluate(() => window.__e2eLog)).join(' | '));
    await page.evaluate(() => { const el = document.getElementById('score'); if (el) el.hidden = true; });
    await look(2.5, 0.3, 120);
    await shot('landed', 1500);
  }
  const perf = await page.evaluate(async () => { const f0 = window.__fs.frames, t = performance.now(); await new Promise((r) => setTimeout(r, 2000)); const ri = window.__fs.renderer.info.render; return { fps: +((window.__fs.frames - f0) / ((performance.now() - t) / 1000)).toFixed(1), calls: ri.calls, tris: ri.triangles }; });
  console.log('perf at the end:', JSON.stringify(perf), 'total', ((Date.now() - t0) / 60000).toFixed(1), 'min');
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} catch (e) {
  console.log('FAIL exception', e.message);
  results.push({ name: 'exception', ok: false, detail: e.message });
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${ICAO} ${MODE} ${TYPE}: ${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
