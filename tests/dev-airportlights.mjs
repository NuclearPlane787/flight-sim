// Airport lights at night (v0.2.0 Part 2, the airportlights job): screenshots of the runway,
// approach and PAPI lights, the taxiway lights, the aprons' floods and terminal windows, and
// the day for comparison. Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/dev-airportlights.mjs [names…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/), OUT (default Claude outputs/flight-sim/).
//
// Night: world.update is wrapped so the sky is set to 23:00 KST on 9 Nov 2026 (a new Moon)
// after main's own setTime, with the exposure the sky asks for; without sky.setTime the
// uniforms are set by hand. The rabbit's phase is pinned (uTime) so a still catches it.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
mkdirSync(OUT, { recursive: true });

const NIGHT_MS = Date.UTC(2026, 10, 9, 14, 0);   // 23:00 KST
const DAY_MS = Date.UTC(2026, 10, 9, 5, 0);       // 14:00 KST

// In the page: night on (or off), the rabbit's phase pinned.
const NIGHT_HOOK = `((on, ms, rabbitT) => {
  const fs = window.__fs, w = fs.world, u = w.uniforms;
  if (!w.__alOrig) w.__alOrig = w.update.bind(w);
  w.update = (ctx) => {
    if (w.sky.setTime) {
      w.sky.setTime(ms, 37.5, 126.8);
      if (w.sky.state && Number.isFinite(w.sky.state.exposure)) fs.renderer.toneMappingExposure = w.sky.state.exposure;
    } else if (on) {
      u.uNight.value = 1; u.uSunColor.value.setRGB(0, 0, 0); u.uSkyAmb.value.setRGB(0.02, 0.025, 0.04); u.uSunDir.value.set(0.3, -0.3, 0.9).normalize();
    }
    w.__alOrig(ctx);
    if (rabbitT != null) u.uTime.value = rabbitT;
    const tl = w.taxiLights;
    window.__alStats = { night: u.uNight.value, exposure: fs.renderer.toneMappingExposure, taxi: tl ? tl.sets.map((s) => [s.icao, s.pts.visible, s.count]) : null, stats: { ...w.stats } };
  };
})`;

// On final: d nm out on the 3° path to the destination's runway.
const finalAt = (nm) => `(() => {
  const fs = window.__fs;
  const ax = fs.runwayAxis(fs.dest.end, fs.dest.other);
  const d = ${nm} * 1852;
  fs.sim.reset({ x: ax.tx - ax.ux * d, y: ax.ty - ax.uy * d, z: (fs.dest.end.elevM || 0) + 15 + Math.tan(3 * Math.PI / 180) * d,
    hdg: ax.hdg, onGround: false, iasMs: 140 / 1.943844, flapLever: 3, gearDown: true, fuelKg: 3000, payloadKg: 17000 });
  fs.sim.controls.gearDown = true; fs.sim.controls.flapLever = 3;
  for (let i = 0; i < 60; i++) fs.sim.step(1 / 120);
  fs.setPaused(true, true);
})()`;

// Taxiing at Incheon: 140 m short of a stop bar, facing it (the bar nearest the 33L/33R ends).
const TAXI_SETUP = `(async () => {
  const fs = window.__fs;
  const mod = await import(new URL('src/world/taxilights.js', location.href).href);
  const a = fs.airports.find((x) => x.icao === 'RKSI');
  const L = mod.taxiLightLayout(a);
  const want = { x: -91900, y: 161900 };
  const bars = L.filter((l) => l.kind === 'stopbar');
  bars.sort((p, q) => Math.hypot(p.x - want.x, p.y - want.y) - Math.hypot(q.x - want.x, q.y - want.y));
  const b = bars[0], fx = -b.dir[0], fy = -b.dir[1];        // towards the runway
  const x = b.x - fx * 140, y = b.y - fy * 140;
  const g = fs.world.heightAt(x, y);
  fs.sim.reset({ x, y, z: g, hdg: Math.atan2(fx, fy), onGround: true, iasMs: 0, flapLever: 1, gearDown: true, fuelKg: 6000, payloadKg: 17000 });
  fs.setPaused(true, true);
  return { bar: [b.x, b.y] };
})()`;

