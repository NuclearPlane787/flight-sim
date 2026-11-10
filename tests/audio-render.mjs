// Objective sound check: renders scripted flight states through src/audio/synth.js in an
// OfflineAudioContext (tests/dev-audio-render.html) and checks the PCM: levels, balance,
// pitch tracking, clipping, clicks, NaN, pause / time-compression muting, update() cost.
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/audio-render.mjs [--type b787-9] [--json out.json]
//
// --type (v0.3.0): that aircraft type's engine (b787-9, b777-300er; without it the A321neo).
//
// In the cloud container (v0.2.2): FS_CLOUD=1 E2E_ROOT=http://127.0.0.1:8765/ node tests/audio-render.mjs
// (its preinstalled Playwright and headless Chromium; NODE_PATH=$(npm root -g)). SYNTH=<url
// relative to tests/> renders another copy of the synth (an older one, to compare).

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const CLOUD = !!process.env.FS_CLOUD;
const { chromium } = CLOUD ? createRequire(import.meta.url)('playwright') : await import('/tmp/flight-sim/pw/node_modules/playwright/index.mjs');
const ROOT = process.env.E2E_ROOT || 'http://localhost:8001/';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

const browser = await chromium.launch(CLOUD ? {} : { channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let r, wx;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const ti = process.argv.indexOf('--type'), query = new URLSearchParams();
  if (ti > 0) query.set('type', process.argv[ti + 1]);
  if (process.env.SYNTH) query.set('synth', process.env.SYNTH);
  await page.goto(ROOT + 'games/flight-sim/tests/dev-audio-render.html' + (query.size ? '?' + query : ''));
  await page.waitForFunction(() => typeof window.runAudio === 'function', null, { timeout: 30000 });
  r = await page.evaluate(() => window.runAudio());
  wx = await page.evaluate(() => window.runWeather());   // v0.4.0
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

const S = r.seg;
const i = process.argv.indexOf('--json');
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(r, null, 1));

console.log(`\n${r.type}: ${r.spec.fanBlades} blades, ${r.spec.n1Hz.toFixed(4)} Hz per % N1`);
console.log('\nsegment            rms dB   peak  centroid Hz  tone Hz  band dB');
for (const [k, v] of Object.entries(S)) {
  if (Array.isArray(v)) continue;
  console.log(`${k.padEnd(18)} ${f1(v.rms).padStart(6)} ${v.peak.toFixed(3).padStart(6)} ${String(Math.round(v.centroid)).padStart(11)} ${String(Math.round(v.tone)).padStart(8)} ${f1(v.bandDb).padStart(8)}`);
}
console.log('\nspool-up, per second: rms dB / tone Hz');
console.log(S.spool.map((v) => `${f1(v.rms)}/${Math.round(v.tone)}`).join('  '));
console.log('\nscenario       peak   click ratio @ s');
for (const [k, v] of Object.entries(r.scen)) console.log(`${k.padEnd(14)} ${v.peak.toFixed(3)}  ${String(v.click.ratio).padStart(6)} @ ${v.click.at}${v.nan ? '  NaN ' + v.nan : ''}`);
console.log(`\nupdate(): avg ${r.timing.avgMs.toFixed(4)} ms, max ${r.timing.maxMs.toFixed(3)} ms over ${r.timing.calls} calls\n`);

// ---- checks ----
const scen = Object.values(r.scen);
check('no NaN anywhere', scen.every((v) => v.nan === 0));
check('no clipping (peak < 0.98 in every scenario)', scen.every((v) => v.peak < 0.98), `max ${Math.max(...scen.map((v) => v.peak)).toFixed(3)} (everything ${r.scen.everything.peak.toFixed(3)})`);
check('click detector self-test (a 0.05 step on a sine reads > 8)', r.clickSelfTest.ratio > 8, `${r.clickSelfTest.ratio}`);
check('no clicks (worst step < 8x local typical step)', scen.every((v) => v.click.ratio < 8),
  Object.entries(r.scen).filter(([, v]) => v.click.ratio >= 8).map(([k, v]) => `${k} ${v.click.ratio}@${v.click.at}`).join(', '));
check('idle is not silent (outside > -40 dB, inside > -45 dB)', S.idleOut.rms > -40 && S.idleIn.rms > -45, `${f1(S.idleOut.rms)} / ${f1(S.idleIn.rms)}`);
check('TOGA louder than idle by 10+ dB outside', S.togaOut.rms - S.idleOut.rms > 10, `${f1(S.togaOut.rms - S.idleOut.rms)} dB`);
// v0.3.1: 3+ dB, was 6+. Shane: "I can't hear the engines much at all from the cockpit. They should be
// muffled and quieter than the outside, but not almost absent." So the cockpit went up about 6 dB at
// TOGA (more at idle and on an approach); it stays quieter than outside, and duller (the next check).
check('inside quieter than outside at TOGA (3+ dB)', S.togaOut.rms - S.togaIn.rms > 3, `${f1(S.togaOut.rms - S.togaIn.rms)} dB`);
check('inside duller than outside at TOGA (centroid lower)', S.togaIn.centroid < S.togaOut.centroid * 0.8, `${Math.round(S.togaIn.centroid)} vs ${Math.round(S.togaOut.centroid)} Hz`);
// (At idle the cockpit's air-conditioning hiss dominates inside, so idle is compared on level only.)
check('inside quieter than outside at idle', S.idleIn.rms < S.idleOut.rms, `${f1(S.idleIn.rms)} vs ${f1(S.idleOut.rms)} dB`);
// Duller compared source by source: the mix differs on purpose (wind is louder in the cockpit).
check('cruise engines: inside duller than outside (centroid lower)', S.cruiseInEng.centroid < S.cruiseOutEng.centroid * 0.8, `${Math.round(S.cruiseInEng.centroid)} vs ${Math.round(S.cruiseOutEng.centroid)} Hz`);
check('cruise wind: inside duller than outside (centroid lower)', S.cruiseInWind.centroid < S.cruiseOutWind.centroid * 0.8, `${Math.round(S.cruiseInWind.centroid)} vs ${Math.round(S.cruiseOutWind.centroid)} Hz`);
// Since v0.2.2 the engines' tones waver (±15 %) and the two engines beat, as real ones do, so
// the level isn't steady from one window to the next any more: these allow 1.5 dB (1 s) and
// 2 dB (300 ms) where v0.2.1's steady tones allowed 0.5 and 1.5. A step or a click still shows.
const sp = S.spool, steps = sp.slice(1).map((v, k) => v.rms - sp[k].rms);
check('spool-up level rises steadily (no 1 s step drops > 1.5 dB, total 10+ dB)', steps.every((d) => d > -1.5) && sp.at(-1).rms - sp[0].rms > 10, steps.map(f1).join(' '));
// 300 ms moving average of the 100 ms windows (single 100 ms windows of rumble noise wander ±1 dB).
const w0 = r.scen['spoolup-out'].win, winSp = w0.slice(5, 85).map((_, k) => (w0[k + 4] + w0[k + 5] + w0[k + 6]) / 3);
const wsteps = winSp.slice(1).map((v, k) => v - winSp[k]);
check('spool-up smooth (300 ms average never steps > 2 dB)', wsteps.every((d) => Math.abs(d) < 2), `max |step| ${f1(Math.max(...wsteps.map(Math.abs)))} dB`);
// v0.2.2: the fan's tone is checked where it should be (the blades × the N1 shaft's frequency), every
// second of the spool-up. (Before, the strongest tone from 250 Hz up had to rise; now the
// buzz-saw's tones can be stronger than the fan's at high N1, and 237 Hz at idle is below 250.)
check('the fan tone tracks N1 (10+ dB over its neighbourhood at the blades × the shaft frequency, every second)', S.bpf.every((v) => v.db > 10),
  S.bpf.map((v) => `${Math.round(v.f)} Hz ${f1(v.db)}`).join(', '));
check('cruise inside: engines and wind balanced (within 6 dB of each other)', Math.abs(S.cruiseInEng.rms - S.cruiseInWind.rms) < 6, `engines ${f1(S.cruiseInEng.rms)}, wind ${f1(S.cruiseInWind.rms)}`);
check('cruise inside a little quieter than TOGA inside (0–8 dB)', S.togaIn.rms - S.cruiseIn.rms > 0 && S.togaIn.rms - S.cruiseIn.rms < 8, `${f1(S.cruiseIn.rms)} vs ${f1(S.togaIn.rms)}`);
check('flap motor audible while moving (+1.5 dB)', S.flapRun.rms - S.motorsBase.rms > 1.5, `${f1(S.flapRun.rms - S.motorsBase.rms)} dB`);
check('gear motor audible while moving (+1.5 dB)', S.gearRun.rms - S.motorsBase.rms > 1.5, `${f1(S.gearRun.rms - S.motorsBase.rms)} dB`);
check('touchdown thump (+6 dB over approach, peak up)', S.touch.rms - S.preTouch.rms > 6 && S.touch.peak > S.preTouch.peak * 2, `${f1(S.touch.rms - S.preTouch.rms)} dB`);
check('reversers loud on the rollout (+6 dB over idle outside)', S.revOut.rms - S.idleOut.rms > 6, `${f1(S.revOut.rms - S.idleOut.rms)} dB`);
check('slow roll with brakes audible (> stopped + 2 dB)', S.slowRoll.rms - S.stopped.rms > 2, `${f1(S.slowRoll.rms)} vs stopped ${f1(S.stopped.rms)}`);
check('brake squeal below 20 kt (2.7–3.1 kHz band +10 dB vs 50 kt roll)', S.squealRoll.bandDb - S.slowRoll.bandDb > 10, `${f1(S.slowRoll.bandDb)} → ${f1(S.squealRoll.bandDb)} dB`);
check('reverser door clunk (+3 dB over the 80 ms before)', S.door.rms - S.preDoor.rms > 3, `${f1(S.preDoor.rms)} → ${f1(S.door.rms)} dB`);
check('cavalry charge clearly over TOGA inside (+6 dB)', S.cav.rms - S.cavBase.rms > 6, `${f1(S.cav.rms - S.cavBase.rms)} dB`);
check('overspeed chime clearly over cruise inside (+6 dB)', S.chime.rms - S.chimeBase.rms > 6, `${f1(S.chime.rms - S.chimeBase.rms)} dB`);
check('stall warning clearly over TOGA inside (+6 dB)', S.stall.rms - S.stallBase.rms > 6, `${f1(S.stall.rms - S.stallBase.rms)} dB`);
check('paused is silent (< -80 dB)', S.paused.rms < -80, `${f1(S.paused.rms)} dB (before ${f1(S.pausedBefore.rms)})`);
check('time compression: world gone, warnings quieter (10+ dB down)', S.fastBefore.rms - S.fast.rms > 10 && S.fast.rms > -60, `${f1(S.fastBefore.rms)} → ${f1(S.fast.rms)} dB`);
check('update() under 0.05 ms on average', r.timing.avgMs < 0.05, `${r.timing.avgMs.toFixed(4)} ms`);

// ---- v0.4.0: the weather ----
const X = wx.seg, T = wx.thunder, near = T['wx-near'], cold = T['wx-near-cold'], far = T['wx-far'];
console.log(`\nweather (v0.4.0):`);
console.log(`rain heavy in ${f1(X.rainIn.rms)} dB (band ${f1(X.rainIn.bandDb)}, centroid ${Math.round(X.rainIn.centroid)} Hz); out ${f1(X.rainOut.rms)} (centroid ${Math.round(X.rainOut.centroid)}); light in ${f1(X.rainLight.rms)}; no rain in ${f1(X.noRain.rms)}; approach ${f1(X.noRainAppr.rms)} → ${f1(X.rainAppr.rms)}`);
for (const [k, v] of Object.entries(T)) console.log(`${k.padEnd(14)} flash ${v.flash.toFixed(2)} s, ${(v.d / 1000).toFixed(2)} km, delay predicted ${v.delay.toFixed(2)} s, measured ${v.delayMeasured.toFixed(2)} s, length ${v.lenS.toFixed(1)} s, centroid ${Math.round(v.centroid)} Hz, peak ${v.peak.toFixed(3)}`);
console.log(`gust swing ${f1(X.gustSwing)} dB (no weather ${f1(X.noGustSwing)} dB); siren ${f1(X.sirenBase.rms)} → ${f1(X.siren.rms)} dB`);
const scenW = Object.values(wx.scen);
check('weather: no NaN, no clipping, no clicks', scenW.every((v) => v.nan === 0 && v.peak < 0.98 && v.click.ratio < 8),
  Object.entries(wx.scen).filter(([, v]) => v.nan || v.peak >= 0.98 || v.click.ratio >= 8).map(([k, v]) => `${k} peak ${v.peak.toFixed(3)} click ${v.click.ratio}@${v.click.at}`).join(', '));
check('rain: heavy in the cockpit is well over the bed (+10 dB)', X.rainIn.rms - X.noRain.rms > 10, `${f1(X.noRain.rms)} → ${f1(X.rainIn.rms)} dB`);
check('rain: heavy heard over an approach in the cockpit (+1.5 dB)', X.rainAppr.rms - X.noRainAppr.rms > 1.5, `${f1(X.noRainAppr.rms)} → ${f1(X.rainAppr.rms)} dB`);
check('rain: 3+ dB louder in the cockpit than outside', X.rainIn.rms - X.rainOut.rms > 3, `${f1(X.rainIn.rms)} vs ${f1(X.rainOut.rms)} dB`);
check('rain: light rain 6+ dB under heavy', X.rainIn.rms - X.rainLight.rms > 6, `${f1(X.rainLight.rms)} vs ${f1(X.rainIn.rms)} dB`);
check('rain: its energy is in the 1.5–12 kHz band (> -3 dB of the total)', X.rainIn.bandDb > -3 && X.rainOut.bandDb > -3, `in ${f1(X.rainIn.bandDb)}, out ${f1(X.rainOut.bandDb)} dB`);
check('rain: duller in the cockpit than outside (centroid lower)', X.rainIn.centroid < X.rainOut.centroid, `${Math.round(X.rainIn.centroid)} vs ${Math.round(X.rainOut.centroid)} Hz`);
for (const [k, v] of Object.entries(T)) check(`thunder delay: ${k} heard ${v.delay.toFixed(2)} s after the flash, ±0.25 s`, Math.abs(v.delayMeasured - v.delay) < 0.25, `${v.delayMeasured.toFixed(2)} s measured, ${v.delay.toFixed(2)} s predicted (${(v.d / 1000).toFixed(2)} km)`);
check('thunder delay: the far strike later in proportion to its distance (±5 %)', Math.abs(far.delayMeasured / near.delayMeasured - far.delay / near.delay) < 0.05 * (far.delay / near.delay), `${f1(far.delayMeasured / near.delayMeasured)}x (distance ratio ${f1(far.d / near.d)}x)`);
check('thunder delay: colder air is slower (the sound\'s speed from the temperature)', cold.delayMeasured > near.delayMeasured, `+15 °C ${near.delayMeasured.toFixed(2)} s, −20 °C ${cold.delayMeasured.toFixed(2)} s`);
check('thunder: near loud and short, far quieter, longer and duller', far.peakDb < near.peakDb - 6 && far.lenS > near.lenS * 1.3 && far.centroid < near.centroid * 0.7, `near ${f1(near.peakDb)} dB, ${near.lenS.toFixed(1)} s, ${Math.round(near.centroid)} Hz; far ${f1(far.peakDb)} dB, ${far.lenS.toFixed(1)} s, ${Math.round(far.centroid)} Hz`);
check('gusts: the wind\'s noise swings 6+ dB, 4+ dB more than without the weather', X.gustSwing > 6 && X.gustSwing - X.noGustSwing > 4, `${f1(X.gustSwing)} dB (no weather ${f1(X.noGustSwing)} dB)`);
check('Boeing siren over the quiet cockpit (+15 dB)', X.siren.rms - X.sirenBase.rms > 15, `${f1(X.sirenBase.rms)} → ${f1(X.siren.rms)} dB`);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
