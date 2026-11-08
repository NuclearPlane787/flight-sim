// v0.2.1's checks in headless Chromium, through the real game loop (main.js), in the cloud
// container: the view switch (its place, clicks, 1 2 3; since v0.3.1 Cockpit in a seat swaps
// to the other seat again, as before v0.2.2, and V steps through all four), a waypoint dragged
// onto the magenta line, Change route on the map (to RKSI 33L, and a click on Jeju), then skip
// to final at the new destination and a landing there by tests/e2e-controller.js, the logbook,
// and Change route refused after landing. Pictures go to outDir as v021-*.png.
//   node route-views.cjs [outDir]          (about 15 minutes with SwiftShader; FS_BASE as in stills.cjs)
// The frame clock is faked (each frame is 0.1 s of sim) and nothing is drawn except for the
// pictures, which are taken with the game paused quietly (captures hang while it runs).
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const out = process.argv[2] || 'v021';
require('fs').mkdirSync(out, { recursive: true });
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
  await page.waitForTimeout(600);
  // Paused quietly while the picture is taken: with the frames running, the capture hangs.
  const shot = async (name) => {
    await page.evaluate(() => { window.__fs.setPaused(true, true); window.__fs.renderer.render = window.__realRender; });
    await page.waitForTimeout(300);
    await snap(page, browser, `${out}/${name}.png`, BASE, viewport);
    await page.evaluate(() => { window.__fs.renderer.render = () => {}; window.__fs.setPaused(false); });
    await page.waitForTimeout(300);
    console.log('shot', name);
  };

  // ---- The view switch ----
  const sw = await page.evaluate(() => {
    const v = document.querySelector('.fsui-views'), f = document.querySelector('.fsui-fcu');
    if (!v) return null;
    const r = v.getBoundingClientRect(), fr = f.getBoundingClientRect();
    return { labels: [...v.querySelectorAll('button')].map((b) => b.textContent), left: r.left, right: r.right, top: r.top, h: r.height, fcuRight: fr.right, fcuTop: fr.top, fcuH: fr.height, cls: v.className };
  });
  ok(sw && sw.labels.length === 3, `the switch: ${JSON.stringify(sw && sw.labels)}`);
  ok(sw && sw.left > sw.fcuRight && Math.abs(sw.top - sw.fcuTop) < 1 && Math.abs(sw.h - sw.fcuH) < 1 && viewport.width - sw.right < 20,
    `top right, level with the FCU and clear of it (${sw && Math.round(sw.left)} > ${sw && Math.round(sw.fcuRight)}), class "${sw && sw.cls}"`);
  const vid = () => page.evaluate(() => ({ id: window.__fs.rig.view.id, on: document.querySelector('.fsui-views .on')?.dataset.v, seat: document.querySelector('.fsui-views [data-v="cockpit"] .fsui-seat').textContent }));
  const steps = [];
  for (const [how, what] of [['click', 'nose'], ['click', 'cockpit'], ['click', 'cockpit'], ['click', 'orbit'], ['key', '1'], ['key', '1'], ['key', '2'], ['key', '3'], ['key', 'v'], ['key', 'v'], ['key', '1'], ['click', 'cockpit']]) {
    if (how === 'click') await page.click(`.fsui-views [data-v="${what}"]`); else await page.keyboard.press(what);
    await page.waitForTimeout(250);
    const v = await vid();
    steps.push(`${how === 'click' ? what : 'key ' + what} → ${v.id}${v.seat ? ' (' + v.seat + ')' : ''} [on: ${v.on}]`);
  }
  console.log('  ' + steps.join('\n  '));
  ok(steps.join('|') === [
    'nose → nose [on: nose]', 'cockpit → captain (CPT) [on: cockpit]', 'cockpit → fo (F/O) [on: cockpit]', 'orbit → orbit [on: orbit]',
    'key 1 → captain (CPT) [on: cockpit]', 'key 1 → fo (F/O) [on: cockpit]', 'key 2 → nose [on: nose]', 'key 3 → orbit [on: orbit]',
    'key v → captain (CPT) [on: cockpit]', 'key v → fo (F/O) [on: cockpit]', 'key 1 → captain (CPT) [on: cockpit]', 'cockpit → fo (F/O) [on: cockpit]',
  ].join('|'), 'clicks and keys pick the views; Cockpit (or 1) in a seat swaps seats (v0.3.1); V steps through all four; the lit button follows');
  // In the first officer's seat (from the last click).
  await shot('v021-view-switch-cockpit');
  await page.click('.fsui-views [data-v="orbit"]');
  await page.waitForTimeout(250);
  await shot('v021-view-switch-orbit');

  // ---- The map: a waypoint dragged onto the magenta line shows and counts ----
  await page.keyboard.press('m');
  await page.waitForTimeout(800);
  const info0 = await page.evaluate(() => document.querySelector('.fsui-map-info').textContent);
  const mid = await page.evaluate(() => { const fs = window.__fs, s = fs.sim.state, d = fs.dest.end; return fs.map._devScreen((s.pos.x * 0.3 + d.x * 0.7), (s.pos.y * 0.3 + d.y * 0.7)); });
  // Drag from 70% of the way along the line.
  await page.mouse.move(mid[0], mid[1]); await page.mouse.down();
  await page.mouse.move(mid[0] + 40, mid[1] - 20, { steps: 4 }); await page.mouse.move(mid[0] + 140, mid[1] - 60, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const info1 = await page.evaluate(() => document.querySelector('.fsui-map-info').textContent);
  const nm = (t) => Number((t.match(/:\s*(\d+)\s*nm/) || [])[1]);
  const wp1 = await page.evaluate(() => window.__fs.map.waypoints.length);
  ok(wp1 === 1 && nm(info1) > nm(info0), `a dragged waypoint counts: ${wp1} waypoint, ${nm(info0)} → ${nm(info1)} nm ("${info1.slice(0, 40)}")`);
  await shot('v021-map-waypoint');

  // ---- Change route ----
  await page.click('.fsui-map-bar [data-a="route"]');
  await page.waitForTimeout(400);
  const p0 = await page.evaluate(() => ({ open: window.__fs.map.routeOpen, apt: document.querySelector('.fsui-route [data-r="apt"] .on')?.dataset.icao, rwy: document.querySelector('.fsui-route [data-r="rwy"] .on')?.dataset.ident, note: document.querySelector('.fsui-route-note').textContent }));
  ok(p0.open && p0.apt === 'RKPC' && p0.rwy === '07', `Change route opens on the current destination: ${p0.apt} ${p0.rwy} ("${p0.note.slice(0, 90)}")`);
  await page.click('.fsui-route [data-icao="RKSI"]');
  await page.waitForTimeout(300);
  const p1 = await page.evaluate(() => ({ rwys: [...document.querySelectorAll('.fsui-route [data-r="rwy"] button')].map((b) => b.dataset.ident), on: document.querySelector('.fsui-route [data-r="rwy"] .on')?.dataset.ident, note: document.querySelector('.fsui-route-note').textContent }));
  ok(p1.rwys.length >= 6 && p1.rwys.includes(p1.on), `RKSI's runways ${p1.rwys.join(' ')}, picked ${p1.on} (straight in from here)`);
  console.log('  note:', p1.note);
  await page.click('.fsui-route [data-ident="33L"]');
  await page.waitForTimeout(300);
  await shot('v021-map-change-route');
  await page.click('.fsui-route [data-a="rset"]');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ dest: window.__fs.plan.dest, arr: window.__fs.plan.arrRunway, end: window.__fs.dest.end.ident, wps: window.__fs.map.waypoints.length, open: window.__fs.map.routeOpen,
    toast: document.getElementById('toast').textContent, info: document.querySelector('.fsui-map-info').textContent, cap: window.__fs.captureState().plan }));
  ok(after.dest === 'RKSI' && after.arr === '33L' && after.end === '33L' && after.wps === 0 && !after.open, `Fly there: plan ${after.dest} ${after.arr}, dest ${after.end}, waypoints ${after.wps}, toast "${after.toast}"`);
  ok(after.cap.dest === 'RKSI' && after.cap.arrRunway === '33L' && after.cap.waypoints.length === 0, 'the scenario save carries the new route');
  ok(/RKSI 33L/.test(after.info), `the map's info: "${after.info.slice(0, 50)}"`);
  await shot('v021-map-new-route');
  // A click on Jeju's label offers it.
  // A click on an airport's label offers it, even with the lines passing over it (Jeju, where
  // the aircraft is), and Cancel leaves the route alone.
  for (const icao of ['RKPC', 'RKSS']) {
    const at = await page.evaluate((i) => window.__fs.map._devLabel(i), icao);
    await page.mouse.click(at[0], at[1]);
    await page.waitForTimeout(400);
    const p2 = await page.evaluate(() => ({ open: window.__fs.map.routeOpen, apt: document.querySelector('.fsui-route [data-r="apt"] .on')?.dataset.icao, rwy: document.querySelector('.fsui-route [data-r="rwy"] .on')?.dataset.ident }));
    ok(p2.open && p2.apt === icao, `a click on ${icao}'s label offers it (${JSON.stringify(p2)})`);
    if (p2.open) await page.click('.fsui-route [data-a="rcancel"]');
    await page.waitForTimeout(200);
  }
  const still = await page.evaluate(() => window.__fs.plan.dest);
  ok(still === 'RKSI', `Cancel leaves the route alone (${still})`);
  await page.keyboard.press('m');
  await page.waitForTimeout(400);
  await shot('v021-hud-new-route');

  // ---- Skip to final at the new destination, and land there ----
  await page.evaluate(() => window.__fs.skipToFinal());
  await page.waitForTimeout(1500);
  const fin = await page.evaluate(() => { const fs = window.__fs, s = fs.sim.state, a = fs.airports.find((x) => x.icao === 'RKSI'); return { nm: Math.hypot(s.pos.x - a.origin[0], s.pos.y - a.origin[1]) / 1852, dest: fs.dest.end.ident }; });
  ok(fin.nm < 20 && fin.dest === '33L', `skip to final puts it ${fin.nm.toFixed(1)} nm from RKSI, for ${fin.dest}`);
  await page.evaluate(() => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
    window.__e2e.phase = 'approach';
  });
  let score = null;
  for (let i = 0; i < 4000 && !score; i++) {
    await page.waitForTimeout(100);
    const st = await page.evaluate(() => ({ crashed: window.__fs.sim.state.crashed || null, score: window.__fsLastScore || null, t: Math.round(window.__fs.sim.state.t) }));
    if (st.crashed) { ok(false, 'crashed: ' + st.crashed); break; }
    score = st.score;
    if (i % 150 === 0) console.log(`  ${st.t} s`);
  }
  if (score) {
    const lb = await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('gamedump:flight-sim:logbook') || '[]'); return l[l.length - 1] || l[0]; });
    ok(true, `landed: ${score.grade} ${score.points}, parts ${score.parts.map((p) => p.name).join(', ')}`);
    ok(lb && lb.route === 'RKSS–RKSI' && lb.arrRunway === '33L', `the logbook: ${lb && lb.route} ${lb && lb.arrRunway}`);
    const r = await page.evaluate(() => window.__fs.changeRoute('RKPC', '07'));
    ok(r && r.ok === false, `after landing, Change route says: "${r && r.error}"`);
  }
  if (errors.length) { ok(false, 'console errors: ' + errors.slice(0, 4).join(' | ')); } else console.log('no console errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close();
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
