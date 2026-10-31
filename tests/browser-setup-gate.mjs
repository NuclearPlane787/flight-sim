// The setup screen's gate start: pick "At the gate", pick a stand, Fly, and check the plan.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 3 -- node games/flight-sim/tests/browser-setup-gate.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const errors = [];
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.fsui-setup:not([hidden])', { timeout: 60000 });
  await page.click('[data-seg="start"] button[data-v="gate"]');
  const opts = await page.$$eval('[data-f="stand"] option', (os) => os.map((o) => o.textContent));
  console.log('stands:', opts.length, opts.slice(0, 6).join(', '), '…', opts.slice(-2).join(', '));
  await page.selectOption('[data-f="stand"]', '3');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'ground-6-setup-gate.png') });
  await page.click('[data-a="fly"]');
  await page.waitForTimeout(500);
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('gamedump:flight-sim:settings') || '{}').lastPlan);
  console.log('plan:', JSON.stringify(plan));
  ok = plan && plan.start === 'gate' && plan.stand === '3' && opts[0].startsWith('Gate');
} catch (e) { console.error('FAILED:', e); } finally { await browser.close(); }
console.log('console errors:', errors.length ? errors : 'none');
console.log(ok && !errors.length ? 'PASS' : 'FAIL');
process.exit(ok && !errors.length ? 0 : 1);
