// v0.7.9 (map): the path map's pictures and its redraw time, headless, one page a region (a gate start, the map open):
// the bases in view zoomed out and in (the legend showing), the brief's airports at two zoom steps (the whole field,
// and right in with the stands' numbers), and the assigned taxi route at the gate. Each view is set by the map's dev
// hook (_devView: a map point and metres a pixel), so the tree and the pushed v0.7.8 (--base .../base/...) are
// pictured at the same views. The redraw's time is the map's own _devDrawMs(20), in this page, at four views.
//   node tests/browser-v079-map.mjs --tag mpb [--base <url>] [--q "&map79=0"]
//   FS_REGION=europe node tests/browser-v079-map.mjs --tag mpb ...
// Pictures "Claude outputs/flight-sim/v079-<tag>-<view>.png". The last line printed: "done N of M".
import { chromium } from './pw.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REGION } from '../src/world/regions.js';
import { standList } from '../src/ground/gate-flow.js';
import { typeById } from '../src/sim/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const BASE = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/'), TAG = opt('--tag', 'mpb'), Q = opt('--q', '');
const EU = process.env.FS_REGION === 'europe';
const origin = (icao) => JSON.parse(readFileSync(path.join(here, '..', REGION.data, `airports/${icao}.json`), 'utf8')).origin;

// [view, ICAO or [x, y], metres a pixel]; 'aircraft' is the player's aircraft at its gate
const VIEWS = EU
  ? [['eu-bases-out', ['ETAR', 'EGUL', 'EGVA', 'EGQS', 'LERT', 'LEZG'], 0], ['eu-uk-bases', ['EGUL', 'EGVA', 'EGQS'], 0], ['etar-field', 'ETAR', 7], ['etar-in', 'ETAR', 2],
     ['egul-field', 'EGUL', 7], ['lezg-field', 'LEZG', 9],
     ['egll-field', 'EGLL', 5.5], ['egll-in', 'EGLL', 2], ['lfpg-field', 'LFPG', 6.5], ['lfpg-in', 'LFPG', 2],
     ['eddf-field', 'EDDF', 6], ['eddf-in', 'EDDF', 2], ['taxi-egll', 'aircraft', 4], ['taxi-egll-in', 'aircraft', 2]]
  : [['ea-bases-out', ['RKJK', 'RKTU', 'RJNK', 'RKSI'], 0], ['ea-bases-in', 'RKJK', 9], ['rjnk-field', 'RJNK', 8], ['rktu-field', 'RKTU', 7],
     ['rksi-field', 'RKSI', 7], ['rksi-in', 'RKSI', 2], ['rjtt-field', 'RJTT', 6], ['rjtt-in', 'RJTT', 2],
     ['taxi-rksi', 'aircraft', 4], ['taxi-rksi-in', 'aircraft', 2]];
const TIMED = EU ? [['eu-bases-out', 0], ['egll-field', 5.5], ['egll-in', 2], ['lfpg-field', 6.5]] : [['ea-bases-out', 0], ['rksi-field', 7], ['rksi-in', 2], ['rjtt-field', 6]];
const START = EU ? { icao: 'EGLL', end: '27R' } : { icao: 'RKSI', end: '33L' };
{ // the third gate the setup offers the A321 (as browser-v078-gates.mjs picks one)
  const ap = JSON.parse(readFileSync(path.join(here, '..', REGION.data, `airports/${START.icao}.json`), 'utf8'));
  const gates = standList(ap, typeById('a321neo')).filter((s) => s.gate);
  START.stand = gates[Math.min(2, gates.length - 1)].ref;
}

