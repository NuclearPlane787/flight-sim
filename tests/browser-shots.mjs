// Load the game in Chrome (real GPU), run a list of scenes and screenshot each one, with the
// fps, triangles and draw calls from the performance counters. Console errors are reported.
//
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-shots.mjs [scene …]
//
// A scene is a start query plus setup code run in the page. Names are in SCENES below.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/';

// Each scene: query string, then JS run in the page (fs = window.__fs), then wait ms.
const SCENES = {
  'gimpo-14R-nose': ['origin=RKSS&dep=14R&view=nose', '', 2500],
  'gimpo-14R-orbit': ['origin=RKSS&dep=14R&view=orbit', '', 2500],
  'gimpo-14R-captain': ['origin=RKSS&dep=14R&view=captain', '', 2500],
  'gimpo-14R-fo': ['origin=RKSS&dep=14R&view=fo', '', 2500],
  'jeju-final-nose': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=nose', '', 3000],
  'jeju-final-orbit': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=orbit', '', 3000],
  // 3,000 ft over Seoul, heading east up the Han from just west of Yeouido.
  'seoul-3000ft': ['origin=RKSS&dep=14R&view=nose', `
    const s = fs.sim;
    s.reset({ x: -60000, y: 168500, z: 915, hdg: 1.5, onGround: false, iasMs: 250/1.943844, flapLever: 0, gearDown: false, fuelKg: 7000, payloadKg: 15000 });
    fs.ap.setAlt(3000); fs.ap.setHdg(95); fs.ap.setSpd(250); fs.ap.engageAp(); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.input.lever = 25/45;
    fs.rig.looks.nose.pitch = -0.22;`, 4000],
  'seoul-3000ft-orbit': ['origin=RKSS&dep=14R&view=orbit', `
    const s = fs.sim;
    s.reset({ x: -60000, y: 168500, z: 915, hdg: 1.5, onGround: false, iasMs: 250/1.943844, flapLever: 0, gearDown: false, fuelKg: 7000, payloadKg: 15000 });
    fs.ap.setAlt(3000); fs.ap.setHdg(95); fs.ap.setSpd(250); fs.ap.engageAp(); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.input.lever = 25/45;
    fs.rig.looks.orbit.pitch = 0.35; fs.rig.looks.orbit.dist = 120;`, 4000],
  // 3 nm final for Jeju 07 on the 3° path, CONF FULL, gear down.
  'jeju-07-3nm': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=nose', `
    const d = fs.dest, ax = fs.runwayAxis(d.end, d.other), dist = 3 * 1852;
    fs.sim.reset({ x: ax.tx - ax.ux * dist, y: ax.ty - ax.uy * dist, z: d.end.elevM + 15 + Math.tan(3 * Math.PI / 180) * dist, hdg: ax.hdg, onGround: false, iasMs: 135/1.943844, flapLever: 4, gearDown: true, fuelKg: 5000, payloadKg: 17000 });
    fs.sim.controls.flapLever = 4; fs.sim.controls.gearDown = true; fs.input.lever = 25/45;
    fs.ap.setSpd(135); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.ap.setVs(-700); fs.ap.engageAp(); fs.ap.setVs(-700);
    fs.rig.looks.nose.pitch = -0.08;`, 2500],
  // Hallasan from the approach: 10 nm final for Jeju 07, looking right (south).
  'hallasan': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=nose', `
    const d = fs.dest, ax = fs.runwayAxis(d.end, d.other), dist = 10 * 1852;
    fs.sim.reset({ x: ax.tx - ax.ux * dist, y: ax.ty - ax.uy * dist, z: d.end.elevM + 15 + Math.tan(3 * Math.PI / 180) * dist, hdg: ax.hdg, onGround: false, iasMs: 170/1.943844, flapLever: 1, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
    fs.ap.setSpd(170); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.ap.engageAp();
    fs.rig.looks.nose.yaw = -1.25; fs.rig.looks.nose.pitch = 0.02;`, 3000],
  // M2: a gate start at Gimpo with the taxi route, and Incheon's aprons from 1,500 ft.
  'gimpo-gate-orbit': ['origin=RKSS&dep=14R&start=gate&stand=3&view=orbit', `fs.rig.looks.orbit.pitch = 0.45; fs.rig.looks.orbit.dist = 140;`, 3500],
  'gimpo-gate-captain': ['origin=RKSS&dep=14R&start=gate&stand=3&view=captain', '', 3500],
  'jeju-gate-orbit': ['origin=RKPC&dep=07&dest=RKSS&arr=14R&start=gate&stand=11&view=orbit', `fs.rig.looks.orbit.pitch = 0.45; fs.rig.looks.orbit.dist = 140;`, 3500],
  'incheon-gate-orbit': ['origin=RKSI&dep=33L&dest=RKPC&arr=07&start=gate&stand=38&view=orbit', `fs.rig.looks.orbit.pitch = 0.45; fs.rig.looks.orbit.dist = 160;`, 3500],
  'incheon-1500ft': ['origin=RKSI&dep=33L&view=nose', `
    const s = fs.sim;
    s.reset({ x: -98000, y: 158500, z: 460, hdg: 0.9, onGround: false, iasMs: 200/1.943844, flapLever: 1, gearDown: false, fuelKg: 7000, payloadKg: 15000 });
    fs.ap.setAlt(1500); fs.ap.setHdg(60); fs.ap.setSpd(200); fs.ap.engageAp(); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.input.lever = 25/45;
    fs.rig.looks.nose.pitch = -0.3;`, 4000],
  'map': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=orbit', `
    fs.ap.setHdg(200); fs.ap.setAlt(20000); fs.ap.levelChange(); fs.map.open(); fs.requestPredict();`, 5000],
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let bad = 0;
try {
  for (const name of names) {
    const [q, js, wait] = SCENES[name];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e));
    await page.goto(`${BASE}?test&${q}`);
    try {
      await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
      if (js) await page.evaluate(`(() => { const fs = window.__fs; ${js} })()`);
      await page.keyboard.press('Backquote');
      await page.waitForTimeout(wait);
      const stats = await page.evaluate(() => window.__fsStats);
      await page.screenshot({ path: path.join(OUT, `lead-${name}.png`) });
      console.log(`${name}: fps ${stats.fps.toFixed(0)}, tris ${stats.triangles}, calls ${stats.calls}`);
    } catch (e) {
      bad++;
      console.log(`${name}: FAILED ${e.message}`);
      await page.screenshot({ path: path.join(OUT, `lead-${name}-failed.png`) }).catch(() => {});
    }
    if (errors.length) { console.log(`  console (${errors.length}):\n   ` + errors.slice(0, 8).join('\n   ')); }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
