// The city lights at night (src/world/citylights.js and cities.js's lit windows): stills of
// Seoul from FL100 and 3,000 ft, a close look at the apartment windows, the day unchanged,
// and the cost (draw calls, triangles, frame rate) with the lights on and off.
// Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/dev-citylights.mjs [shot…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/), SHOTS_OUT (default
// GameDump/Claude outputs/flight-sim/).
//
// Until the sky job's sky.setTime exists, night is set by hand through the world uniforms,
// and (test-only mock) sky.js is served with its sky and haze colours darkened by uNight, so
// the night isn't drawn under a day-blue sky.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHOTS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
mkdirSync(OUT, { recursive: true });
const D = Math.PI / 180;

// Each shot: aircraft { x, y, z (m), hdg° }, view, look, night or day.
const SHOTS = {
  fl100: { ac: { x: -62000, y: 166000, z: 3048, hdg: 75 }, view: 'nose', look: { pitch: -14 * D, fov: 60 }, night: true },
  '3000ft': { ac: { x: -54500, y: 168600, z: 914, hdg: 80 }, view: 'nose', look: { pitch: -10 * D, fov: 60 }, night: true },
  windows: { ac: { x: -50800, y: 169300, z: 260, hdg: 120 }, view: 'nose', look: { pitch: -16 * D, fov: 45 }, night: true },
  day: { ac: { x: -54500, y: 168600, z: 914, hdg: 80 }, view: 'nose', look: { pitch: -10 * D, fov: 60 }, night: false },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  // The sky mock, only while sky.js has no setTime.
  await page.route('**/src/world/sky.js', async (route) => {
    const res = await route.fetch();
    let src = await res.text();
    if (!src.includes('setTime')) {
      src = src.replace(/(float t = pow\(1\.0 - clamp\(e, 0\.0, 1\.0\), mix\(5\.0, 9\.0, alt\)\);\n\s*vec3 c = mix\(zenith, horizon, t\);)/,
        '$1\n  c = c * (1.0 - 0.985 * uNight) + vec3(0.002, 0.003, 0.008) * uNight;');
      src = src.replace('vec3(0.36, 0.46, 0.62), 0.35)', 'vec3(0.36, 0.46, 0.62) * (1.0 - 0.985 * uNight), 0.35)');
    }
    await route.fulfill({ response: res, body: src });
  });
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.world, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const has = await page.evaluate(() => ({ cl: !!window.__fs.world.cityLights, setTime: !!window.__fs.world.sky.setTime }));
  console.log('cityLights in world:', has.cl, '· sky.setTime:', has.setTime);
  if (!has.cl) { console.log('no cityLights: is world.js wired?'); failed++; }

  for (const name of names) {
    const s = SHOTS[name];
    if (!s) { console.log('unknown shot', name); failed++; continue; }
    const res = await page.evaluate(([s, D]) => {
      const fs = window.__fs, u = fs.world.uniforms;
      fs.sim.reset({ x: s.ac.x, y: s.ac.y, z: s.ac.z, hdg: s.ac.hdg * D, onGround: false, iasMs: 230 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
      fs.sim.controls.gearDown = false; fs.sim.controls.flapLever = 0;
      fs.setPaused(true, true);
      fs.rig.viewId = s.view;
      Object.assign(fs.rig.looks[s.view], s.look);
      for (const id of ['hud', 'pause', 'perf', 'toast', 'score']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
      if (fs.world.sky.setTime) {
        // 23:00 KST on 9 Nov 2026 (a new Moon), or 14:00 for the day.
        fs.clock.set(s.night ? Date.UTC(2026, 10, 9, 14, 0) : Date.UTC(2026, 10, 9, 5, 0));
        fs.clock.setRunning?.(false);
      } else if (s.night) {
        u.uNight.value = 1;
        u.uSunColor.value.setRGB(0, 0, 0);
        u.uSkyAmb.value.setRGB(0.02, 0.025, 0.04);
        u.uSunDir.value.set(0, -0.3, 0.95).normalize();
      } else {
        u.uNight.value = 0;
        u.uSunColor.value.setRGB(1.0, 0.94, 0.86);
        u.uSkyAmb.value.setRGB(0.38, 0.46, 0.58);
        u.uSunDir.value.copy(fs.world.sun);
      }
      return true;
    }, [s, D]);
    for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(120); }
    const stats = await page.evaluate(() => {
      const fs = window.__fs, ri = fs.renderer.info.render, cl = fs.world.cityLights;
      const r = cl.update({ camMap: { x: fs.sim.state.pos.x, y: fs.sim.state.pos.y }, origin: { x: fs.sim.state.pos.x, y: fs.sim.state.pos.y } });
      fs.renderOnce();
      return { calls: ri.calls, tris: ri.triangles, points: ri.points, cl: r, night: fs.world.uniforms.uNight.value };
    });
    const file = path.join(OUT, `v020-night-city-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`${name}: ${file}`, JSON.stringify(stats));
  }

  // The cost at night over Seoul at 3,000 ft: frames rendered for real (unpaused), with the
  // city lights on and then hidden.
  if (!process.argv.slice(2).length || process.argv.includes('3000ft')) {
    for (const on of [true, false]) {
      const r = await page.evaluate(async ([on, D]) => {
        const fs = window.__fs, u = fs.world.uniforms;
        fs.sim.reset({ x: -54500, y: 168600, z: 914, hdg: 80 * D, onGround: false, iasMs: 230 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
        fs.sim.controls.gearDown = false; fs.sim.controls.flapLever = 0;
        if (fs.world.sky.setTime) { fs.clock.set(Date.UTC(2026, 10, 9, 14, 0)); fs.clock.setRunning?.(false); }
        else { u.uNight.value = 1; u.uSunColor.value.setRGB(0, 0, 0); u.uSkyAmb.value.setRGB(0.02, 0.025, 0.04); }
        const obj = fs.world.cityLights.object;
        // Hide the lights by turning the object off each frame (update turns it back on).
        let hook = null;
        if (!on) { const up = fs.world.update; hook = up; fs.world.update = (a) => { up.call(fs.world, a); obj.visible = false; }; }
        fs.setPaused(false);
        await new Promise((res) => setTimeout(res, 1500));
        const f0 = fs.frames, t0 = performance.now();
        const ms = [];
        let last = performance.now();
        await new Promise((res) => {
          const tick = () => { const n = performance.now(); ms.push(n - last); last = n; if (n - t0 < 4000) requestAnimationFrame(tick); else res(); };
          requestAnimationFrame(tick);
        });
        const frames = fs.frames - f0, secs = (performance.now() - t0) / 1000;
        const st = window.__fsStats;
        fs.setPaused(true, true);
        // GPU time, uncapped: 40 renders back to back, each waited for (a 1-pixel read).
        const gl = fs.renderer.getContext(), px = new Uint8Array(4);
        fs.renderOnce(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const g0 = performance.now();
        for (let i = 0; i < 40; i++) { fs.renderOnce(); if (!on) { obj.visible = false; } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        const gpuMs = (performance.now() - g0) / 40;
        if (hook) fs.world.update = hook;
        ms.sort((a, b) => a - b);
        return { on, msPerFrameUncapped: +gpuMs.toFixed(2), fps: +(frames / secs).toFixed(1), p95ms: +ms[Math.floor(ms.length * 0.95)].toFixed(1), drawMs: +st.drawMs.toFixed(2), calls: st.calls, tris: st.triangles, cityLights: fs.world.stats.cityLights };
      }, [on, D]);
      console.log('cost', JSON.stringify(r));
    }
  }
  if (errors.length) { console.log('console:', errors.slice(0, 8).join(' | ')); }
  await page.close();
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
