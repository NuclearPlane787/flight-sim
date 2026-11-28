// v0.8.0, part 1 in Chrome: with no data/ folder the loading screen says so in one line, with the clone command.
//   node tests/browser-v080-nodata.mjs <the URL of a copy of the game without its data/ folder>
// (The run's server has such a copy at /nodata/: the game's code cloned without data/.) Picture
// "Claude outputs/flight-sim/v080-nodata-loading.png". The last line printed: "done N of M".
import { chromium } from './pw.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DATA_CLONE } from '../src/world/data-check.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.argv[2];
if (!BASE) { console.log('give the URL of a copy without data/'); console.log('done 0 of 1'); process.exit(0); }
let pass = 0, total = 0;
const check = (ok, what) => { total++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + what); };
const profile = mkdtempSync(path.join(tmpdir(), 'fs-v080-nodata-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 }, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction((cmd) => document.body.innerText.includes(cmd), DATA_CLONE, { timeout: 30000 }).catch(() => {});
  const text = await page.evaluate(() => document.body.innerText);
  const line = text.split('\n').find((l) => l.includes('git clone')) || '';
  check(line.includes(DATA_CLONE), `the loading screen names the clone command: "${line.trim().slice(0, 160)}"`);
  check(await page.evaluate(() => !window.__fs), 'and the game goes no further (no flight object)');
  await page.screenshot({ path: path.join(OUT, 'v080-nodata-loading.png') });
  console.log('  picture v080-nodata-loading.png');
} catch (e) { check(false, 'ran to its end: ' + String(e).slice(0, 300)); }
finally { await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 8000))]); try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ } }
console.log(`done ${pass} of ${total}`);
process.exit(0);