const SHOTS = {
  'jeju07-8nm': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: finalAt(8), view: 'captain', night: true, rabbit: 0.15 },
  'jeju07-2nm': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: finalAt(2), view: 'captain', night: true, rabbit: 0.15 },
  'jeju07-15nm': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: finalAt(15), view: 'captain', night: true, rabbit: 0.15 },
  // Zoomed (1st person, 22° fov), to see the lights' pattern and colours.
  'jeju07-8nm-zoom': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: finalAt(8), view: 'nose', fov: 22, night: true, rabbit: 0.15 },
  'jeju07-2nm-zoom': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: finalAt(2), view: 'nose', fov: 12, night: true, rabbit: 0.15 },
  'jeju07-15nm-zoom': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: finalAt(15), view: 'nose', fov: 15, night: true, rabbit: 0.15 },
  'gimpo14R-4nm': { q: 'origin=RKPC&dep=07&dest=RKSS&arr=14R&start=final', setup: finalAt(4), view: 'captain', night: true, rabbit: 0.2 },
  'incheon-taxi': { q: 'origin=RKSI&dep=33L&dest=RKPC&arr=07&start=gate', setup: TAXI_SETUP, view: 'captain', night: true },
  'incheon-taxi-orbit': { q: 'origin=RKSI&dep=33L&dest=RKPC&arr=07&start=gate', setup: TAXI_SETUP, view: 'orbit', look: [160, 22, 160, 60], night: true },
  'incheon-apron': { q: 'origin=RKSI&dep=33L&dest=RKPC&arr=07&start=gate&stand=21', setup: `(() => { window.__fs.setPaused(true, true); })()`, view: 'orbit', look: [150, 16, 230, 60], night: true },
  'jeju07-2nm-day': { q: 'origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', setup: finalAt(2), view: 'captain', night: false },
  'incheon-apron-day': { q: 'origin=RKSI&dep=33L&dest=RKPC&arr=07&start=gate&stand=21', setup: `(() => { window.__fs.setPaused(true, true); })()`, view: 'orbit', look: [150, 16, 230, 60], night: false },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let failed = 0;
try {
  for (const name of names) {
    const shot = SHOTS[name];
    if (!shot) { console.log('unknown shot', name); failed++; continue; }
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page.goto(`${BASE}?test&${shot.q}&fuel=6000`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.world, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(shot.setup);
    await page.evaluate(`${NIGHT_HOOK}(${shot.night}, ${shot.night ? NIGHT_MS : DAY_MS}, ${shot.rabbit ?? 'null'})`);
    await page.evaluate(([view, look, fov]) => {
      const fs = window.__fs, D = Math.PI / 180;
      fs.rig.viewId = view;
      if (look) Object.assign(fs.rig.looks.orbit, { yaw: look[0] * D, pitch: look[1] * D, dist: look[2], fov: look[3] });
      if (fov) Object.assign(fs.rig.looks[view], { fov, pitch: -5.5 * D });
      for (const id of ['hud', 'pause', 'perf', 'toast', 'score']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
    }, [shot.view, shot.look || null, shot.fov || null]);
    for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(120); }
    const st = await page.evaluate(() => ({ al: window.__alStats, calls: window.__fs.renderer.info.render.calls, tris: window.__fs.renderer.info.render.triangles }));
    const file = path.join(OUT, `v020-night-airport-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`${name}: ${path.basename(file)} night=${st.al?.night?.toFixed(2)} exp=${st.al?.exposure?.toFixed(2)} calls=${st.calls} tris=${st.tris} worldCalls=${st.al?.stats?.drawCalls} lights=${st.al?.stats?.lights} taxi=${JSON.stringify(st.al?.taxi)} ${info ? JSON.stringify(info) : ''}${errors.length ? '\n  errors: ' + errors.slice(0, 5).join(' | ') : ''}`);
    if (errors.some((e) => /error/i.test(e))) failed++;
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
