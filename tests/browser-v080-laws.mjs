// v0.8.0, part 7: the PFDs' marks for the degraded laws, in the dev pages (no WebGL): the A321's PFD in alternate and
// direct law (ALTN LAW / DIRECT LAW, USE MAN PITCH TRIM, the amber crosses) with the FCU's LAW label, and the 787-9's
// PFD in the secondary mode (the status line blank). One short run; through the lock:
//   gk.sh br 4 <name>.txt '^done' node games/flight-sim/tests/browser-v080-laws.mjs [base URL of the game's folder]
// Pictures: Claude outputs/flight-sim/v080-p7-laws-*.png (or $OUT).
import { chromium } from './pw.mjs';

const GAME = (process.argv[2] || 'http://127.0.0.1:8014/games/flight-sim/').replace(/\/?$/, '/');
const OUT = process.env.OUT || decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let ok = 0, n = 0;
const check = (c, what) => { n++; if (c) ok++; console.log((c ? 'ok   ' : 'FAIL ') + what); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror ' + e.message));
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // ---- the A321 ----
  await page.goto(GAME + 'tests/dev-ui.html?scene=approach');
  await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
  for (const law of ['alternate', 'direct']) {
    await page.evaluate((l) => { const v = window.__view; v.state.law = l; v.controls.law = l; v.ap.ap = false; }, law);
    await frames(); await page.waitForTimeout(300);
    const label = await page.evaluate(() => document.querySelector('.fsui-law')?.textContent);
    check(label === (law === 'direct' ? 'LAW DIR' : 'LAW ALTN'), `A321 ${law}: the FCU reads ${label}`);
    const pfd = await page.$('.fsui-pfd');
    await pfd.screenshot({ path: OUT + `v080-p7-laws-a321-${law === 'direct' ? 'direct' : 'altn'}-pfd.png` });
    const fcu = await page.$('.fsui-law');
    if (law === 'direct') await (await fcu.evaluateHandle((e) => e.parentElement)).asElement().screenshot({ path: OUT + 'v080-p7-laws-a321-direct-fcu.png' });
    console.log('shot ' + law);
  }

  // ---- the 787-9 ----
  await page.goto(GAME + 'tests/dev-ui-boeing.html?scene=final');
  await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
  await page.evaluate(() => { const v = window.__view; v.state.law = 'secondary'; if (window.__sim) window.__sim.controls.law = 'secondary'; if (v.controls) v.controls.law = 'secondary'; });
  await frames(); await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__view.state.law) === 'secondary', 'the 787-9 in the secondary mode');
  await (await page.$('.fsui-pfd')).screenshot({ path: OUT + 'v080-p7-laws-b787-secondary-pfd.png' });
  console.log('shot b787');
  await page.close({ timeout: 5000 }).catch(() => {});
  await ctx.close({ timeout: 5000 }).catch(() => {});
} catch (e) { console.log('error ' + e.message); }
await browser.close({ timeout: 5000 }).catch(() => {});
console.log(`done ${ok} of ${n}`);
