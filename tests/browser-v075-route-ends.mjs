// v0.7.5, part 5 (Shane, with a picture of Barcelona in the map's Change the route: "runway 20 doesn't exist in the
// route selection"): the map's Change the route lists every runway end, the ends the AIP doesn't land on last, dimmed,
// with their note; such an end can be flown to (Fly there), gets its 15 nm final on the map, the game's beam, and
// Skip to final. Then East Asia's page: Itami's list has its circling-only ends after 32L and 32R. Headless, muted.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 5 -- node games/flight-sim/tests/browser-v075-route-ends.mjs
import { chromium } from './pw.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let bad = 0;
const check = (name, ok, note = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${note}`); if (!ok) bad++; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const panel = async (icao) => {
    await page.keyboard.press('KeyN'); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('.fsui-map [data-a="route"], [data-a="route"]').click()); await page.waitForTimeout(300);
    await page.evaluate((i) => document.querySelector(`.fsui-route [data-r="apt"] button[data-icao="${i}"]`).click(), icao); await page.waitForTimeout(300);
    return page.evaluate(() => [...document.querySelectorAll('.fsui-route [data-r="rwy"] button')].map((b) => ({ id: b.dataset.ident, on: b.classList.contains('on'), dim: b.style.opacity !== '', title: b.title })));
  };
  // Europe: a flight from Madrid, the route changed to Barcelona's 20.
  await page.goto(`${ROOT}games/flight-sim/?test&region=europe&origin=LEMD&dep=36L&dest=LEMD&arr=32L&start=runway`);
  await page.waitForFunction(() => window.__fs && window.__fs.frames > 30 && window.__fs.sim.state.onGround, null, { timeout: 90000 });
  let ends = await panel('LEBL');
  check('Barcelona: all six ends listed', ends.length === 6, ends.map((e) => e.id).join(' '));
  check('Barcelona: 20 is last, dimmed, with the AIP\'s note', ends.at(-1).id === '20' && ends.at(-1).dim && /take-offs only in the AIP/.test(ends.at(-1).title), JSON.stringify(ends.at(-1)));
  check('Barcelona: the end picked for you is one the AIP lands on', ends.some((e) => e.on && e.id !== '20' && !e.dim), JSON.stringify(ends.find((e) => e.on)));
  await page.evaluate(() => document.querySelector('.fsui-route [data-r="rwy"] button[data-ident="20"]').click()); await page.waitForTimeout(300);
  const note = await page.evaluate(() => document.querySelector('.fsui-route .fsui-route-note').textContent);
  check('Barcelona: picking 20 shows its line and the note', /LEBL 20/.test(note) && /take-offs only in the AIP/.test(note), note.slice(0, 200));
  await page.screenshot({ path: path.join(OUT, 'v075-map-route-lebl-20.png') });
  await page.evaluate(() => document.querySelector('.fsui-route [data-a="rset"]').click()); await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ open: window.__fs.map.routeOpen, plan: window.__fs.plan ? [window.__fs.plan.dest, window.__fs.plan.arrRunway] : null, ils: !!window.__fs.sim.ap?.ils || null }));
  check('Barcelona: Fly there takes 20 as the destination', !after.open && (!after.plan || (after.plan[0] === 'LEBL' && after.plan[1] === '20')), JSON.stringify(after));
  await page.evaluate(() => { const [x, y] = [0, 0]; const a = window.__fs.airports.find((q) => q.icao === 'LEBL'); const e = a.runways.flatMap((r) => r.ends).find((q) => q.ident === '20'); window.__fs.map._devView(e.x, e.y + 12000, 60); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'v075-map-final-lebl-20.png') });
  check('Europe: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  // East Asia: Itami's arrival list.
  errors.length = 0;
  await page.goto(`${ROOT}games/flight-sim/?test&origin=RJTT&dep=34R&dest=RJBB&arr=06R&start=runway`);
  await page.waitForFunction(() => window.__fs && window.__fs.frames > 30 && window.__fs.sim.state.onGround, null, { timeout: 90000 });
  ends = await panel('RJOO');
  check('Itami: 32L and 32R first, the circling-only 14R and 14L after', ends.map((e) => e.id).join(' ') === '32L 32R 14R 14L', ends.map((e) => e.id).join(' '));
  check('Itami: the end picked for you has a straight-in final', ends.some((e) => e.on && /^32/.test(e.id)), JSON.stringify(ends.find((e) => e.on)));
  await page.screenshot({ path: path.join(OUT, 'v075-map-route-rjoo.png') });
  ends = await (async () => { await page.evaluate(() => document.querySelector('.fsui-route [data-r="apt"] button[data-icao="RKTU"]').click()); await page.waitForTimeout(300); return page.evaluate(() => [...document.querySelectorAll('.fsui-route [data-r="rwy"] button')].map((b) => b.dataset.ident)); })();
  check('Cheongju: the civil runway first, the air force\'s (a standby) after', ends.join(' ') === '06L 24R 06R 24L', ends.join(' '));
  check('East Asia: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL exception', e.message); bad++; } finally { await browser.close(); }
console.log(`done: ${bad} failed`);
process.exit(bad ? 1 : 0);
