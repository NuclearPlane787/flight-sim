// v0.4.0: the cloud layers and lightning in the real game, on this Mac's GPU. Saves v040-clouds-<name>.png.
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-weather-clouds.mjs [names…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/), FS_OUT.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
const DAY = KST(2026, 11, 3, 13), DUSK = KST(2026, 11, 1, 17, 40), NIGHT = KST(2026, 11, 9, 23), MOON = KST(2026, 11, 24, 22);
const Q = 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000';
const SEOUL = { x: -58000, y: 166500 };
const OVC = [{ okta: 8, baseFt: 3000, topFt: 6000 }], BKN = [{ okta: 6, baseFt: 3000, topFt: 5000 }], SCT = [{ okta: 3, baseFt: 4000, topFt: 6500 }], FEW = [{ okta: 2, baseFt: 5000, topFt: 7000 }];
const look = (pitchDeg, yawDeg = 0, fov = 60) => ({ pitch: pitchDeg * Math.PI / 180, yaw: yawDeg * Math.PI / 180, fov });

const SHOTS = {
  'day-below-bkn': { ms: DAY, z: 500, clouds: BKN, view: 'nose', l: look(14) },
  'day-below-ovc': { ms: DAY, z: 500, clouds: OVC, view: 'nose', l: look(10) },
  'day-above-ovc': { ms: DAY, z: 3000, clouds: OVC, view: 'captain', l: look(-6) },
  'day-above-sct': { ms: DAY, z: 2800, clouds: SCT, view: 'nose', l: look(-12) },
  'day-above-few': { ms: DAY, z: 2800, clouds: FEW, view: 'nose', l: look(-14) },
  'day-in-cloud': { ms: DAY, z: 1400, clouds: OVC, view: 'orbit', l: { pitch: 8 * Math.PI / 180, yaw: 150 * Math.PI / 180 } },
  'day-cockpit-in-cloud': { ms: DAY, z: 1400, clouds: OVC, view: 'captain', l: look(0) },
  'dusk-above-ovc': { ms: DUSK, z: 3000, clouds: OVC, view: 'nose', l: look(-3, 90) },
  'night-below-ovc-seoul': { ms: NIGHT, z: 500, clouds: OVC, view: 'nose', l: look(8) },
  'night-above-ovc-seoul': { ms: NIGHT, z: 3000, clouds: OVC, view: 'nose', l: look(-8) },
  'night-above-ovc-moon': { ms: MOON, z: 3000, clouds: OVC, view: 'nose', l: look(-8) },
};
const LIGHTNING = { 'storm-night': { ms: NIGHT, z: 1200, clouds: [{ okta: 7, baseFt: 6000, topFt: 12000 }], view: 'nose', l: look(4) } };