const profile = mkdtempSync(path.join(tmpdir(), 'fs-v079-map-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let done = 0;
const total = VIEWS.length + 1;
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = `${BASE}?test${EU ? '&region=europe' : ''}&origin=${START.icao}&dep=${START.end}&dest=${START.icao}&arr=${START.end}&start=gate&stand=${encodeURIComponent(START.stand)}&view=orbit&type=a321neo${Q}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 60, null, { timeout: 120000 });
  const g = await page.evaluate(() => { const r = window.__fs.gate.route, s = window.__fs.sim.state; return { phase: window.__fs.gate.phase, n: r?.points?.length || 0, kind: r?.kind, runway: r?.runway, stand: window.__fs.gate.stand?.ref, x: s.pos.x, y: s.pos.y }; });
  console.log(`gate start: ${JSON.stringify(g)}`);
  await page.evaluate(() => window.__fs.map.open());
  await page.waitForTimeout(4000);   // the map's extras (relief, borders, terminals' labels)
  const at = (v) => (v === 'aircraft' ? [g.x, g.y] : Array.isArray(v) ? fitOf(v).slice(0, 2) : origin(v));
  // a list of airports: the view that holds them all with a margin (metres a pixel 0: fitted)
  function fitOf(list) {
    const P = list.map(origin), xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return [(x0 + x1) / 2, (y0 + y1) / 2, Math.max((x1 - x0) / 1100, (y1 - y0) / 640, 300)];
  }
  const mppOf = (where, mpp) => (mpp || fitOf(where)[2]);
  for (const [name, where, m0] of VIEWS) {
    const [x, y] = at(where), mpp = mppOf(where, m0);
    await page.evaluate(([x, y, m]) => window.__fs.map._devView(x, y, m), [x, y, mpp]);
    await page.waitForTimeout(400);
    const f = `v079-${TAG}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, f) });
    console.log(`  picture ${f}`);
    done++;
  }
  // the redraw's time in this page: the map's own draw, 20 times a view (the first draw of a view builds its layouts)
  const ms = [];
  for (const [name, m0] of TIMED) {
    const v = VIEWS.find((q) => q[0] === name), [x, y] = at(v[1]), mpp = mppOf(v[1], m0);
    // first: the view's first draw (its layouts built); then: the mean of 20 draws; raster: the mean of 10 draws each
    // followed by a one-pixel read, which waits for the canvas to be painted
    const t = await page.evaluate(([x, y, m]) => {
      const M = window.__fs.map, c = document.querySelector('.fsui-map canvas').getContext('2d');
      const t0 = performance.now(); M._devView(x, y, m); const first = performance.now() - t0;
      const avg = M._devDrawMs(20);
      c.getImageData(0, 0, 1, 1);
      const t1 = performance.now(); for (let i = 0; i < 10; i++) { M._devDrawMs(1); c.getImageData(0, 0, 1, 1); }
      return { first, avg, raster: (performance.now() - t1) / 10 };
    }, [x, y, mpp]);
    ms.push(`${name} ${Math.round(mpp * 10) / 10} m/px: first ${t.first.toFixed(1)} ms, then ${t.avg.toFixed(2)} ms, painted ${t.raster.toFixed(2)} ms`);
  }
  console.log(`redraw ${TAG}: ${ms.join('; ')}`);
  // the tooltip over a base's and a joint field's label, and the closest zoom the wheel reaches (pixels per metre)
  const tips = [];
  for (const icao of EU ? ['ETAR', 'LEZG', 'EGLL'] : ['RKJK', 'RKSI']) {
    await page.evaluate(([x, y]) => window.__fs.map._devView(x, y, 900), origin(icao));
    await page.waitForTimeout(200);
    const p = await page.evaluate((i) => window.__fs.map._devLabel(i), icao);
    if (!p) { tips.push(`${icao}: no label`); continue; }
    await page.mouse.move(p[0], p[1]);
    await page.waitForTimeout(150);
    tips.push(await page.evaluate(() => { const t = document.querySelector('.fsui-map .fsui-tip'); return t && !t.hidden ? t.textContent : '(no tip)'; }));
  }
  console.log(`tips ${TAG}: ${tips.join(' | ')}`);
  const [zx, zy] = origin(START.icao);
  await page.evaluate(([x, y]) => window.__fs.map._devView(x, y, 20), [zx, zy]);
  await page.mouse.move(720, 450);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  const ppm = await page.evaluate(([x, y]) => { const M = window.__fs.map, a = M._devScreen(x, y), b = M._devScreen(x + 100, y); return (b[0] - a[0]) / 100; }, [zx, zy]);
  console.log(`zoom ${TAG}: closest ${ppm.toFixed(3)} px a metre (${(1 / ppm).toFixed(2)} m a pixel)`);
  done++;
  if (errors.length) console.log('ERRORS ' + errors.join(' | ').slice(0, 400));
} catch (e) {
  console.log(`FAILED ${String(e).slice(0, 300)}`);
  try { console.log('state: ' + await ctx.pages()[0].evaluate(() => JSON.stringify({ fs: !!window.__fs, phase: window.__fs?.gate?.phase, frames: window.__fs?.frames }))); } catch { /* the page is gone */ }
}
finally {
  await ctx.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the temp folder stays */ }
}
console.log(`done ${done} of ${total}`);
