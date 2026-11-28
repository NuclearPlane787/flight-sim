// v0.8.0, part 5 in Chrome on this Mac's GPU: an engine fire after take-off from Heathrow on the A321, handled
// through its checklist (the lever to idle, ENG MASTER off, the fire handle, agent 1, agent 2 if it still burns), and
// an engine shut down and restarted in cruise on the 787-9 by its FUEL CONTROL switch on the EICAS. A picture at
// each step, in "Claude outputs/flight-sim/v080-eng-<case>-<n>-<what>.png".
//   node tests/browser-v080-engines.mjs [fire] [relight] [--size 1280x720]
// Through the run's lock and the guard (tools/check-step.sh). The last line printed: "done N of M".
// The steps are clicked where a player clicks them: the checklist's buttons ([data-step] with a [data-act]) and the
// switch on the engine display's canvas (alerts.switchPoint(i)); where a hook isn't there the step is done through
// the sim and the check says so (FAIL "clicked"), so the click path is never passed by a stand-in.
import { chromium } from './pw.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zoneMs, zoneOfIcao } from '../src/clock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const argv = process.argv.slice(2);
const si = argv.indexOf('--size'); const SIZE = si >= 0 ? argv.splice(si, 2)[1] : '1440x900';
const [W, H] = SIZE.split('x').map(Number);
const want = (p) => !argv.length || argv.includes(p);
const KT = 1.943844, FT = 3.28084;
let checks = 0, passed = 0;
const check = (name, ok, note = '') => { checks++; if (ok) passed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${note}`); };

const profile = mkdtempSync(path.join(tmpdir(), 'fs-v080-eng-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: W, height: H },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const tag = SIZE === '1440x900' ? '' : `-${SIZE}`;
const shot = async (name) => { const f = `v080-eng-${name}${tag}.png`; await page.screenshot({ path: path.join(OUT, f) }); console.log(`  picture ${f}`); };
const st = () => page.evaluate(() => {
  const f = window.__fs, s = f.sim.state;
  return { t: s.t, ias: s.ias, agl: s.agl, alt: s.pos.z, vs: s.vs, roll: s.roll, beta: s.beta, onGround: s.onGround, crashed: s.crashed, ts: f.timeScale,
    eng: s.engines.map((e) => ({ n1: e.n1, sw: e.sw, lit: e.lit, fire: e.fire, pushed: e.pushed, agents: e.agents, start: e.start, block: e.block, thrust: e.thrustN })),
    failures: s.failures.map((x) => x.kind + ':' + x.target), ap: f.ap.ap,
    lights: f.alerts ? [`warn:${!!f.alerts.lit.warning}`, `caut:${!!f.alerts.lit.caution}`] : [],
    steps: [...document.querySelectorAll('[data-step]')].map((b) => `${b.dataset.act || '-'}|${b.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)}`) };
});
const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  for (;;) {
    const s = await st();
    if (fn(s)) return s;
    if (s.crashed) throw new Error(`crashed while waiting for ${label}: ${s.crashed}`);
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s).slice(0, 600)}`);
    await page.waitForTimeout(200);
  }
};
// Click the checklist's step whose action is `act` (and whose words match `rx`); → true if a real click did it.
const clickStep = async (act, rx) => {
  const sel = await page.evaluate(([a, r]) => {
    const re = new RegExp(r, 'i');
    const els = [...document.querySelectorAll('[data-step]')].filter((b) => (!a || b.dataset.act === a) && re.test(b.textContent) && b.offsetParent !== null && !b.disabled);
    if (!els.length) return null;
    const b = els[0].getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, [act, rx]);
  if (!sel) return false;
  await page.mouse.click(sel.x, sel.y);
  await page.waitForTimeout(250);
  return true;
};
const clickSwitch = async (i) => {
  const p = await page.evaluate((k) => (window.__fs.alerts && window.__fs.alerts.switchPoint ? window.__fs.alerts.switchPoint(k) : null), i);
  if (!p) return false;
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
  return true;
};
// A fixed early afternoon at the airport (14:00 local), whatever time the check runs.
const afternoon = (icao) => page.evaluate((ms) => window.__fs.clock.set(ms), zoneMs(2026, 11, 19, 14, 0, 0, zoneOfIcao(icao)));
const armNow = (kind, target, when, seed) => page.evaluate(async ([k, tg, w, sd]) => {
  const F = await import(new URL('src/sim/failures.js', location.href).href), sim = window.__fs.sim;
  sim.setFailures(F.armed(sim.failures, { kind: k, target: tg, when: w }, sim.state.t, sd));
}, [kind, target, when, seed]);
const orbit = (yaw, pitch, dist) => page.evaluate(([y, p, d]) => { const f = window.__fs; f.selectView('orbit'); const L = f.rig.looks.orbit; L.yaw = y; L.pitch = p; L.dist = d; }, [yaw, pitch, dist]);

try {
  if (want('fire')) {
    // ---- an engine fire after lift-off from Heathrow's 27R, the A321 ----
    await page.goto(`${BASE}?test&region=europe&origin=EGLL&dep=27R&dest=EGLL&arr=27R&start=runway&type=a321neo&view=captain`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.frames > 60, null, { timeout: 90000 });
    await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
    await afternoon('EGLL');
    // A seed whose fire needs both bottles (failures.js's fireNeeds), so the 30 s step is exercised.
    const seed = await page.evaluate(async () => { const F = await import(new URL('src/sim/failures.js', location.href).href); for (let s = 1; s < 999; s++) if (F.fireNeeds(s) === 2) return s; });
    await armNow('eng-fire', 1, { type: 'moment', moment: 'liftoff' }, seed);
    await page.waitForTimeout(600);
    await shot('fire-0-armed-on-the-runway');
    const s0 = await st();
    check('nothing lit before the failure: both master lights out, no checklist', s0.lights.every((l) => /false$/.test(l)) && s0.steps.length === 0, `lights ${s0.lights.join(' ')}; steps ${s0.steps.length}`);
    check('the switches are on the engine display', await page.evaluate(() => !!(window.__fs.alerts && window.__fs.alerts.switchPoint && window.__fs.alerts.switchPoint(0))), '');
    await page.evaluate(() => {
      const f = window.__fs, ax = f.runwayAxis(f.runwayEnds('EGLL', '27R').end, f.runwayEnds('EGLL', '27R').other);
      window.__e2e.rwyHdg = ax.hdg; window.__e2e.rwyAxis = ax; window.__e2e.vr = 145; window.__e2e.phase = 'takeoff'; f.input.lever = 1;
    });
    const fired = await waitFor((s) => s.failures.length > 0, 90000, 'the fire after lift-off');
    check('the fire came after lift-off', !fired.onGround && fired.agl * FT > 50 && fired.eng[1].fire && fired.eng[1].lit, `at ${(fired.agl * FT).toFixed(0)} ft, ${(fired.ias * KT).toFixed(0)} kt, engine 2 burning and running (N1 ${fired.eng[1].n1.toFixed(0)})`);
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(1500);
    const s1 = await st();
    check('MASTER WARN is lit and the checklist is open', s1.lights.some((l) => /^warn.*true$/.test(l)) && s1.steps.length >= 4, `lights ${s1.lights.join(' ')}; steps: ${s1.steps.join(' / ')}`);
    await shot('fire-1-warning-and-checklist');
    // From here the test's own pilot flies the engine-out climb by hand, as a player must (the laws leave the yaw to the
    // feet): wings level, the nose for about 165 kt, the rudder against the sideslip.
    await page.evaluate(() => {
      const DEG = Math.PI / 180;
      window.__e2e.phase = 'idle';
      window.__fsController = (sim) => {
        const s = sim.state, c = sim.controls;
        const want = Math.max(5, Math.min(13, 10 + (s.ias * 1.943844 - 165) * 0.4));
        c.pitch = Math.max(-0.5, Math.min(0.5, (want - s.pitch / DEG) * 0.15 - s.q * 1.5));
        c.roll = Math.max(-1, Math.min(1, -s.roll / DEG * 0.08 - s.p * 0.8));
        c.yaw = Math.max(-1, Math.min(1, s.beta / DEG * 0.25 - s.r * 2));
      };
    });
    // The smoke, from behind on the burning engine's side, with the panels out of the way.
    const hide = () => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Hide|Show) panels$/.test(x.textContent.trim())); if (b) b.click(); });
    await hide();
    await orbit(-0.9, 0.16, 60); await page.waitForTimeout(1200); await shot('fire-2-smoke-from-engine-2');
    await orbit(0.5, 0.3, 45); await page.waitForTimeout(800); await shot('fire-2b-smoke-from-ahead');
    await hide();
    await page.evaluate(() => window.__fs.selectView('captain'));
    // The master light: a click cancels the light (the message and the checklist stay).
    const lp = await page.evaluate(() => { const b = document.querySelector('[data-alert="warn"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (lp) { await page.mouse.click(lp.x, lp.y); await page.waitForTimeout(300); }
    const s2 = await st();
    check('a click on MASTER WARN puts the light out, the checklist stays', !!lp && s2.lights.some((l) => /^warn.*false$/.test(l)) && s2.steps.length >= 4, `lights ${s2.lights.join(' ')}`);
    // Climb away on the live engine, then the checklist. The autopilot holds it while the hands are on the switches.
    await waitFor((s) => s.agl * FT > 1200, 90000, '1,200 ft');
    // 1. The burning engine's lever to idle (a flying step: it ticks itself).
    await page.evaluate(() => { const f = window.__fs; f.sim.controls.thrustEng = [f.sim.controls.thrust, 0]; });   // (input.js takes the levers as it finds them)
    await page.waitForTimeout(700);
    await shot('fire-3-lever-idle');
    // 2. ENG MASTER 2 OFF, 3. the fire handle, 4. agent 1: each clicked on the checklist.
    const c2 = await clickStep('engineSwitch', 'MASTER'); if (!c2) await page.evaluate(() => window.__fs.sim.engineSwitch(1, false));
    let s = await st();
    check('ENG MASTER 2 OFF, clicked on the checklist', c2 && !s.eng[1].sw && !s.eng[1].lit, `clicked ${c2}; switch ${s.eng[1].sw}, lit ${s.eng[1].lit}`);
    await shot('fire-4-master-off');
    const c3 = await clickStep('firePush', 'FIRE'); if (!c3) await page.evaluate(() => window.__fs.sim.firePush(1));
    s = await st();
    check('the fire handle, clicked', c3 && s.eng[1].pushed, `clicked ${c3}; pushed ${s.eng[1].pushed}`);
    const c4 = await clickStep('fireAgent', 'AGENT ?1'); if (!c4) await page.evaluate(() => window.__fs.sim.fireAgent(1));
    s = await st();
    check('AGENT 1, clicked', c4 && s.eng[1].agents === 1, `clicked ${c4}; bottles ${s.eng[1].agents}`);
    await shot('fire-5-agent-1');
    // 5. Still burning after 30 s (this seed needs both): agent 2.
    const tA = s.t;
    await waitFor((x) => x.t - tA > 31, 60000, '30 s after agent 1');
    s = await st();
    check('still burning 30 s after the first bottle (this fire needs both)', s.eng[1].fire, `fire ${s.eng[1].fire}`);
    await shot('fire-6-still-burning-after-30s');
    const c5 = await clickStep('fireAgent', 'AGENT ?2'); if (!c5) await page.evaluate(() => window.__fs.sim.fireAgent(1));
    s = await st();
    check('AGENT 2, clicked', c5 && s.eng[1].agents === 2, `clicked ${c5}; bottles ${s.eng[1].agents}`);
    const out = await waitFor((x) => !x.eng[1].fire, 30000, 'the fire out');
    check('the fire is out, the aircraft climbing on one engine with its wings level', !out.crashed && out.eng[0].lit && out.eng[0].thrust > 0 && out.eng[1].thrust <= 0 && out.vs > 0 && Math.abs(out.roll) < 0.12 && out.agl * FT > 1500,
      `${(out.agl * FT).toFixed(0)} ft above the ground, ${(out.ias * KT).toFixed(0)} kt, ${(out.vs * 196.85).toFixed(0)} ft/min, bank ${(out.roll * 57.3).toFixed(1)}°, engine 1 N1 ${out.eng[0].n1.toFixed(0)}, engine 2 N1 ${out.eng[1].n1.toFixed(0)}`);
    await page.waitForTimeout(800);
    await shot('fire-7-out-on-one-engine');
    await hide(); await orbit(-0.9, 0.16, 60); await page.waitForTimeout(1000); await shot('fire-8-no-more-smoke'); await hide();
  }
  if (want('relight')) {
    // ---- an engine shut down and restarted in cruise, the 787-9 ----
    await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&type=b787-9&view=captain`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.frames > 60, null, { timeout: 90000 });
    await afternoon('RKSS');
    // Put it in cruise at FL250 and 290 kt (inside the start envelope, fast enough to windmill), autopilot on.
    await page.evaluate(() => {
      const f = window.__fs, s = f.sim.state, D = f.sim.type.data;
      f.sim.reset({ x: s.pos.x, y: s.pos.y, hdg: s.hdg, onGround: false, z: 25000 * 0.3048, iasMs: 290 * 0.514444, flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 20000,
        ap: { ap: true, athr: true, hdgDeg: s.hdg * 180 / Math.PI, altFt: 25000 } });
      f.ap.setSpd?.(290); f.input.lever = f.sim.controls.thrust;
    });
    await page.waitForTimeout(4000);
    let s = await st();
    check('in cruise at FL250 on the autopilot, both engines running', s.ap && s.eng.every((e) => e.lit && e.sw) && Math.abs(s.alt * FT - 25000) < 300, `${(s.alt * FT).toFixed(0)} ft, ${(s.ias * KT).toFixed(0)} kt`);
    await shot('relight-0-cruise');
    const k1 = await clickSwitch(1); if (!k1) await page.evaluate(() => window.__fs.sim.engineSwitch(1, false));
    s = await st();
    check('FUEL CONTROL 2 to CUTOFF, clicked on the EICAS', k1 && !s.eng[1].sw && !s.eng[1].lit, `clicked ${k1}; switch ${s.eng[1].sw}`);
    await waitFor((x) => x.eng[1].n1 < 30, 60000, 'engine 2 running down');
    s = await st();
    check('engine 2 windmills, the caution is up and its checklist open', s.eng[1].thrust < 0 && s.lights.some((l) => /^caut.*true$/.test(l)) && s.steps.length > 0, `N1 ${s.eng[1].n1.toFixed(0)}, thrust ${s.eng[1].thrust.toFixed(0)} N; lights ${s.lights.join(' ')}; steps: ${s.steps.join(' / ')}`);
    await shot('relight-1-shut-down');
    const k2 = await clickSwitch(1); if (!k2) await page.evaluate(() => window.__fs.sim.engineSwitch(1, true));
    await page.waitForTimeout(6000);
    s = await st();
    check('FUEL CONTROL 2 to RUN, clicked: the start is running', k2 && s.eng[1].sw && s.eng[1].start > 2 && s.eng[1].block === '', `clicked ${k2}; start ${s.eng[1].start.toFixed(1)} s, block "${s.eng[1].block}"`);
    await shot('relight-2-starting');
    const lit = await waitFor((x) => x.eng[1].lit, 90000, 'engine 2 lit');
    check('engine 2 lights within the minute', lit.eng[1].lit, `at t ${lit.t.toFixed(0)} s`);
    await page.waitForTimeout(15000);
    s = await st();
    check('both engines running again, the lights out and the checklist gone', s.eng.every((e) => e.lit) && Math.abs(s.eng[0].n1 - s.eng[1].n1) < 6 && s.steps.length === 0, `N1 ${s.eng.map((e) => e.n1.toFixed(0)).join(' / ')}; lights ${s.lights.join(' ')}; steps ${s.steps.length}`);
    await shot('relight-3-running-again');
    // Above the envelope the switch doesn't light it, and the display says why.
    await page.evaluate(() => {
      const f = window.__fs, st0 = f.sim.state;
      f.sim.reset({ x: st0.pos.x, y: st0.pos.y, hdg: st0.hdg, onGround: false, z: 38000 * 0.3048, iasMs: 250 * 0.514444, flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 20000,
        ap: { ap: true, athr: true, hdgDeg: st0.hdg * 180 / Math.PI, altFt: 38000 } });
      f.sim.engineSwitch(0, false);
    });
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.__fs.sim.engineSwitch(0, true));
    await page.waitForTimeout(8000);
    s = await st();
    check('at FL380 the engine doesn\'t light, with the reason', !s.eng[0].lit && s.eng[0].block === 'altitude' && s.eng[0].start === 0, `block "${s.eng[0].block}"; steps: ${s.steps.join(' / ')}`);
    await shot('relight-4-above-the-envelope');
  }
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) {
  check('the script ran to its end', false, String(e).slice(0, 700));
  try { await shot('error'); } catch (e2) { /* the page is gone */ }
} finally {
  await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 8000))]);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ }
}
console.log(`done ${passed} of ${checks}`);
process.exit(0);
