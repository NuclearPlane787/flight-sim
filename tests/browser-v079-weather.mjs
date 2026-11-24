// v0.7.9, part 9: weather by place's second half, in Chrome (headless, muted). A flight from a clear departure toward
// a thunderstorm (Heathrow to Frankfurt by default; `--pair rkss-rjtt` for Gimpo to Haneda), the aircraft put on the
// route at cruise height, paused, looking along it from the nose:
//   1. in the departure's third and at the blend's edge: the destination's cloud ahead (before v0.7.9, and with
//      `--q "&wxahead79=0"`, a clear sky to the horizon);
//   2. a front set moving toward the departure (30 kt, the Weather tab's own button), the sim's clock put on by two
//      hours: the storm has come to the same place;
//   3. the Weather tab with the front's row.
// Each step prints the weight at the aircraft, the clouds' draws and the haze. Pictures:
// "Claude outputs/flight-sim/v079-wx-<tag>-<pair>-<what>.png". The last line printed: "done N of M".
//   /tmp/flight-sim/v079/gk.sh br 6 wx/b.txt '^done ' node games/flight-sim/tests/browser-v079-weather.mjs --tag b
import { chromium } from './pw.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const GAME = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/'), TAG = opt('--tag', 'b'), Q = opt('--q', ''), PAIR = opt('--pair', 'egll-eddf');
const P = { 'egll-eddf': { region: 'europe', origin: 'EGLL', dep: '27R', dest: 'EDDF', arr: '25L', hour: 12 },
  'rkss-rjtt': { region: 'east-asia', origin: 'RKSS', dep: '14R', dest: 'RJTT', arr: '34L', hour: 3 } }[PAIR];
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
try {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${GAME}?test&region=${P.region}&origin=${P.origin}&dep=${P.dep}&dest=${P.dest}&arr=${P.arr}&start=runway&view=nose${Q}`);
  await page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout: 120000 });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `v079-wx-${TAG}-${PAIR}-${n}.png`) });
  await page.evaluate((P) => {
    const f = window.__fs;
    const end = (icao, use) => f.airports.find((q) => q.icao === icao).runways.flatMap((r) => r.ends).filter((e) => e.use !== use && e.use !== 'closed' && e.use !== 'standby')[0].ident;
    f.startFlight({ origin: P.origin, depRunway: end(P.origin, 'landing'), dest: P.dest, arrRunway: end(P.dest, 'takeoff'), start: 'final', stand: null, pax: 180, cargoKg: 2000, fuelKg: 9000, waypoints: [],
      weather: 'clear', weatherDest: 'thunderstorm' });
    f.clock.set(Date.UTC(2026, 10, 19, P.hour, 0, 0));
    f.rig.viewId = 'nose';
  }, P);
  await page.waitForTimeout(2500);
  // The aircraft at a fraction of the route, level at zM, heading along it, the sim's clock put on by dT seconds; paused and drawn.
  // --fps: the frame rate over 4 s at a place (run alone, on mains: the lead's frame-rate checks)
  const FPS = process.argv.includes('--fps');
  const fps = async (name) => {
    if (!FPS) return;
    const r = await page.evaluate(() => new Promise((res) => {
      const ts = []; const t0 = performance.now();
      const tick = (t) => { ts.push(t); if (t - t0 < 4000) requestAnimationFrame(tick); else { const d = ts.slice(1).map((v, i) => v - ts[i]); res({ fps: (ts.length - 1) * 1000 / (ts[ts.length - 1] - ts[0]), worst: Math.max(...d), calls: window.__fs.renderer.info.render.calls, tris: window.__fs.renderer.info.render.triangles }); } };
      requestAnimationFrame(tick);
    }));
    console.log(`fps ${name}: ${r.fps.toFixed(1)} fps (worst ${r.worst.toFixed(1)} ms), ${r.calls} calls, ${(r.tris / 1000).toFixed(0)}k tris`);
  };
  const put = async (frac, zM, dT = 0) => page.evaluate(async ({ frac, zM, dT }) => {
    const f = window.__fs, sim = f.sim, W = await import('./src/sim/weather.js'), e = sim.weather.ends, snap = sim.snapshot(), c = snap.core;
    const dx = e.bx - e.ax, dy = e.by - e.ay, psi = Math.atan2(dx, dy), V = 230;
    c.px = e.ax + frac * dx; c.py = e.ay + frac * dy; c.pz = zM;
    c.q0 = Math.cos(psi / 2); c.q1 = 0; c.q2 = 0; c.q3 = Math.sin(psi / 2);
    c.vn = V * Math.cos(psi); c.ve = V * Math.sin(psi); c.vd = 0; c.p = 0; c.q = 0; c.r = 0;
    c.t += dT;
    f.setPaused(true);
    sim.restore(snap, { keepWeather: true });
    for (let i = 0; i < 6; i++) { f.renderOnce(); await new Promise((r) => requestAnimationFrame(() => r())); }
    await new Promise((r) => setTimeout(r, 2500));   // the terrain's tiles for the new place
    for (let i = 0; i < 4; i++) { f.renderOnce(); await new Promise((r) => requestAnimationFrame(() => r())); }
    let draws = 0; f.scene?.traverse?.((o) => { if (o.isMesh && o.visible && /^cloud-(base|top)$/.test(o.name)) draws++; });
    const st = { drawCalls: draws };
    return { w: W.blendWeight(e, c.px, c.py, sim.state.t), t: sim.state.t, front: W.frontKtOf(sim.weather), layers: st.layers, draws: st.drawCalls, fog: st.fog,
      routeLen: Math.hypot(dx, dy) / 1000, z: sim.state.pos.z };
  }, { frac, zM, dT });
  const hud = (on) => page.evaluate((on) => { for (const id of ['hud', 'map-root']) { const el = document.getElementById(id); if (el) el.style.visibility = on ? '' : 'hidden'; } }, on);
  await hud(false);

  const a = await put(0.2, 10000);
  await shot('1-departure-third-fl330');
  console.log(`1 departure's third: ${JSON.stringify(a)}`);
  check('in the departure\'s third the aircraft is in the departure\'s air', a.w === 0, `w ${a.w}`);
  check(Q.includes('wxahead79=0') ? 'switched off: no cloud is drawn there' : 'the destination\'s layers are drawn from there', Q.includes('wxahead79=0') ? !(a.draws > 0) : a.draws >= 1, `draws ${a.draws}, layers ${a.layers}`);
  const b = await put(0.32, 10000);
  await shot('2-blend-edge-fl330');
  await fps('at the blend\'s edge, FL330');
  console.log(`2 the blend's edge: ${JSON.stringify(b)}`);
  const c = await put(0.2, 3000);
  await shot('3-departure-third-10000ft');
  console.log(`3 departure's third, 10,000 ft: ${JSON.stringify(c)}`);
  const m = await put(0.5, 3000);
  await shot('3b-middle-10000ft');
  await fps('in the storm\'s blend at 10,000 ft');
  console.log(`3b the middle of the blend, 10,000 ft: ${JSON.stringify(m)}`);
  check('in the middle of the blend the weight is a half', Math.abs(m.w - 0.5) < 0.02, `w ${m.w}`);
  const n = await put(0.45, 10000);
  await shot('3c-toward-the-storm-fl330');
  await fps('toward the storm from FL330');
  console.log(`3c toward the storm from FL330: ${JSON.stringify(n)}`);

  // The front, as the Weather tab's "To departure" sets it; then two hours later at the same place.
  await hud(true);
  await page.evaluate(() => { window.__fs.setPaused(false); window.__fs.showLTab('weather'); });
  await page.waitForTimeout(500);
  const row = await page.evaluate(() => { const el = window.__fs.weatherWin.el, r = el.querySelector('[data-o="frontRow"]'); return { hidden: r.hidden, buttons: [...r.querySelectorAll('button')].map((x) => x.textContent) }; });
  check('the Weather tab shows the front\'s row with two ends', !row.hidden && row.buttons.length === 3, JSON.stringify(row));
  await page.click('.fswx [data-seg="front"] button[data-v="30"]');
  await page.waitForTimeout(400);
  const set = await page.evaluate(async () => { const W = await import('./src/sim/weather.js'); const el = window.__fs.weatherWin.el; return { kt: W.frontKtOf(window.__fs.sim.weather), note: el.querySelector('[data-o="frontNote"]').textContent, on: el.querySelector('[data-seg="front"] button.on')?.textContent }; });
  check('"To departure" sets a front of 30 kt on the flight\'s weather', set.kt === 30 && set.on === 'To departure', JSON.stringify(set));
  await shot('4-weather-tab-front');
  await page.evaluate(() => window.__fs.weatherWin.close());
  await hud(false);
  const d0 = await put(0.2, 3000);
  const d = await put(0.2, 3000, 7200);
  await shot('5-front-two-hours-on-10000ft');
  console.log(`5 the same place two hours on: ${JSON.stringify(d)}`);
  check('with the front, two hours on the same place is in the blend or the storm', d0.w === 0 && d.w > 0, `w ${d0.w} -> ${d.w} (the front has come ${(30 * 0.514444 * 7200 / 1000).toFixed(0)} km of the route's ${d.routeLen.toFixed(0)})`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('the run', false, String(e).slice(0, 300));
} finally {
  await ctx.close(); await browser.close();
}
console.log(`done ${results.filter(Boolean).length} of ${results.length}`);
