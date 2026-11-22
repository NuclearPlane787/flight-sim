// v0.7.4, weather by place, in Chrome (headless, muted): the Weather tab's Departure / Destination switch, and two
// flights from a calm departure into a stormy destination (rain, gusts, lightning): Heathrow to Frankfurt and
// Gimpo to Haneda. Each is started as New scenario's plan would be (weather: the departure's preset,
// weatherDest: the destination's), its METARs read at both ends and at an airport between, and the aircraft
// jumped along the route (a jump to a point of it, as the path map's jumps do) for stills on the way: in the
// departure's third, the middle and the destination's third, and on final in the destination's storm. At each
// the sim's air (QNH, temperature, wind), the look's weather (the haze's uniform, the rain) are read.
// Pictures: "Claude outputs/flight-sim/v074-weather-<pair>-<what>.png".
//   /tmp/flight-sim/v074/gk.sh br 6 weather/br1.txt '^done ' node games/flight-sim/tests/browser-v074-weather.mjs
// Env: E2E_ROOT (default http://127.0.0.1:8014/).
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const GAME = ROOT + 'games/flight-sim/';
const shotPath = (n) => path.join(OUT, `v074-weather-${n}.png`);
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const PAIRS = [
  { tag: 'egll-eddf', region: 'europe', origin: 'EGLL', dep: '27R', dest: 'EDDF', arr: '25L', mid: 'EBBR', hour: 11 },
  { tag: 'rkss-rjtt', region: 'east-asia', origin: 'RKSS', dep: '14R', dest: 'RJTT', arr: '34L', mid: 'RKPK', hour: 2 },
].filter((p) => !only || p.tag === only);

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const contexts = [];
try {
  for (const P of PAIRS) {
    console.log(`\n== ${P.tag}`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    // The page starts a test flight on the runway; the flight with both ends' weathers is started over it below.
    await page.goto(`${GAME}?test&region=${P.region}&origin=${P.origin}&dep=${P.dep}&dest=${P.dest}&arr=${P.arr}&start=runway`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout: 120000 })
      .catch((e) => { throw new Error(`${e.message}; page errors: ${errors.slice(0, 3).join(' | ')}`); });
    const shot = (n) => page.screenshot({ path: shotPath(`${P.tag}-${n}`) });

    // The plan's runways: the first usable end at each.
    const plan = await page.evaluate(async (P) => {
      const f = window.__fs;
      const end = (icao, use) => {
        const a = f.airports.find((q) => q.icao === icao);
        const ends = a.runways.flatMap((r) => r.ends).filter((e) => e.use !== use && e.use !== 'closed' && e.use !== 'standby');
        return ends[0].ident;
      };
      const p = { origin: P.origin, depRunway: end(P.origin, 'landing'), dest: P.dest, arrRunway: end(P.dest, 'takeoff'), start: 'runway', stand: null, pax: 180, cargoKg: 2000, fuelKg: 9000, waypoints: [],
        weather: 'clear', weatherDest: 'thunderstorm' };
      f.startFlight(p);
      f.clock.set(Date.UTC(2026, 10, 19, P.hour, 0, 0));
      return p;
    }, P);
    await page.waitForTimeout(3000);

    // ---- the weather as set, and the METARs ----
    const wx = await page.evaluate(async (P) => {
      const f = window.__fs;
      const W = await import('./src/sim/weather.js'), M = await import('./src/sim/weather-presets.js');
      const s = f.sim.weather, c = f.weatherCtx;
      // The airport between: the one nearest the middle of the blend (P.mid if none is nearer).
      let best = null, bd = Infinity;
      for (const a of f.airports) {
        if (!a.origin || a.icao === P.origin || a.icao === P.dest) continue;
        const d = Math.abs(W.blendWeight(s.ends, a.origin[0], a.origin[1]) - 0.5);
        if (d < bd) { bd = d; best = a.icao; }
      }
      if (best) P.mid = best;
      return { mid: P.mid,
        two: W.hasTwoEnds(s), depPreset: s?.dep?.preset, destPreset: s?.preset,
        ends: s?.ends, metDep: M.metarOf(s, P.origin, c), metDest: M.metarOf(s, P.dest, c), metMid: M.metarOf(s, P.mid, c),
        midW: c.places[P.mid] ? W.blendWeight(s.ends, c.places[P.mid].x, c.places[P.mid].y) : null,
      };
    }, P);
    P.mid = wx.mid;
    console.log(`METAR ${wx.metDep}\nMETAR ${wx.metDest}\nMETAR ${wx.metMid} (weight ${wx.midW?.toFixed(2)})`);
    check(`${P.tag}: the plan's two weathers (clear at ${P.origin}, a storm at ${P.dest})`, wx.two && wx.depPreset === 'clear' && wx.destPreset === 'thunderstorm');
    check(`${P.tag}: the departure's METAR is calm`, /00000(KT|MPS) CAVOK 15\/07 Q1013/.test(wx.metDep), wx.metDep);
    check(`${P.tag}: the destination's METAR is its storm`, new RegExp(`^${P.dest} 230\\d\\dG\\d\\d(KT|MPS) 6000 TSRA .*19/17 Q1001`).test(wx.metDest), wx.metDest);
    // (Where no airport lies in the middle third, the nearest one's line is the air of the end whose third it is in.)
    const strip = (m) => m.split(' ').slice(1).filter((x) => !/^RMK$|^A\d{4}$|^NOSIG$/.test(x)).join(' ');
    const midOk = wx.midW > 0 && wx.midW < 1 ? strip(wx.metMid) !== strip(wx.metDep) && strip(wx.metMid) !== strip(wx.metDest)
      : strip(wx.metMid) === strip(wx.midW === 0 ? wx.metDep : wx.metDest);
    check(`${P.tag}: another airport has its own line, from the air at its place`, wx.metMid.startsWith(P.mid) && midOk, `${wx.metMid} (weight ${wx.midW})`);

    // ---- New scenario's two pickers, and the Weather tab and its switch (the first pair) ----
    if (P === PAIRS[0]) {
      const su0 = await page.evaluate((P) => {
        const f = window.__fs;
        window.__setupOut = 'pending';
        f.setup.show({ origin: P.origin, dest: P.dest, weather: 'clear' }, { title: 'New scenario', cancel: true }).then((p) => { window.__setupOut = p; });
        const sel = document.querySelector('.fsui-setup [data-f="weatherDest"]');
        return { opts: [...sel.options].map((o) => o.value), v: sel.value, dep: document.querySelector('.fsui-setup [data-f="weather"]').value };
      }, P);
      check('New scenario: the destination\'s weather defaults to the departure\'s', su0.v === '' && su0.dep === 'clear' && su0.opts[0] === '' && su0.opts.includes('thunderstorm'), JSON.stringify(su0));
      await page.selectOption('.fsui-setup [data-f="weatherDest"]', 'thunderstorm');
      await page.evaluate(() => document.querySelector('.fsui-setup [data-f="weatherDest"]').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(200);
      await shot('setup');
      await page.click('.fsui-setup [data-a="fly"]');
      await page.waitForFunction(() => window.__setupOut !== 'pending', null, { timeout: 5000 });
      const su1 = await page.evaluate(() => ({ weather: window.__setupOut?.weather, weatherDest: window.__setupOut?.weatherDest }));
      check('and Fly gives the plan both', su1.weather === 'clear' && su1.weatherDest === 'thunderstorm', JSON.stringify(su1));
      // A circuit (the review): one place, so one picker; the Arrival one is off.
      const su2 = await page.evaluate((P) => {
        const f = window.__fs;
        window.__setupOut = 'pending';
        f.setup.show({ origin: P.origin, dest: P.origin, weather: 'rain' }, { title: 'New scenario', cancel: true }).then((p) => { window.__setupOut = p; });
        const sel = document.querySelector('.fsui-setup [data-f="weatherDest"]');
        return { disabled: sel.disabled, v: sel.value };
      }, P);
      check('New scenario, a circuit: the Arrival picker is off', su2.disabled && su2.v === '', JSON.stringify(su2));
      await page.click('.fsui-setup [data-a="cancel"]');
      await page.waitForFunction(() => window.__setupOut !== 'pending', null, { timeout: 5000 });
    }

    // ---- the Weather tab and its switch (both pairs) ----
    {
      await page.evaluate(() => window.__fs.showLTab('weather'));
      await page.waitForTimeout(400);
      const tab = async () => page.evaluate(() => {
        const el = window.__fs.weatherWin.el, on = el.querySelector('[data-seg="end"] button.on');
        return { end: window.__fs.weatherWin.end, on: on && on.textContent, metar: el.querySelector('[data-o="metar"]').textContent, metar2: el.querySelector('[data-o="metar2"]').textContent,
          preset: el.querySelector('[data-p].on')?.dataset.p, note: el.querySelector('[data-o="endNote"]').textContent, kt: el.querySelector('[data-f="wind.kt"]').value };
      });
      const t1 = await tab();
      check('the tab opens on the destination, its METAR first, the departure\'s under it', t1.end === 'dest' && t1.metar === wx.metDest && t1.metar2 === wx.metDep && t1.preset === 'thunderstorm', JSON.stringify(t1));
      await shot('tab-destination');
      await page.click('.fswx [data-seg="end"] button[data-v="dep"]');
      await page.waitForTimeout(300);
      const t2 = await tab();
      check('the switch shows the departure\'s weather', t2.end === 'dep' && t2.metar === wx.metDep && t2.metar2 === wx.metDest && t2.preset === 'clear' && t2.kt === '0', JSON.stringify(t2));
      await shot('tab-departure');
      // A preset on the departure: set there alone, the destination's kept.
      await page.click('.fswx [data-p="few-clouds"]');
      await page.waitForTimeout(300);
      const t3 = await page.evaluate(async () => {
        const f = window.__fs, s = f.sim.weather;
        return { dep: s?.dep?.preset, dest: s?.preset, depRefY: s?.dep?.refY, ends: s?.ends };
      });
      check('a preset on the departure sets only the departure\'s', t3.dep === 'few-clouds' && t3.dest === 'thunderstorm', JSON.stringify(t3));
      // An edit on the destination's form, applied with Apply: only the destination's changes.
      await page.click('.fswx [data-seg="end"] button[data-v="dest"]');
      await page.fill('.fswx [data-f="qnh"]', '998');
      await page.click('.fswx [data-a="apply"]');
      await page.waitForTimeout(300);
      const t4 = await page.evaluate(() => { const s = window.__fs.sim.weather; return { dep: s?.dep?.preset, depQnh: s?.dep?.qnh, destQnh: s?.qnh, dest: s?.preset }; });
      check('Apply on the destination sets only the destination\'s', t4.dep === 'few-clouds' && t4.depQnh === 1022 && t4.destQnh === 998 && t4.dest === 'custom', JSON.stringify(t4));
      // Back to the plan's: clear at the departure, the storm at the destination.
      await page.click('.fswx [data-seg="end"] button[data-v="dep"]');
      await page.click('.fswx [data-p="clear"]');
      await page.click('.fswx [data-seg="end"] button[data-v="dest"]');
      await page.click('.fswx [data-p="thunderstorm"]');
      await page.waitForTimeout(300);
      const t5 = await page.evaluate(() => { const s = window.__fs.sim.weather; return { dep: s?.dep?.preset, dest: s?.preset }; });
      check('and back to clear and the storm', t5.dep === 'clear' && t5.dest === 'thunderstorm', JSON.stringify(t5));
      // Both ends: a preset there is one weather on the whole route (the tab's way before v0.7.4); then the plan's again.
      await page.click('.fswx [data-seg="end"] button[data-v="both"]');
      await page.click('.fswx [data-p="rain"]');
      await page.waitForTimeout(300);
      const t6 = await page.evaluate(() => { const s = window.__fs.sim.weather; return { two: !!s?.dep, preset: s?.preset }; });
      check('Both ends sets one weather everywhere', !t6.two && t6.preset === 'rain', JSON.stringify(t6));
      await page.click('.fswx [data-seg="end"] button[data-v="dep"]');
      await page.click('.fswx [data-p="clear"]');
      await page.click('.fswx [data-seg="end"] button[data-v="dest"]');
      await page.click('.fswx [data-p="thunderstorm"]');
      await page.waitForTimeout(300);
      const t7 = await page.evaluate(() => { const s = window.__fs.sim.weather; return { dep: s?.dep?.preset, dest: s?.preset }; });
      check('and the two ends again', t7.dep === 'clear' && t7.dest === 'thunderstorm', JSON.stringify(t7));
      await page.evaluate(() => window.__fs.weatherWin.close());
    }

    // ---- the departure, on the runway ----
    const read = () => page.evaluate(async () => {
      const f = window.__fs, s = f.sim.state, W = await import('./src/sim/weather.js');
      const wx = f.sim.weather, look = W.weatherAt(wx, s.pos.x, s.pos.y), u = f.world.uniforms;
      const C = W.compileWeather(wx), L = W.localWeather(C, s.pos.x, s.pos.y);
      return { w: W.blendWeight(wx.ends, s.pos.x, s.pos.y), qnh: L.qnh, tempC: L.dT + 15, windKt: Math.hypot(s.wind.x, s.wind.y) * 1.943844, gustKt: s.wind.gustKt,
        lookRain: look.precip.rate, lookVis: look.visM, haze: u.uHazeSigma0.value, wet: u.uWet.value, z: s.pos.z, agl: s.agl, crashed: f.crashed };
    });
    const r0 = await read();
    check(`${P.tag}: at ${P.origin} the departure's air: calm, standard, dry`, r0.w === 0 && r0.qnh === 1013.25 && r0.windKt === 0 && r0.lookRain === 0 && r0.wet === 0, JSON.stringify(r0));
    await shot('1-departure');

    // ---- airborne: start on final, then jump to points along the route ----
    await page.evaluate(({ p, h }) => { const f = window.__fs; f.startFlight({ ...p, start: 'final' }); f.clock.set(Date.UTC(2026, 10, 19, h, 0, 0)); }, { p: plan, h: P.hour });
    await page.waitForTimeout(2500);
    // aglM: a height above the ground there instead of about 11,500 ft above the sea.
    // zM: a height above the sea instead (m).
    const jumpAlong = async (t, label, aglM = 0, zM = 0) => {
      await page.evaluate(({ t, aglM, zM }) => {
        const f = window.__fs, sim = f.sim, e = sim.weather.ends, snap = sim.snapshot();
        const c = snap.core;
        // The final's own attitude and velocity (level, on its heading), moved to the point at about 11,500 ft.
        c.px = e.ax + t * (e.bx - e.ax); c.py = e.ay + t * (e.by - e.ay);
        c.pz = zM > 0 ? zM : aglM > 0 ? Math.max(0, f.world.heightfield.heightAt(c.px, c.py)) + aglM : 3500;
        f.jumpTo({ x: c.px, y: c.py, z: c.pz, t: c.t, snap });
      }, { t, aglM, zM });
      await page.waitForTimeout(4000);
      await shot(label);
      const r = await read();
      console.log(`${label}: ${JSON.stringify(r)}`);
      return r;
    };
    const a = await jumpAlong(0.2, '2-way-departure-third');
    check(`${P.tag}: in the departure's third, its air alone`, a.w === 0 && a.qnh === 1013.25 && a.lookRain === 0 && a.windKt < 0.01, `w ${a.w}, QNH ${a.qnh}, wind ${a.windKt.toFixed(2)} kt`);
    const m = await jumpAlong(0.5, '3-way-middle');
    check(`${P.tag}: in the middle, the blend`, Math.abs(m.w - 0.5) < 0.05 && m.qnh > 1001 && m.qnh < 1013.25 && m.lookRain > 0 && m.lookRain < 0.55 && m.windKt > 3 && m.haze > r0.haze, `w ${m.w}, QNH ${m.qnh.toFixed(2)}, ${(m.tempC).toFixed(1)} °C, wind ${m.windKt.toFixed(1)} kt, rain ${m.lookRain.toFixed(3)}, haze ${m.haze.toExponential(2)}`);
    // ---- one look step in the middle third, the camera and the sim's time fixed (the first pair) ----
    // The aircraft is put 1 m either side of the step at w = 11.5/24 (where, before the review's mend, the clouds'
    // pattern changed with the nearer end's seed), paused, and drawn once each side.
    if (P === PAIRS[0]) {
      const stepAt = async (side) => page.evaluate(async (side) => {
        const f = window.__fs, sim = f.sim, W = await import('./src/sim/weather.js'), e = sim.weather.ends, snap = sim.snapshot(), c = snap.core;
        const target = 11.5 / 24;   // a step boundary of the look
        let lo = 1 / 3, hi = 2 / 3;
        for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2, x = e.ax + mid * (e.bx - e.ax), y = e.ay + mid * (e.by - e.ay); if (W.blendWeight(e, x, y) < target) lo = mid; else hi = mid; }
        const L = Math.hypot(e.bx - e.ax, e.by - e.ay), t = lo + side * 1 / L;
        if (!window.__stepZ) window.__stepZ = Math.max(0, f.world.heightfield.heightAt(e.ax + t * (e.bx - e.ax), e.ay + t * (e.by - e.ay))) + 600;
        c.px = e.ax + t * (e.bx - e.ax); c.py = e.ay + t * (e.by - e.ay); c.pz = window.__stepZ;
        f.setPaused(true);
        sim.restore(snap, { keepWeather: true });
        f.renderOnce();
        await new Promise((r) => requestAnimationFrame(() => r()));
        f.renderOnce();
        const look = W.weatherAt(sim.weather, c.px, c.py, W.LOOK_STEP);
        return { w: W.blendWeight(e, c.px, c.py), seed: look.seed, cloudSeed: look.cloud.seed, aloft: look.cloud.aloft, okta: look.clouds.map((q) => q.okta), t: sim.state.t };
      }, side);
      const sa = await stepAt(-1);
      await shot('step-a');
      const sb = await stepAt(1);
      await shot('step-b');
      console.log(`step a ${JSON.stringify(sa)}\nstep b ${JSON.stringify(sb)}`);
      check('one look step in the middle: the same cloud pattern and drift, the camera and time fixed', sa.cloudSeed === sb.cloudSeed && sa.seed === sb.seed && JSON.stringify(sa.aloft) === JSON.stringify(sb.aloft) && sa.t === sb.t && sa.w < 11.5 / 24 && sb.w > 11.5 / 24,
        `w ${sa.w.toFixed(5)} | ${sb.w.toFixed(5)}, okta ${sa.okta} | ${sb.okta}`);
      await page.evaluate(() => window.__fs.setPaused(false));
    }

    // Under the storm's lowest base (2,500 ft above the sea), so the still shows its weather and not the inside of its
    // layer: 650 m (about 2,130 ft) up, 97 % of the way, over the low ground near the destination (Frankfurt's Main
    // valley, Tokyo's bay shore; the hills before them reach into the layer).
    const b = await jumpAlong(0.97, '4-way-destination-third', 0, 650);
    check(`${P.tag}: in the destination's third, its storm`, b.w === 1 && b.qnh === 1001 && b.lookRain === 0.55 && b.gustKt === 26 && b.wet > 0 && b.agl > 100 && b.z < 762, `w ${b.w}, QNH ${b.qnh}, wind ${b.windKt.toFixed(1)} kt G${b.gustKt}, rain ${b.lookRain}, wet ${b.wet.toFixed(2)}, ${Math.round(b.z / 0.3048)} ft (${Math.round(b.agl / 0.3048)} ft above the ground: under the 2,500 ft base)`);

    // ---- the end: on final at the destination, in the storm ----
    // A jump onto the final, 3 nm out at about 1,000 ft above the threshold: under the storm's cloud base.
    await page.evaluate((p) => window.__fs.startFlight({ ...p, start: 'final' }), plan);
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const f = window.__fs, d = f.dest, ax = f.runwayAxis(d.end, d.other), snap = f.sim.snapshot(), c = snap.core;
      const back = 3 * 1852, h = f.world.heightfield.heightAt(d.end.x, d.end.y);
      c.px = ax.tx - ax.ux * back; c.py = ax.ty - ax.uy * back; c.pz = h + 300;
      f.jumpTo({ x: c.px, y: c.py, z: c.pz, t: c.t, snap });
    });
    await page.waitForTimeout(4000);
    const fin = await read();
    check(`${P.tag}: on final at ${P.dest}, the destination's storm and a wet runway`, fin.w === 1 && fin.qnh === 1001 && fin.lookRain === 0.55 && fin.wet > 0 && !fin.crashed, JSON.stringify(fin));
    await shot('5-final-storm');
    check(`${P.tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 5000))]);
  }
} catch (e) {
  check('the run', false, String(e && e.stack || e));
} finally {
  for (const c of contexts) await Promise.race([c.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
}
const pass = results.filter(Boolean).length;
console.log(`done ${pass} of ${results.length}`);
process.exit(pass === results.length ? 0 : 1);
