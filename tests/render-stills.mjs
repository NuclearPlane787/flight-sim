// The main menu's stills (assets/menu/*.jpg), rendered from the game in Chrome on this Mac's
// GPU with a free camera, the HUD hidden. Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/render-stills.mjs [names…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/), STILLS_OUT (default assets/menu/).
// The day stills are at 15:00 KST on 31 Oct 2026; 'seoul-night' at 23:00 KST on 9 Nov 2026 (STILL_CLOCK_MS overrides the day's).

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { statSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.STILLS_OUT || path.resolve(here, '../assets/menu');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
mkdirSync(OUT, { recursive: true });

// Each shot: a start, then a setup function run in the page (places the aircraft and the camera).
const SHOTS = {
  'gimpo-gate': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', setup: `(() => {
      const fs = window.__fs, a = fs.airports.find((x) => x.icao === 'RKSS');
      const st = a.stands.find((s) => s.ref === '3') || a.stands[Math.floor(a.stands.length / 2)];
      fs.startFlight({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'gate', stand: st.ref, pax: 180, cargoKg: 2000, fuelKg: 6000, waypoints: [] });
      fs.setPaused(true, true);
      return { look: [145, 9, 62, 46] };
    })()` },
  'jeju-final': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: `(() => {
      const fs = window.__fs, s = fs.sim.state;
      const ax = fs.runwayAxis(fs.dest.end, fs.dest.other);
      // 7 nm out on the 3° path, gear and flaps down.
      const d = 7 * 1852;
      fs.sim.reset({ x: ax.tx - ax.ux * d, y: ax.ty - ax.uy * d, z: (fs.dest.end.elevM || 0) + 15 + Math.tan(3 * Math.PI / 180) * d,
        hdg: ax.hdg, onGround: false, iasMs: 140 / 1.943844, flapLever: 3, gearDown: true, fuelKg: 3000, payloadKg: 17000 });
      fs.sim.controls.gearDown = true; fs.sim.controls.flapLever = 3;
      for (let i = 0; i < 240; i++) fs.sim.step(1 / 120);
      fs.setPaused(true, true);
      return { look: [205, 4, 70, 50] };
    })()` },
  'seoul': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', setup: `(() => {
      const fs = window.__fs;
      // Over the Han by Yeouido, 3,000 ft, heading east.
      fs.sim.reset({ x: -52500, y: 168800, z: 914, hdg: 80 * Math.PI / 180, onGround: false, iasMs: 220 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
      fs.sim.controls.gearDown = false; fs.sim.controls.flapLever = 0;
      for (let i = 0; i < 120; i++) fs.sim.step(1 / 120);
      fs.setPaused(true, true);
      return { look: [150, 12, 85, 55] };
    })()` },
  // Night over Seoul (23:00 KST on 9 Nov 2026, a new Moon): the city lights and the Milky Way.
  'seoul-night': { ms: Date.UTC(2026, 10, 9, 14, 0), q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', setup: `(() => {
      const fs = window.__fs;
      fs.sim.reset({ x: -60500, y: 166500, z: 1100, hdg: 70 * Math.PI / 180, onGround: false, iasMs: 220 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
      fs.sim.controls.gearDown = false; fs.sim.controls.flapLever = 0;
      for (let i = 0; i < 120; i++) fs.sim.step(1 / 120);
      fs.setPaused(true, true);
      return { look: [165, 6, 70, 60] };
    })()` },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1600,1060'] });
let failed = 0;
try {
  for (const name of names) {
    const shot = SHOTS[name];
    if (!shot) { console.log('unknown shot', name); failed++; continue; }
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}?test&${shot.q}&fuel=6000`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(shot.setup);
    // The clock: the shot's own time, else a fixed afternoon (the menu's day stills).
    const clockMs = shot.ms ?? (process.env.STILL_CLOCK_MS ? Number(process.env.STILL_CLOCK_MS) : Date.UTC(2026, 9, 31, 6, 0));
    await page.evaluate((ms) => { const c = window.__fs.clock; c.set(ms); c.setRunning(false); }, clockMs);
    // The orbit camera at [yaw° from behind, pitch°, distance m, fov°].
    await page.evaluate(([yaw, pitch, dist, fov]) => {
      const fs = window.__fs, D = Math.PI / 180;
      fs.rig.viewId = 'orbit';
      Object.assign(fs.rig.looks.orbit, { yaw: yaw * D, pitch: pitch * D, dist, fov });
      for (const id of ['hud', 'pause', 'perf', 'toast', 'score']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
    }, r.look);
    // A few renders, so the terrain's rings and the detail settle around the camera.
    for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(150); }
    const file = path.join(OUT, `${name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
    console.log(`${name}: ${file} ${(statSync(file).size / 1024).toFixed(0)} KB${errors.length ? ' errors: ' + errors.join(' | ') : ''}`);
    if (errors.length) failed++;
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
