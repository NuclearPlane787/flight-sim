// Close-ups of each type's model from the dev pages (tests/dev-aircraft.html for the A321neo,
// tests/dev-widebody.html for the Boeings) in headless Chromium (SwiftShader WebGL), read off the
// canvas. Written for v0.3.1: the wing's high-lift surfaces with the gear down, and the gear doors.
//   node models.cjs [outDir] [prefix]        FS_BASE: where serve.py serves the game
//   TYPES=a321neo,b787-9 SETS=landing,doors  to narrow it down
// Each type gets these sets of shots:
//   landing: slats and flaps at the landing setting, gear down and locked, doors shut;
//   clean:   the same angles, everything retracted (gear down), for comparison;
//   doors:   the gear halfway, the doors open, seen from outside and from inside the bays.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const out = process.argv[2] || '/tmp/fs-models';
const prefix = process.argv[3] || 'model';
fs.mkdirSync(out, { recursive: true });

// Body frame: x forward, y left, z up. look(yaw° from the nose, + to the left; pitch° up; dist m;
// target [x, z, y]).
const TYPES = {
  a321neo: { page: 'tests/dev-aircraft.html', land: { slatDeg: 27, flapDeg: 34 }, gear: [-1.2, -3.9, 3.795], slat: [-0.1, -0.42, 9], scale: 1, a321: true },
  'b787-9': { page: 'tests/dev-widebody.html?type=b787-9', land: { slatDeg: 30, flapDeg: 30 }, gear: [-1.89, -4.9, 4.9], slat: [0.2, -0.3, 14], scale: 1.45 },
  'b777-300er': { page: 'tests/dev-widebody.html?type=b777-300er', land: { slatDeg: 30, flapDeg: 30 }, gear: [-2.55, -5.73, 5.485], slat: [-0.5, 0.05, 15], scale: 1.55 },
};
function shotsFor(t) {
  const [gx, gz, gy] = t.gear, k = t.scale;
  const leg = [gx, gz + 2.6 * k, gy];             // the top of the main gear's leg
  const wing = [gx + 1, gz + 3 * k, gy + 6 * k];  // the inner wing, outboard of the leg
  return [
    // Close on the top of the leg, from outboard at its height, from the front below, from behind.
    ['leg-side', 88, 2, 7 * k, leg],
    ['leg-front-low', 35, -10, 8 * k, leg],
    ['leg-rear-low', 145, -12, 8 * k, leg],
    ['leg-below', 100, -40, 8 * k, leg],
    ['gear-side', 95, -4, 15 * k, leg],
    ['gear-rear', 150, -6, 16 * k, leg],
    ['gear-front-below', 30, -14, 17 * k, leg],
    ['wing-rear-above', 160, 24, 24 * k, wing],
    ['wing-front-below', 35, -18, 26 * k, wing],
    ['wing-side', 92, 2, 30 * k, [gx, gz + 3 * k, gy + 4 * k]],
    // The leading edge outboard of the engine, and the inner flap from above and behind.
    ['slat-front', 60, 8, 5 * k, t.slat],
    ['slat-section', 90, 3, 4 * k, t.slat],
    ['slat-below', 45, -30, 5 * k, t.slat],
    ['flap-above', 165, 38, 11 * k, [gx - 1.2 * k, gz + 3.6 * k, gy + 1.5 * k]],
  ];
}
function doorShotsFor(t) {
  const [gx, gz, gy] = t.gear, k = t.scale;
  const belly = [gx, gz + 2.4 * k, gy * 0.4];
  const noseX = t.a321 ? 15.7 : gx + (k > 1.5 ? 31.2 : 25.83);
  return [
    ['doors-belly-side', 80, -8, 14 * k, belly],
    ['doors-belly-front', 15, -20, 14 * k, belly],
    ['doors-belly-rear', 165, -18, 14 * k, belly],
    ['doors-nose-side', 70, -8, 9 * k, [noseX, gz + 2.6 * k, 0]],
    ['doors-nose-front', 20, -15, 9 * k, [noseX, gz + 2.6 * k, 0]],
  ];
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pick = (env, all) => (process.env[env] ? process.env[env].split(',') : all);
  const sets = pick('SETS', ['landing', 'clean', 'doors']);
  for (const id of pick('TYPES', Object.keys(TYPES))) {
    const t = TYPES[id];
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + t.page);
    await page.waitForFunction(() => window.dev && window.dev.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.dev.shot(true));
    const set = async (st) => page.evaluate(({ st, a321 }) => window.dev.set(a321 ? { state: st } : st), { st, a321: !!t.a321 });
    for (const which of sets) {
      if (which === 'landing') await set({ ...t.land, gearPos: 1, gearDoors: 0 });
      else if (which === 'clean') await set({ slatDeg: 0, flapDeg: 0, gearPos: 1, gearDoors: 0 });
      else await set({ slatDeg: 0, flapDeg: 0, gearPos: 0.55, gearDoors: 1 });
      const list = which === 'doors' ? doorShotsFor(t) : shotsFor(t);
      await page.evaluate((h) => window.dev.hideGround(h), which === 'doors');
      for (const [name, yaw, pitch, dist, target] of list) {
        await page.evaluate(({ yaw, pitch, dist, target }) => window.dev.look(yaw, pitch, dist, target), { yaw, pitch, dist, target });
        await page.waitForTimeout(150);
        const url = await page.evaluate(() => window.dev.png());
        const file = path.join(out, `${prefix}-${id}-${which === 'doors' ? '' : which + '-'}${name}.png`);
        fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
        console.log('shot', path.basename(file));
      }
    }
    if (errors.length) console.log(id, 'page errors:', errors.join(' | '));
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
