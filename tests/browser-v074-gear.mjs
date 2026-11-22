// v0.7.4, Shane's item 6 ("The landing gear bogeys of the planes all seem really fragile (they are made with thin
// little rods)"): close stills of each type's main and nose gear, by day, gear down, on a runway, from the walk-around
// (orbit) camera, and the gear half-way and retracted (nothing through the doors or the wing). The same views from
// the pushed tree (the "before") and this one (the "after"), and each model's triangles.
//
//   node games/flight-sim/tests/browser-v074-gear.mjs [before|after] [--headed]
//   E2E_GAME: the game's URL (before: http://127.0.0.1:8014/base/games/flight-sim/, after: …/games/flight-sim/)
// Pictures: Claude outputs/flight-sim/v074-gear-<before|after>-<type>-<view>.png (VIEWS=a,b to narrow; 'below' the dev pages' set). Last line: "gear N of M shots".

import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const which = process.argv.includes('before') ? 'before' : 'after';
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const GAME = process.env.E2E_GAME || (which === 'before' ? ROOT + 'base/games/flight-sim/' : ROOT + 'games/flight-sim/');
const ONLY = process.env.VIEWS ? process.env.VIEWS.split(',') : null;
const TYPES = (process.env.TYPES || 'a321neo,b787-9,b777-300er').split(',');
const closeIn = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
const NOON = Date.UTC(2026, 5, 21, 3, 0, 0);   // 12:00 KST, midsummer: by day

// [name, what to frame, yaw° (0 behind, 90 left, 180 ahead), pitch°, dist m, fov°, gearPos, doors]
// The orbit camera looks at a point 2 m above the centre of gravity, and stays 1.5 m over the ground; from close by the
// gear falls out of the bottom of the frame. So the camera stands well back with a narrow lens, and the picture is the
// part of the frame round the gear (its box projected to the screen), rendered at twice the pixels.
const VIEWS = [
  ['main', 'main', 100, -3, 70, 16, 1, 0],
  ['main-rear', 'main', 62, -3, 70, 16, 1, 0],
  ['nose', 'nose', 170, -2, 110, 9, 1, 0],
  ['half', 'main', 100, -3, 70, 16, 0.5, 1],
  ['up', 'main', 100, -3, 70, 16, 0, 0],
  ['up-above', 'mainTop', 120, 24, 60, 20, 0, 0],
];

