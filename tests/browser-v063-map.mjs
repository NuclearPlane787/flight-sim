// v0.6.3 Part 4: the path map's city areas and names, headless, on the map's dev page (no WebGL).
// Pictures of the whole region, Korea, the Kanto plain, the Yangtze delta and Beijing; the names written at
// each zoom; the draw's cost with the cities and without (?mapcities=0); no name on an airport's label.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-v063-map.mjs [rootUrl]
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../Claude outputs/flight-sim');
const ROOT = process.argv[2] || process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const TAG = process.env.E2E_TAG || '';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const HEADED = process.argv.includes('--headed') || process.env.FS_HEADLESS === '0';
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
// [name, x, y (map m), metres per px]
const VIEWS = [['region', 255000, -27000, 2650], ['korea', 0, -20000, 520], ['seoul', -45000, 172000, 110], ['kanto', 1100000, 30000, 260], ['tokyo', 1105000, 30000, 70],
  ['yangtze', -640000, -500000, 330], ['beijing', -900000, 440000, 300], ['beijing-close', -945000, 480000, 90], ['north', -100000, 620000, 900]];
try {
  const ms = {};
  for (const cities of [1, 0]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${ROOT}games/flight-sim/tests/dev-v060-map.html?eastasia=1${cities ? '' : '&mapcities=0'}`);
    await page.waitForFunction(() => window.__devReady, null, { timeout: 30000 });
    await page.evaluate(() => { document.getElementById('nds')?.style.setProperty('display', 'none'); window.__dev.map.open(); });
    await page.waitForTimeout(200);
    for (const [name, x, y, mpp] of VIEWS) {
      const r = await page.evaluate(([x, y, mpp]) => { const m = window.__dev.map; m._devView(x, y, mpp); return { ms: m._devDrawMs(20), places: m._devPlaces() }; }, [x, y, mpp]);
      (ms[name] ||= {})[cities] = r.ms;
      if (cities) {
        console.log(`${name.padEnd(14)} ${String(r.places.length).padStart(2)} names: ${r.places.map((p) => p.name).join(', ')}`);
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(OUT, `v063-map${TAG}-${name}.png`) });
        if (name === 'region') {
          const names = r.places.map((p) => p.name);
          check('the region names its great cities', ['Tokyo', 'Seoul', 'Shanghai', 'Beijing', 'Osaka'].every((n) => names.includes(n)), names.join(', '));
          check('the region is not crowded with names', names.length <= 30, String(names.length));
        }
        if (name === 'korea') check('Korea zoomed names Busan, Daegu, Daejeon and Gwangju', ['Busan', 'Daegu', 'Daejeon', 'Gwangju'].every((n) => r.places.some((p) => p.name === n)), '');
        // No name's centre inside an airport label's box.
        const hit = await page.evaluate(() => { const m = window.__dev.map; return window.__dev.airports.map((a) => [a.icao, m._devLabel(a.icao)]).filter(([, l]) => l).some(([, l]) => m._devPlaces().some((p) => Math.abs(p.x - l[0]) < 8 && Math.abs(p.y - l[1]) < 8)); });
        check(`${name}: no name on an airport's label`, !hit);
      } else check(`${name}: no names with ?mapcities=0`, r.places.length === 0, String(r.places.length));
    }
    check(`the dev page (cities ${cities}) has no errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
  console.log('map draw, ms a frame (with the cities / without):');
  for (const [n, r] of Object.entries(ms)) console.log(`  ${n.padEnd(14)} ${r[1].toFixed(2)} / ${r[0].toFixed(2)}`);
  const worst = Math.max(...Object.values(ms).map((r) => r[1]));
  check('the map draws in under 8 ms with the cities at every view', worst < 8, `${worst.toFixed(2)} ms`);
} finally { await browser.close(); }
console.log(results.every(Boolean) ? `ALL PASS (${results.length})` : `FAILED ${results.filter((r) => !r).length} of ${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
