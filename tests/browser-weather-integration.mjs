// v0.4.0: the Weather tab in the real game (not the mock of tests/browser-weather-tab.mjs): a preset from the tab reaches the
// sim and the world, K sets the local QNH, a scenario's state carries the weather, a v0.3.2 state loads calm, and the plan's
// weather applies at the start of a flight.
//   python3 tools/cpu-guard.py -- node tests/browser-weather-integration.mjs
// Env: FS_URL (default http://localhost:8014/games/flight-sim/).
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
const HEADED = process.argv.includes('--headed') || process.env.FS_HEADLESS === '0';   // headless by default (no window on Shane's screen); --headed or FS_HEADLESS=0 for one
process.argv = process.argv.filter((a) => a !== '--headed');   // so positional arguments never see it

const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: ['--mute-audio', ...(HEADED ? [] : ['--use-angle=metal', '--ignore-gpu-blocklist']), '--window-size=1440,960'] });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(720, 450);
  const preset = () => page.evaluate(() => window.__fs.sim.weather?.preset ?? null);

  check('a new flight starts clear', (await preset()) === null);
  await page.evaluate(() => window.__fs.showLTab('weather'));
  await page.waitForTimeout(300);
  check('the Weather tab opens', await page.evaluate(() => window.__fs.weatherWin.isOpen));
  await page.click('[data-p="rain"]');
  await page.waitForTimeout(400);
  check('a preset from the tab reaches the sim', (await preset()) === 'rain', String(await preset()));
  const haze = await page.evaluate(() => { const u = window.__fs.world.uniforms; return { sigma: u.uHazeSigma0.value, wet: u.uWet?.value }; });
  check('and the world', haze.sigma > 2.6e-5 * 3, JSON.stringify(haze));

  // The L window's key (\ since v0.5.7) closes it and brings the same tab back.
  await page.evaluate(() => window.__fs.toggleL());
  await page.waitForTimeout(150);
  check('\\ closes it', await page.evaluate(() => !window.__fs.weatherWin.isOpen));
  await page.evaluate(() => window.__fs.toggleL());
  await page.waitForTimeout(150);
  check('\\ brings the Weather tab back', await page.evaluate(() => window.__fs.weatherWin.isOpen));
  await page.evaluate(() => window.__fs.toggleL());

  // Shift+B (K before v0.5.7): the local QNH.
  await page.mouse.click(720, 450);
  const qnh = await page.evaluate(() => window.__fs.sim.weather.qnh);
  await page.keyboard.press('Shift+KeyB');   // v0.5.7: the local QNH is Shift+B (K is the warehouse's block)
  await page.waitForTimeout(200);
  const hpa = await page.evaluate(() => window.__fs.sim.baro.hpa);
  check('Shift+B sets the local QNH', Math.abs(hpa - qnh) < 1e-9, `${hpa} vs ${qnh}`);

  // Saves.
  const saved = await page.evaluate(() => { const fs = window.__fs; const st = JSON.parse(JSON.stringify(fs.captureState())); fs.sim.setWeather(null); fs.applyState(st); return fs.sim.weather?.preset; });
  check('a saved state brings its weather', saved === 'rain', String(saved));
  const old = await page.evaluate(() => { const fs = window.__fs; const st = JSON.parse(JSON.stringify(fs.captureState())); delete st.sim.weather; fs.applyState(st); return fs.sim.weather; });
  check('a state from before v0.4.0 loads calm', old === null);

  // The plan's weather.
  await page.evaluate(() => { const fs = window.__fs; const st = fs.captureState(); fs.startFlight({ ...st.plan, weather: 'snow' }); });
  await page.waitForTimeout(1200);
  check('the plan\'s weather applies at the start', (await preset()) === 'snow', String(await preset()));
  await page.evaluate(() => { const fs = window.__fs; const st = fs.captureState(); fs.startFlight({ ...st.plan, weather: undefined }); });
  await page.waitForTimeout(1200);
  check('and clear when it has none', (await preset()) === null, String(await preset()));

  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) { check('run', false, String(e)); } finally { await browser.close(); }
process.exit(failed ? 1 : 0);
