// v0.4.0: a crosswind landing through the real game in Chrome by the test-only controller (e2e-controller.js):
// skip to final at Jeju, a 15 kt crosswind from the right of the runway, and the landing card with the wind.
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-weather-landing.mjs [a321neo|b787-9|b777-300er] [crosswind kt] [autoland]
// With `autoland` (a Boeing): the autopilot flies the ILS to the stop, and the checks are the centreline and the decrab.
// Env: E2E_URL (default http://localhost:8014/games/flight-sim/), E2E_OUT.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const type = process.argv[2] || 'a321neo', xKt = Number(process.argv[3] || 15), autoland = process.argv[4] === 'autoland';
const BASE = process.env.E2E_URL || 'http://localhost:8014/games/flight-sim/';
const FT = 3.28084, KT = 1.943844;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?test&type=${type}&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=7500`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 90000 });
  await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
  await page.waitForTimeout(1500);
  await page.mouse.click(720, 450);
  const setup = await page.evaluate(async (xKt) => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    const frame = await import(new URL('src/world/frame.js', location.href).href);
    const from = frame.gridToMag(ax.hdg + Math.PI / 2, ax.tx, ax.ty) * 180 / Math.PI;
    fs.sim.setWeather({ preset: 'custom', seed: 3, refX: ax.tx, refY: ax.ty, wind: { fromDeg: from, kt: xKt, gustKt: 0 }, aloft: { fromDeg: from + 15, kt: xKt * 1.5 } });
    fs.setTimeScale(1); fs.skipToFinal();
    return { fromDeg: from, weather: !!fs.sim.weather };
  }, xKt);
  check('the weather is set', setup.weather, `wind from ${setup.fromDeg.toFixed(0)}° at ${xKt} kt`);
  await page.waitForTimeout(1500);
  if (autoland) await page.evaluate(() => {
    const f = window.__fs, A = f.sim.type.data, c = f.sim.controls, s = f.sim.state;
    f.ap.app();
    const ax = f.runwayAxis(f.dest.end, f.dest.other);
    window.__crew = { td: null, ax };
    window.__fsController = () => {
      const toGo = -((s.pos.x - ax.tx) * ax.ux + (s.pos.y - ax.ty) * ax.uy);
      const idx = (n) => A.FLAP_LEVER.indexOf(n);
      if (toGo < 12 * 1852 && c.flapLever < idx('5')) { c.flapLever = idx('5'); f.ap.setSpd(170); }
      if (toGo < 9.5 * 1852 && !c.gearDown) c.gearDown = true;
      if (toGo < 9 * 1852 && c.flapLever < idx('20')) { c.flapLever = idx('20'); f.ap.setSpd(160); }
      if (toGo < 7.5 * 1852 && c.flapLever < idx('30')) { c.flapLever = idx('30'); c.spoilersArmed = true; }
      if (c.flapLever === idx('30')) f.ap.setSpd(Math.round(s.vls * 1.943844 + 5));
      if (s.onGround && !window.__crew.td) {
        const cross = (s.pos.x - ax.tx) * ax.uy - (s.pos.y - ax.ty) * ax.ux;
        window.__crew.td = { crabDeg: Math.atan2(Math.sin(s.hdg - ax.hdg), Math.cos(s.hdg - ax.hdg)) * 57.3, cross };
      }
      if (s.onGround && s.wow.nose) { c.brakeL = c.brakeR = 0.6; }
    };
    f.setTimeScale(3);
  });
  else await page.evaluate(() => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
    window.__e2e.phase = 'approach';
    fs.setTimeScale(3);
  });
  const st = () => page.evaluate(() => { const s = window.__fs.sim.state; return { agl: s.agl, onGround: s.onGround, crashed: s.crashed, drift: s.drift, hdg: s.hdg, ias: s.ias, gs: s.gs, windY: s.wind.y }; });
  const waitFor = async (fn, ms, label) => { const t0 = Date.now(); for (;;) { const s = await st(); if (fn(s) || s.crashed) return s; if (Date.now() - t0 > ms) throw new Error('timed out: ' + label); await page.waitForTimeout(150); } };
  const a2 = await waitFor((s) => s.agl * FT < 2500, 200000, '2,500 ft');
  await page.evaluate(() => window.__fs.setTimeScale(1));
  const f = await waitFor((s) => s.agl * FT < 1000, 200000, '1,000 ft');
  check('crabbing on the approach', Math.abs(f.drift) > 0.03, `drift ${(f.drift * 57.3).toFixed(1)}° at ${(f.agl * FT).toFixed(0)} ft`);
  await page.screenshot({ path: path.join(OUT, `v040-xwind-${type}-final.png`) });
  await waitFor((s) => s.onGround, 200000, 'touchdown');
  await page.waitForFunction(() => window.__fsLastScore, null, { timeout: 120000 });
  const score = await page.evaluate(() => window.__fsLastScore);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `v040-xwind-${type}${autoland ? '-autoland' : ''}-card.png`) });
  const w = score.touchdown?.wind;
  if (autoland) {
    const r = await page.evaluate(() => { const f = window.__fs, s = f.sim.state, ax = window.__crew.ax; return { td: window.__crew.td, cross: (s.pos.x - ax.tx) * ax.uy - (s.pos.y - ax.ty) * ax.ux, onGround: s.onGround, lat: f.ap.lateral }; });
    check('autoland: decrabbed at the wheels', r.td && Math.abs(r.td.crabDeg) < 5, JSON.stringify(r.td));
    check('autoland: on the centreline', r.td && Math.abs(r.td.cross) < 15 && Math.abs(r.cross) < 15, `at the wheels ${r.td?.cross.toFixed(1)} m, at the card ${r.cross.toFixed(1)} m, ${r.lat}`);
  }
  check('the landing score', autoland || (!!score.grade && 'ABCDEF'.indexOf(score.grade[0]) <= 1), `${score.grade} ${score.points}: ${score.parts.map((p) => `${p.name} ${p.value}${p.unit}`).join(', ')}`);
  check('the card has the wind', !!w && w.cross > xKt * 0.6, JSON.stringify(w));
  check('not crashed', !(await page.evaluate(() => window.__fs.sim.state.crashed)));
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('run', false, String(e)); } finally { await browser.close(); }
process.exit(failed ? 1 : 0);
