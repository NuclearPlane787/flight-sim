// v0.6.0 Part 5 steps 5-7 in the real game, headless: the altimeter's local rules with the region's flag on.
// An A321 and a 787 over Haneda after Shift+B (inches on the PFD and the FCU/MCP), both over Pudong climbing through
// 3,000 m on QNH (the metric altitude on by itself, the BARO alert), and the A321 over Gimpo (unchanged).
// Until the region's airports and terrain are in, the aircraft is placed in the air over each one's coordinates.
//   python3 tools/cpu-guard.py --minutes 6 -- node tests/browser-v060-rules-baro.mjs
// Env: FS_URL (default http://127.0.0.1:8014/games/flight-sim/), OUT (the pictures' folder).
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const OUT = process.env.OUT || fileURLToPath(new URL('../../../Claude outputs/flight-sim/', import.meta.url));
const origin = (icao) => JSON.parse(readFileSync(new URL(`../data/airports/${icao}.json`, import.meta.url), 'utf8')).origin;
const PLACES = { RJTT: origin('RJTT'), ZSPD: origin('ZSPD'), RKSS: origin('RKSS') };
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  for (const type of ['a321neo', 'b787-9']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}?test&eastasia=1&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&type=${type}`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.frames > 30, null, { timeout: 90000 });
    // The country raster (another part's agent wires it into the page; installed here if it isn't yet).
    await page.evaluate(async () => {
      const R = await import('/games/flight-sim/src/world/region.js');
      if (!R.geoRules()) R.setGeoRules(await (await import('/games/flight-sim/src/world/geo-rules.js')).loadGeoRules('/games/flight-sim/data/'));
    });
    // In the air over a place: x, y (the map frame), at zM, climbing to altFt on the AP; the day's QNH qnh.
    const place = (where, zM, altFt, qnh, dy = -12000, vs = 0) => page.evaluate(async ({ p, zM, altFt, qnh, dy, vs }) => {
      const fs = window.__fs, sim = fs.sim;
      const { calmWeather } = await import('/games/flight-sim/src/sim/weather.js');
      sim.setWeather({ ...calmWeather(), preset: 'custom', qnh, wind: { fromDeg: 220, kt: 8, gustKt: 0 } });
      sim.reset({ x: p[0], y: p[1] + dy, z: zM, hdg: 0, onGround: false, iasMs: 250 * 0.514444, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 16000 });
      sim.setBaro(1013.25);
      fs.ap.setSpd?.(250); fs.ap.setHdg?.(360); fs.ap.hdgSel?.(); fs.ap.setAlt(altFt); fs.ap.engageAp();
      if (vs) fs.ap.setVs?.(vs); else fs.ap.levelChange?.();
      return { country: (await import('/games/flight-sim/src/world/region.js')).countryAt(sim.state.pos.x, sim.state.pos.y) };
    }, { p: PLACES[where], zM, altFt, qnh, dy, vs });
    const shiftB = async () => { await page.mouse.click(720, 600); await page.keyboard.press('Shift+KeyB'); await page.waitForTimeout(300); };
    const readout = () => page.evaluate(() => {
      const fs = window.__fs, s = fs.sim.state, b = fs.sim.baro;
      const vis = (q) => [...document.querySelectorAll(q)].filter((e) => e.offsetParent !== null);
      const strip = vis('.fsui-fcu .fsui-win[data-k="baro"] .fsui-val').map((e) => e.textContent);
      const unit = vis('.fsui-fcu .fsui-unit').map((e) => e.dataset.u);
      const metric = vis('.fsui-fcu .fsui-btn[data-k="metric"], .fsui-fcu .fsui-btn[data-k="mtrs"]').map((e) => e.classList.contains('on'));
      // Every fixed window on the strips: the text's width inside its box.
      const over = [...document.querySelectorAll('.fsui-fcu .fsui-win, .fsui-fcu .fsui-btn')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.dataset.k);
      return { baro: b, altInd: s.altInd, z: s.pos.z, vs: s.vs, alert: s.baroAlert, t: s.t, strip, unit, metric, over };
    });
    const shot = async (name) => {
      const file = `${OUT}v060-rules-baro-${name}.png`;
      await page.screenshot({ path: file });
      // And the PFD and the strip up close (at the device's 2x), to check the text fits its windows.
      const pfd = `${OUT}v060-rules-baro-${name}-pfd.png`;
      const box = await page.evaluate(() => { const a = document.querySelector('.fsui-pfd').getBoundingClientRect(); const f = [...document.querySelectorAll('.fsui-fcu')].find((e) => e.offsetParent !== null).getBoundingClientRect(); return { x: Math.min(a.x, f.x), y: f.y, w: Math.max(a.right, f.right) - Math.min(a.x, f.x), h: a.bottom - f.y }; });
      await page.screenshot({ path: pfd, clip: { x: box.x, y: box.y, width: Math.min(box.w, 720), height: box.h } });
      console.log('picture:', file, pfd);
    };
    // The sim may wait for terrain outside Korea's tiles until the region's are in: step it here if it does.
    const settle = async (seconds) => {
      const t0 = await page.evaluate(() => window.__fs.sim.state.t);
      await page.waitForTimeout(seconds * 1000);
      const t1 = await page.evaluate(() => window.__fs.sim.state.t);
      if (t1 - t0 < seconds * 0.5) {
        console.log(`(the sim held ${(seconds - (t1 - t0)).toFixed(1)} s for terrain: stepping it by hand)`);
        await page.evaluate((n) => { const sim = window.__fs.sim; for (let i = 0; i < n; i++) { sim.step(1 / 120); sim.events.length = 0; } }, Math.round(seconds * 120));
        await page.evaluate(() => window.__fs.renderOnce?.());
        await page.waitForTimeout(300);
      }
    };
    const short = type === 'a321neo' ? 'a321' : '787';

    // Haneda: Shift+B gives the QNH in inches.
    const h = await place('RJTT', 1500, 6000, 1014.9);
    check(`${short}: over Haneda the country is Japan`, h.country === 'JP', h.country);
    await shiftB();
    await settle(2);
    let r = await readout();
    check(`${short}: Shift+B at Haneda: inches`, r.baro.inHg === true && Math.abs(r.baro.hpa - 1014.9) < 1e-9, JSON.stringify(r.baro));
    check(`${short}: the strip shows 29.97 and IN`, r.strip.includes('29.97') && r.unit.includes('in'), JSON.stringify(r));
    check(`${short}: no metres in Japan`, r.metric.every((on) => !on), JSON.stringify(r.metric));
    check(`${short}: nothing overflows its window on the strip`, r.over.length === 0, r.over.join(','));
    await shot(`${short}-haneda`);
    // The unit's button: a click, back to hPa and again to inches.
    await page.locator('.fsui-fcu .fsui-unit').filter({ visible: true }).click();
    await page.waitForTimeout(150);
    r = await readout();
    check(`${short}: a click on IN/HPA: hPa`, !r.baro.inHg && r.strip.includes('1015'), JSON.stringify(r.strip));
    await page.locator('.fsui-fcu .fsui-unit').filter({ visible: true }).click();
    await page.waitForTimeout(150);

    // Pudong: QNH set (hPa in China), climbing through 3,000 m: the alert, and the metres on by themselves.
    const p = await place('ZSPD', 2950, 15000, 1020, -12000, 1500);   // climbing at 1,500 ft/min on V/S
    check(`${short}: over Pudong the country is China`, p.country === 'CN', p.country);
    await shiftB();
    r = await readout();
    check(`${short}: Shift+B at Pudong: hPa`, !r.baro.inHg && r.strip.includes('1020'), JSON.stringify(r.strip));
    for (let i = 0; i < 40; i++) {
      await settle(1);
      r = await readout();
      if (r.altInd > 3040) break;
    }
    check(`${short}: climbing through 3,000 m on QNH: the BARO alert`, r.alert === true && r.altInd > 3000, `${r.altInd.toFixed(0)} m, vs ${r.vs.toFixed(1)}`);
    check(`${short}: the metric altitude on by itself in China`, r.metric.length === 1 && r.metric[0] === true, JSON.stringify(r.metric));
    await shot(`${short}-pudong`);

    if (type === 'a321neo') {
      // Gimpo: as v0.5.8 (hPa, no metres, the alert from 14,000 ft).
      const g = await place('RKSS', 900, 5000, 1008);
      check('a321: over Gimpo the country is Korea', g.country === 'KR', g.country);
      await shiftB();
      await settle(2);
      r = await readout();
      check('a321: Gimpo: hPa, 1008, no metres, no alert', !r.baro.inHg && r.strip.includes('1008') && r.metric.every((on) => !on) && !r.alert, JSON.stringify(r));
      await shot('a321-gimpo');
    }
    check(`${short}: no console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
    await page.close();
  }

  // (v0.7.0: the flag-off check, no IN/HPA or METRIC ALT buttons with ?eastasia=0, went with the flag.)
} finally { await browser.close(); }
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
