// v0.5.3 (the run's extra time): a design with its own airframe at the gate in the real game, in Chrome on the
// Mac's GPU (1440×900): a long-winged (span 1.3), stretched (+6/+2) design of each type starts at the first stand
// New scenario offers it at Gimpo, with its own nose on the stop mark, the parked traffic clear of its own wings,
// and is pushed back onto the taxi lines. Pictures from above, parked and after the pushback.
//   python3 tools/cpu-guard.py --minutes 10 -- node tests/browser-stands-airframe.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async (base) => {
    const f = window.__fs;
    f.clock.set(Date.UTC(2026, 9, 31, 6, 0)); f.clock.setRunning(false);
    const D = await import('./src/sim/designs.js'), G = await import('./src/ground/gate-flow.js');
    const af = D.defaultAirframe(base);
    const d = D.normalizeDesign({ ...D.newDesign(base, { id: `chk-gate-${base}`, name: `Gate ${base}` }),
      airframe: { ...af, plugFwd: 6, plugAft: 2, wingL: { ...af.wingL, span: 1.3 }, wingR: { ...af.wingR, span: 1.3 } } });
    const def = D.designDef(d);
    const ap = f.airports ? f.airports.find((a) => a.icao === 'RKSS') : null;
    const mine = G.standList(ap, def), theirs = G.standList(ap, D.designDef(D.newDesign(base, { id: `chk-base-${base}` })));
    const stand = mine.find((s) => s.gate) || mine[0];
    f.startFlight({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'gate', stand: stand.ref, pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 15000, waypoints: [], type: base, design: d }, { keepClock: true });
    const s = f.sim.state, S = def.geo.DESIGN_SHAPE, st = f.gate.stand;
    const nose = [s.pos.x + Math.sin(s.hdg) * S.noseX, s.pos.y + Math.cos(s.hdg) * S.noseX];
    return { n: mine.length, nBase: theirs.length, ref: stand.ref, at: st?.ref, off: Math.hypot(nose[0] - st.x, nose[1] - st.y), span: S.spanM, phase: f.gate.phase, hasAp: !!ap };
  }, base);
  check(`${base}: New scenario's stands for it at Gimpo`, r.hasAp && r.n >= 1 && r.n <= r.nBase, `${r.n} (its base's ${r.nBase}), span ${r.span?.toFixed(1)} m`);
  check(`${base}: parked at ${r.ref}, its own nose on the stop mark`, r.at === r.ref && r.off < 0.05, `${r.off?.toFixed(3)} m, ${r.phase}`);
  await page.waitForTimeout(1500);
  const look = () => page.evaluate(() => { const f = window.__fs; f.rig.viewId = 'orbit'; Object.assign(f.rig.looks.orbit, { yaw: 0.6, pitch: 1.2, dist: f.sim.type.orbitDist * 2.2 }); });
  await look(); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `v053-gate-${base}-parked.png`) });
  const pb = await page.evaluate(async () => {
    const f = window.__fs;
    f.gate.onKey('pushback');
    await new Promise((r) => setTimeout(r, 300));
    f.setTimeScale(4);   // the tug's 4×, as browser-boeing-flight.mjs
    await new Promise((r) => setTimeout(r, 3000));
    const gs = f.sim.state.gs;
    const t0 = performance.now();
    while (f.gate.phase === 'pushback' && !f.sim.state.crashed && performance.now() - t0 < 200000) await new Promise((r) => setTimeout(r, 500));
    f.setTimeScale(1);
    return { phase: f.gate.phase, crashed: !!f.sim.state.crashed, movingGs: +gs.toFixed(2), s: Math.round((performance.now() - t0) / 1000) };
  });
  check(`${base}: pushed back onto the taxi lines`, pb.phase === 'taxi' && !pb.crashed, JSON.stringify(pb));
  await look(); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `v053-gate-${base}-pushed.png`) });
  check(`${base}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
