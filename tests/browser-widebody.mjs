// Screenshots of the widebody model from tests/dev-widebody.html, at 1440×900, in Chrome on this Mac's GPU.
//   python3 tools/cpu-guard.py -- node tests/browser-widebody.mjs [--type b777-300er] [shot names…]
// FS_URL (default the lead's server, http://127.0.0.1:8014/games/flight-sim/) picks the server.
// Saves "Claude outputs/flight-sim/v030-<type>-model-<name>.png" and prints triangles and draw calls.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const DEG = Math.PI / 180;

const inAir = { gearCompression: { nose: 0, left: 0, right: 0 } };
const gearUp = { gearPos: 0, gearDoors: 0, gearCompression: { nose: 0, left: 0, right: 0 } };
const argv = process.argv.slice(2);
const typeAt = argv.indexOf('--type');
const TYPE = typeAt >= 0 ? argv.splice(typeAt, 2)[1] : 'b787-9';
const landing = {
  slatDeg: 30, flapDeg: 30,
  surfaces: { spoilersL: [1, 1, 1, 1, 1], spoilersR: [1, 1, 1, 1, 1] },
  engines: [{ n1: 70, rev: 1 }, { n1: 70, rev: 1 }],
};
const nightLights = { nav: 1, beacon: 1, strobe: 1, landing: 1, taxi: 1, logo: 1 };
const SHOTS = {
  side: { view: 'side' },
  front: { view: 'front' },
  top: { view: 'top', hideGround: true, state: gearUp },
  threeQuarter: { view: 'threeQuarter' },
  threeQuarterRear: { view: 'threeQuarterRear' },
  below: { view: 'below', state: gearUp },
  nose: { view: 'nose' },
  noseFront: { view: 'noseFront' },
  tail: { view: 'tail' },
  engine: { view: 'engine' },
  rearEngine: { view: 'rearEngine' },
  engineSide: { view: 'engineSide' },
  wingTip: { view: 'wingTip' },
  gearDown: { view: 'gear' },
  gearUp: { view: 'side', state: gearUp },
  gearUpNear: { view: 'gear', state: gearUp },
  gearTransit: { view: 'gear', state: { ...inAir, gearPos: 0.45, gearDoors: 1 } },
  bogieLoaded: { view: 'bogie' },
  bogieAir: { view: 'bogie', state: inAir },
  steerStraight: { view: 'bogieBelow', hideGround: true },
  steerHard: { view: 'bogieBelow', hideGround: true, state: { steerAngle: 70 * DEG } },
  steerHardLeft: { view: 'bogieBelow', hideGround: true, state: { steerAngle: -70 * DEG } },
  noseGear: { view: 'noseGear' },
  noseGearTransit: { view: 'noseGearBelow', state: { ...inAir, gearPos: 0.45, gearDoors: 1 } },
  noseGearUp: { view: 'noseGearBelow', state: gearUp },
  threeQuarterRight: { view: 'threeQuarterRight' },
  flex: { view: 'front', flex: 3 },
  flapsOut: { view: 'wing', state: { slatDeg: 30, flapDeg: 30 } },
  flapsBelow: { view: 'wingBelow', state: { slatDeg: 30, flapDeg: 30 } },
  flapClose30: { view: 'flapClose', state: { slatDeg: 30, flapDeg: 30 } },
  flapClose15: { view: 'flapClose', state: { slatDeg: 20, flapDeg: 15 } },
  flaps5: { view: 'wing', state: { slatDeg: 15, flapDeg: 5 } },
  flaps15: { view: 'wing', state: { slatDeg: 15, flapDeg: 15 } },
  reversers: { view: 'rearEngine', state: landing },
  surfaces: { view: 'threeQuarterRear', state: { surfaces: { elevator: 15 * DEG, rudder: 25 * DEG, aileronL: 20 * DEG, aileronR: -20 * DEG, stab: 3 * DEG, spoilersL: [0, 1, 1, 1, 1] } } },
  night: { view: 'threeQuarter', night: 1, lights: nightLights },
  nightTail: { view: 'tail', night: 1, lights: nightLights },
  orthoSide: { view: 'orthoSide' },
  orthoTop: { view: 'orthoTop', hideGround: true, state: gearUp },
  orthoFront: { view: 'orthoFront' },
  seat: { view: 'captain' },
  seatLeft: { view: 'captainLeft' },
};

const names = argv.length ? argv : Object.keys(SHOTS);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + 'tests/dev-widebody.html?type=' + TYPE);
  await page.waitForFunction(() => window.dev?.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.dev.shot(true));
  for (const name of names) {
    const s = SHOTS[name];
    if (!s) { console.log('no shot', name); continue; }
    await page.evaluate((s) => {
      const d = window.dev.defaults;
      window.dev.set({
        surfaces: { elevator: 0, stab: 0, aileronL: 0, aileronR: 0, rudder: 0, spoilersL: [0, 0, 0, 0, 0], spoilersR: [0, 0, 0, 0, 0] },
        slatDeg: 0, flapDeg: 0, gearPos: 1, gearDoors: 0, steerAngle: 0,
        gearCompression: { nose: d.nose, left: d.main, right: d.main }, engines: [{ n1: 20, rev: 0 }, { n1: 20, rev: 0 }],
      });
      window.dev.set(s.state || {});
      window.dev.hideGround(!!s.hideGround);
      window.dev.flex(s.flex || 0);
      window.dev.night(s.night || 0, s.lights || { nav: 1, beacon: 1, strobe: 1, landing: 0, taxi: 0, logo: 0 });
      window.dev.view(s.view);
    }, s);
    await page.waitForTimeout(350);
    const info = await page.evaluate(() => window.dev.info());
    const file = path.join(OUT, `v030-${TYPE}-model-${name}.png`);
    await page.screenshot({ path: file });
    console.log(name, JSON.stringify(info));
  }
  // The model against the geometry module, in Chrome, on the skinned vertices.
  const geo = await page.evaluate(() => {
    const d = window.dev.defaults;
    window.dev.view('side');    // a seat view hides the nose
    window.dev.set({ gearPos: 1, gearDoors: 0, gearCompression: { nose: d.nose, left: d.main, right: d.main }, surfaces: { spoilersL: [0, 0, 0, 0, 0], spoilersR: [0, 0, 0, 0, 0] }, flapDeg: 0, slatDeg: 0, engines: [{ n1: 0, rev: 0 }, { n1: 0, rev: 0 }] });
    const down = window.dev.bounds();
    window.dev.set({ gearPos: 0, gearCompression: { nose: 0, left: 0, right: 0 } });
    const up = window.dev.bounds();
    return { down, up, g: window.dev.geo };
  });
  const near = (a, b, tol, what) => {
    const ok = Math.abs(a - b) <= tol;
    if (!ok) process.exitCode = 1;
    console.log(ok ? 'ok  ' : 'FAIL', what, a.toFixed(3), 'vs', b.toFixed(3));
  };
  near(geo.down.xMax, geo.g.NOSE_X, 0.02, 'nose tip x');
  near(geo.down.xMin, geo.g.TAIL_X, 0.1, 'stabiliser tip x');
  near(geo.down.yMax, geo.g.SPAN / 2, 0.02, 'half span');
  near(geo.down.zMax, geo.g.topZ, 0.05, 'fin top z');
  near(geo.down.zMin, geo.g.mainZ, 0.02, 'main tyres on the contact point');
  near(geo.up.inboardLow, geo.g.bellyLow - 0.02, 0.15, 'gear up: nothing hangs under the belly');
  console.log(errors.length ? 'console:\n' + errors.join('\n') : 'console: clean');
} finally {
  await browser.close();
}
