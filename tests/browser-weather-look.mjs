// v0.4.0 Part 4: visibility, fog and the overcast's light and the wet/snowy ground, in the real game on this Mac's GPU.
//   python3 tools/cpu-guard.py -- node tests/browser-weather-look.mjs [names…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/).
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
const DAY = KST(2026, 11, 10, 13), NIGHT = KST(2026, 11, 9, 23);
const Q = 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000';
const AIR = (x, y, zM, hdgDeg, kt = 220) => `(() => { const fs = window.__fs;
  fs.sim.reset({ x: ${x}, y: ${y}, z: ${zM}, hdg: ${hdgDeg} * Math.PI / 180, onGround: false, iasMs: ${kt} / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 }); })()`;
const FINAL = (nm, flap = 3) => `(() => { const fs = window.__fs, ax = fs.runwayAxis(fs.dest.end, fs.dest.other), d = ${nm} * 1852;
  fs.sim.reset({ x: ax.tx - ax.ux * d, y: ax.ty - ax.uy * d, z: (fs.dest.end.elevM || 0) + 15 + Math.tan(3 * Math.PI / 180) * d, hdg: Math.atan2(ax.ux, ax.uy), onGround: false, iasMs: 140 / 1.943844, flapLever: ${flap}, gearDown: true, fuelKg: 5000, payloadKg: 17000 }); })()`;
const RUNWAY = '0';
const FWD = { yaw: 0, pitch: -2 * Math.PI / 180, fov: 62 };
const SHOTS = {
  clear: { wx: null, ms: DAY, setup: RUNWAY },
  haze3km: { wx: { visM: 3000 }, ms: DAY, setup: RUNWAY },
  fog400: { wx: { visM: 400, fogTopFt: 400 }, ms: DAY, setup: RUNWAY },
  'fog-final': { wx: { visM: 700, fogTopFt: 300 }, ms: DAY, setup: FINAL(1.4, 3) },
  'fog-final-night': { wx: { visM: 700, fogTopFt: 300 }, ms: NIGHT, setup: FINAL(1.4, 3) },
  'fog-above': { wx: { visM: 400, fogTopFt: 800 }, ms: DAY, setup: AIR(-63000, 165000, 1500, 200), look: { yaw: 0.4, pitch: -0.25, fov: 62 } },
  overcast: { wx: { clouds: [{ okta: 8, baseFt: 2500, topFt: 7000 }] }, ms: DAY, setup: RUNWAY },
  'above-overcast': { wx: { clouds: [{ okta: 8, baseFt: 2500, topFt: 7000 }] }, ms: DAY, setup: AIR(-63000, 165000, 2700, 200), look: { yaw: 0, pitch: -0.1, fov: 62 } },
  'in-cloud': { wx: { clouds: [{ okta: 8, baseFt: 2500, topFt: 7000 }] }, ms: DAY, setup: AIR(-63000, 165000, 1500, 200), look: { yaw: 0, pitch: 0, fov: 62 } },
  wet: { wx: { precip: { kind: 'rain', rate: 0.6 }, tempC: 12, clouds: [{ okta: 7, baseFt: 3000, topFt: 8000 }], visM: 8000 }, ms: DAY, setup: RUNWAY },
  snow: { wx: { precip: { kind: 'snow', rate: 0.7 }, tempC: -4, runway: 'snow', clouds: [{ okta: 7, baseFt: 3000, topFt: 8000 }], visM: 4000 }, ms: DAY, setup: AIR(-63500, 168000, 700, 135, 180), look: { yaw: 0, pitch: -0.2, fov: 62 } },
  'snow-rwy': { wx: { precip: { kind: 'snow', rate: 0.7 }, tempC: -4, runway: 'snow', clouds: [{ okta: 7, baseFt: 3000, topFt: 8000 }], visM: 8000 }, ms: DAY, setup: RUNWAY },
  'snow-cleared': { wx: { precip: { kind: 'snow', rate: 0.7 }, tempC: -4, runway: 'wet', clouds: [{ okta: 5, baseFt: 3000, topFt: 8000 }], visM: 8000 }, ms: DAY, setup: RUNWAY },
  'snow-night': { wx: { precip: { kind: 'snow', rate: 0.4 }, tempC: -4, runway: 'snow', clouds: [{ okta: 5, baseFt: 6000, topFt: 9000 }], visM: 9000 }, ms: NIGHT, setup: AIR(-55000, 165000, 900, 100, 200), look: { yaw: 0, pitch: -0.15, fov: 62 } },
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1280,800'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}?test&${Q}`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  for (const name of names) {
    const shot = SHOTS[name];
    if (!shot) continue;
    await page.evaluate(shot.setup);
    const stats = await page.evaluate(({ wx, ms, look }) => {
      const fs = window.__fs;
      fs.sim.setWeather(wx ? { preset: 'custom', ...wx } : null);
      fs.world.setWeather(wx ? fs.sim.weather || { preset: 'custom', ...wx } : null);
      fs.clock.set(ms); fs.clock.setRunning(false);
      fs.setPaused(true, true);
      fs.rig.viewId = 'orbit'; fs.rig.viewId = look ? 'captain' : 'nose';
      if (look) Object.assign(fs.rig.looks.captain, look);
      else Object.assign(fs.rig.looks.nose, { yaw: 0, pitch: -2 * Math.PI / 180, fov: 62 });
      for (const id of ['toast', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
      return { dc: fs.world.stats.drawCalls };
    }, { wx: shot.wx, ms: shot.ms, look: shot.look });
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(120); }
    const after = await page.evaluate(() => { const u = window.__fs.world.uniforms; return { dc: window.__fs.world.stats.drawCalls, s0: u.uHazeSigma0.value, fog: u.uFogSigma.value, wet: u.uWet.value, snow: u.uSnow.value, night: u.uNight.value }; });
    await page.screenshot({ path: path.join(OUT, `v040-${name}.png`) });
    console.log(name, JSON.stringify(after));
  }
  console.log('errors:', errors.length, errors.slice(0, 5).join(' || '));
} finally { await browser.close(); }
process.exit(errors.length ? 1 : 0);
