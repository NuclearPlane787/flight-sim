// v0.4.0: looks at the rain, the snow and the windshield drops in the real game.
// Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-weather-precip.mjs
// Env: E2E_URL (default http://localhost:8014/games/flight-sim/), ONLY (a substring of the shot names).

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const URL0 = (process.env.E2E_URL || 'http://localhost:8014/games/flight-sim/') + '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway' + (process.env.TYPE ? `&type=${process.env.TYPE}` : '');
const ONLY = process.env.ONLY || '';

const profile = mkdtempSync(path.join(tmpdir(), 'fs-precip-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 }, args: ['--window-size=1440,960'] });
let code = 0;
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const NOON = Date.UTC(2026, 10, 10, 3, 0), NIGHT = Date.UTC(2026, 10, 9, 14, 0);
  const info = () => page.evaluate(() => {
    const f = window.__fs, r = f.renderer.info.render, sc = f.scene;
    const p = sc.getObjectByName('precip-particles'), d = sc.getObjectByName('precip-drops');
    return { fps: window.__fsStats?.fps, calls: r.calls, tris: r.triangles, view: f.rig.view.id, alt: Math.round(f.sim.state.pos.z), tas: Math.round(f.sim.state.tas), particles: p?.visible ? p.geometry.instanceCount : 0, drops: d?.visible ? d.geometry.instanceCount : 0, wet: d?.material.uniforms.uWet.value };
  });
  const shot = async (name) => {
    await page.waitForTimeout(500);
    console.log(name, JSON.stringify(await info()));
    if (ONLY && !name.includes(ONLY)) return;
    await page.screenshot({ path: path.join(OUT, `v040-precip-${name}.png`) });
  };
  const setWeather = (w) => page.evaluate((x) => window.__fs.sim.setWeather(x), w);
  const view = (id) => page.evaluate((v) => { window.__fs.rig.viewId = v; }, id);
  const clock = (ms) => page.evaluate((t) => { const f = window.__fs; f.clock.set(t); f.clock.setRunning(false); }, ms);
  const RAIN = { preset: 'custom', precip: { kind: 'rain', rate: 0.8 } };
  const SNOW = { preset: 'custom', precip: { kind: 'snow', rate: 0.7 }, tempC: -5 };

  // TYPE=b787-9 (a short run): another type's windows, and the fall stopping at the cloud base.
  if (process.env.TYPE) {
    await clock(NOON);
    await setWeather(RAIN);
    await view('captain');
    await page.waitForTimeout(5000);
    await shot(`rain-seat-runway-${process.env.TYPE}`);
    await page.evaluate(() => window.__fs.skipToFinal());
    await page.waitForTimeout(4000);
    await setWeather({ ...RAIN, clouds: [{ okta: 8, baseFt: 2000, topFt: 3000 }] });
    await page.waitForTimeout(1500);
    console.log('above a 2000 ft base (expect particles 0):', JSON.stringify(await info()));
    await setWeather({ ...RAIN, clouds: [{ okta: 8, baseFt: 12000, topFt: 14000 }] });
    await page.waitForTimeout(1500);
    console.log('below a 12000 ft base (expect particles > 0):', JSON.stringify(await info()));
    console.log('errors', errors.length, errors.slice(0, 5));
    if (errors.length) code = 1;
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
    process.exit(code);
  }

  await clock(NOON);
  await setWeather(null);
  await page.waitForTimeout(800);
  console.log('clear', JSON.stringify(await info()));

  await view('orbit');
  await page.waitForTimeout(1000);
  const clearOrbit = await info();
  console.log('clear orbit', JSON.stringify(clearOrbit));
  await setWeather(RAIN);
  await page.waitForTimeout(1200);
  await shot('rain-orbit-runway');
  const rainOrbit = await info();
  console.log('draw calls: clear', clearOrbit.calls, 'rain', rainOrbit.calls, '(expect +1)');
  // The bright patch at the bottom right: the particles' fault or the runway's? Hide the particles.
  await page.evaluate(() => { window.__fs.scene.getObjectByName('precip-particles').material.visible = false; });
  await shot('rain-orbit-runway-noparticles');
  await page.evaluate(() => { window.__fs.scene.getObjectByName('precip-particles').material.visible = true; });
  // Paused: the particles' offset stands still.
  const off = () => page.evaluate(() => window.__fs.scene.getObjectByName('precip-particles').material.uniforms.uOffset.value.toArray());
  await page.evaluate(() => window.__fs.setPaused(true));
  await page.waitForTimeout(300);
  const o1 = await off();
  await page.waitForTimeout(500);
  const o2 = await off();
  console.log('paused offset unchanged:', JSON.stringify(o1) === JSON.stringify(o2));
  await page.evaluate(() => window.__fs.setPaused(false));
  await view('captain');
  await page.waitForTimeout(5000);          // the windshield wets
  await shot('rain-seat-runway');

  await setWeather(SNOW);
  await view('orbit');
  await page.waitForTimeout(800);
  await shot('snow-orbit-runway');
  await view('captain');
  await page.waitForTimeout(4000);
  await shot('snow-seat-runway');

  await setWeather(RAIN);
  await page.evaluate(() => { const f = window.__fs; f.skipToFinal(); });
  await page.waitForTimeout(4000);
  await view('nose');
  await page.waitForTimeout(800);
  await shot('rain-nose-final');
  await view('captain');
  await page.waitForTimeout(4000);
  await shot('rain-seat-final');

  await clock(NIGHT);
  await page.waitForTimeout(1500);
  await shot('rain-seat-final-night');
  await view('orbit');
  await page.waitForTimeout(800);
  await shot('rain-orbit-final-night');

  // The budget: the heaviest rain, at night, in the seat (both draws on).
  await setWeather({ preset: 'custom', precip: { kind: 'rain', rate: 1 } });
  await view('captain');
  await page.waitForTimeout(3500);
  const fps = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(1000); fps.push((await info()).fps); }
  console.log('heavy rain at night, seat: fps', fps.map((x) => x.toFixed(1)).join(' '), JSON.stringify(await info()));
  await shot('rain-heavy-seat-final-night');

  await setWeather(SNOW);
  await view('captain');
  await page.waitForTimeout(3000);
  await shot('snow-seat-final-night');
  await clock(NOON);
  await view('nose');
  await page.waitForTimeout(1500);
  await shot('snow-nose-final');

  console.log('errors', errors.length, errors.slice(0, 5));
  if (errors.length) code = 1;
} catch (e) {
  console.error(e); code = 1;
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(code);
