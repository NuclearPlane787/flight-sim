// briefs/V0-6-0.md's definition of done: 60 fps at each new airport at a stand. The game itself (not the
// free camera), parked at the first gate the setup offers the A321neo, the outside view, by day
// and at night: frames counted over 4 s of real time, with the draws and triangles.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 8 -- node games/flight-sim/tests/browser-v060-stand-fps.mjs [ICAO ...]
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standList } from '../src/ground/gate-flow.js';
import { standHeading } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';
import { REGION, REGION_ID } from '../src/world/regions.js';
import { canLand, circlingOnly } from '../src/world/runways.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const ICAOS = process.argv.slice(2).filter((a) => /^[A-Z]{4}$/.test(a));
const GROUND = process.argv.includes('--ground') ? 1 : 0;                       // Part 7's ground on
const SHOT = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;   // a picture at each stand: v060-<tag>-stand-<icao>-{day,night}.png
const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const LIST = ICAOS.length ? ICAOS : ['ZSPD', 'ZSSS', 'ZSYN', 'ZSQD', 'RJTT', 'RJAA', 'RJBB', 'RJFF', 'RKPK'];   // (the Korean three work too: RKSS RKSI RKPC)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const icao of LIST) {
    const ap = JSON.parse(readFileSync(path.join(here, '..', REGION.data, `airports/${icao}.json`), 'utf8'));   // v0.7.0: the run's region's folder
    // (v0.7.3: an airport with no ILS at all, Innsbruck and Gibraltar: the longest runway's first end that is landed on straight in)
    const straightIn = (e) => canLand(icao, e.ident) && !circlingOnly(icao, e.ident);
    const rw = ap.runways.filter((r) => r.ends.some((e) => e.ils && canLand(icao, e.ident))).sort((p, q) => q.lengthM - p.lengthM)[0]
      || ap.runways.filter((r) => r.ends.some(straightIn)).sort((p, q) => q.lengthM - p.lengthM)[0];
    const arr = (rw.ends.find((e) => e.ils && canLand(icao, e.ident)) || rw.ends.find(straightIn)).ident;   // (v0.7.0: an end that is landed on: runways.js ONE_WAY)
    for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
    const offered = standList(ap, typeById('a321neo')); const want = (offered.find((x) => x.gate) || offered[0]).ref;   // (an airport with no gates mapped: its first stand; v0.6.1, Yancheng)
    await page.goto(`${BASE}?test&eastasia=1&cities=1&ground=${GROUND}&origin=${icao}&dep=${arr}&dest=${icao}&arr=${arr}&start=gate&stand=${encodeURIComponent(want)}&view=orbit${process.env.E2E_EXTRA || ''}`);
    await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 30, null, { timeout: 60000 });
    const out = [];
    // (12:00 and 23:00 in Korea and Japan; v0.7.0, Europe: 12:00 and 21:00 UTC, midday and night there)
    for (const [tod, hourUtc] of (REGION_ID === 'europe' ? [['day', 12], ['night', 21]] : [['day', 3], ['night', 14]])) {
      await page.evaluate((ms) => window.__fs.clock.set(ms), Date.UTC(2026, 10, 19, hourUtc, 0, 0));
      await page.waitForTimeout(2500);
      const r = await page.evaluate(async () => {
        const f = window.__fs, f0 = f.frames, t0 = performance.now();
        let worst = 0, last = t0;
        await new Promise((res) => { const tick = (t) => { worst = Math.max(worst, t - last); last = t; if (t - t0 < 4000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
        const ri = f.renderer.info.render;   // the whole frame: the world, the aircraft, the lights
        return { fps: (f.frames - f0) / ((performance.now() - t0) / 1000), worst, draws: ri.calls, tris: ri.triangles, heap: Math.round(performance.memory.usedJSHeapSize / 1048576) };
      });
      if (SHOT) { await page.getByText('Hide panels').click({ timeout: 1500 }).catch(() => {}); await page.evaluate(() => { const L = window.__fs.rig.looks.orbit; L.yaw = 0.7; L.pitch = 0.45; L.dist = 160; }); await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}v060-${SHOT}-stand-${icao.toLowerCase()}-${tod}.png` }); }
      out.push(`${tod} ${r.fps.toFixed(1)} fps (worst frame ${r.worst.toFixed(1)} ms), ${r.draws} draws, ${(r.tris / 1000).toFixed(0)}k triangles`);
      if (r.fps < 59) bad++;
    }
    console.log(`${icao} stand ${want}: ${out.join('; ')}`);
  }
  if (errors.length) { console.log('console errors:', errors.slice(0, 4).join(' | ')); bad++; }
  console.log(bad ? 'FAIL' : 'PASS 60 fps at a stand at every airport, day and night');
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
