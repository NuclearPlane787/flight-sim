// The A321's own lights and the cockpit at night, in Chrome on this Mac's GPU: stills for
// v0.2.0 Part 2 (aircraft lights). Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/dev-aclights.mjs [names…]
// Env: FS_URL (default http://localhost:8014/games/flight-sim/), SHOTS_OUT (default
// ../../Claude outputs/flight-sim/). Night comes from the clock (sky.setTime) when the sky has
// it, else from the world uniforms set by hand. The lights follow the real phase (main.js's
// lightsFor); a shot can force them with `force` (setLights wrapped so main can't undo it).

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHOTS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const NIGHT_MS = Date.UTC(2026, 10, 9, 14, 0);   // 23:00 KST, 9 Nov 2026 (new Moon: a dark night)
const DAY_MS = Date.UTC(2026, 10, 9, 5, 30);     // 14:30 KST
mkdirSync(OUT, { recursive: true });

const Q = 'origin=RKSS&dep=14R&dest=RKPC&arr=07';
// look: [view, yaw°, pitch°, dist m, fov°] (orbit), or ['captain', yaw°, pitch°, null, fov°].
const SHOTS = {
  runway: { q: `${Q}&start=runway`, night: true, look: ['orbit', 150, 6, 55, 50] },
  'runway-front': { q: `${Q}&start=runway`, night: true, look: ['orbit', 200, 4, 70, 50] },
  air: { q: `${Q}&start=runway`, night: true, setup: 'air', look: ['orbit', 120, 10, 70, 50], flash: 'strobe' },
  'air-beacon': { q: `${Q}&start=runway`, night: true, setup: 'air', look: ['orbit', 80, 25, 60, 50], flash: 'beaconTop' },
  'air-far': { q: `${Q}&start=runway`, night: true, setup: 'air', look: ['orbit', 140, 5, 900, 30], flash: 'strobe' },
  gate: { q: `${Q}&start=gate`, night: true, setup: 'gate', look: ['orbit', 135, 12, 60, 50] },
  'landing-pool': { q: `${Q}&start=runway`, night: true, look: ['captain', 0, -4, null, 60], hud: true },
  'grass-pool': { q: `${Q}&start=runway`, night: true, setup: 'grass', look: ['captain', 0, -6, null, 60] },
  cockpit: { q: `${Q}&start=runway`, night: true, look: ['captain', 0, -18, null, 70], hud: true },
  'cockpit-nohud': { q: `${Q}&start=runway`, night: true, look: ['captain', 0, -18, null, 70] },
  'day-runway': { q: `${Q}&start=runway`, night: false, look: ['orbit', 150, 6, 55, 50] },
  'day-cockpit': { q: `${Q}&start=runway`, night: false, look: ['captain', 0, -18, null, 70] },
};

const SETUPS = {
  // 3,000 ft over the Han, gear up, heading east.
  air: `(() => { const fs = window.__fs;
    fs.sim.reset({ x: -52500, y: 168800, z: 914, hdg: 80 * Math.PI / 180, onGround: false, iasMs: 220 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
    fs.sim.controls.gearDown = false; fs.sim.controls.flapLever = 0;
    for (let i = 0; i < 240; i++) fs.sim.step(1 / 120); })()`,
  gate: `(() => { const fs = window.__fs, a = fs.airports.find((x) => x.icao === 'RKSS');
    const st = a.stands.find((s) => s.ref === '3') || a.stands[Math.floor(a.stands.length / 2)];
    fs.startFlight({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'gate', stand: st.ref, pax: 180, cargoKg: 2000, fuelKg: 6000, waypoints: [] }); })()`,
  // Short final over the grass before the threshold: the pool on the ground ahead.
  grass: `(() => { const fs = window.__fs, s = fs.sim.state;
    const h = s.hdg, d = 700, z0 = s.pos.z;
    fs.sim.reset({ x: s.pos.x - Math.sin(h) * d, y: s.pos.y - Math.cos(h) * d, z: z0 + 12 + Math.tan(3 * Math.PI / 180) * d,
      hdg: h, onGround: false, iasMs: 140 / 1.943844, flapLever: 3, gearDown: true, fuelKg: 3000, payloadKg: 17000 });
    fs.sim.controls.gearDown = true; fs.sim.controls.flapLever = 3;
    for (let i = 0; i < 30; i++) fs.sim.step(1 / 120); })()`,
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
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}?test&${shot.q}&fuel=6000`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.aircraft, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    if (shot.setup) await page.evaluate(SETUPS[shot.setup]);
    await page.waitForTimeout(500);
    const info = await page.evaluate(([night, nightMs, dayMs]) => {
      const fs = window.__fs, w = fs.world, u = w.uniforms;
      fs.setPaused(true, true);
      if (w.sky.setTime && fs.clock?.set) fs.clock.set(night ? nightMs : dayMs);
      else if (night) {
        u.uNight.value = 1; u.uSunColor.value.setRGB(0, 0, 0); u.uSkyAmb.value.setRGB(0.02, 0.025, 0.04);
        u.uSunDir.value.set(0.3, -0.5, 0.8).normalize();
        w.sky.sunLight.intensity = 0.02; w.sky.hemi.intensity = 0.05;
      }
      return { setTime: !!w.sky.setTime, phase: fs.gate?.phase };
    }, [shot.night, NIGHT_MS, DAY_MS]);
    // The camera.
    await page.evaluate(([look, hud]) => {
      const fs = window.__fs, D = Math.PI / 180, [view, yaw, pitch, dist, fov] = look;
      fs.rig.viewId = view;
      const L = fs.rig.looks[view];
      if (L) { if (yaw != null) L.yaw = yaw * D; if (pitch != null) L.pitch = pitch * D; if (dist != null) L.dist = dist; if (fov != null) L.fov = fov; }
      const hide = hud ? ['pause', 'perf', 'toast', 'score'] : ['hud', 'pause', 'perf', 'toast', 'score'];
      for (const id of hide) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
      document.querySelectorAll('.fsui-hud').forEach((e) => { e.style.visibility = hud ? 'visible' : 'hidden'; });
    }, [shot.look, !!shot.hud]);
    for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(120); }
    // Catch a flash: step the aircraft's light clock until that lamp is lit, then render.
    const lit = await page.evaluate((flash) => {
      const fs = window.__fs, ac = fs.aircraft;
      const pts = ac.object.getObjectByName('aircraft-lamps');
      const idx = { strobe: 5, beaconTop: 3, beaconBottom: 4 }[flash];
      const level = () => pts.geometry.attributes.aLamp.array[idx * 4 + 3];
      if (flash) for (let i = 0; i < 400 && !(level() > 0); i++) ac.update(fs.sim.state, 0.005);
      fs.renderOnce();
      const lv = Array.from({ length: pts.geometry.attributes.aLamp.count }, (_, i) => +pts.geometry.attributes.aLamp.array[i * 4 + 3].toFixed(2));
      const u = fs.world.uniforms;
      return { levels: lv, night: u.uNight.value, landOn: u.uLandOn.value, taxiOn: u.uTaxiOn.value, landPos: u.uLandPos.value.toArray().map((v) => +v.toFixed(1)), landDir: u.uLandDir.value.toArray().map((v) => +v.toFixed(2)) };
    }, shot.flash || null);
    const file = path.join(OUT, `v020-night-aircraft-${name}.png`);
    await page.screenshot({ path: file });
    console.log(name, JSON.stringify({ ...info, ...lit }), errors.length ? 'ERRORS: ' + errors.join(' | ') : '');
    if (errors.length) failed++;
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
