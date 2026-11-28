// v0.8.0 (legs): each landing-gear leg on the 3D model and on the engine display, in the real game, one short run:
// the A321 and the 787-9 in the air at 8,000 ft, seen from the front and a little below (the orbit view, yaw 180°:
// the aircraft's LEFT is on the picture's RIGHT): the gear down with nothing failed; the left main leg that won't lock
// (the lever up, then down: the other two come down); the nose leg the same; the engine display's gear indication
// in each (an element shot); and the sparks' shader drawn once (the state's scraping forced while paused).
// Pictures v080-legs-<type>-<what>.png in GameDump/Claude outputs/flight-sim/.
//   node games/flight-sim/tests/browser-v080-legs.mjs        (the lead's server on 8014; prints "done N of M" last)
import { chromium } from './pw.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zoneMs, zoneOfIcao } from '../src/clock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const GAME = ROOT + 'games/flight-sim/';
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  for (const type of ['a321neo', 'b787-9']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RJTT&arr=34L&start=final&type=${type}&sparks80=1`);   // (the sparks are off unless asked for, since 23:15)
    await page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__fs.sim.state.t > 1, null, { timeout: 60000 });
    // A fixed early afternoon at Gimpo (14:00 local), whatever time the check runs.
    await page.evaluate((ms) => window.__fs.clock.set(ms), zoneMs(2026, 11, 19, 14, 0, 0, zoneOfIcao('RKSS')));
    // In the air at 8,000 ft, paused; the sim stepped by hand (the legs' travel without waiting), the frame drawn once.
    const setup = (legFail) => page.evaluate(async ([leg]) => {
      const f = window.__fs, F = await import(new URL('src/sim/failures.js', location.href).href);
      f.setPaused(true);
      f.sim.setFailures(null); f.sim.repair('all');
      const s = f.sim.state;
      f.sim.reset({ x: s.pos.x, y: s.pos.y, hdg: s.hdg, onGround: false, z: 8000 * 0.3048, iasMs: 200 * 0.514444, flapLever: 0, gearDown: leg < 0, fuelKg: 9000, payloadKg: 12000 });
      f.sim.controls.gearDown = leg < 0;
      if (leg >= 0) {
        f.sim.setFailures(F.armed(null, { kind: 'gear-nolock', target: leg, when: { type: 'now' } }, f.sim.state.t, 1));
        for (let i = 0; i < 12; i++) f.sim.step(1 / 120);
        f.sim.controls.gearDown = true;
        for (let i = 0; i < 40 * 120; i++) f.sim.step(1 / 120);
      }
      f.selectView('orbit'); const L = f.rig.looks.orbit; L.yaw = Math.PI; L.pitch = -0.06; L.dist = type0(f) ? 42 : 62;
      f.renderOnce();
      function type0(ff) { return ff.sim.type.id === 'a321neo'; }
      return { legs: [...f.sim.state.gearLegs], flags: [...f.sim.state.gearLegFlags], gearPos: f.sim.state.gearPos, doors: f.sim.state.gearDoors, z: f.sim.state.pos.z };
    }, [legFail]);
    // The engine display first (an element shot), then the checklist folded out of the way and the whole window.
    const shots = async (what) => {
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__fs.renderOnce());
      const eng = page.locator('.fsui-eng');
      if (await eng.count()) await eng.first().screenshot({ path: path.join(OUT, `v080-legs-${type}-${what}-display.png`) }).catch(() => {});
      if (await page.locator('[data-fold="fold"]').count()) await page.click('[data-fold="fold"]').catch(() => {});
      await page.evaluate(() => window.__fs.renderOnce());
      await page.screenshot({ path: path.join(OUT, `v080-legs-${type}-${what}.png`) });
    };
    let r = await setup(-1);
    check(`${type}: nothing failed, the gear down`, r.legs.every((x) => x === 1) && r.gearPos === 1, JSON.stringify(r));
    await shots('down');
    r = await setup(1);
    check(`${type}: the left main won't lock: legs [1, 0, 1]`, Math.round(r.legs[0]) === 1 && r.legs[1] < 0.01 && Math.round(r.legs[2]) === 1, JSON.stringify(r));
    const leftBone = await page.evaluate(() => { const b = window.__fs.aircraft.bones; return [b.mainLegL.quaternion.toArray(), b.mainLegR.quaternion.toArray(), b.noseLeg.quaternion.toArray()]; });
    check(`${type}: on the model only mainLegL is turned`, leftBone[0][3] < 0.9 && leftBone[1][3] > 0.9999 && leftBone[2][3] > 0.9999, JSON.stringify(leftBone));
    await shots('left-up');
    r = await setup(0);
    check(`${type}: the nose won't lock: legs [0, 1, 1]`, r.legs[0] < 0.01 && Math.round(r.legs[1]) === 1 && Math.round(r.legs[2]) === 1, JSON.stringify(r));
    await shots('nose-up');
    // The sparks' shader, drawn once: the state's scraping forced while paused (the sim's next step puts it back).
    const sp = await page.evaluate(() => {
      const f = window.__fs, s = f.sim.state, o = f.aircraft.object.getObjectByName('sparks');
      if (!o) return { made: false };
      s.scraping = true; s.gs = 40;
      const L = f.rig.looks.orbit; L.yaw = Math.PI * 0.7; L.pitch = -0.05; L.dist = 32;   // close, from the front quarter: the trails run aft
      f.renderOnce();
      const vis = o.visible, calls = f.renderer.info.render.calls;
      return { made: true, vis, calls };
    });
    check(`${type}: the sparks made and drawn when scraping`, sp.made && sp.vis, JSON.stringify(sp));
    await page.screenshot({ path: path.join(OUT, `v080-legs-${type}-sparks-forced.png`) });
    await page.evaluate(() => { const s = window.__fs.sim.state; s.scraping = false; window.__fs.renderOnce(); });
    const hidden = await page.evaluate(() => !window.__fs.aircraft.object.getObjectByName('sparks').visible);
    check(`${type}: and hidden again`, hidden);
    check(`${type}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
}
console.log(`done ${results.filter(Boolean).length} of ${results.length}`);
