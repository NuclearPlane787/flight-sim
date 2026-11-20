// v0.6.0 Part 4 steps 2-3: the path map and the NDs' coast across the region, headless.
//  1. tests/dev-v060-map.html (no WebGL): the NDs' per-frame cost of the coast at 10-320 nm near
//     Tokyo Bay and the Seto Inland Sea (region file) against Incheon (Korea's file, the flag off),
//     the map's draw cost, and the ND pictures at 160 nm near Tokyo.
//  2. The game with ?eastasia=1: a flight from Gimpo, the map (N) over the whole region, zoomed on
//     Tokyo Bay and on Korea, an airport picked by its label, Change route with eleven airports.
//     (Until main.js lists the region's airports, the eight new JSONs are added to the game's
//     list here for the map's sake; nothing is flown to them.)
//  3. The game with the flag off: the map as v0.5.8 drew it.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-v060-map.mjs [rootUrl]
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../Claude outputs/flight-sim');
const ROOT = process.argv[2] || process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const NEW = ['RKPK', 'RJFF', 'RJBB', 'RJTT', 'RJAA', 'ZSPD', 'ZSSS', 'ZSQD', 'ZSYN', 'ZBAA', 'ZBAD', 'ZYTX', 'ZYTL', 'UHWW', 'RJCC', 'RJSA', 'RJSS', 'RJSN', 'ZKPY', 'ZKWS'];   // (ZSYN: v0.6.1; five: v0.6.3; the last six: v0.6.4)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const f2 = (v) => v.toFixed(2);
try {
  // ---- 1. the dev page: costs and the ND pictures ----
  const costs = {};
  for (const flag of [1, 0]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${ROOT}games/flight-sim/tests/dev-v060-map.html?eastasia=${flag}`);
    await page.waitForFunction(() => window.__devReady, null, { timeout: 30000 });
    const info = await page.evaluate(() => ({ on: window.__dev.EAST_ASIA_ON, buildMs: window.__dev.buildMs, n: window.__dev.airports.length }));
    console.log(`dev page flag ${flag}: region ${info.on}, ${info.n} airports, buildCoast ${f2(info.buildMs)} ms`);
    const places = flag ? { 'Tokyo Bay': [35.5, 139.8, 220], 'Seto Inland Sea': [34.3, 133.3, 80], 'Incheon (region file)': [37.46, 126.44, 150] }
      : { 'Incheon (Korea file)': [37.46, 126.44, 150] };
    for (const [name, [la, lo, hdg]] of Object.entries(places)) {
      for (const nd of ['a', 'b']) {
        const row = await page.evaluate(([la, lo, hdg, nd]) => {
          window.__dev.place(la, lo, hdg);
          const out = {};
          for (const r of [10, 20, 40, 80, 160, 320]) out[r] = window.__dev.time(nd, r, 40);
          return out;
        }, [la, lo, hdg, nd]);
        costs[`${name} ${nd === 'a' ? 'A321' : 'Boeing'}`] = row;
      }
    }
    if (flag) {
      await page.evaluate(() => { window.__dev.place(35.3, 138.6, 70); window.__dev.setDest('RJTT', '34L'); window.__dev.draw(160); });
      await page.locator('#nds').screenshot({ path: path.join(OUT, 'v060-nd-160nm-tokyo.png') });
      await page.evaluate(() => { window.__dev.place(34.25, 132.6, 75); window.__dev.setDest('RJBB', '06R'); window.__dev.draw(80); });
      await page.locator('#nds').screenshot({ path: path.join(OUT, 'v060-nd-80nm-seto.png') });
      await page.evaluate(() => { window.__dev.place(35.42, 139.95, 340); window.__dev.setDest('RJTT', '34L'); window.__dev.draw(20); });
      await page.locator('#nds').screenshot({ path: path.join(OUT, 'v060-nd-20nm-tokyo-bay.png') });
    }
    // The map's draw cost (the dev page's map, no aircraft state): whole region / zoomed views.
    const mapMs = await page.evaluate(async (flag) => {
      const m = window.__dev.map; m.open(); await new Promise((r) => setTimeout(r, 100));
      const out = {};
      const views = flag ? { region: [255000, -27000, 2700], tokyo: [1110000, 20000, 120], korea: [0, -20000, 700], seto: [450000, -170000, 400] } : { korea: [0, 0, 1000], incheon: [-80000, 165000, 120] };
      for (const [n, [x, y, mpp]] of Object.entries(views)) { m._devView(x, y, mpp); out[n] = m._devDrawMs(20); }
      m.close();
      return out;
    }, flag);
    console.log(`map draw ms (flag ${flag}):`, Object.entries(mapMs).map(([k, v]) => `${k} ${f2(v)}`).join(', '));
    check(`dev page (flag ${flag}) no errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
  console.log('ND coast cost, ms per frame (all - without coast), ranges 10/20/40/80/160/320 nm:');
  for (const [k, row] of Object.entries(costs)) console.log(`  ${k.padEnd(30)} ${Object.values(row).map((v) => f2(v.coast).padStart(6)).join(' ')}   (whole ND at 160: ${f2(row[160].all)})`);
  const worst = (re) => Math.max(...Object.entries(costs).filter(([k]) => re.test(k)).flatMap(([, r]) => [10, 20, 40, 80, 160].map((x) => r[x].coast)));
  const regionWorst = worst(/Tokyo|Seto/), koreaWorst = worst(/Korea file/);
  check('the region\'s ND coast within 2x Korea\'s today (10-160 nm) or under 1 ms', regionWorst < Math.max(1, 2 * koreaWorst), `region ${f2(regionWorst)} ms, Korea ${f2(koreaWorst)} ms`);

  // ---- 2. the game with the region on ----
  for (const flag of [1, 0]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${ROOT}games/flight-sim/?eastasia=${flag}&test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.frames > 30, null, { timeout: 90000 });
    const added = flag ? await page.evaluate(async (NEW) => {
      const list = window.__fs.airports, have = new Set(list.map((a) => a.icao)), add = [];
      for (const i of NEW) {
        if (have.has(i)) continue;
        const a = await (await fetch(`data/airports/${i}.json`)).json();
        for (const r of a.runways) r.ends.forEach((e, j) => { if (e.hdgGridDeg == null) e.hdgGridDeg = Math.atan2(r.ends[1 - j].x - e.x, r.ends[1 - j].y - e.y) * 180 / Math.PI; });
        add.push(a);
      }
      list.push(...add);
      return { added: add.map((a) => a.icao), total: list.length };
    }, NEW) : null;
    if (added) console.log('airports:', JSON.stringify(added));
    await page.keyboard.press('KeyN');
    await page.waitForTimeout(600);
    const open = await page.evaluate(() => window.__fs.map.isOpen);
    check(`flag ${flag}: the map opens on N`, open);
    if (flag) {
      const sh = async (name, x, y, mpp) => { await page.evaluate(([x, y, m]) => window.__fs.map._devView(x, y, m), [x, y, mpp]); await page.waitForTimeout(150); await page.screenshot({ path: path.join(OUT, `v060-map-${name}.png`) }); };
      await sh('region', 255000, -27000, 2650);
      // An airport picked by its label at the region's scale: Haneda.
      const lab = await page.evaluate(() => window.__fs.map._devLabel('RJTT'));
      check('Haneda has a label at the region\'s scale', !!lab, JSON.stringify(lab));
      if (lab) {
        await page.mouse.click(lab[0], lab[1]);
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => { const on = document.querySelector('.fsui-route:not([hidden]) [data-r="apt"] button.on'); return { open: window.__fs.map.routeOpen, on: on && on.textContent, n: document.querySelectorAll('.fsui-route [data-r="apt"] button').length }; });
        check('a click on Haneda\'s label offers it in Change route, with eleven airports', r.open && /^RJTT/.test(r.on || '') && r.n >= 11, JSON.stringify(r));
        await page.screenshot({ path: path.join(OUT, 'v060-map-route-haneda.png') });
        await page.evaluate(() => document.querySelector('.fsui-route [data-a="rcancel"]').click());
      }
      const labs = await page.evaluate(() => ['ZSPD', 'ZSSS', 'RJTT', 'RJAA', 'RKSS', 'RKSI'].map((i) => [i, window.__fs.map._devLabel(i)]));
      console.log('labels at the region scale:', JSON.stringify(labs.map(([i, p]) => [i, p && p.map(Math.round)])));
      await sh('tokyo-bay', 1125000, 30000, 110);
      await sh('korea', -20000, -40000, 700);
      await sh('shanghai', -560000, -515000, 130);
      await sh('kansai-seto', 560000, -160000, 450);
      // The bright predicted path, from Gimpo towards Haneda (synthetic samples on the great circle).
      await page.evaluate(() => {
        const fs = window.__fs, s = fs.sim.state, h = fs.airports.find((a) => a.icao === 'RJTT').runways[0].ends[0];
        const n = 80, list = [];
        for (let i = 1; i <= n; i++) list.push({ t: s.t + i * 60, x: s.pos.x + (h.x - s.pos.x) * i / n, y: s.pos.y + (h.y - s.pos.y) * i / n, z: 10000 });
        fs.map.setPrediction(list);
      });
      await sh('region-path', 520000, 60000, 1500);
    } else {
      await page.screenshot({ path: path.join(OUT, 'v060-map-flag-off.png') });
    }
    check(`game flag ${flag}: no console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
    await page.close();
  }
} finally { await browser.close(); }
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
