// v0.4.0's review checks in headless Chromium, through the real game loop (main.js), in the cloud container:
// a 15 nm final for Jeju 07 started with the setup's Gusty crosswind preset, then a landing by
// tests/e2e-controller.js in a gusty crosswind, and the same final in calm air for comparison.
//   - a flight starts with the altimeter at the day's QNH, and the AP's ALT at the altimeter's reading;
//   - on a final the heading held is the crabbed one, so HDG keeps the aircraft on the extended centreline;
//   - K sets the local QNH again after a wrong setting; skip to final sets it too;
//   - the card and the logbook give the tower's wind (the panel's), with its gusts;
//   - in calm air the start is as v0.3.2's: 1013.25, the runway's heading, no drift.
//   node weather-final.cjs [outDir]      (about 3 minutes with SwiftShader; FS_BASE as in stills.cjs)
// The frame clock is faked (each frame is 0.1 s of sim) and nothing is drawn until the card's picture.
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const out = process.argv[2] || '';
if (out) require('fs').mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const viewport = { width: 1280, height: 800 };
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    let fake = 1000;
    window.requestAnimationFrame = (cb) => setTimeout(() => { fake += 100; cb(fake); }, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 180000 });
  await page.evaluate(async (base) => {
    const fs = window.__fs;
    window.__realRender = fs.renderer.render.bind(fs.renderer);
    fs.renderer.render = () => {};
    (0, eval)(await (await fetch(base + 'tests/e2e-controller.js')).text());
  }, BASE);
  // What the start looks like: the baro, the AP's targets, the crab and where the aircraft is against the runway.
  const look = () => page.evaluate(() => {
    const fs = window.__fs, s = fs.sim.state, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    const rx = s.pos.x - ax.tx, ry = s.pos.y - ax.ty;
    const rwyMag = fs.gridToMagDeg(ax.hdg, s.pos.x, s.pos.y), hdgMag = fs.gridToMagDeg(s.hdg, s.pos.x, s.pos.y);
    return { preset: fs.sim.weather?.preset ?? 'clear', qnh: fs.sim.weather?.qnh ?? 1013.25, baro: fs.sim.baro, t: s.t,
      altFtFcu: fs.ap.altFt, altIndFt: s.altInd * 3.28084, trueFt: s.pos.z * 3.28084, hdgFcu: fs.ap.hdgDeg, rwyMag, hdgMag,
      drift: s.drift * 180 / Math.PI, cross: rx * ax.uy - ry * ax.ux, along: rx * ax.ux + ry * ax.uy, lateral: fs.ap.lateral, vertical: fs.ap.vertical, ap: fs.ap.ap };
  });
  const flyFor = async (sec) => {
    const t0 = await page.evaluate(() => window.__fs.sim.state.t);
    await page.waitForFunction((t) => window.__fs.sim.state.t >= t, t0 + sec, { timeout: 120000, polling: 50 });
  };
  const angle = (a, b) => ((a - b) % 360 + 540) % 360 - 180;

  // ---- 1. The setup's Gusty crosswind, on a 15 nm final ----
  await page.evaluate(() => { const fs = window.__fs; fs.startFlight({ ...fs.plan, start: 'final', weather: 'gusty-crosswind' }); });
  let a = await look();
  console.log('gusty start:', JSON.stringify(a));
  ok(a.preset === 'gusty-crosswind', `the plan's weather is set: ${a.preset}`);
  ok(a.baro.hpa === a.qnh && !a.baro.std, `the altimeter starts at the day's QNH: ${a.baro.hpa} (QNH ${a.qnh})`);
  ok(Math.abs(a.altFtFcu - a.altIndFt) < 60, `the AP's ALT is the altimeter's reading there: ${a.altFtFcu} against ${Math.round(a.altIndFt)} ft`);
  ok(Math.abs(a.drift) > 4, `the aircraft is crabbed into the wind: drift ${a.drift.toFixed(1)}°`);
  ok(Math.abs(angle(a.hdgFcu, a.hdgMag)) <= 0.6 && Math.abs(angle(a.hdgFcu, a.rwyMag)) > 4,
    `the FCU's heading is the crabbed one the aircraft flies: ${a.hdgFcu}° (${a.hdgMag.toFixed(1)}°), the runway's ${a.rwyMag.toFixed(1)}°`);
  const cross0 = a.cross;
  await flyFor(60);
  a = await look();
  console.log('60 s on:', JSON.stringify(a));
  ok(a.ap && a.lateral === 'HDG', `still on the AP, HDG: ${a.ap} ${a.lateral} ${a.vertical}`);
  ok(Math.abs(a.cross - cross0) < 120, `HDG holds the extended centreline in the crosswind: ${Math.round(cross0)} → ${Math.round(a.cross)} m across`);
  ok(Math.abs(a.altIndFt - a.altFtFcu) < 100, `ALT holds the altimeter's ${a.altFtFcu} ft: ${Math.round(a.altIndFt)} ft`);

  // ---- 2. K after a wrong setting, and skip to final ----
  await page.evaluate(() => window.__fs.sim.setBaro(1000));
  await page.keyboard.press('k');
  await page.waitForTimeout(150);
  a = await look();
  const toast = await page.evaluate(() => [...document.querySelectorAll('[id*="toast"], [class*="toast"]')].map((e) => e.textContent).join(' | '));
  ok(a.baro.hpa === a.qnh, `K sets the local QNH again: ${a.baro.hpa}`);
  ok(/QNH \d{3,4} set/.test(toast), `with a toast: "${toast.trim().slice(0, 80)}"`);
  await page.evaluate(() => {
    const fs = window.__fs, w = fs.sim.weather;
    fs.sim.setWeather({ ...w, wind: { fromDeg: w.wind.fromDeg, kt: 15, gustKt: 22 }, aloft: { fromDeg: (w.wind.fromDeg + 15) % 360, kt: 25 }, turbulence: 'light' });
    fs.sim.setBaro(990);
    fs.skipToFinal();
  });
  await page.waitForTimeout(1500);
  a = await look();
  console.log('skip to final:', JSON.stringify(a));
  ok(a.baro.hpa === a.qnh, `skip to final sets the QNH too: ${a.baro.hpa}`);
  ok(Math.abs(a.drift) > 2 && Math.abs(angle(a.hdgFcu, a.rwyMag)) > 2, `and holds the crab: drift ${a.drift.toFixed(1)}°, FCU ${a.hdgFcu}°`);

  // ---- 3. A landing by the test pilot in 15 kt gusting 22, straight across ----
  await page.evaluate(() => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
    window.__e2e.phase = 'approach';
  });
  let score = null;
  for (let i = 0; i < 300 && !score; i++) {
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({ crashed: window.__fs.sim.state.crashed || null, score: window.__fsLastScore || null, t: window.__fs.sim.state.t }));
    if (st.crashed) { ok(false, `crashed: ${JSON.stringify(st.crashed)}`); break; }
    score = st.score;
  }
  if (score) {
    const w = score.touchdown?.wind;
    console.log('landed:', score.grade, score.points, JSON.stringify(w));
    ok(w && Math.abs(w.kt - 15) < 0.5 && w.gustKt === 22, `the card's wind is the tower's: ${w && w.kt.toFixed(1)} kt, gusts ${w && w.gustKt}`);
    ok(w && w.cross > 14 && w.side === 'R', `a crosswind from the right: ${w && w.cross.toFixed(1)} kt ${w && w.side}`);
    await page.waitForTimeout(500);
    const card = await page.evaluate(() => document.getElementById('score')?.innerText?.replace(/\n+/g, ' | ') || '');
    const line = (card.match(/Wind [^|]*/) || [''])[0].trim();
    ok(/^Wind \d{3}° at 15 kt, gusting 22 · 15 kt crosswind from the right/.test(line), `the card says it: "${line}"`);
    const logged = await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('gamedump:flight-sim:logbook') || '[]'); return (Array.isArray(l) ? l : l.flights || []).at(-1)?.wind || null; });
    ok(logged && Math.round(logged.kt) === 15 && logged.gustKt === 22, `the logbook keeps it: ${JSON.stringify(logged)}`);
    if (out) {
      await page.evaluate(() => { window.__fs.renderer.render = window.__realRender; window.__fs.setPaused(true, true); });
      try { await snap(page, browser, `${out}/v040-review-xwind-card.png`, BASE, viewport); console.log('shot v040-review-xwind-card'); }
      catch (e) { console.log('no picture of the card (the capture failed):', String(e).split('\n')[0]); }
      await page.evaluate(() => { window.__fs.renderer.render = () => {}; });
    }
  } else ok(false, 'no landing score');

  // ---- 4. The same final in calm air: as v0.3.2 ----
  await page.evaluate(() => { window.__e2e.phase = 'off'; window.__fsLastScore = null; const fs = window.__fs; fs.startFlight({ ...fs.plan, start: 'final', weather: 'clear' }); });
  a = await look();
  console.log('calm start:', JSON.stringify(a));
  ok(a.preset === 'clear' && a.baro.hpa === 1013.25 && !a.baro.std, `calm: the altimeter at 1013.25: ${a.baro.hpa}`);
  ok(a.drift === 0 && Math.abs(angle(a.hdgFcu, a.rwyMag)) <= 0.5, `calm: no drift, the FCU at the runway's heading: ${a.hdgFcu}° (${a.rwyMag.toFixed(1)}°)`);
  ok(a.altIndFt === a.trueFt && Math.abs(a.altFtFcu - Math.round(a.trueFt / 100) * 100) < 1, `calm: the altimeter is the true altitude, the ALT its round hundred: ${a.altFtFcu}`);

  ok(errors.length === 0, errors.length ? `console errors: ${errors.slice(0, 3).join(' / ')}` : 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