const names = process.argv.slice(2).length ? process.argv.slice(2) : [...Object.keys(SHOTS), ...Object.keys(LIGHTNING)];
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?test&${Q}`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const clearCalls = await page.evaluate(async () => { for (let i = 0; i < 30; i++) { window.__fs.renderOnce(); await new Promise((r) => setTimeout(r, 30)); } return window.__fs.renderer.info.render.calls; });
  const place = (s) => page.evaluate(({ s, SEOUL }) => {
    const fs = window.__fs;
    fs.setPaused(true, true);
    fs.sim.reset({ x: SEOUL.x, y: SEOUL.y, z: s.z, hdg: 45 * Math.PI / 180, onGround: false, iasMs: 200 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 15000 });
    fs.clock.set(s.ms); fs.clock.setRunning(false);
    fs.rig.viewId = s.view;
    Object.assign(fs.rig.looks[s.view], s.l);
    for (const id of ['toast', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  }, { s, SEOUL });

  for (const name of names) {
    const s = SHOTS[name];
    if (!s) continue;
    await place(s);
    await page.evaluate((clouds) => { window.__fs.sim.setWeather({ preset: 'custom', seed: 7, clouds }); }, s.clouds);
    await page.evaluate(async () => { for (let i = 0; i < 8; i++) { window.__fs.renderOnce(); await new Promise((r) => setTimeout(r, 120)); } });
    const calls = await page.evaluate(() => window.__fs.renderer.info.render.calls);
    await page.screenshot({ path: path.join(OUT, `v040-clouds-${name}.png`) });
    console.log(`shot ${name}: draw calls ${calls} (clear ${clearCalls})`);
    check(`no errors after ${name}`, errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  for (const name of names) {
    const s = LIGHTNING[name];
    if (!s) continue;
    await place(s);
    await page.evaluate(({ clouds }) => {
      const fs = window.__fs;
      fs.sim.setWeather({ preset: 'custom', seed: 11, clouds, lightning: 1 });
      fs.setPaused(false, true);
      fs.setTimeScale(1);
      const sc = fs.scene, r = fs.renderer, render = r.render.bind(r);
      window.__shots = {};
      const bolt = sc.getObjectByName('lightning-bolt'), flash = sc.getObjectByName('lightning-flash');
      let busy = false;
      r.render = (a, b) => {
        render(a, b);
        if (busy) return;
        if (bolt?.visible && !window.__shots.bolt) {
          // Turn to face the bolt (as tests/browser-night.mjs faces the Moon), render once more and keep that.
          busy = true;
          const s = fs.sim.state, az = Math.atan2(bolt.position.x, -bolt.position.z);
          fs.rig.looks.nose.yaw = -Math.atan2(Math.sin(az - s.hdg), Math.cos(az - s.hdg));
          fs.rig.looks.nose.pitch = 4 * Math.PI / 180;
          fs.renderOnce();
          window.__shots.bolt = r.domElement.toDataURL('image/png');
          busy = false;
        } else if (flash?.visible && !window.__shots.flash) window.__shots.flash = r.domElement.toDataURL('image/png');
      };
    }, { clouds: s.clouds });
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(500);
      const got = await page.evaluate(() => Object.keys(window.__shots));
      if (got.includes('bolt') && got.includes('flash')) break;
    }
    const got = await page.evaluate(() => { const fs = window.__fs; fs.setPaused(true, true); return window.__shots; });
    for (const k of Object.keys(got)) {
      writeFileSync(path.join(OUT, `v040-clouds-${name}-${k}.png`), Buffer.from(got[k].split(',')[1], 'base64'));
      console.log(`shot ${name}-${k}`);
    }
    check('a flash was seen', !!got.flash);
    check('a bolt was seen', !!got.bolt);
    const after = await page.evaluate(() => { const fs = window.__fs; fs.sim.setWeather({ preset: 'clear' }); fs.renderOnce(); return [fs.scene.getObjectByName('lightning-bolt').visible, fs.scene.getObjectByName('lightning-flash').visible, fs.scene.getObjectByName('cloud-base').visible]; });
    await page.evaluate(async () => { for (let i = 0; i < 4; i++) { window.__fs.renderOnce(); await new Promise((r) => setTimeout(r, 60)); } });
    const hid = await page.evaluate(() => [window.__fs.scene.getObjectByName('lightning-bolt').visible, window.__fs.scene.getObjectByName('lightning-flash').visible, window.__fs.scene.getObjectByName('cloud-base').visible, window.__fs.renderer.info.render.calls]);
    check('clear weather hides everything', !hid[0] && !hid[1] && !hid[2], `visible ${hid.slice(0, 3)}; calls ${hid[3]} (clear ${clearCalls})`);
  }
  // The frame rate, under a three-layer sky looking up (the most cloud overdraw), and the draw calls at one place, clear and clouded.
  if (names.includes('fps') || !process.argv.slice(2).length) {
    const THREE_LAYERS = [{ okta: 6, baseFt: 3000, topFt: 4500 }, { okta: 4, baseFt: 9000, topFt: 12000 }, { okta: 8, baseFt: 28000, topFt: 32000 }];
    await place({ ms: DAY, z: 500, view: 'nose', l: look(25) });
    const calls = async () => page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.__fs.renderOnce(); await new Promise((r) => setTimeout(r, 40)); } return window.__fs.renderer.info.render.calls; });
    const clear = await calls();
    await page.evaluate((clouds) => { window.__fs.sim.setWeather({ preset: 'custom', seed: 3, clouds }); }, THREE_LAYERS);
    const clouded = await calls();
    await page.evaluate(() => { const fs = window.__fs; fs.setPaused(false, true); fs.setTimeScale(1); });
    await page.waitForTimeout(1500);
    const samples = [];
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(750); samples.push(await page.evaluate(() => ({ ...window.__fsStats }))); }
    const fpsAvg = samples.reduce((a, s) => a + s.fps, 0) / samples.length, fpsMin = Math.min(...samples.map((s) => s.fps));
    console.log(`fps avg ${fpsAvg.toFixed(1)} min ${fpsMin.toFixed(1)}; draw calls clear ${clear}, three layers ${clouded}; sample ${JSON.stringify(samples[3])}`);
    check('draw calls add no more than the layers', clouded - clear <= 6, `${clouded - clear} more`);
    await page.evaluate(() => window.__fs.setPaused(true, true));
  }
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