let n = 0, all = 0;
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  if (!ONLY || VIEWS.some((v) => ONLY.includes(v[0]))) for (const type of TYPES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RJTT&arr=34L&start=runway&type=${type}&dpr=2`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__fs.sim.state.t > 1.5, null, { timeout: 60000 });
    const info = await page.evaluate((noon) => {
      const f = window.__fs;
      f.setPaused(true);
      f.clock.set(noon); f.clock.setRunning(false);
      f.selectView('orbit');
      for (const id of ['hud', 'toast', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
      const G = f.sim.type.geo.GEAR;
      return { nose: G.nose.x, main: G.left.x, mainY: G.left.y };
    }, NOON);
    for (const [name, frame, yaw, pitch, dist, fov, gearPos, doors] of VIEWS) {
      if (ONLY && !ONLY.includes(name)) continue;
      all++;
      // Farther back with a narrower lens until the gear is wholly in the frame (the 777's long nose).
      let r = null;
      for (let k = 1, i = 0; i < 4; i++, k *= 1.35) {
      r = await page.evaluate(async ({ frame, yaw, pitch, dist, fov, gearPos, doors }) => {
        const f = window.__fs, DEG = Math.PI / 180;
        f.rig.looks.orbit = { yaw: yaw * DEG, pitch: pitch * DEG, fov, dist };
        Object.assign(f.sim.state, { gearPos, gearDoors: doors });
        for (let i = 0; i < 4; i++) { f.renderOnce(); await new Promise((r) => requestAnimationFrame(r)); }
        f.renderOnce();
        // The gear's box (body frame: x forward, y left, z up from the centre of gravity), to the screen.
        const G = f.sim.type.geo.GEAR, g = frame === 'nose' ? G.nose : G.left;
        const hx = frame === 'nose' ? 1.2 : 2.6, hy = frame === 'nose' ? 0.9 : 1.6;
        const zTop = frame === 'mainTop' ? 1.5 : 0;
        const obj = f.aircraft.object, cam = f.rig.camera, V3 = obj.position.constructor;
        obj.updateMatrixWorld(true);
        let x0 = 1, x1 = -1, y0 = 1, y1 = -1;
        for (const dx of [-hx, hx]) for (const dy of [-hy, hy]) for (const z of [g.z, zTop]) {
          const p = obj.localToWorld(new V3(-(g.y + dy), z, -(g.x + dx))).project(cam);
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        const W = innerWidth, H = innerHeight;
        return { tri: f.renderer.info.render.triangles, box: [(x0 + 1) / 2 * W, (1 - y1) / 2 * H, (x1 + 1) / 2 * W, (1 - y0) / 2 * H] };
      }, { frame, yaw, pitch, dist: dist * k, fov: fov / k, gearPos, doors });
      if (r.box[0] >= 4 && r.box[1] >= 4 && r.box[2] <= 1436 && r.box[3] <= 880) break;
      }
      await page.waitForTimeout(250);
      // The box with a margin, at 16:10, inside the window.
      const [bx0, by0, bx1, by1] = r.box, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      let w = Math.max(360, (bx1 - bx0) * 1.5, (by1 - by0) * 1.5 * 1.6), h = w / 1.6;
      w = Math.min(w, 1440); h = Math.min(h, 900);
      const clip = { x: Math.max(0, Math.min(1440 - w, cx - w / 2)), y: Math.max(0, Math.min(900 - h, cy - h / 2)), width: w, height: h };
      const file = path.join(OUT, `v074-gear-${which}-${type}-${name}.png`);
      await page.screenshot({ path: file, clip });
      n++;
      console.log(`${type} ${name}: ${r.tri} triangles in the frame; box ${r.box.map(Math.round).join(',')} → ${path.basename(file)}`);
    }
    // The aircraft model's own triangles (its meshes, every part).
    const model = await page.evaluate(() => {
      const f = window.__fs; let t = 0, meshes = 0;
      const root = f.aircraft?.group || f.aircraft?.root || f.aircraft?.object || f.aircraft;
      root?.traverse?.((o) => { if (o.isMesh && o.geometry) { meshes++; const g = o.geometry; const c = g.index ? g.index.count : g.attributes.position.count; t += (c / 3) * (o.isInstancedMesh ? o.count : 1); } });
      return { t: Math.round(t), meshes };
    });
    console.log(`${type}: the model ${model.t} triangles in ${model.meshes} meshes${errors.length ? '; page errors: ' + errors.join(' | ') : ''}`);
    await closeIn(page.close(), 5000);
  }
  // From below, the ground hidden (the dev pages: the orbit camera stays over the ground): the bays with the gear
  // half-way and retracted, nothing through the doors or the belly. Targets as tests/cloud/models.cjs's.
  const DEV = {
    a321neo: { page: 'tests/dev-aircraft.html', gear: [-1.2, -3.9, 3.795], k: 1, a321: true },
    'b787-9': { page: 'tests/dev-widebody.html?type=b787-9', gear: [-1.89, -4.9, 4.9], k: 1.45 },
    'b777-300er': { page: 'tests/dev-widebody.html?type=b777-300er', gear: [-2.55, -5.73, 5.485], k: 1.55 },
  };
  if (!ONLY || ONLY.includes('below')) for (const type of TYPES) {
    const t = DEV[type], [gx, gz, gy] = t.gear, k = t.k;
    const noseX = t.a321 ? 15.7 : gx + (k > 1.5 ? 31.2 : 25.83);
    const page = await ctx.newPage();
    await page.goto(GAME + t.page);
    await page.waitForFunction(() => window.dev && window.dev.ready, null, { timeout: 120000 });
    await page.evaluate(() => { window.dev.shot(true); window.dev.hideGround(true); });
    for (const [name, gearPos, doors, yaw, pitch, dist, target] of [
      ['below-half', 0.5, 1, 60, -38, 15 * k, [gx, gz + 2.4 * k, gy * 0.5]],
      ['below-up', 0, 0, 60, -38, 15 * k, [gx, gz + 2.4 * k, gy * 0.5]],
      ['below-up-rear', 0, 0, 150, -30, 15 * k, [gx, gz + 2.4 * k, gy * 0.5]],
      ['below-nose-up', 0, 0, 50, -30, 9 * k, [noseX, gz + 2.6 * k, 0]],
    ]) {
      all++;
      await page.evaluate(({ st, a321 }) => window.dev.set(a321 ? { state: st } : st), { st: { slatDeg: 0, flapDeg: 0, gearPos, gearDoors: doors }, a321: !!t.a321 });
      await page.evaluate(({ yaw, pitch, dist, target }) => window.dev.look(yaw, pitch, dist, target), { yaw, pitch, dist, target });
      await page.waitForTimeout(200);
      const file = path.join(OUT, `v074-gear-${which}-${type}-${name}.png`);
      await page.screenshot({ path: file });
      n++;
      console.log(`${type} ${name} → ${path.basename(file)}`);
    }
    await closeIn(page.close(), 5000);
  }
  // v0.7.4 second pass ("gear2"): close and low, the camera placed in the dev page (the orbit camera can't come this
  // close: it aims 2 m over the centre of gravity and stays 1.5 m over the ground). Each type's left main gear and its
  // nose gear: three-quarters from ahead and outboard (35° off the axle line), and from behind and inboard so the beam,
  // the axles' ends and the links show between the wheels; the camera about 1.5 m over the ground, near enough that one
  // gear fills about half the frame's height (fov 40°). Body frame: G.left / G.nose (x forward, y left, z up; z the
  // tyres' bottom). H: the gear's height in the picture, wheel bottom to the wing's or the belly's underside [EST].
  const G2 = {
    a321neo: { main: [-1.2, 3.795, -3.9], nose: [15.71, 0, -3.9], H: 2.5, Hn: 1.9 },
    'b787-9': { main: [-1.89, 4.9, -4.917], nose: [23.94, 0, -4.683], H: 3.4, Hn: 2.5 },
    'b777-300er': { main: [-2.55, 5.485, -5.752], nose: [28.67, 0, -5.485], H: 3.8, Hn: 2.7 },
  };
  if (ONLY && ONLY.includes('gear2')) for (const type of TYPES) {
    const t = DEV[type], g = G2[type];
    const page = await ctx.newPage();
    await page.goto(GAME + t.page);
    await page.waitForFunction(() => window.dev && window.dev.ready, null, { timeout: 120000 });
    await page.evaluate(() => { window.dev.shot(true); window.dev.hideGround(false); });
    await page.evaluate(({ a321 }) => window.dev.set(a321 ? { state: { slatDeg: 0, flapDeg: 0, gearPos: 1, gearDoors: 0 } } : { slatDeg: 0, flapDeg: 0, gearPos: 1, gearDoors: 0 }), { a321: !!t.a321 });
    const view = (p, H, yaw) => { const d = 2.75 * H, pitch = Math.asin(Math.max(-0.9, Math.min(0.9, (1.5 - H / 2) / d))) * 180 / Math.PI; return [yaw, pitch, d, [p[0], p[2] + H / 2, p[1]]]; };
    for (const [name, yaw, pitch, dist, target] of [
      // (the dev page's yaw: + to the right of the nose, so the left gear's outboard side is −)
      ['main-front34', ...view(g.main, g.H, -35)],
      ['main-rear-in', ...view(g.main, g.H, 145)],
      ['main-rear-out', ...view(g.main, g.H, -145)],
      ['nose-front34', ...view(g.nose, g.Hn, -35)],
      ['nose-rear', ...view(g.nose, g.Hn, 145)],
    ]) {
      all++;
      await page.evaluate(({ yaw, pitch, dist, target }) => window.dev.look(yaw, pitch, dist, target, 40), { yaw, pitch, dist, target });
      await page.waitForTimeout(250);
      const file = path.join(OUT, `v074-gear2-${which}-${type}-${name}.png`);
      await page.screenshot({ path: file });
      n++;
      console.log(`${type} ${name}: yaw ${yaw}, pitch ${pitch.toFixed(1)}, ${dist.toFixed(1)} m → ${path.basename(file)}`);
    }
    if (which === 'after' || which === 'before') console.log(`${type}: model ${JSON.stringify(await page.evaluate(() => window.dev.info().modelTriangles))} triangles`);
    await closeIn(page.close(), 5000);
  }
  await closeIn(ctx.close(), 5000);
} finally {
  await closeIn(browser.close(), 8000);
}
console.log(`gear ${n} of ${all} shots`);
