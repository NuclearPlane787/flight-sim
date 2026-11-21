// v0.7.0 Part 2 in Chrome (headless, muted, its own profile): saves across regions, the region picker, the Load list
// by region, and Europe's path map.
//   1. A save made by the pushed v0.6.4 (E2E_BASE: a served copy of that tree, same origin, so the same storage) loads
//      in this build at the same place to the bit, and flies on.
//   2. A scenario made in Europe is listed under Europe in East Asia's Load list; loading it reloads the page into
//      Europe and starts it there.
//   3. With ?europe=1 New scenario asks for the region first; picking the other region reloads into it and opens its
//      setup, whose airports are that region's, grouped by country. Without it (EUROPE_ON off) there is no picker.
//   4. Europe's path map at three zooms: the outline, the coast, the airports, the cities' names.
// Pictures: "Claude outputs/flight-sim/v070-regions-*.png", "v070-map-europe-*.png".
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-v070-regions.mjs
// Env: E2E_ROOT (default http://127.0.0.1:8014/), E2E_BASE (default E2E_ROOT + 'base/': skip part 1 with E2E_BASE=none),
// E2E_PENDING=1 (Europe's airports still pending: adds ?pending=1).
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const BASE = process.env.E2E_BASE || ROOT + 'base/';
const PEND = process.env.E2E_PENDING === '1' ? '&pending=1' : '';
const GAME = ROOT + 'games/flight-sim/';
const shot = (n) => path.join(OUT, `${process.env.E2E_PREFIX || 'v070'}-${n}.png`);   // (v0.7.1: E2E_PREFIX names a later version's pictures; v0.7.1's own run overwrote v0.7.0's and copied them to v071-*)
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  };
  const up = (page, timeout = 90000) => page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout });

  // ---- 1. a save made in v0.6.4 ----
  let oldSave = null;
  if (BASE !== 'none') {
    const page = await ctx.newPage(); watch(page);
    await page.goto(`${BASE}games/flight-sim/?test&origin=RKSS&dep=14R&dest=RJTT&arr=34L&start=final`);
    await up(page);
    await page.waitForFunction(() => window.__fs.sim.state.t > 3, null, { timeout: 60000 });
    oldSave = await page.evaluate(() => {
      const f = window.__fs;
      f.setPaused(true);
      const st = f.captureState();
      const r = f.scenarios.create('Made in v0.6.4', st, { route: 'RKSS–RJTT', where: 'On final to RJTT', type: 'a321neo' });
      const p = f.sim.state.pos;
      return { ok: r.ok, id: r.id, pos: [p.x, p.y, p.z], t: f.sim.state.t, version: document.querySelector('[data-version]').textContent, hasRegion: 'region' in (f.scenarios.entry(r.id) || {}) };
    });
    check('a scenario saved by the pushed build', oldSave.ok && /v0\.6\.4|v0\.7\.[012]/.test(oldSave.version), `${oldSave.version}; at ${oldSave.pos.map((v) => v.toFixed(1)).join(', ')}`);
    await page.close();

    const now = await ctx.newPage(); watch(now);
    await now.goto(GAME);
    await up(now);
    const r = await now.evaluate((id) => {
      const f = window.__fs;
      const version = document.querySelector('[data-version]').textContent;
      f.loadScenario(id);
      f.setPaused(true);
      const p = f.sim.state.pos;
      return { version, region: f.region, inMenu: f.inMenu, pos: [p.x, p.y, p.z], t: f.sim.state.t, current: f.current && f.current.name };
    }, oldSave.id);
    check('this build loads it at the same place, to the bit', !r.inMenu && r.pos.every((v, k) => v === oldSave.pos[k]) && r.t === oldSave.t && r.region === 'east-asia',
      `${r.version}; ${r.current}; ${r.pos.map((v) => v.toFixed(1)).join(', ')}`);
    await now.evaluate(() => window.__fs.setPaused(false));
    await now.waitForTimeout(6000);
    const fl = await now.evaluate(() => { const f = window.__fs, s = f.sim.state; return { t: s.t, z: s.pos.z, crashed: f.crashed, ias: s.ias, dest: f.dest && f.dest.end && f.dest.end.ident }; });
    check('and it flies on down its final', fl.t > oldSave.t + 3 && !fl.crashed && fl.z < oldSave.pos[2] && fl.z > 50, `t ${fl.t.toFixed(1)} s (was ${oldSave.t.toFixed(1)}), ${Math.round(fl.z * 3.28084)} ft (was ${Math.round(oldSave.pos[2] * 3.28084)}), to ${fl.dest}`);
    await now.evaluate(() => window.__fs.exitToMenu());
    await now.close();
  }

  // ---- 2. a scenario made in Europe, loaded from East Asia ----
  const eu = await ctx.newPage(); watch(eu);
  await eu.goto(`${GAME}?region=europe${PEND}`);
  await up(eu);
  const made = await eu.evaluate(() => {
    const f = window.__fs;
    const a = f.airports.find((q) => q.icao === 'EGLL'), b = f.airports.find((q) => q.icao === 'LFPG');
    if (!a || !b) return { ok: false, airports: f.airports.map((q) => q.icao) };
    const plan = { origin: 'EGLL', depRunway: a.runways[0].ends[0].ident, dest: 'LFPG', arrRunway: b.runways[0].ends[0].ident, start: 'runway', pax: 180, cargoKg: 2000, fuelKg: 6000, waypoints: [], type: 'a321neo' };
    const r = f.scenarios.create('London to Paris', { v: 1, fresh: true, plan }, { route: 'EGLL–LFPG', where: 'Not flown yet', phase: 'fresh', origin: 'EGLL', dest: 'LFPG' });
    return { ok: r.ok, id: r.id, region: f.region, tag: f.scenarios.entry(r.id).region, airports: f.airports.map((q) => q.icao) };
  });
  check('a scenario made on a page opened in Europe carries its region', made.ok && made.region === 'europe' && made.tag === 'europe', JSON.stringify(made).slice(0, 160));
  await eu.close();

  const ea = await ctx.newPage(); watch(ea);
  await ea.goto(`${GAME}?region=east-asia&europe=1${PEND}`);        // East Asia, with Europe offered (EUROPE_ON for this page)
  await up(ea);
  const home = await ea.evaluate(() => ({ region: window.__fs.region, card: document.querySelector('[data-o="cardTitle"]')?.textContent, sub: document.querySelector('[data-o="cardSub"]')?.textContent,
    stats: document.querySelector('[data-o="cardStats"]')?.textContent }));
  check('the page opens in East Asia, and its ticket names the newest scenario, Europe\'s, by its airports\' names', home.region === 'east-asia' && /Heathrow|Charles de Gaulle|London to Paris/.test(`${home.card} ${home.sub} ${home.stats}`), JSON.stringify(home));
  await ea.screenshot({ path: shot('regions-home-ticket') });
  await ea.evaluate(() => window.__fs.menu.showPage('load'));
  await ea.waitForTimeout(300);
  const groups = await ea.evaluate(() => [...document.querySelectorAll('[data-o="list"] > *')].map((n) => (n.classList.contains('fsm-group') ? `[${n.dataset.region}]` : n.querySelector('b')?.textContent)));
  check('the Load list groups the scenarios by region, this page\'s first', made.ok && groups.includes('[europe]') && groups.indexOf('London to Paris') > groups.indexOf('[europe]')
    && (!oldSave || (groups.indexOf('[east-asia]') === 0 && groups.indexOf('Made in v0.6.4') < groups.indexOf('[europe]'))), groups.join(' | '));
  await ea.screenshot({ path: shot('regions-load-list') });
  if (made.ok) {
    await Promise.all([
      ea.waitForNavigation({ timeout: 60000 }),
      ea.locator(`.fsm-row[data-id="${made.id}"] [data-r="load"]`).click(),
    ]);
    await up(ea);
    await ea.waitForFunction(() => window.__fs.region === 'europe' && !window.__fs.inMenu && window.__fs.plan, null, { timeout: 60000 });
    const got = await ea.evaluate(() => { const f = window.__fs, s = f.sim.state; return { region: f.region, origin: f.plan.origin, dest: f.plan.dest, current: f.current && f.current.name, onGround: s.onGround, url: location.search }; });
    check('loading it reloads the page into Europe and starts it at Heathrow', got.region === 'europe' && got.origin === 'EGLL' && got.dest === 'LFPG' && got.current === 'London to Paris' && got.onGround, JSON.stringify(got));
    await ea.waitForTimeout(2500);
    await ea.screenshot({ path: shot('regions-loaded-in-europe') });
    // Europe's rules where the aircraft stands (Part 5): the game's own modules, as the page loaded them.
    const rules = await ea.evaluate(async () => {
      const base = location.href.split('?')[0];
      const R = await import(new URL('src/world/region.js', base).href), W = await import(new URL('src/sim/weather-presets.js', base).href), C = await import(new URL('src/clock.js', base).href);
      const f = window.__fs, p = f.sim.state.pos, r = R.rulesAt(p.x, p.y), z = C.zoneAt(p.x, p.y);
      return { country: r.country, taFt: Math.round(r.transAltM / 0.3048), tlFt: Math.round(r.transLevelM / 0.3048), baro: r.baroUnit, metric: r.metricAlt, zone: r.timeZone,
        label: C.zoneLabel(z, f.clock.ms), summer: C.isSummerTime(f.clock.ms, z), metar: W.metarOf(W.presetWeather('clear', f.weatherCtx), 'EGLL', f.weatherCtx), geo: !!R.geoRules() };
    });
    check("at Heathrow: the United Kingdom's rules, Heathrow's own 6,000 ft, London's zone named for the date, the METAR in Europe's form",
      rules.geo && rules.country === 'GB' && rules.taFt === 6000 && rules.tlFt === 7000 && rules.baro === 'hPa' && rules.metric === false && rules.zone === 'Europe/London'
      && rules.label === (rules.summer ? 'BST' : 'GMT') && /^EGLL .* Q\d{4} NOSIG$/.test(rules.metar), JSON.stringify(rules));

    // A plan with a departure from a landing-only end and an arrival at a take-off-only end (no setup offers one; a
    // save made by hand could hold one) starts from ends that are used that way (the review's finding 3).
    const oneWay = await ea.evaluate(() => { const f = window.__fs, was = f.plan, key = (p) => p.origin + ' ' + p.depRunway + ' ' + p.dest + ' ' + p.arrRunway, before = key(was);
      f.startFlight({ ...was, origin: 'EDDF', depRunway: '25R', dest: 'LEMD', arrRunway: '14L', start: 'runway', stand: null });
      const got = { dep: f.plan.depRunway, arr: f.plan.arrRunway, onGround: f.sim.state.onGround };
      f.startFlight(was); return { ...got, before, back: key(f.plan) }; });
    check('a plan from Frankfurt 25R (landings only) to Madrid 14L (take-offs only) starts from ends used that way, and the plan before it is untouched',
      !['25R', '07L', '36'].includes(oneWay.dep) && !!oneWay.dep && oneWay.arr === '32R' && oneWay.onGround && oneWay.back === oneWay.before && /^EGLL /.test(oneWay.back), JSON.stringify(oneWay));

    // ---- 3. the picker ----
    await ea.evaluate(() => window.__fs.exitToMenu());
    await ea.waitForTimeout(300);
    await ea.locator('[data-k="new"]').click();
    await ea.waitForTimeout(300);
    const pick = await ea.evaluate(() => ({ page: window.__fs.menu.page, rows: [...document.querySelectorAll('[data-o="regions"] [data-region]')].map((b) => `${b.dataset.region}: ${b.querySelector('b').textContent} / ${b.querySelector('small').textContent} / ${b.querySelector('.fsm-when').textContent}`) }));
    check('New scenario asks for the region first: East Asia and Europe, this page\'s marked', pick.page === 'region' && pick.rows.length === 2 && /europe: Europe .*loaded/.test(pick.rows[1]) && /east-asia: East Asia/.test(pick.rows[0]), pick.rows.join(' || '));
    await ea.screenshot({ path: shot('regions-picker') });
    await Promise.all([ea.waitForNavigation({ timeout: 60000 }), ea.locator('[data-o="regions"] [data-region="east-asia"]').click()]);
    await up(ea);
    await ea.waitForSelector('.fsui-setup:not([hidden]) select[data-f="origin"]', { timeout: 30000 });
    const s1 = await ea.evaluate(() => ({ region: window.__fs.region, groups: [...document.querySelectorAll('select[data-f="origin"] optgroup')].map((g) => `${g.label} ${g.children.length}`), origin: document.querySelector('select[data-f="origin"]').value }));
    check('picking East Asia from Europe reloads into East Asia and opens its setup', s1.region === 'east-asia' && /^Korea/.test(s1.groups[0]) && s1.origin.startsWith('R'), `${s1.groups.join(', ')}; from ${s1.origin}`);
    await ea.screenshot({ path: shot('regions-setup-east-asia') });
    // Cancel, and New scenario in Europe from East Asia.
    await ea.keyboard.press('Escape');
    await ea.waitForTimeout(400);
    if (await ea.evaluate(() => !window.__fs.menu.isOpen)) await ea.evaluate(() => window.__fs.exitToMenu());
    await ea.evaluate(() => window.__fs.menu.showPage('region'));
    await ea.waitForTimeout(200);
    await Promise.all([ea.waitForNavigation({ timeout: 60000 }), ea.locator('[data-o="regions"] [data-region="europe"]').click()]);
    await up(ea);
    await ea.waitForSelector('.fsui-setup:not([hidden]) select[data-f="origin"]', { timeout: 30000 });
    const s2 = await ea.evaluate(() => ({ region: window.__fs.region, groups: [...document.querySelectorAll('select[data-f="origin"] optgroup')].map((g) => `${g.label} ${g.children.length}`),
      origin: document.querySelector('select[data-f="origin"]').value, dest: document.querySelector('select[data-f="dest"]').value,
      options: [...document.querySelectorAll('select[data-f="origin"] option')].map((o) => o.textContent) }));
    check('picking Europe opens Europe\'s setup: its airports by country, a first flight from Heathrow', s2.region === 'europe' && /^United Kingdom/.test(s2.groups[0]) && s2.origin === 'EGLL' && s2.options.some((t) => /Heathrow/.test(t)),
      `${s2.groups.join(', ')}; ${s2.origin} to ${s2.dest}; ${s2.options.join(', ')}`);
    await ea.screenshot({ path: shot('regions-setup-europe') });
  }
  await ea.close();

  // With EUROPE_ON off (?europe=0; it is on by default since Heathrow and Charles de Gaulle passed) Europe isn't offered:
  // no picker, and a remembered Europe isn't honoured.
  const off = await ctx.newPage(); watch(off);
  await off.goto(`${GAME}?europe=0`);
  await up(off);
  await off.locator('[data-k="new"]').click();
  await off.waitForTimeout(600);
  const o = await off.evaluate(() => ({ region: window.__fs.region, page: window.__fs.menu.page, setup: !!document.querySelector('.fsui-setup:not([hidden])'), stored: localStorage.getItem('gamedump:flight-sim:region') }));
  check('with EUROPE_ON off there is no picker, and the page is East Asia whatever was remembered', o.region === 'east-asia' && o.page !== 'region' && o.setup, JSON.stringify(o));
  await off.close();

  // ---- 4. Europe's path map ----
  const map = await ctx.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }); watch(map);
  await map.goto(`${GAME}tests/dev-v060-map.html?region=europe${PEND}`);
  await map.waitForFunction(() => window.__devReady, null, { timeout: 30000 });
  await map.evaluate(() => { document.getElementById('nds')?.style.setProperty('display', 'none'); window.__dev.map.open(); });
  await map.waitForTimeout(200);
  // [name, lat-lon centre as map metres are computed in the page, metres per pixel]
  const views = [['region', -60000, 60000, 3200], ['west', -150000, 300000, 900], ['london', -300000, 500000, 160]];
  const names = {};
  for (const [name, x, y, mpp] of views) {
    const r = await map.evaluate(([x, y, mpp]) => { const m = window.__dev.map; m._devView(x, y, mpp); return { ms: m._devDrawMs(20), places: m._devPlaces().map((p) => p.name) }; }, [x, y, mpp]);
    names[name] = r.places;
    console.log(`${name.padEnd(8)} ${r.ms.toFixed(2)} ms a draw; ${r.places.length} names: ${r.places.join(', ')}`);
    await map.waitForTimeout(120);
    await map.screenshot({ path: shot(`map-europe-${name}`) });
    check(`Europe's map (${name}) draws in under 8 ms`, r.ms < 8, `${r.ms.toFixed(2)} ms`);
  }
  check('the whole region names its great cities', ['London', 'Paris', 'Madrid', 'Rome', 'Berlin'].every((n) => names.region.includes(n)) && names.region.length <= 30, names.region.join(', '));
  const aps = await map.evaluate(() => window.__dev.airports.map((a) => a.icao));
  check('the map has Europe\'s airports', aps.length > 0 && aps.every((i) => /^[EL]/.test(i)), aps.join(', '));
  // Change route never picks a standby runway for you (the review's finding: straightIn() skipped the ends nothing
  // lands on but not Gatwick's 08L/26R and Orly's 02/20, and from Paris it chose Gatwick's 26R).
  for (const [icao, from, vx, vy, spare] of [['EGKK', [48.85, 2.35], -300000, 500000, /^(08L|26R)\b/], ['LFPO', [51.5, -0.1], -121000, 200000, /^(02|20)\b/]]) {
    if (!aps.includes(icao)) { check(`${icao} is listed, for the standby check`, false, aps.join(', ')); continue; }
    const r = await map.evaluate(async ([icao, from, vx, vy]) => {
      const d = window.__dev, m = d.map; d.place(from[0], from[1]); d.view.dest = null;
      let lab = null; for (const mpp of [160, 80, 40]) { m._devView(vx, vy, mpp); lab = m._devLabel(icao); if (lab) break; }
      return { lab };
    }, [icao, from, vx, vy]);
    if (!r.lab) { check(`${icao} has a label on the map`, false); continue; }
    await map.mouse.click(r.lab[0], r.lab[1]);
    await map.waitForTimeout(300);
    const g = await map.evaluate(() => { const q = (s) => document.querySelector(`.fsui-route:not([hidden]) [data-r="${s}"] button.on`); return { open: window.__dev.map.routeOpen, apt: q('apt')?.textContent || '', rwy: (q('rwy')?.textContent || '').trim(), all: [...document.querySelectorAll('.fsui-route [data-r="rwy"] button')].map((b) => b.textContent.trim()) }; });
    check(`Change route at ${icao} picks a main runway, its standby runway offered last`, g.open && g.apt.startsWith(icao) && !!g.rwy && !spare.test(g.rwy) && g.all.filter((t) => spare.test(t)).length === 2 && g.all.slice(-2).every((t) => spare.test(t)), JSON.stringify(g));
    await map.evaluate(() => document.querySelector('.fsui-route [data-a="rcancel"]')?.click());
  }
  await map.close();

  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) {
  check('exception', false, String(e && e.stack ? e.stack : e).slice(0, 600));
} finally { await browser.close(); }
console.log(results.every(Boolean) ? `ALL PASS (${results.length})` : `FAILED ${results.filter((r) => !r).length} of ${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
