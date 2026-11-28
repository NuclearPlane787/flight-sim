// v0.8.0, parts 3 and 4 in Chrome on a Boeing: every kind of failure armed through the Failures tab's own form on the
// 777-300ER standing on Gimpo's 14R, seen in the sim, on the screens (the master light and the alert's title) and in
// the tab's Active list, then repaired from the list; then each way of arming seen to fire by itself: after a time,
// at random within a window, and at a moment (the take-off roll above 100 kt).
//   node tests/browser-v080-kinds.mjs [--type b777-300er] [--size 1440x900]
// Pictures "Claude outputs/flight-sim/v080-kinds-<type>-<what>.png". The last line printed: "done N of M".
import { chromium } from './pw.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zoneMs, zoneOfIcao } from '../src/clock.js';
import { KINDS, describe } from '../src/sim/failures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const BASE = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/'), TYPE = opt('--type', 'b777-300er');
const [W, H] = opt('--size', '1440x900').split('x').map(Number);
const F = '.fssw.fsfw', KT = 1.943844;
let pass = 0, total = 0;
const check = (ok, what) => { total++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + what); };

const profile = mkdtempSync(path.join(tmpdir(), 'fs-v080-kinds-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: W, height: H },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = (what) => page.screenshot({ path: path.join(OUT, `v080-kinds-${TYPE}-${what}.png`) }).then(() => console.log(`  picture v080-kinds-${TYPE}-${what}.png`));
  const st = () => page.evaluate(() => {
    const f = window.__fs, s = f.sim.state;
    return { t: s.t, ias: s.ias, onGround: s.onGround, crashed: s.crashed, fails: s.failures.map((a) => ({ ...a })), plan: f.sim.failures ? f.sim.failures.items.length : 0,
      alerts: (f.alerts.list || []).map((a) => `${a.level}:${a.title}`), lit: JSON.stringify(f.alerts.lit),
      eng: s.engines.map((e) => ({ lit: e.lit, sw: e.sw, fire: e.fire, flags: e.flags })), legs: s.gearLegs.slice(), legFlags: s.gearLegFlags.slice(), sys: s.gearSys,
      lists: document.querySelector('.fssw.fsfw [data-o="lists"]')?.textContent || '' };
  });
  const click = (sel) => page.click(`${F} ${sel}`);
  const form = async (kind, target) => {
    const K = KINDS[kind];
    await click(`[data-seg="system"] [data-v="${K.system}"]`);
    await page.selectOption(`${F} [data-sel="kind"]`, kind);
    if (K.target === 'engine') await click(`[data-eng="${target}"]`);
    if (K.target === 'leg') await click(`[data-seg="leg"] [data-v="${target}"]`);
  };
  const waitFor = async (fn, ms, label) => {
    const t0 = Date.now();
    for (;;) { const s = await st(); if (fn(s)) return s; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s).slice(0, 500)}`); await page.waitForTimeout(150); }
  };

  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&type=${TYPE}&view=captain`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.alerts && window.__fs.frames > 60, null, { timeout: 90000 });
  await page.evaluate((ms) => { window.__fs.clock.set(ms); window.__fs.sim.controls.parkingBrake = true; }, zoneMs(2026, 11, 19, 14, 0, 0, zoneOfIcao('RKSS')));
  await page.evaluate(() => window.__fs.showLTab('failures')); await page.waitForTimeout(400);
  check(await page.isVisible(F), 'the Failures tab is open on the ' + TYPE);

  // ---- every kind, Now, through the form; seen; repaired from the Active list ----
  const cases = [['eng-flameout', 0], ['eng-seize', 1], ['eng-fire', 1], ['gear-noext', 0], ['gear-nograv', 0], ['gear-nolock', 2], ['gear-collapse', 1]];
  await click('[data-seg="when"] [data-v="now"]');
  for (const [kind, target] of cases) {
    await form(kind, target);
    await click('[data-a="arm"]');
    const s = await waitFor((x) => x.fails.some((a) => a.kind === kind), 5000, kind);
    const words = describe({ kind, target });
    const e = s.eng[target] || {};
    const seen = kind === 'eng-flameout' ? !e.lit && (e.flags & 1) : kind === 'eng-seize' ? !e.lit && (e.flags & 2) : kind === 'eng-fire' ? e.fire && e.lit
      : kind === 'gear-noext' ? (s.sys & 1) : kind === 'gear-nograv' ? (s.sys & 2) : kind === 'gear-nolock' ? (s.legFlags[target] & 1) : (s.legFlags[target] & 2);
    check(!!seen && s.lists.includes(words), `${kind}: failed in the sim and listed as "${words}"; alerts: ${s.alerts.join(', ') || 'none (on the ground)'}; lights ${s.lit}`);
    if (kind === 'eng-fire') {
      await page.waitForTimeout(500);
      const a = await st();
      check(a.alerts.some((x) => /^warning:.*FIRE/.test(x)), `the fire's warning on the ${TYPE}: ${a.alerts.join(', ')}; lights ${a.lit}`);
      await shot('fire-on-the-runway');
    }
    await page.click(`${F} [data-a="repair"]`); await page.waitForTimeout(350);
    const r = await st();
    check(r.fails.length === 0 && r.plan === 0, `${kind}: repaired from the list (failed ${r.fails.length}, armed ${r.plan})`);
    // Engines back to running before the next one (an engine repaired with its switch on starts by itself: don't wait a minute, start anew).
    await page.evaluate(() => { const f = window.__fs; f.startFlight({ ...f.plan }, { keepClock: true }); f.sim.controls.parkingBrake = true; });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__fs.showLTab('failures')); await page.waitForTimeout(250);
    await click('[data-seg="when"] [data-v="now"]');
  }

  // ---- after a time: it fires by itself ----
  await click('[data-seg="when"] [data-v="after"]');
  await form('gear-nolock', 0);
  await page.fill(`${F} [data-f="min"]`, '0'); await page.fill(`${F} [data-f="sec"]`, '4');
  await click('[data-a="arm"]'); await page.waitForTimeout(300);
  let s = await st();
  check(s.plan === 1 && s.fails.length === 0 && /Nose gear/.test(s.lists), `armed for 4 s from now, not yet failed: ${s.lists.replace(/\s+/g, ' ').slice(0, 120)}`);
  const t0 = s.t;
  s = await waitFor((x) => x.fails.length === 1, 12000, 'the timed failure');
  check(Math.abs(s.fails[0].t - t0 - 4) < 1.2, `it fired by itself ${(s.fails[0].t - t0).toFixed(1)} s later`);
  await page.click(`${F} [data-a="repairAll"]`); await page.waitForTimeout(300);

  // ---- at random within a window (one minute, one kind ticked): it fires by itself, and nothing told which ----
  await page.waitForTimeout(3200);   // (the line "Failure: Nose gear…" of the timed one above has gone: the pictures reader took it for the random one's)
  await click('[data-seg="when"] [data-v="random"]');
  await page.fill(`${F} [data-f="win"]`, '1');
  // Leave only "normal extension fails" ticked.
  const ticks = await page.$$eval(`${F} [data-tick]`, (b) => b.map((x) => [x.dataset.tick, x.classList.contains('on')]));
  for (const [k, on] of ticks) if ((k === 'gear-noext') !== on) await click(`[data-tick="${k}"]`);
  await click('[data-a="arm"]'); await page.waitForTimeout(300);
  s = await st();
  check(s.plan === 1 && /A random failure armed, within 1 minute/.test(s.lists) && !/extension/i.test(s.lists), `the random one is armed and tells only its window: ${s.lists.replace(/\s+/g, ' ').slice(0, 140)}`);
  await shot('random-armed');
  s = await waitFor((x) => x.fails.length === 1, 70000, 'the random failure');
  check(s.fails[0].kind === 'gear-noext', `it fired by itself inside its minute (${s.fails[0].kind})`);
  await page.click(`${F} [data-a="repairAll"]`); await page.waitForTimeout(300);

  // ---- at a moment: an engine flameout on the take-off roll above 100 kt ----
  await page.evaluate(() => { const f = window.__fs; f.startFlight({ ...f.plan }, { keepClock: true }); });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__fs.showLTab('failures')); await page.waitForTimeout(250);
  await click('[data-seg="when"] [data-v="moment"]');
  await page.selectOption(`${F} [data-sel="moment"]`, 'roll100');
  await form('eng-flameout', 1);
  await click('[data-a="arm"]'); await page.waitForTimeout(300);
  s = await st();
  check(s.plan === 1 && /On the take-off roll above 100 kt/.test(s.lists), `armed for the take-off roll: ${s.lists.replace(/\s+/g, ' ').slice(0, 140)}`);
  await page.evaluate(() => { const f = window.__fs; f.sim.controls.parkingBrake = false; f.input.lever = 1; });
  s = await waitFor((x) => x.fails.length === 1 || x.crashed, 60000, 'the flameout on the roll');
  check(s.fails.length === 1 && s.onGround && s.ias * KT >= 100 && s.ias * KT < 108 && !s.eng[1].lit, `engine 2 flamed out on the roll at ${(s.ias * KT).toFixed(0)} kt`);
  await page.waitForTimeout(700);
  const a = await st();
  check(a.alerts.some((x) => /^caution:ENG.*FAIL/.test(x)), `its caution is up: ${a.alerts.join(', ')}; lights ${a.lit}`);
  await shot('flameout-on-the-roll');
  await page.evaluate(() => { const f = window.__fs; f.input.lever = 0; f.sim.controls.brakeL = f.sim.controls.brakeR = 1; });
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
} catch (e) {
  check(false, 'the script ran to its end: ' + String(e).slice(0, 600));
} finally {
  await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 8000))]);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ }
}
console.log(`done ${pass} of ${total}`);
process.exit(0);
