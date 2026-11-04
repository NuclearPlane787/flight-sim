// Screenshots of the Boeing cockpit from tests/dev-cockpit-boeing.html, at 1440×900: both seats, four
// ways, day and night. Run through the cpu-guard, from games/flight-sim/:
//   FLIGHT_SIM_BASE=http://127.0.0.1:8014/games/flight-sim/ COCKPIT_TYPE=b777-300er python3 tools/cpu-guard.py -- node tests/browser-cockpit-boeing.mjs [name filter]
// Saves "Claude outputs/flight-sim/v030-<type>-cockpit-<seat>-<view>-<day|night>.png". COCKPIT_TYPE: b787-9 by default.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FLIGHT_SIM_BASE || 'http://localhost:8001/games/flight-sim/';
const TYPE = process.env.COCKPIT_TYPE || 'b787-9';

// [yaw° left of the nose, pitch°, fov°]: 'ahead' is camera.js's default seat view.
const VIEWS = {
  ahead: () => [0, -6, 62],
  down: () => [0, -32, 62],
  // Towards each seat's own side window, and across to the far one.
  left: () => [80, -3, 62],
  right: () => [-80, -3, 62],
};
const EXTRA = {
  // Controls at their limits, to see that they move, from the captain's seat.
  'captain-controls-day': { seat: 'captain', v: [-18, -40, 72], s: { thrustLever: 1, speedbrake: 1 }, c: { flapLever: 'last', speedbrake: 1, pitch: 1, roll: 0.8, gearDown: false } },
  'captain-reverse-day': { seat: 'captain', v: [-30, -52, 62], s: { thrustLever: -1, speedbrake: 0 }, c: { flapLever: 4, speedbrake: 0, pitch: -1, roll: -0.8, gearDown: true } },
  'captain-up-day': { seat: 'captain', v: [0, 35, 75], s: {}, c: {} },
  'captain-behind-day': { seat: 'captain', v: [170, -5, 75], s: {}, c: {} },
};

const filter = process.argv[2] || '';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + `tests/dev-cockpit-boeing.html?type=${TYPE}`);
  await page.waitForFunction(() => window.dev?.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.dev.shot(true));
  const take = async (name) => {
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => window.dev.info());
    await page.screenshot({ path: path.join(OUT, `v030-${TYPE}-cockpit-${name}.png`) });
    console.log(name, JSON.stringify(info));
  };
  for (const seat of ['captain', 'fo']) for (const [v, f] of Object.entries(VIEWS)) for (const [tod, n] of [['day', 0], ['night', 1]]) {
    const name = `${seat}-${v}-${tod}`;
    if (!name.includes(filter)) continue;
    await page.evaluate(([seat, a, n]) => {
      window.dev.set({ thrustLever: 0.3, speedbrake: 0 }, { flapLever: 2, speedbrake: 0, pitch: 0, roll: 0, gearDown: true });
      window.dev.night(n); window.dev.view(seat, ...a);
    }, [seat, f(seat), n]);
    await take(name);
  }
  for (const [name, x] of Object.entries(EXTRA)) {
    if (!name.includes(filter)) continue;
    await page.evaluate(([x]) => {
      if (x.c.flapLever === 'last') x.c.flapLever = window.dev.detents - 1;
      window.dev.night(0); window.dev.set(x.s, x.c); window.dev.view(x.seat, ...x.v);
    }, [x]);
    await take(name);
  }
  console.log(errors.length ? 'console:\n' + errors.join('\n') : 'console: clean');
} finally {
  await browser.close();
}
