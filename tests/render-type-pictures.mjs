// The picker's pictures (assets/types/<id>.jpg): each type rendered from the game, in Chrome on this
// Mac's GPU, on a runway at Gimpo in the afternoon, from a three-quarter view. No third-party images.
//   python3 tools/cpu-guard.py --minutes 6 -- node tests/render-type-pictures.mjs [ids…]
// Env: FS_URL (default http://127.0.0.1:8014/games/flight-sim/).
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../assets/types');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['a321neo'];
const DIST = { a321neo: 58, 'b787-9': 80, 'b777-300er': 92 };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=800,560'] });
let failed = 0;
try {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 704, height: 440 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=6000&type=${id}`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
    await page.waitForTimeout(1200);
    await page.evaluate(({ dist }) => {
      const fs = window.__fs, D = Math.PI / 180;
      fs.setPaused(true, true);
      fs.clock.set(Date.UTC(2026, 9, 31, 6, 0)); fs.clock.setRunning(false);
      fs.rig.viewId = 'orbit';
      Object.assign(fs.rig.looks.orbit, { yaw: 142 * D, pitch: 7 * D, dist, fov: 38 });
      for (const k of ['hud', 'pause', 'perf', 'toast', 'score']) { const e = document.getElementById(k); if (e) e.style.visibility = 'hidden'; }
    }, { dist: DIST[id] || 70 });
    for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__fs.renderOnce()); await page.waitForTimeout(150); }
    const file = path.join(OUT, `${id}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    console.log(`${id}: ${(statSync(file).size / 1024).toFixed(0)} KB${errors.length ? ' errors: ' + errors.join(' | ') : ''}`);
    if (errors.length) failed++;
    await page.close();
  }
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
