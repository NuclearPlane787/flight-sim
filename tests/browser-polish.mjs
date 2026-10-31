// World polish scenes: load the game in Chrome (real GPU), place the aircraft, screenshot,
// and print fps, triangles and draw calls. Shots go to Claude outputs/flight-sim/polish-<tag>-<scene>.png.
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 8 -- node games/flight-sim/tests/browser-polish.mjs <tag> [scene …]

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/';

// Put the aircraft at map (x, y), `agl` metres above the ground, heading hdg (rad, grid),
// AP holding that altitude; then aim the given view.
const place = (x, y, agl, hdg, view, look, kt = 250) => `
  const g = fs.world.heightAt(${x}, ${y}), z = g + ${agl};
  fs.sim.reset({ x: ${x}, y: ${y}, z, hdg: ${hdg}, onGround: false, iasMs: ${kt}/1.943844, flapLever: 0, gearDown: false, fuelKg: 7000, payloadKg: 15000 });
  fs.ap.setAlt(Math.round(z / 0.3048 / 100) * 100); fs.ap.setHdg(Math.round(fs.gridToMagDeg(${hdg}, ${x}, ${y}))); fs.ap.setSpd(${kt});
  fs.ap.engageAp(); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.input.lever = 25/45;
  Object.assign(fs.rig.looks.${view}, ${JSON.stringify(look)});`;

const SCENES = {
  'gimpo-14R-nose': ['origin=RKSS&dep=14R&view=nose', '', 2500],
  'seoul-3000ft': ['origin=RKSS&dep=14R&view=nose', place(-60000, 168500, 900, 1.5, 'nose', { pitch: -0.22 }), 4000],
  // Looking down at the Han's banks from 3,000 ft, heading north towards the river.
  'han-3000ft': ['origin=RKSS&dep=14R&view=nose', place(-52000, 169000, 900, 0.0, 'nose', { pitch: -0.55 }), 4000],
  'jeju-07-3nm': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=nose', `
    const d = fs.dest, ax = fs.runwayAxis(d.end, d.other), dist = 3 * 1852;
    fs.sim.reset({ x: ax.tx - ax.ux * dist, y: ax.ty - ax.uy * dist, z: d.end.elevM + 15 + Math.tan(3 * Math.PI / 180) * dist, hdg: ax.hdg, onGround: false, iasMs: 135/1.943844, flapLever: 4, gearDown: true, fuelKg: 5000, payloadKg: 17000 });
    fs.sim.controls.flapLever = 4; fs.sim.controls.gearDown = true; fs.input.lever = 25/45;
    fs.ap.setSpd(135); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.ap.setVs(-700); fs.ap.engageAp(); fs.ap.setVs(-700);
    fs.rig.looks.nose.pitch = -0.25;`, 2500],
  // The east edge of Jeju's 10 m coast patch (x = -85,530 m), on the north shore, from 1,500 ft.
  // The east edges of Jeju's and Incheon's 10 m coast patches, where the coast crosses them, from 1,500 ft.
  'jeju-patch-edge': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=nose', place(-86300, -273800, 460, Math.PI / 2, 'nose', { pitch: -0.9 }, 200), 3500],
  'incheon-patch-edge': ['origin=RKSS&dep=14R&view=nose', place(-85500, 164080, 460, Math.PI / 2, 'nose', { pitch: -0.9 }, 200), 3500],
  // Cruise: FL350 over the west coast south of Incheon, heading south.
  'fl350': ['origin=RKSS&dep=14R&view=nose', place(-90000, 120000, 10668, Math.PI * 0.9, 'nose', { pitch: -0.18 }), 3500],
  'fl350-down': ['origin=RKSS&dep=14R&view=nose', place(-90000, 120000, 10668, Math.PI * 0.9, 'nose', { pitch: -0.5, yaw: 0.6 }), 3500],
  // The tree area's edge from 2,000 ft, over the hills east of Seoul.
  'forest-2000ft': ['origin=RKSS&dep=14R&view=nose', place(-20000, 160000, 610, 1.6, 'nose', { pitch: -0.3 }), 4000],
  // The proposed daylight runway lights (airports.js isn't this job's file): the same
  // scene with the light shader patched in the page, to show the proposal.
  'gimpo-14R-nose-lights': ['origin=RKSS&dep=14R&view=nose', `
    fs.world.runways.group.traverse((o) => {
      const m = o.material;
      if (!o.isPoints || !m || !m.vertexShader.includes('gl_PointSize')) return;
      m.vertexShader = m.vertexShader
        .replace('float sz = max(px, minPx);', 'float sz = px > minPx ? minPx + (px - minPx) * 0.4 : minPx;')
        .replace('gl_PointSize = min(sz, 28.0)', 'gl_PointSize = min(sz, 12.0)');
      m.fragmentShader = m.fragmentShader.replace('vCol * (core * 2.5 + halo)', 'vCol * (core * 1.4 + halo * 0.5)');
      m.needsUpdate = true;
    });`, 2500],
  'hallasan': ['origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=nose', `
    const d = fs.dest, ax = fs.runwayAxis(d.end, d.other), dist = 10 * 1852;
    fs.sim.reset({ x: ax.tx - ax.ux * dist, y: ax.ty - ax.uy * dist, z: d.end.elevM + 15 + Math.tan(3 * Math.PI / 180) * dist, hdg: ax.hdg, onGround: false, iasMs: 170/1.943844, flapLever: 1, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
    fs.ap.setSpd(170); if (!fs.ap.athr) fs.ap.toggleAthr(); fs.ap.engageAp();
    fs.rig.looks.nose.yaw = -1.25; fs.rig.looks.nose.pitch = 0.02;`, 3000],
};

const tag = process.argv[2] || 'x';
const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SCENES);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let bad = 0;
try {
  for (const name of names) {
    const [q, js, wait] = SCENES[name];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e));
    await page.goto(`${BASE}?test&${q}`);
    try {
      await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
      if (js) await page.evaluate(`(() => { const fs = window.__fs; ${js} })()`);
      await page.keyboard.press('Backquote');
      await page.waitForTimeout(wait);
      const stats = await page.evaluate(() => window.__fsStats);
      await page.screenshot({ path: path.join(OUT, `polish-${tag}-${name}.png`) });
      console.log(`${name}: fps ${stats.fps.toFixed(0)}, tris ${stats.triangles}, calls ${stats.calls}`);
    } catch (e) {
      bad++;
      console.log(`${name}: FAILED ${e.message}`);
    }
    if (errors.length) { bad++; console.log(`  console (${errors.length}):\n   ` + errors.slice(0, 8).join('\n   ')); }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
