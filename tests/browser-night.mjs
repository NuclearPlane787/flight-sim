// v0.2.0 Part 2's screenshots and frame rate (V020.md → Definition of done, Part 2), in the real
// game in Chrome on this Mac's GPU, with the clock set and stopped:
//   Seoul at night from FL100 and from 3,000 ft; final to Gimpo 14R at night; Jeju 07 from 12 nm
//   (close finals and Incheon's taxiways are in tests/dev-airportlights.mjs); the A321
//   from outside at night; dusk and dawn; the sky looking up; the Sky window; and the frame rate
//   at night over Seoul at 3,000 ft (fps, draw calls, triangles from the performance readout).
// Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-night.mjs [names…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/).

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
// A dark night with a new Moon (9 Nov 2026), a moonlit one (24 Nov), and today's dusk and dawn.
const NEW_MOON_23 = KST(2026, 11, 9, 23);
const FULL_MOON_22 = KST(2026, 11, 24, 22);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

// Each shot: the start query, the clock, a setup run in the page (places the aircraft), and the camera.
const AIR = (x, y, zM, hdgDeg, kt = 220) => `(() => { const fs = window.__fs;
  fs.sim.reset({ x: ${x}, y: ${y}, z: ${zM}, hdg: ${hdgDeg} * Math.PI / 180, onGround: false, iasMs: ${kt} / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
  fs.sim.controls.gearDown = false; fs.sim.controls.flapLever = 0; fs.ap.engageAp(); if (!fs.ap.athr) fs.ap.toggleAthr();
  fs.ap.setAlt(Math.round(${zM} * 3.28084 / 100) * 100); fs.ap.setHdg(${Math.round(0)} || Math.round(fs.gridToMagDeg(${hdgDeg} * Math.PI / 180, ${x}, ${y})) % 360 || 360); fs.ap.setSpd(${kt});
  for (let i = 0; i < 240; i++) fs.sim.step(1 / 120); })()`;
const FINAL = (nm, flap = 3) => `(() => { const fs = window.__fs, ax = fs.runwayAxis(fs.dest.end, fs.dest.other), d = ${nm} * 1852;
  fs.sim.reset({ x: ax.tx - ax.ux * d, y: ax.ty - ax.uy * d, z: (fs.dest.end.elevM || 0) + 15 + Math.tan(3 * Math.PI / 180) * d,
    hdg: ax.hdg, onGround: false, iasMs: 140 / 1.943844, flapLever: ${flap}, gearDown: true, fuelKg: 3000, payloadKg: 17000 });
  fs.sim.controls.gearDown = true; fs.sim.controls.flapLever = ${flap};
  for (let i = 0; i < 120; i++) fs.sim.step(1 / 120); })()`;
