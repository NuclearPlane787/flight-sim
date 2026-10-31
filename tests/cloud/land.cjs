// A landing through the real game loop (main.js) in headless Chromium, flown by the test-only
// tests/e2e-controller.js from a 15 nm final, RKSS to <dest> <runway>. It prints the score's
// parts with their costs, the approach figures and the score card's text.
//   node land.cjs normal RKSI 33L                 the controller's own approach (B 89 in v0.1.3)
//   node land.cjs low RKSI 33L [150]              low: at about 150 ft 1 km out, then put back
//                                                 on its normal aim (C 65–73 in v0.1.3)
//   node land.cjs short RKSI 33L [150]            aimed 150 m short of the threshold: an
//                                                 undershoot onto the grass (v0.1.2's check)
//   ... [cardShot.png]                             a 5th argument: also a picture of the card
// The frame clock is faked (each frame is 0.1 s of sim) and nothing is drawn until the end,
// so a landing takes about 2 minutes in the container. FS_BASE as in stills.cjs.
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
(async () => {
  const [mode = 'normal', dest = 'RKSI', arr = '33L', p = '', shotPath = ''] = process.argv.slice(2);
  const tan3 = Math.tan(3 * Math.PI / 180);
  // How far back to move the controller's threshold (it aims 400 m past it).
  const back = mode === 'low' ? 1400 - ((Number(p) || 150) * 0.3048) / tan3 : mode === 'short' ? 400 + (Number(p) || 150) : 0;
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
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=${dest}&arr=${arr}&start=final`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 120000 });
  await page.evaluate(async (base) => {
    const fs = window.__fs;
    window.__realRender = fs.renderer.render.bind(fs.renderer);
    fs.renderer.render = () => {};
    (0, eval)(await (await fetch(base + 'tests/e2e-controller.js')).text());
  }, BASE);
  await page.evaluate(({ mode, back }) => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    const elev = d.end.elevM ?? d.airport.elevM;
    window.__realAxis = { ...ax, elev };
    window.__e2e.axis = back ? { ...ax, tx: ax.tx - ax.ux * back, ty: ax.ty - ax.uy * back, elev } : { ...ax, elev };
    window.__e2e.phase = 'approach';
    window.__switchAt = mode === 'low' ? 1000 : null;   // m before the threshold
  }, { mode, back });
  const t0 = Date.now();
  for (let i = 0; i < 4000; i++) {
    await page.waitForTimeout(100);
    const st = await page.evaluate(() => {
      const fs = window.__fs, s = fs.sim.state, ax = window.__realAxis;
      const along = (s.pos.x - ax.tx) * ax.ux + (s.pos.y - ax.ty) * ax.uy;
      if (window.__switchAt !== null && along >= -window.__switchAt && window.__e2e.axis !== ax) {
        window.__ftAtSwitch = Math.round((s.pos.z - ax.elev) * 3.28084);
        window.__e2e.axis = ax;                          // back on its normal aim
      }
      return { t: Math.round(s.t), along: Math.round(along), ft: Math.round((s.pos.z - ax.elev) * 3.28084), crashed: s.crashed || null, score: window.__fsLastScore || null };
    });
    if (i % 100 === 0) console.log(`${st.t}s, ${st.along} m from the threshold, ${st.ft} ft`);
    if (st.crashed) { console.log('CRASHED:', st.crashed); break; }
    if (st.score) {
      const sc = st.score;
      console.log('score', sc.grade, sc.points, 'cost', sc.cost);
      for (const q of sc.parts) console.log('  ', q.name.padEnd(26), String(q.value).padStart(6), (q.unit || '').padEnd(7), (q.note || '').padEnd(5), 'cost', Number(q.cost).toFixed(4), ' −' + q.penalty);
      console.log('approach', JSON.stringify(sc.approach));
      break;
    }
  }
  const sw = await page.evaluate(() => window.__ftAtSwitch);
  if (sw != null) console.log('height at the switch', sw, 'ft');
  console.log('wall', Math.round((Date.now() - t0) / 1000), 's');
  await page.evaluate(() => { window.__fs.renderer.render = window.__realRender; });
  console.log('card:', await page.evaluate(() => document.getElementById('score')?.innerText?.replace(/\n+/g, ' | ').slice(0, 600)));
  if (shotPath) {
    await page.evaluate(() => window.__fs.setPaused(true, true));
    await snap(page, browser, shotPath, BASE, viewport);
    console.log('shot', shotPath);
  }
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
