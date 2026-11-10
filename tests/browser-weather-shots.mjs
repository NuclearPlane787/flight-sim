// v0.4.0's pictures and frame rates (V040.md → Definition of done), in the real game in Chrome on this Mac's GPU:
// every preset by day and at night, from the cockpit and in 3rd person, on a final at Jeju; then the frame rate at
// night in heavy rain, in a thunderstorm and in fog, and clear weather's draw calls.
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-weather-shots.mjs [shots|fps]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/).
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
const DAY = KST(2026, 11, 10, 13), NIGHT = KST(2026, 11, 9, 23);
const PRESETS = ['clear', 'few', 'overcast', 'rain', 'thunderstorm', 'snow', 'fog', 'crosswind'];
const mode = process.argv[2] || 'all';

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const errors = [];
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  const ids = await page.evaluate(async () => {
    const m = await import(new URL('src/sim/weather-presets.js', location.href).href);
    window.__wp = m;
    return m.PRESETS.map((p) => p.id);
  });
  console.log('presets:', ids.join(', '));
  const place = (preset, nm = 3) => page.evaluate(({ preset, nm }) => {
    const fs = window.__fs, ax = fs.runwayAxis(fs.dest.end, fs.dest.other), d = nm * 1852;
    fs.sim.setWeather(window.__wp.presetWeather(preset, fs.weatherCtx));
    fs.sim.reset({ x: ax.tx - ax.ux * d, y: ax.ty - ax.uy * d, z: (fs.dest.end.elevM || 0) + 15 + Math.tan(3 * Math.PI / 180) * d, hdg: ax.hdg, onGround: false, iasMs: 140 / 1.943844, flapLever: 3, gearDown: true, fuelKg: 3000, payloadKg: 17000 });
    fs.sim.controls.gearDown = true; fs.sim.controls.flapLever = 3;
    for (let i = 0; i < 120; i++) fs.sim.step(1 / 120);
  }, { preset, nm });
  const setView = (ms, view) => page.evaluate(({ ms, view }) => {
    const fs = window.__fs;
    fs.clock.set(ms); fs.clock.setRunning(false); fs.setPaused(true, true);
    fs.rig.viewId = view;
    for (const id of ['toast', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  }, { ms, view });
  if (mode !== 'fps' && mode !== 'extras') {
    for (const id of ids) {
      await place(id);
      for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) {
        for (const [vn, view] of [['cockpit', 'captain'], ['3rd', 'orbit']]) {
          await setView(ms, view);
          for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(120); }
          await page.screenshot({ path: path.join(OUT, `v040-${id}-${tod}-${vn}.png`) });
        }
      }
      console.log('shot', id);
    }
  }
  if (mode === 'all' || mode === 'extras') {
    // The Boeing's ND and MCP, in a crosswind and at altitude.
    await page.goto(`${BASE}?test&type=b787-9&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 90000 });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { window.__wp = await import(new URL('src/sim/weather-presets.js', location.href).href); });
    await place('gusty-crosswind', 8);
    await setView(DAY, 'captain');
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(120); }
    await page.screenshot({ path: path.join(OUT, 'v040-boeing-nd-wind-mcp-baro.png') });
    console.log('shot boeing nd');
  }
  if (mode !== 'shots' && mode !== 'extras') {
    await page.evaluate(() => { document.getElementById('perf')?.style.setProperty('visibility', 'visible'); });
    await page.keyboard.press('F3');
    const frames = async (name, preset, ms, min) => {
      await place(preset, 8);
      await page.evaluate(({ ms }) => { const fs = window.__fs; fs.clock.set(ms); fs.clock.setRunning(false); fs.rig.viewId = 'captain'; fs.setPaused(false); }, { ms });
      await page.waitForTimeout(4000);
      const sm = [];
      for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); sm.push(await page.evaluate(() => ({ ...window.__fsStats }))); }
      const fps = sm.map((s) => s.fps), avg = fps.reduce((a, b) => a + b) / fps.length, lo = Math.min(...fps);
      const calls = Math.max(...sm.map((s) => s.calls)), tris = Math.max(...sm.map((s) => s.triangles));
      check(`${name}: 60 fps`, lo >= min, `avg ${avg.toFixed(1)}, min ${lo.toFixed(1)}`);
      check(`${name}: within the budgets`, calls <= 300 && tris <= 1.05e6, `${calls} draws, ${(tris / 1e6).toFixed(2)} M triangles`);
      return calls;
    };
    await frames('clear, day', 'clear', DAY, 50);
    await frames('heavy rain, night', 'rain', NIGHT, 55);
    await frames('thunderstorm, night', 'thunderstorm', NIGHT, 55);
    await frames('fog, night', 'fog', NIGHT, 55);
  }
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