const SHOTS = {
  'seoul-fl100': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: NEW_MOON_23, setup: AIR(-62000, 160000, 3048, 45, 280), view: 'captain', look: { yaw: 0, pitch: -14 * Math.PI / 180, fov: 70 } },
  'seoul-3000ft': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: NEW_MOON_23, setup: AIR(-58000, 166500, 915, 60), view: 'captain', look: { yaw: 0, pitch: -10 * Math.PI / 180, fov: 70 } },
  'final-gimpo-14r': { q: 'origin=RKPC&dep=07&dest=RKSS&arr=14R&start=runway', ms: FULL_MOON_22, setup: FINAL(4), view: 'captain', look: { yaw: 0, pitch: -5 * Math.PI / 180, fov: 62 } },
  'final-jeju-07-far': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: NEW_MOON_23, setup: FINAL(12, 1), view: 'captain', look: { yaw: 0, pitch: -4 * Math.PI / 180, fov: 50 } },
  'a321-outside': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: FULL_MOON_22, setup: AIR(-63500, 168000, 600, 135, 180), view: 'orbit', look: { yaw: 150 * Math.PI / 180, pitch: 8 * Math.PI / 180, dist: 70, fov: 50 } },
  'dusk': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: KST(2026, 11, 1, 17, 48), setup: AIR(-70000, 168000, 1500, 250), view: 'orbit', look: { yaw: 200 * Math.PI / 180, pitch: 6 * Math.PI / 180, dist: 80, fov: 55 } },
  'dawn': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: KST(2026, 11, 1, 6, 42), setup: AIR(-55000, 165000, 1500, 100), view: 'orbit', look: { yaw: 180 * Math.PI / 180, pitch: 5 * Math.PI / 180, dist: 80, fov: 55 } },
  'sky-up': { q: 'origin=RKPC&dep=07&dest=RKSS&arr=14R&start=runway', ms: KST(2026, 8, 15, 22), setup: '0', view: 'nose', look: { yaw: 40 * Math.PI / 180, pitch: 55 * Math.PI / 180, fov: 85 } },
  'sky-moon': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: FULL_MOON_22, setup: '0', view: 'moon' },
  'sky-window': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway', ms: KST(2026, 11, 24, 21, 30), setup: '0', view: 'captain', look: { yaw: 0, pitch: 4 * Math.PI / 180, fov: 62 }, skywin: true },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : [...Object.keys(SHOTS), 'fps'];
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const errors = [];
try {
  for (const name of names) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    if (name === 'fps') {
      // 60 s of night flight over Seoul at 3,000 ft on the AP, captain's seat, the readout on.
      await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000`);
      await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
      await page.evaluate((ms) => { const fs = window.__fs; fs.clock.set(ms); fs.clock.setRunning(false); }, NEW_MOON_23);
      await page.evaluate(SHOTS['seoul-3000ft'].setup);
      await page.evaluate(() => { const fs = window.__fs; fs.rig.viewId = 'captain'; fs.setPaused(false); });
      await page.keyboard.press('F3');
      await page.waitForTimeout(5000);
      const samples = [];
      for (let i = 0; i < 10; i++) { await page.waitForTimeout(1000); samples.push(await page.evaluate(() => ({ ...window.__fsStats, night: window.__fs.world.uniforms.uNight.value, city: window.__fs.world.stats.cityLights }))); }
      const fps = samples.map((s) => s.fps), minFps = Math.min(...fps), avg = fps.reduce((a, b) => a + b) / fps.length;
      const calls = Math.max(...samples.map((s) => s.calls)), tris = Math.max(...samples.map((s) => s.triangles));
      const perf = await page.textContent('#perf');
      await page.screenshot({ path: path.join(OUT, 'v020-night-fps-seoul-3000ft.png') });
      check('60 fps at night over Seoul at 3,000 ft', minFps >= 58, `avg ${avg.toFixed(1)}, min ${minFps.toFixed(1)} fps; uNight ${samples[0].night.toFixed(2)}; city slots ${samples[0].city}`);
      check('within ~1 M triangles and 300 draws', calls <= 300 && tris <= 1.05e6, `max ${calls} draws, ${(tris / 1e6).toFixed(2)} M triangles; readout: ${perf}`);
      await page.close();
      continue;
    }
    const shot = SHOTS[name];
    if (!shot) { console.log('unknown', name); continue; }
    await page.goto(`${BASE}?test&${shot.q}&fuel=6000`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
    await page.waitForTimeout(800);
    await page.evaluate(shot.setup);
    await page.evaluate(({ ms, view, look }) => {
      const fs = window.__fs;
      fs.clock.set(ms); fs.clock.setRunning(false);
      fs.setPaused(true, true);
      if (view === 'moon') {
        // Look straight at the Moon from the nose view.
        fs.rig.viewId = 'nose'; fs.renderOnce();
        const st = fs.world.sky.state, s = fs.sim.state;
        const az = st.moonAzDeg * Math.PI / 180, hdgTrue = s.hdg; // grid ≈ true here
        fs.rig.looks.nose.yaw = -Math.atan2(Math.sin(az - hdgTrue), Math.cos(az - hdgTrue));
        fs.rig.looks.nose.pitch = st.moonAltDeg * Math.PI / 180;
        fs.rig.looks.nose.fov = 20;
      } else {
        fs.rig.viewId = view;
        Object.assign(fs.rig.looks[view], look);
      }
      for (const id of ['toast', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
    }, { ms: shot.ms, view: shot.view, look: shot.look });
    if (shot.skywin) { await page.keyboard.press('KeyL'); }
    for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(150); }
    const st = await page.evaluate(() => ({ ...window.__fs.world.sky.state, flash: 0 }));
    await page.screenshot({ path: path.join(OUT, `v020-night-${name}.png`) });
    console.log(`shot ${name}: sun ${st.sunAltDeg?.toFixed(1)}°, moon ${st.moonAltDeg?.toFixed(1)}° (${(st.moonIllum * 100).toFixed(0)}%), night ${st.night?.toFixed(2)}`);
    await page.close();
  }
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
