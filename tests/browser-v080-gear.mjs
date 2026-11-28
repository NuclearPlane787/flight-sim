// v0.8.0 (gear): two landings with the gear not all down, in the real game, one short run: a gear-up landing (the lever
// left up, no failure) on the A321neo at Heathrow's 27R, and the 787-9 at Incheon's 33L on two legs (the left main
// won't lock). Each flown from 4 nm out by the game's test pilot (tests/e2e-controller.js) with the belly landing's
// part on top (as tests/v080-gear-land.mjs flies it in node): the belly flare, then on the ground the thrust off,
// wings level, the nose let down; stopped, the parking brake and the engines off. Pictures of the slide and the card,
// v080-gear-<what>.png in GameDump/Claude outputs/flight-sim/; console errors counted.
//   node games/flight-sim/tests/browser-v080-gear.mjs        (the lead's server on 8014; prints "done N of M" last)
import { chromium } from './pw.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const GAME = ROOT + 'games/flight-sim/';
const CTL = readFileSync(path.join(here, 'e2e-controller.js'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

// The belly landing's pilot, wrapped round the controller (in the page; the node helper's rules, shortened).
const PILOT = `(() => {
  const DEG = Math.PI / 180, FPM = 0.3048 / 60, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const base = window.__fsController, ctl = window.__e2e, G = window.__gear = { touched: false, stopped: false, mode: 'up', maxBank: 0, firstSink: null };
  function lowest(sim) {
    const s = sim.state, th = s.pitch, ph = s.roll, r6 = -Math.sin(th), r7 = Math.sin(ph) * Math.cos(th), r8 = Math.cos(ph) * Math.cos(th);
    let lo = Infinity;
    for (const c of sim.type.geo.CRASH_POINTS) { if (c.why === 'wingtip strike') continue; lo = Math.min(lo, s.pos.z - (r6 * (c.x - s.cgX) - r7 * c.y - r8 * c.z) - s.groundH); }
    return lo;
  }
  window.__fsController = (sim, dt) => {
    const s = sim.state, c = sim.controls, ap = sim.ap, fs = window.__fs, ax = ctl.axis;
    if (!G.touched) base(sim, dt);
    if (G.mode === 'up') c.gearDown = false;
    const allDown = s.gearLegs.every((v) => v > 0.98);
    if (!G.touched && (ctl.phase === 'belly' || (ctl.phase === 'flare' && !allDown))) {
      if (ctl.phase !== 'belly') { ctl.phase = 'belly'; G.vs0 = s.vs; }
      const h = lowest(sim), k = clamp(h / 12, 0, 1) ** 1.5, aim = -110 * FPM, vsCmd = aim + (G.vs0 - aim) * k;
      let p = clamp((vsCmd - s.vs) * (sim.type.family === 'boeing' ? 0.3 : 0.25) - s.q * 0.8 + ctl.pitchI, -0.3, 0.7);
      if (s.pitch > 6 * DEG && p > 0) p = clamp((6 * DEG - s.pitch) / DEG * 0.3, -0.3, 0);
      c.pitch = p;
      const rx = s.pos.x - ax.tx, ry = s.pos.y - ax.ty, cross = rx * ax.uy - ry * ax.ux, track = Math.atan2(s.vel.x, s.vel.y);
      const bankCmd = clamp(wrap(ax.hdg + clamp(-cross * 0.004, -0.1, 0.1) - track) / DEG * 2, -3, 3);
      c.roll = clamp((bankCmd - s.roll / DEG) * 0.06, -1, 1); c.yaw = clamp(wrap(ax.hdg - s.hdg) / DEG * 0.15, -0.5, 0.5);
      if (h < 3) { if (ap.athr) ap.toggleAthr(); fs.input.lever = 0; }
    }
    if (!G.touched && (s.onGround || s.scraping)) { G.touched = true; G.t0 = s.t; G.firstSink = -s.vs / FPM; }
    if (G.touched) {
      if (ap.athr) ap.toggleAthr(); if (ap.ap) ap.disconnectAp('test');
      fs.input.lever = 0; c.thrust = 0;
      const rx = s.pos.x - ax.tx, ry = s.pos.y - ax.ty, cross = rx * ax.uy - ry * ax.ux, iasKt = s.ias / 0.514444;
      c.roll = clamp(-(s.roll / DEG) * 0.15, -1, 1);
      if (s.gearLegs[0] > 0.98) c.pitch = s.wow.nose ? 0 : -0.15;
      else if (s.gearLegs[1] > 0.98 || s.gearLegs[2] > 0.98) { const tg = clamp((iasKt - 40) / 50, 0, 1) * 2 * DEG; c.pitch = clamp((tg - s.pitch) / DEG * 0.25 - s.q * 2, -0.4, 0.8); }
      else c.pitch = 0;
      c.yaw = clamp(wrap(ax.hdg + clamp(-cross * 0.01, -0.1, 0.1) - s.hdg) / DEG * 0.5, -1, 1);
      c.brakeL = c.brakeR = s.t - G.t0 > 2 ? 0.6 : 0;
      G.maxBank = Math.max(G.maxBank, Math.abs(s.roll / DEG));
      if (s.gs < 0.5 && !G.stopped) { G.stopped = true; G.tStop = s.t; c.parkingBrake = true; for (let i = 0; i < s.engines.length; i++) sim.engineSwitch(i, false); }
    }
  };
})();`;

const CASES = [
  { name: 'heathrow-gear-up', q: 'region=europe&origin=EGKK&dep=26L&dest=EGLL&arr=27R&type=a321neo', icao: 'EGLL', rwy: '27R', mode: 'up', text: 'Gear-up landing' },
  { name: 'incheon-two-legs', q: 'origin=RKSS&dep=14R&dest=RKSI&arr=33L&type=b787-9', icao: 'RKSI', rwy: '33L', mode: 'nolock-1', text: 'Landed with the left main gear up' },
  // v0.8.0, part 7 (the lead): a landing on the A321 with the flaps jammed at 1, the gear down: faster and longer, on its wheels.
  { name: 'heathrow-flaps-jam', q: 'region=europe&origin=EGKK&dep=26L&dest=EGLL&arr=27R&type=a321neo', icao: 'EGLL', rwy: '27R', mode: 'flaps-jam', text: null },
].filter((c) => !process.argv[3] || process.argv.slice(3).includes(c.name));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  for (const C of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${GAME}?test&${C.q}&start=final`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__fs.sim.state.t > 1, null, { timeout: 60000 });
    await page.addScriptTag({ content: CTL });
    // 4 nm out on the 3° path, the gear up (or the left main failed), flaps for the final; the test pilot from there.
    const set = await page.evaluate(async ([icao, rwy, mode]) => {
      const f = window.__fs, F = await import(new URL('src/sim/failures.js', location.href).href);
      const { end, other } = f.runwayEnds(icao, rwy), ax = f.runwayAxis(end, other), sim = f.sim, D = sim.type.data;
      const dist = 4 * 1852, ux = Math.sin(ax.hdg), uy = Math.cos(ax.hdg);
      const flap = mode === 'flaps-jam' ? 1 : D.FLAP_LEVER.length - 1;
      sim.reset({ x: end.x - ux * dist, y: end.y - uy * dist, z: end.elevM + 15 + Math.tan(3 * Math.PI / 180) * dist, hdg: ax.hdg, onGround: false,
        iasMs: (mode === 'flaps-jam' ? 180 : 150) * 0.514444, flapLever: flap, gearDown: false, fuelKg: 6000, payloadKg: 14000 });
      sim.controls.flapLever = flap; sim.controls.gearDown = false;
      if (mode === 'nolock-1') sim.setFailures(F.armed(null, { kind: 'gear-nolock', target: 1 }, sim.state.t, 5));
      if (mode === 'flaps-jam') sim.setFailures(F.armed(null, { kind: 'flaps-jam', target: 0 }, sim.state.t, 5));
      f.input.lever = sim.controls.thrust = Math.min(sim.controls.thrust, sim.leverClimb);
      sim.ap.setSpd(Math.round(sim.state.ias / 0.514444)); sim.ap.engageAp(); if (!sim.ap.athr) sim.ap.toggleAthr();
      const ctl = window.__e2e;
      ctl.axis = { tx: end.x, ty: end.y, ux, uy, hdg: ax.hdg, elev: end.elevM }; ctl.phase = 'approach';
      f.selectView('orbit');
      return { hdg: ax.hdg, elev: end.elevM };
    }, [C.icao, C.rwy, C.mode]);
    await page.addScriptTag({ content: PILOT });
    await page.evaluate((m) => { window.__gear.mode = m; }, C.mode);
    // Fly it; a picture mid-slide (the orbit view from the side, low), then wait for the stop and the card.
    let slideShot = false;
    const t0 = Date.now();
    for (;;) {
      const s = await page.evaluate(() => { const s = window.__fs.sim.state, G = window.__gear; return { crashed: s.crashed, touched: G.touched, gs: s.gs, t: s.t, t0: G.t0, stopped: G.stopped, tStop: G.tStop, score: !!window.__fsLastScore }; });
      if (s.crashed) break;
      if (s.touched && !slideShot && s.t - s.t0 > 4) {
        slideShot = true;
        await page.evaluate(() => { const L = window.__fs.rig.looks.orbit; L.yaw = Math.PI * 0.62; L.pitch = -0.03; L.dist = window.__fs.sim.type.id === 'a321neo' ? 45 : 65; });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT, `v080-gear-${C.name}-slide.png`) });
      }
      if (s.stopped && s.score && s.t - s.tStop > 3) break;
      if (Date.now() - t0 > 150000) break;
      await page.waitForTimeout(250);
    }
    const r = await page.evaluate(() => {
      const f = window.__fs, s = f.sim.state, G = window.__gear, c = window.__fsLastScore, e = f.runwayEnds;
      return { crashed: s.crashed, stopped: G.stopped, firstSink: G.firstSink, maxBank: G.maxBank, legs: [...s.gearLegs], gs: s.gs,
        card: c ? { points: c.points, grade: c.grade, gear: c.gear || null, rows: c.parts.map((p) => p.name) } : null,
        cardText: document.querySelector('.fssc-card')?.innerText?.slice(0, 600) || '', cardShown: !!document.querySelector('.fssc-card') && !document.querySelector('#score')?.hidden };
    });
    check(`${C.name}: not crashed`, !r.crashed, String(r.crashed));
    check(`${C.name}: stopped`, r.stopped && r.gs < 0.5, `gs ${r.gs?.toFixed(3)}, first touch ${r.firstSink?.toFixed(0)} ft/min, bank max ${r.maxBank?.toFixed(1)}°`);
    if (C.text) check(`${C.name}: the card says "${C.text}"`, r.card?.gear?.text === C.text && r.cardText.includes(C.text), JSON.stringify(r.card));
    else {
      const j = await page.evaluate(() => { const f = window.__fs, s = f.sim.state; return { jam: s.flapsJam, flap: s.flapDeg, slat: s.slatDeg, lever: f.sim.controls.flapLever, cfg: s.config, alerts: (f.alerts.list || []).map((a) => a.title), tdKt: window.__fsLastScore?.touchdown?.iasKt }; });
      check(`${C.name}: the flaps stayed at 1's while the lever went to FULL, on its wheels with a card`, j.jam && j.flap < 15 && j.lever >= 3 && r.legs.every((v) => v > 0.98) && !!r.card && !r.card.gear, JSON.stringify(j) + ' card ' + JSON.stringify(r.card).slice(0, 200));
      check(`${C.name}: the flaps' caution is up`, j.alerts.some((t) => /FLAPS/.test(t)), j.alerts.join(', '));
    }
    await page.evaluate(() => { const L = window.__fs.rig.looks.orbit; if (L.dist < 40) L.dist = window.__fs.sim.type.id === 'a321neo' ? 55 : 75; });   // (the aircraft whole behind the card)
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `v080-gear-${C.name}-card.png`) });
    check(`${C.name}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
}
console.log(`done ${results.filter(Boolean).length} of ${results.length}`);
