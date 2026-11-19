// V060.md Part 5, the picture owed: the Weather tab's METAR line in each country's form, in the
// game, on a final at Haneda (Japan: Q and A), Pudong (China: the wind in MPS) and Gimpo (Korea,
// as v0.5.8). Headless, muted.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 5 -- node games/flight-sim/tests/browser-v060-rules-metar.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let bad = 0;
const check = (name, ok, note) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${note}`); if (!ok) bad++; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [icao, rwy, tag, want] of [['RJTT', '34L', 'haneda', /RJTT .* Q\d{4} .*A\d{4}/], ['ZSPD', '34L', 'pudong', /ZSPD .*MPS .* Q\d{4}/], ['RKSS', '14R', 'gimpo', /RKSS .*KT .* Q\d{4}/]]) {
    await page.goto(`${BASE}?test&eastasia=1&origin=RKPC&dep=07&dest=${icao}&arr=${rwy}&start=final`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames > 30, null, { timeout: 60000 });
    await page.keyboard.press('Backslash');
    await page.click('[data-tab="weather"]', { timeout: 5000 });
    await page.click('.fswx [data-p="rain"]');
    await page.waitForTimeout(600);
    const metar = await page.textContent('.fswx [data-o="metar"]');
    check(`${icao}: the Weather tab's METAR in the country's form`, want.test(metar), metar);
    await page.locator('.fswx').screenshot({ path: `${OUT}v060-rules-metar-${tag}.png` });
  }
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
