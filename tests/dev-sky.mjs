// Screenshots of the sky at set times (v0.2.0's night): the clock paused at a KST time, the
// aircraft placed over Seoul, the nose view turned to an azimuth and a pitch, the HUD hidden.
// Run from the game folder, through the guard:
//   python3 tools/cpu-guard.py -- node tests/dev-sky.mjs [names…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/), SKY_OUT (default
// GameDump's "Claude outputs/flight-sim/"). Prints sky.state for each shot.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SKY_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
mkdirSync(OUT, { recursive: true });

const kst = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600e3;
// Each shot: the time, the height (m MSL), and the look: azimuth (° true), pitch (°), fov (°).
const SHOTS = {
  'fullmoon-moon': { ms: kst(2026, 11, 24, 21), z: 400, az: 105, pitch: 40, fov: 60 },
  'fullmoon-north': { ms: kst(2026, 11, 24, 21), z: 400, az: 0, pitch: 15, fov: 80 },
  'fullmoon-ground': { ms: kst(2026, 11, 24, 21), z: 900, az: 290, pitch: -12, fov: 70 },
  'newmoon-east': { ms: kst(2026, 11, 9, 23), z: 400, az: 100, pitch: 22, fov: 80 },
  'newmoon-north': { ms: kst(2026, 11, 9, 23), z: 400, az: 15, pitch: 25, fov: 85 },
  'newmoon-west': { ms: kst(2026, 11, 9, 23), z: 400, az: 290, pitch: 25, fov: 85 },
  'newmoon-zenith': { ms: kst(2026, 11, 9, 23), z: 400, az: 180, pitch: 80, fov: 100 },
  'fl350-west': { ms: kst(2026, 11, 9, 23), z: 10668, az: 290, pitch: 12, fov: 85 },
  'fl350-east': { ms: kst(2026, 11, 9, 23), z: 10668, az: 100, pitch: 8, fov: 85 },
  'dusk-west': { ms: kst(2026, 11, 1, 17, 30), z: 600, az: 245, pitch: 6, fov: 75 },
  'dusk-east': { ms: kst(2026, 11, 1, 17, 30), z: 600, az: 65, pitch: 6, fov: 75 },
  'dusk-late': { ms: kst(2026, 11, 1, 18, 5), z: 600, az: 245, pitch: 10, fov: 80 },
  'dawn-east': { ms: kst(2026, 11, 1, 6, 30), z: 600, az: 110, pitch: 6, fov: 75 },
  'day-1400': { ms: kst(2026, 11, 1, 14), z: 600, az: 215, pitch: 2, fov: 70 },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.world?.sky?.stars, null, { timeout: 90000 });
  await page.waitForTimeout(1000);
  for (const name of names) {
    const s = SHOTS[name];
    if (!s) { console.log('unknown shot', name); failed++; continue; }
    const st = await page.evaluate((s) => {
      const fs = window.__fs, D = Math.PI / 180;
      fs.setPaused(true, true);
      fs.clock.setRunning(false);
      fs.clock.set(s.ms);
      // Over the Han by Yeouido, heading the way we look.
      fs.sim.reset({ x: -52500, y: 168800, z: s.z, hdg: s.az * D, onGround: false, iasMs: 120, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
      fs.rig.viewId = 'nose';
      Object.assign(fs.rig.looks.nose, { yaw: 0, pitch: s.pitch * D, fov: s.fov });
      for (const id of ['hud', 'pause', 'perf', 'toast', 'score']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
      fs.renderOnce();
      return fs.world.sky.state;
    }, s);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(120); }
    const calls = await page.evaluate(() => window.__fs.renderer.info.render.calls);
    const file = path.join(OUT, `v020-night-sky-${name}.png`);
    await page.screenshot({ path: file });
    const r = (x) => Math.round(x * 10) / 10;
    console.log(`${name}: sun ${r(st.sunAltDeg)}°/${r(st.sunAzDeg)}°, moon ${r(st.moonAltDeg)}°/${r(st.moonAzDeg)}° ${Math.round(st.moonIllum * 100)}%, night ${r(st.night)}, exposure ${r(st.exposure)}, calls ${calls}`);
  }
  // The per-frame cost of setTime in the page: 1x (most calls return at once) and 600x.
  const cost = await page.evaluate(() => {
    const sky = window.__fs.world.sky, t0 = window.__fs.clock.ms, n = 3000;
    let a = performance.now();
    for (let i = 0; i < n; i++) sky.setTime(t0 + i * 16.7, 37.56, 126.8);
    const x1 = (performance.now() - a) / n;
    a = performance.now();
    for (let i = 0; i < n; i++) sky.setTime(t0 + 1e8 + i * 10000, 37.56, 126.8);
    return { x1, x600: (performance.now() - a) / n };
  });
  console.log(`setTime per frame: ${(cost.x1 * 1000).toFixed(2)} µs at 1x, ${(cost.x600 * 1000).toFixed(1)} µs at 600x`);
  if (errors.length) { console.log('errors:', errors.join(' | ')); failed++; }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
