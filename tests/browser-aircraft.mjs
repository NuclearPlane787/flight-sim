// Screenshots of the aircraft model and cockpit from tests/dev-aircraft.html, at 1440×900.
// Run through the cpu-guard:
//   python3 tools/cpu-guard.py -- node tests/browser-aircraft.mjs [shot names…]
// Saves "Claude outputs/flight-sim/aircraft-<name>.png" and prints triangles and draw calls.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FLIGHT_SIM_BASE || 'http://localhost:8001/games/flight-sim/';

const DEG = Math.PI / 180;
const gearUp = { gearPos: 0, gearDoors: 0, gearCompression: { nose: 0, left: 0, right: 0 } };
const landing = {
  slatDeg: 27, flapDeg: 40,
  surfaces: { spoilersL: [1, 1, 1, 1, 1], spoilersR: [1, 1, 1, 1, 1] },
  engines: [{ n1: 70, rev: 1 }, { n1: 70, rev: 1 }],
};
const SHOTS = {
  side: { view: 'side' },
  sideRight: { view: 'sideRight' },
  front: { view: 'front' },
  above: { view: 'above' },
  threeQuarter: { view: 'threeQuarter' },
  below: { view: 'below' },
  tail: { view: 'tail' },
  gearDown: { view: 'gear' },
  gearUp: { view: 'gear', state: gearUp },
  gearUpSide: { view: 'side', state: gearUp },
  landingConfig: { view: 'wing', state: landing },
  reversers: { view: 'rearEngine', state: landing },
  engine: { view: 'engine' },
  nose: { view: 'nose' },
  surfaces: { view: 'threeQuarterRight', state: { surfaces: { elevator: 15 * DEG, rudder: 25 * DEG, aileronL: 20 * DEG, aileronR: -20 * DEG, stab: 3 * DEG }, steerAngle: 40 * DEG } },
  surfacesTail: { view: 'tailHigh', state: { surfaces: { elevator: 15 * DEG, rudder: 25 * DEG, stab: 3 * DEG } } },
  surfacesWing: { view: 'wingTip', state: { surfaces: { aileronL: 20 * DEG, aileronR: -20 * DEG }, steerAngle: 40 * DEG } },
  captain: { view: 'captain', controls: { thrust: 0.55, flapLever: 1 }, state: { thrustLever: 0.55 } },
  captainLeft: { view: 'captainLeft' },
  fo: { view: 'fo' },
  pedestal: { view: 'pedestal', controls: { thrust: 1, flapLever: 4, speedbrake: 1, gearDown: false, pitch: 1, roll: 0.5 }, state: { thrustLever: 1, speedbrake: 1 } },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + 'tests/dev-aircraft.html');
  await page.waitForFunction(() => window.dev?.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.dev.shot(true));
  for (const name of names) {
    const s = SHOTS[name];
    if (!s) { console.log('no shot', name); continue; }
    // Reset to the default state, then apply this shot's.
    await page.evaluate((s) => {
      window.dev.set({
        state: {
          surfaces: { elevator: 0, stab: 0, aileronL: 0, aileronR: 0, rudder: 0, spoilersL: [0, 0, 0, 0, 0], spoilersR: [0, 0, 0, 0, 0] },
          slatDeg: 0, flapDeg: 0, gearPos: 1, gearDoors: 0, steerAngle: 0, thrustLever: 0,
          gearCompression: { nose: 0.16, left: 0.22, right: 0.22 }, engines: [{ n1: 20, rev: 0 }, { n1: 20, rev: 0 }],
        },
        controls: { thrust: 0, flapLever: 0, pitch: 0, roll: 0, gearDown: true },
      });
      window.dev.set({ state: s.state || {}, controls: s.controls || {} });
      window.dev.view(s.view);
    }, s);
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => window.dev.info());
    const file = path.join(OUT, `aircraft-${name}.png`);
    await page.screenshot({ path: file });
    console.log(name, JSON.stringify(info), '→', path.basename(file));
  }
  // The thumbnail, rendered at tile size.
  if (!process.argv.slice(2).length || names.includes('thumb')) {
    await page.setViewportSize({ width: 800, height: 500 });
    await page.goto(BASE + 'thumb.svg');
    await page.evaluate(() => { const r = document.documentElement; r.setAttribute('width', '800'); r.setAttribute('height', '500'); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'aircraft-thumb.png') });
    console.log('thumb → aircraft-thumb.png');
  }
  console.log(errors.length ? 'console:\n' + errors.join('\n') : 'console: clean');
} finally {
  await browser.close();
}
