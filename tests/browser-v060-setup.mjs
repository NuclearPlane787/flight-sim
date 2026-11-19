// v0.6.0 Part 4 steps 1 and 5, Part 5 step 8: the setup over eleven airports, the places named on the home page and
// the Load list, and local time (the setup's time row, the Sky window, the logbook), headless, with ?eastasia=1; then
// the setup with the flag off (v0.5.8's strings).
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 8 -- node games/flight-sim/tests/browser-v060-setup.mjs [rootUrl]
// Pictures: Claude outputs/flight-sim/v060-setup-*.png and v060-rules-time-*.png.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../Claude outputs/flight-sim');
const ROOT = process.argv[2] || process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const shot = (name) => path.join(OUT, name);
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
const T15 = KST(2026, 11, 19, 15, 0);

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'fs-v060-setup-')), {
  channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'], viewport: { width: 1440, height: 900 },
});
try {
  // ======== the region on ========
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${ROOT}games/flight-sim/?eastasia=1`);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('gamedump:flight-sim:')) localStorage.removeItem(k); });
  await page.reload();
  await page.waitForFunction(() => window.__fs && window.__fs.inMenu, null, { timeout: 120000 });
  const n = await page.evaluate(() => window.__fs.airports.map((a) => a.icao));
  check('the region\'s eleven airports are in the game', n.length === 11, n.join(' '));

  // ---- the setup: Gimpo → Haneda ----
  await page.evaluate(() => { window.__fs.newScenario(); });
  await page.waitForSelector('.fsui-setup:not([hidden])');
  await page.selectOption('[data-f="origin"]', 'RKSS');
  await page.selectOption('[data-f="dest"]', 'RJTT');
  await page.click('[data-a="enough"]');
  await page.waitForTimeout(200);
  const lists = await page.evaluate(() => {
    const sel = document.querySelector('[data-f="origin"]');
    return {
      groups: [...sel.querySelectorAll('optgroup')].map((g) => `${g.label}: ${[...g.querySelectorAll('option')].map((o) => o.textContent).join(', ')}`),
      dep: [...document.querySelectorAll('[data-f="depRunway"] option')].map((o) => o.value).join(' '),
      arr: [...document.querySelectorAll('[data-f="arrRunway"] option')].map((o) => o.value).join(' '),
      dist: document.querySelector('[data-o="dist"]').textContent,
      fuel: document.querySelector('[data-f="fuelKg"]').value,
      weights: document.querySelector('[data-o="weights"]').innerText,
      note: document.querySelector('[data-o="timeNote"]').textContent,
    };
  });
  console.log('lists:', JSON.stringify(lists, null, 1));
  check('the lists: Korea, Japan, China, by short name', lists.groups.length === 3 && /^Korea: RKSS · Gimpo, RKSI · Incheon, RKPK · Gimhae, RKPC · Jeju$/.test(lists.groups[0]) && /^China: ZSPD · Pudong/.test(lists.groups[2]), lists.groups.join(' | '));
  check('Haneda\'s four runways', lists.arr.split(' ').length === 8, lists.arr);
  check('Gimpo–Haneda about 637 nm', Math.abs(parseInt(lists.dist, 10) - 637) < 8, lists.dist);
  check('the time row in KST at Gimpo', / KST, /.test(lists.note), lists.note);
  await page.locator('.fsui-dlg').screenshot({ path: shot('v060-setup-gimpo-haneda.png') });
  await page.click('[data-seg="time"] [data-v="set"]');
  await page.fill('[data-t="date"]', '2026-11-19'); await page.fill('[data-t="time"]', '15:00');
  const setLbl = await page.evaluate(() => document.querySelector('[data-o="timeRow"] .fsui-note').textContent);
  check('Set\'s fields labelled KST at Gimpo', setLbl === 'KST', setLbl);

  // ---- Pudong as the origin (CST), a gate start with its long list ----
  await page.selectOption('[data-f="origin"]', 'ZSPD');
  await page.click('[data-seg="start"] [data-v="gate"]');
  const pd = await page.evaluate(() => ({
    lbl: document.querySelector('[data-o="timeRow"] .fsui-note').textContent,
    stands: document.querySelectorAll('[data-f="stand"] option').length,
    find: !!document.querySelector('.fsui-stand-find:not([hidden])'),
    dist: document.querySelector('[data-o="dist"]').textContent,
  }));
  check('Pudong: Set\'s fields in CST', pd.lbl === 'CST', pd.lbl);
  check('Pudong: hundreds of stands, with a filter', pd.stands > 300 && pd.find, JSON.stringify(pd));
  await page.fill('.fsui-stand-find', '11');
  const filt = await page.evaluate(() => [...document.querySelectorAll('[data-f="stand"] option')].map((o) => o.value));
  check('the filter narrows the stands to those holding "11"', filt.length > 0 && filt.length < 40 && filt.every((v) => v.includes('11')), filt.slice(0, 8).join(' '));
  await page.selectOption('[data-f="stand"]', filt.includes('112') ? '112' : filt[0]);
  await page.locator('.fsui-dlg').screenshot({ path: shot('v060-setup-pudong.png') });
  await page.click('[data-seg="time"] [data-v="now"]');
  const pdNow = await page.evaluate(() => document.querySelector('[data-o="timeNote"]').textContent);
  check('Pudong: Now in CST', / CST, /.test(pdNow), pdNow);
  // the start time read in CST: 15:00 CST is 16:00 KST
  await page.click('[data-seg="time"] [data-v="set"]');
  await page.fill('[data-t="date"]', '2026-11-19'); await page.fill('[data-t="time"]', '15:00');

  // ---- fly from Haneda (Set 15:00 JST), the Sky window ----
  await page.selectOption('[data-f="origin"]', 'RJTT');
  await page.selectOption('[data-f="dest"]', 'RKSS');
  await page.click('[data-seg="start"] [data-v="runway"]');
  await page.click('[data-a="enough"]');
  await page.click('[data-a="fly"]');
  await page.waitForFunction(() => window.__fs.plan && window.__fs.plan.origin === 'RJTT' && !window.__fs.inMenu, null, { timeout: 60000 });
  const hnd = await page.evaluate(() => ({ ms: window.__fs.plan.time?.ms, clock: window.__fs.clock.ms }));
  check('Set 15:00 at Haneda is 15:00 JST (06:00 UTC)', hnd.ms === Date.UTC(2026, 10, 19, 6), JSON.stringify(hnd));
  await page.waitForTimeout(1500);
  const sky = async (name) => {
    await page.evaluate((t) => { const f = window.__fs; f.setPaused(true, true); f.clock.set(t); f.showLTab('sky'); f.skyWin.update(); f.renderOnce(); }, T15);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ sub: document.querySelector('.fssw-sub').textContent, time: document.querySelector('.fssw [data-o="time"]').textContent,
      zone: document.querySelector('.fssw-time small').textContent, date: document.querySelector('.fssw [data-o="date"]').textContent, rise: document.querySelector('.fssw [data-o="tRise"]').textContent, set: document.querySelector('.fssw [data-o="tSet"]').textContent }));
    await page.screenshot({ path: shot(name) });
    return r;
  };
  const sH = await sky('v060-rules-time-sky-haneda.png');
  check('the Sky window at Haneda: 15:00 JST', sH.zone === 'JST' && sH.time === '15:00' && /JST/.test(sH.sub), JSON.stringify(sH));

  // ---- Pudong ----
  const pdEnd = await page.evaluate(() => window.__fs.airports.find((a) => a.icao === 'ZSPD').runways[0].ends[0].ident);
  await page.evaluate((e) => { window.__fs.setPaused(false); window.__fs.startFlight({ origin: 'ZSPD', depRunway: e, dest: 'RKSS', arrRunway: '14R', start: 'runway', pax: 180, cargoKg: 2000, fuelKg: 7000, waypoints: [] }); }, pdEnd);
  await page.waitForTimeout(2500);
  const sP = await sky('v060-rules-time-sky-pudong.png');
  check('the Sky window at Pudong: 14:00 CST', sP.zone === 'CST' && sP.time === '14:00' && /CST/.test(sP.sub), JSON.stringify(sP));
  const hudClock = await page.evaluate(() => [...document.querySelectorAll('#hud *')].some((e) => /\b\d\d:\d\d\b/.test(e.childNodes[0]?.nodeValue || '')));
  console.log('the HUD shows a clock:', hudClock);
  await page.evaluate(() => window.__fs.skyWin.close());

  // ---- the logbook: a Gimpo–Pudong flight, and an old entry ----
  await page.evaluate(async () => {
    const L = await import('./src/ui/logbook.js');
    const ap = (i) => window.__fs.airports.find((a) => a.icao === i);
    const dep = Date.UTC(2026, 10, 19, 6, 0), air = 1 * 3600 + 58 * 60;
    const t = L.logTimes({ clockMs: dep + (air + 50) * 1000, speed: 1, nowT: 5000 + air + 50, touchdownT: 5000 + air, liftoffT: 5000, origin: ap('RKSS'), dest: ap('ZSPD') });
    const parts = { sink: { points: 30, of: 35 } };
    const log = [
      { date: '2026-11-01T05:05:00.000Z', version: '0.5.8', type: 'a321neo', scenarioId: 'unsaved', scenarioName: 'Unsaved flights', route: 'RKSS–RKPC', depRunway: '14R', arrRunway: '07', airTimeS: 3300, fuelUsedKg: 2900, score: { points: 78, grade: 'B', parts } },
      { date: new Date(dep + (air + 50) * 1000).toISOString(), version: '0.6.0', type: 'a321neo', scenarioId: 'unsaved', scenarioName: 'Unsaved flights', route: 'RKSS–ZSPD', depRunway: '14R', arrRunway: '34L', airTimeS: air, fuelUsedKg: 3100, score: { points: 86, grade: 'A', parts }, ...t },
    ];
    localStorage.setItem('gamedump:flight-sim:logbook', JSON.stringify(log));
    window.__fs.logbook.open();
  });
  await page.waitForTimeout(300);
  const lb = await page.evaluate(() => [...document.querySelectorAll('.fslb-row:not(.head)')].map((r) => r.querySelector('.date').innerText.replace(/\n/g, ' / ') + ' | ' + r.querySelector('.route').innerText.replace(/\n/g, ' / ')));
  console.log('logbook rows:', JSON.stringify(lb));
  check('the logbook: the Gimpo–Pudong flight in KST and CST, with the names', /15:00 KST → 15:58 CST/.test(lb[0] || '') && /Gimpo → Pudong/.test(lb[0] || ''), lb[0]);
  check('the logbook: an old entry read back as KST', /Sun 1 Nov 2026 \/ 14:05 KST/.test(lb[1] || ''), lb[1]);
  await page.screenshot({ path: shot('v060-rules-time-logbook.png') });
  await page.evaluate(() => window.__fs.logbook.close());

  // ---- the home page's ticket and the Load list ----
  await page.evaluate(() => window.__fs.exitToMenu());
  await page.waitForTimeout(400);
  const mk = await page.evaluate(() => {
    const S = window.__fs.scenarios, now = Date.now();
    const a = S.create('Tokyo run', { v: 1, fresh: true, plan: {} }, { route: 'RKSS–RJTT', where: 'FL370, 412 nm to RJTT', phase: 'air', origin: 'RKSS', dest: 'RJTT', alt: 37000, distNm: 412 }, { now: now + 60000 });
    const b = S.create('Shanghai turn', { v: 1, fresh: true, plan: {} }, { route: 'RKSS–ZSPD', where: 'Parked at ZSPD stand 112', phase: 'parked', origin: 'RKSS', dest: 'ZSPD', at: 'ZSPD', stand: '112', landed: true }, { now: now + 120000 });
    window.__fs.menu.refresh();
    return [a.ok, b.ok];
  });
  await page.waitForTimeout(400);
  const card = async () => page.evaluate(() => ({ title: document.querySelector('[data-o="cardTitle"], .fsh-card h3, .fsh-card b')?.textContent, text: document.querySelector('[data-k="continue"]').innerText.replace(/\n+/g, ' / ') }));
  const c1 = await card();
  check('the ticket parked at Pudong', /At Pudong, stand 112/.test(c1.text) && /Gimpo/.test(c1.text), c1.text);
  await page.screenshot({ path: shot('v060-setup-home-parked-pudong.png') });
  await page.evaluate(() => { const S = window.__fs.scenarios; S.create('Tokyo run 2', { v: 1, fresh: true, plan: {} }, { route: 'RKSS–RJTT', where: 'FL370, 412 nm to RJTT', phase: 'air', origin: 'RKSS', dest: 'RJTT', alt: 37000, distNm: 412 }, { now: Date.now() + 180000 }); window.__fs.menu.refresh(); });
  await page.waitForTimeout(400);
  const c2 = await card();
  check('the ticket en route to Haneda', /En route to Haneda/.test(c2.text) && /FL370/.test(c2.text), c2.text);
  await page.screenshot({ path: shot('v060-setup-home-enroute-haneda.png') });
  await page.click('[data-k="load"]');
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.fsm-row-main small')].map((s) => s.textContent));
  console.log('Load list:', JSON.stringify(rows));
  check('the Load list names them', rows.some((r) => /FL370, 412 nm to Haneda/.test(r)) && rows.some((r) => /Parked at Pudong stand 112/.test(r)), rows.join(' | '));
  await page.screenshot({ path: shot('v060-setup-load-list.png') });
  check('the region on: no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await page.close();

  // ======== the region off: v0.5.8 ========
  const off = await ctx.newPage();
  const err2 = [];
  off.on('pageerror', (e) => err2.push(String(e)));
  off.on('console', (m) => { if (m.type() === 'error') err2.push(m.text()); });
  await off.goto(`${ROOT}games/flight-sim/?eastasia=0`);
  await off.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('gamedump:flight-sim:')) localStorage.removeItem(k); });
  await off.reload();
  await off.waitForFunction(() => window.__fs && window.__fs.inMenu, null, { timeout: 120000 });
  await off.evaluate(() => { window.__fs.newScenario(); });
  await off.waitForSelector('.fsui-setup:not([hidden])');
  const o = await off.evaluate(() => ({
    n: window.__fs.airports.length,
    groups: document.querySelectorAll('[data-f="origin"] optgroup').length,
    opts: [...document.querySelectorAll('[data-f="origin"] option')].map((x) => x.textContent),
    fuel: document.querySelector('[data-f="fuelKg"]').value,
    note: document.querySelector('[data-o="timeNote"]').textContent,
    lbl: document.querySelector('[data-o="timeRow"] .fsui-note').textContent,
    nowTitle: document.querySelector('[data-seg="time"] [data-v="now"]').title,
    find: !!document.querySelector('.fsui-stand-find'),
    weights: document.querySelector('[data-o="weights"]').innerText,
  }));
  console.log('flag off:', JSON.stringify(o, null, 1));
  check('flag off: three airports, full names, no groups', o.n === 3 && o.groups === 0 && o.opts.join('|') === 'RKSS · Seoul Gimpo International Airport|RKPC · Jeju International Airport|RKSI · Incheon International Airport', o.opts.join(' | '));
  check('flag off: Gimpo–Jeju\'s 4,000 kg, KST', o.fuel === '4000' && / KST, /.test(o.note) && o.lbl === 'KST' && o.nowTitle === 'The real time in Korea' && !o.find, `${o.fuel} ${o.note}`);
  await off.locator('.fsui-dlg').screenshot({ path: shot('v060-setup-flag-off.png') });
  check('the region off: no console errors', err2.length === 0, err2.slice(0, 5).join(' | '));
  await off.close();

  // ======== the extra: the Oriental Pearl Tower in the home page's skyline (not behind the flag) ========
  const la = await ctx.newPage({ deviceScaleFactor: 2 });
  await la.goto(`${ROOT}games/flight-sim/tests/dev-line-art.html`);
  await la.waitForFunction(() => document.body.dataset.ready === '1');
  const L = await la.evaluate(() => window.__lineArt.landmarks.find((l) => l.name === 'Oriental Pearl Tower'));
  check('the skyline has the Oriental Pearl Tower', !!L, JSON.stringify(L));
  if (L) {
    const box = await la.locator('[data-o="full"] svg').boundingBox();
    await la.screenshot({ path: shot('v060-setup-skyline-pearl.png'), fullPage: true, clip: { x: box.x + L.x0 - 260, y: box.y, width: L.x1 - L.x0 + 520, height: box.height } });
  }
} finally { await ctx.close(); }
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
