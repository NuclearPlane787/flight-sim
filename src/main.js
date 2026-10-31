// Flight Sim: boot, the frame loop, and the glue between the sim, the world, the aircraft,
// the screens and the sound. Fixed 1/120 s physics steps, rendering capped at 60 fps,
// nothing running while paused or hidden.

import * as THREE from '../vendor/three.module.js';
import { toScene, gridToMag } from './world/frame.js';
import { createInput, detentName } from './input.js';
import { createCameraRig } from './camera.js';
import { createCallouts } from './audio/callouts.js';
import { createScorer, runwayFrame, aimingPoint } from './score.js';
import { createLogbook } from './ui/logbook.js';
import { createScorePanel } from './ui/score-panel.js';
import * as store from './store.js';
import { createGateFlow } from './ground/gate-flow.js';
import { standHeading } from './world/traffic-layout.js';
import { VERSION } from './version.js';

const STEP = 1 / 120;
const KT = 1.943844, FT = 3.28084, NM = 1852, DEG = Math.PI / 180;
const RATES = [1, 2, 4, 8, 16];
const TC_MIN_AGL = 2000 / FT;   // time compression only above 2,000 ft AGL
const PHYSICS_BUDGET_MS = 7;    // per frame; beyond it, steps are dropped and the rate falls
const FRAME_MS = 1000 / 60;
const REWIND_S = 30;

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll('[data-version]')) el.textContent = VERSION.label;

const ui = {
  loading: $('loading'), loadingText: $('loading-text'), pause: $('pause'), crash: $('crash'),
  crashReason: $('crash-reason'), score: $('score'), toast: $('toast'), perf: $('perf'), fade: $('fade'),
};

function fail(err) {
  console.error(err);
  ui.loading.hidden = false;
  ui.loadingText.textContent = 'Could not start: ' + (err && err.message ? err.message : err);
}
window.addEventListener('error', (e) => { if (!booted) fail(e.error || e.message); });
let booted = false;

let toastTimer = 0;
function toast(text, ms = 2200) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
}

async function boot() {
  const [simMod, predMod, worldMod, hfMod, rwMod, acMod, cpMod, hudMod, mapMod, setupMod, synthMod] = await Promise.all([
    import('./sim/sim.js'), import('./sim/predict.js').catch(() => ({ createPredictor: () => ({ request() {}, cancel() {} }) })), import('./world/world.js'),
    import('./world/heightfield.js'), import('./world/runways.js'), import('./aircraft.js'),
    import('./cockpit.js'), import('./ui/hud.js'), import('./ui/map.js'), import('./ui/setup.js'),
    import('./audio/synth.js').catch(() => null),
  ]);

  // Renderer, scene and camera.
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(params.get('dpr')) || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.info.autoReset = true;
  const scene = new THREE.Scene();
  const rig = createCameraRig(canvas);
  const camera = rig.camera;
  if (params.get('view')) rig.viewId = params.get('view');

  ui.loadingText.textContent = 'Loading terrain and airports…';
  const base = new URL('../data/', import.meta.url).href;
  const [hf, rw, coast] = await Promise.all([
    hfMod.loadHeightfield(base), rwMod.loadAirports(base),
    fetch(base + 'coast.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  rw.setHeightfield(hf);
  const airports = rw.airports;
  // Stand refs repeat in OSM (73 at Incheon, numbered per terminal or apron; "18" twice at
  // Gimpo), and they're distinct stands 46 m to 4 km apart. Make each ref unique ("511-2"),
  // so the setup list, gate starts, parked-aircraft occupancy and the logbook agree.
  for (const a of airports) {
    const taken = new Set((a.stands || []).map((st) => st.ref));
    const seen = new Set();
    for (const st of a.stands || []) {
      if (seen.has(st.ref)) {
        let n = 2;
        while (taken.has(`${st.ref}-${n}`)) n++; // never collide with a real ref like "908-2"
        st.ref = `${st.ref}-${n}`;
        taken.add(st.ref);
      }
      seen.add(st.ref);
    }
  }
  // Gimpo's baked stand headings are often 90° off where OSM has no lead-in line: take them
  // from the taxi lines at each stand, once, so markings, parked aircraft and gate starts agree.
  for (const a of airports) for (const st of a.stands || []) {
    if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(a, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
  }
  rw.rebuildPaved();
  const byIcao = (icao) => airports.find((a) => a.icao === icao);

  ui.loadingText.textContent = 'Building the world…';
  const world = await worldMod.createWorld({ renderer, scene, baseUrl: base, heightfield: hf, airports });
  const aircraft = acMod.createAircraft();
  const cockpit = cpMod.createCockpit();
  aircraft.object.add(cockpit.object);
  scene.add(aircraft.object);

  // The sim and its ground.
  const g = { h: 0, kind: 'ground' };
  const ground = (x, y) => { g.h = hf.heightAt(x, y); g.kind = rw.groundKind(x, y); return g; };
  const sim = simMod.createSim({ ground });
  const ap = sim.ap;
  const predictor = predMod.createPredictor();
  // M2: gate starts, pushback and taxi routes.
  const occupied = (icao) => (world.traffic ? world.traffic.occupiedStands(icao).map((st) => (st && st.ref) ?? st) : []);
  const gate = createGateFlow({ sim, airports, findRunwayEnd: rw.findRunwayEnd, scene, uniforms: world.uniforms, heightAt: hf.heightAt, occupied });
  gate.onstatus = (t) => { if (t) toast(t, 4500); };
  let landed = false, arrivalStand = null;
  let prediction = null, terrainToastKey = null;

  const input = createInput(window);
  const callouts = createCallouts();
  const scorer = createScorer();
  const synth = synthMod ? synthMod.createSynth() : null;
  const synthOpts = { inside: false, timeScale: 1, paused: false };
  if (store.load('settings', {})?.muted) callouts.muted = true;

  const hud = hudMod.createHud($('hud'), { airports, coast });
  const map = mapMod.createMap($('map-root'), { airports, coast });
  const setup = setupMod.createSetup($('setup-root'), { airports, coast });

  // ---- Flight state ----
  let plan = null;
  let dest = null, destOther = null;
  let timeScale = 1, achievedScale = 1, slowFrames = 0;
  let paused = false, crashed = false, audioStarted = false;
  let acc = 0;
  let rewind = [];       // snapshots every second of sim time
  let lastSnapT = -1e9;
  let liftoffT = null, fuelAtStart = 0;
  let apKey = '';
  let lastPredictReal = 0;

  function runwayEnds(icao, ident) {
    const a = byIcao(icao);
    if (!a) return null;
    for (const r of a.runways) {
      const i = r.ends.findIndex((e) => e.ident === ident);
      if (i >= 0) return { airport: a, runway: r, end: r.ends[i], other: r.ends[1 - i] };
    }
    return null;
  }
  // The landing threshold (an end's x/y; displaced thresholds are already applied), the
  // physical start of the pavement, and the unit vector down the runway.
  function runwayAxis(end, other) {
    const dx = other.x - end.x, dy = other.y - end.y, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const [px, py] = end.pavementEnd || [end.x, end.y];
    return { tx: end.x, ty: end.y, px, py, ux, uy, hdg: Math.atan2(ux, uy), len };
  }

  function placeOnRunway(icao, ident, keep) {
    const r = runwayEnds(icao, ident);
    if (!r) throw new Error(`No runway ${icao} ${ident}`);
    const ax = runwayAxis(r.end, r.other);
    const x = ax.px + ax.ux * 45, y = ax.py + ax.uy * 45; // lined up just past the pavement's end
    sim.reset({ x, y, hdg: ax.hdg, onGround: true, flapLever: 1, gearDown: true,
      fuelKg: keep ? keep.fuelKg : plan.fuelKg, payloadKg: keep ? keep.payloadKg : payloadOf(plan) });
    sim.controls.flapLever = 1;
    sim.controls.gearDown = true;
    sim.controls.parkingBrake = false;
    input.lever = 0;
  }

  // 15 nm out on the extended centreline, on the 3° path, 180 kt, CONF 1, gear up, AP holding.
  function placeOnFinal(keep) {
    const ax = runwayAxis(dest.end, dest.other);
    const dist = 15 * NM;
    const x = ax.tx - ax.ux * dist, y = ax.ty - ax.uy * dist;
    const z = (dest.end.elevM ?? dest.airport.elevM) + 15 + Math.tan(3 * DEG) * dist;
    sim.reset({ x, y, z, hdg: ax.hdg, onGround: false, iasMs: 180 / KT, flapLever: 1, gearDown: false,
      fuelKg: keep ? keep.fuelKg : plan.fuelKg, payloadKg: keep ? keep.payloadKg : payloadOf(plan) });
    sim.controls.flapLever = 1;
    sim.controls.gearDown = false;
    sim.controls.speedbrake = 0;
    input.lever = sim.controls.thrust = 25 / 45; // CL, so the autothrust has its full range
    ap.setHdg(Math.round(gridToMag(ax.hdg, x, y) / DEG) % 360 || 360);
    ap.setAlt(Math.round((z * FT) / 100) * 100);
    ap.setSpd(180);
    ap.engageAp();
    if (!ap.athr) ap.toggleAthr();
    setTimeScale(1);
  }

  const payloadOf = (p) => (p.pax || 0) * 84 + (p.cargoKg || 0);

  function startFlight(p) {
    plan = p;
    store.save('lastflight', p);
    dest = runwayEnds(p.dest, p.arrRunway);
    destOther = dest ? dest.other : null;
    scorer.reset();
    if (dest) scorer.setRunway(dest.end, dest.other);
    landed = false; arrivalStand = null;
    if (p.start === 'gate' && p.stand) {
      gate.start(p);
      input.lever = 0;
      world.traffic?.setPlayerStand(p.origin, p.stand);
    } else {
      gate.clear();
      world.traffic?.setPlayerStand(p.origin, null);
      if (p.start === 'final' && dest) placeOnFinal(null);
      else placeOnRunway(p.origin, p.depRunway, null);
    }
    // The FCU heading starts at the aircraft's own heading (else Z would turn it to 360).
    if (p.start !== 'final') ap.setHdg(Math.round(gridToMag(sim.state.hdg, sim.state.pos.x, sim.state.pos.y) / DEG) % 360 || 360);
    sim.events.length = 0;
    rewind = []; lastSnapT = -1e9; acc = 0;
    liftoffT = null; fuelAtStart = sim.state.fuelKg;
    crashed = false; prediction = null; map.setPrediction?.([]);
    callouts.reset();
    ui.crash.hidden = true; ui.score.hidden = true;
    setTimeScale(1);
    setPaused(false);
  }

  async function newFlight() {
    setPaused(true, true);
    input.setEnabled(false);
    const last = store.load('lastflight', null);
    const p = await setup.show(last || { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway' });
    input.setEnabled(true);
    startFlight(p);
  }

  // After the sim jumps (restore, rewind, skip to final): the keyboard's thrust lever follows
  // the restored one, the old predicted path and pending prediction go, the callouts re-arm,
  // and the rewind buffer records from here.
  function afterJump(rewound = false) {
    // A jump or skip leaves the ground flow behind; a rewind carries it on from where the
    // aircraft now is (the gate state isn't in the sim's snapshots).
    if (rewound) gate.afterRestore(); else gate.clear();
    input.lever = Math.max(sim.state.onGround ? -1 : 0, sim.controls.thrust);
    clearPrediction();
    callouts.reset();
    sim.events.length = 0;
    lastSnapT = sim.state.t;
  }
  function clearPrediction() {
    predictor.cancel();
    prediction = null;
    apKey = '';
    map.setPrediction([]);
  }

  function skipToFinal() {
    if (!dest) { toast('No destination runway set'); return; }
    fadeThen(() => {
      const s = sim.state;
      placeOnFinal({ fuelKg: s.fuelKg, payloadKg: payloadOf(plan) });
      rewind = [];
      afterJump();
      scorer.reset();
      if (dest) scorer.setRunway(dest.end, dest.other);
    });
  }

  function jumpTo(sample) {
    fadeThen(() => {
      sim.restore(sample.snap);
      setTimeScale(1);
      afterJump(); // a new prediction runs from the new spot
    });
  }

  function fadeThen(fn) {
    ui.fade.classList.add('on');
    setTimeout(() => {
      fn();
      requestFrame();
      setTimeout(() => ui.fade.classList.remove('on'), 120);
    }, 360);
  }

  // ---- Time compression ----
  function canCompress() {
    const s = sim.state;
    return ap.ap && !s.onGround && s.agl >= TC_MIN_AGL && !(s.warnings && s.warnings.master) && !crashed;
  }
  function setTimeScale(r) {
    timeScale = RATES.includes(r) ? r : 1;
    achievedScale = timeScale;
    slowFrames = 0;
  }
  function changeRate(dir) {
    const i = RATES.indexOf(timeScale) + dir;
    if (i < 0 || i >= RATES.length) return;
    if (dir > 0 && !canCompress()) { toast('Time compression needs the autopilot on and 2,000 ft above the ground'); return; }
    setTimeScale(RATES[i]);
  }

  // ---- Rewind ----
  function rewindNow() {
    const target = sim.state.t - REWIND_S;
    let snap = null;
    for (let i = rewind.length - 1; i >= 0; i--) if (rewind[i].t <= target) { snap = rewind[i].snap; rewind.length = i + 1; break; }
    if (!snap && rewind.length) { snap = rewind[0].snap; rewind.length = 1; }
    if (!snap) { toast('Nothing to rewind to yet'); return; }
    sim.restore(snap);
    afterJump(true);
    landed = gate.phase === 'taxi-in' || gate.phase === 'arrived';
    crashed = false;
    ui.crash.hidden = true;
    setTimeScale(1);
    scorer.reset();
    if (dest) scorer.setRunway(dest.end, dest.other);
    setPaused(false);
  }

  // ---- Pause ----
  function setPaused(v, quiet = false) {
    paused = v;
    // Paused, the audio thread stops too (the CPU rules); it resumes only if sound had started.
    if (synth && audioStarted) { if (v) synth.stop(); else synth.start(); }
    ui.pause.hidden = !v || quiet || crashed;
    input.dropAll();
    if (!v) { last = performance.now(); requestFrame(); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !paused) setPaused(true);
  });

  // ---- Actions ----
  input.onAction((a) => {
    if (!plan) return;
    const c = sim.controls;
    if (a === 'pause') {
      if (map.isOpen) { map.close(); return; }
      if (crashed) return;
      setPaused(!paused);
      return;
    }
    if (a === 'rewind') { if (paused || crashed) rewindNow(); return; }
    if (paused && a !== 'perf') return;
    switch (a) {
      case 'parkingBrake': c.parkingBrake = !c.parkingBrake; toast(c.parkingBrake ? 'Parking brake set' : 'Parking brake released', 1200); break;
      case 'gear': c.gearDown = !c.gearDown; break;
      case 'speedbrake': c.speedbrake = c.speedbrake > 0 ? 0 : 1; break;
      case 'spoilersArm': c.spoilersArmed = !c.spoilersArmed; toast(c.spoilersArmed ? 'Ground spoilers armed' : 'Ground spoilers disarmed', 1200); break;
      case 'ap': if (ap.ap) ap.disconnectAp('pilot'); else ap.engageAp(); break;
      case 'athr': ap.toggleAthr(); break;
      case 'faster': changeRate(1); break;
      case 'slower': changeRate(-1); break;
      case 'map': map.toggle(); if (map.isOpen) apKey = ''; else predictor.cancel(); break;
      case 'view': { const v = rig.next(); toast(v.name, 1000); break; }
      case 'pushback':
        if (gate.phase === 'parked' || gate.phase === 'pushback') gate.onKey('pushback');
        else toast('Pushback works from a gate start (Flight setup → At the gate)');
        break;
      case 'perf': ui.perf.hidden = !ui.perf.hidden; break;
      case 'rewind': break; // T: handled above, only from the pause or crash screens
      default:
        if (a.startsWith('flap')) c.flapLever = Number(a.slice(4));
    }
  });

  const scoreCard = createScorePanel(ui.score, { onnewflight: () => { ui.crash.hidden = true; crashed = false; newFlight(); } });
  const logbook = createLogbook($('logbook-root'), { load: store.load, save: store.save, onclose: () => input.setEnabled(true) });
  for (const btn of document.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'resume') setPaused(false);
      else if (act === 'rewind') rewindNow();
      else if (act === 'restart') startFlight(plan);
      else if (act === 'setup') { ui.crash.hidden = true; ui.score.hidden = true; crashed = false; newFlight(); }
      else if (act === 'logbook') { input.setEnabled(false); logbook.open(); }
      else if (act === 'mute') {
        callouts.muted = !callouts.muted;
        btn.textContent = 'Callouts: ' + (callouts.muted ? 'off' : 'on');
        store.save('settings', { ...store.load('settings', {}), muted: callouts.muted });
      }
    });
  }
  // The first click or key starts the audio (browsers need a user gesture).
  const startAudio = () => { if (paused) return; audioStarted = true; synth?.start(); window.removeEventListener('pointerdown', startAudio); window.removeEventListener('keydown', startAudio); };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);

  hud.onlaw = (law) => { sim.controls.law = law; };
  map.onjump = (sample) => jumpTo(sample);
  map.onskipfinal = () => { map.close(); skipToFinal(); };
  predictor.onresult = (res) => {
    prediction = res.samples;
    map.setPrediction(prediction);
    // Once per autopilot setting, not at every 20 s re-run.
    if (res.reason === 'terrain' && map.isOpen && terrainToastKey !== apKey) { terrainToastKey = apKey; toast('The predicted path meets the terrain (red cross)', 3500); }
  };

  // ---- Events from the sim ----
  function landingEndFor(x, y, hdg) {
    const r = rw.onRunway(x, y);
    if (!r) return null;
    const fx = Math.sin(hdg), fy = Math.cos(hdg);
    const [a, b] = r.ends;
    const dot = (b.x - a.x) * fx + (b.y - a.y) * fy;
    return dot >= 0 ? { end: a, other: b } : { end: b, other: a };
  }

  function handleEvents() {
    const evs = sim.events;
    if (!evs.length) { const res = scorer.update(sim.state, evs); if (res) showScore(res); return; }
    for (const e of evs) {
      if (e.type === 'liftoff') landed = false;
      if (e.type === 'liftoff' && liftoffT === null) liftoffT = sim.state.t;
      if (e.type === 'touchdown') landed = true;
      if (e.type === 'touchdown' && !scorer.touchedDown) {
        const le = landingEndFor(e.x, e.y, sim.state.hdg);
        if (le) scorer.setRunway(le.end, le.other);
      }
      if (e.type === 'crash') {
        crashed = true;
        ui.crashReason.textContent = e.reason || sim.state.crashed || 'The aircraft was destroyed.';
        ui.crash.hidden = false;
        ui.pause.hidden = true;
        setTimeScale(1);
        callouts.reset();
      }
      if (e.type === 'apDisconnect') { setTimeScale(1); clearPrediction(); }
    }
    const res = scorer.update(sim.state, evs);
    evs.length = 0;
    if (res) showScore(res);
  }

  function showScore(res) {
    const s = sim.state;
    const le = landingEndFor(s.pos.x, s.pos.y, s.hdg);
    const arr = le ? airports.find((a) => a.runways.some((r) => r.ends.includes(le.end))) : null;
    const rf = le ? runwayFrame(le.end, le.other) : null;
    const rwy = le ? airports.flatMap((a) => a.runways).find((x) => x.ends.includes(le.end)) : null;
    scoreCard.show(res, {
      route: `${plan.origin}–${arr ? arr.icao : plan.dest}`, runway: le ? le.end.ident : null,
      runwayLengthM: rf ? rf.lda : undefined, runwayWidthM: rwy?.widthM, aimM: rf ? aimingPoint(rf.lda) : 400,
    });
    store.addLogEntry({
      date: new Date().toISOString(), route: `${plan.origin}–${arr ? arr.icao : plan.dest}`,
      depRunway: plan.start === 'runway' ? plan.depRunway : null, arrRunway: le ? le.end.ident : null, gate: plan.start === 'gate' ? plan.stand ?? null : null,
      airTimeS: liftoffT !== null ? Math.round(res.touchdown.t - liftoffT) : null,
      fuelUsedKg: Math.round(fuelAtStart - s.fuelKg), score: { points: res.points, grade: res.grade, parts: res.parts },
    });
    window.__fsLastScore = res;
  }

  // ---- Prediction ----
  function maybePredict(now) {
    if (!ap.ap && prediction) clearPrediction(); // the path shows only with the autopilot on
    if (!map.isOpen || !ap.ap) return;
    const key = [ap.hdgDeg, ap.altFt, ap.vsFpm, ap.spdKt, ap.vertical, ap.lateral, ap.athr].join('|');
    // Rerun when a target changes, and every 20 s while the map is open (the aircraft moves on).
    if (key !== apKey || now - lastPredictReal > 20000) {
      apKey = key;
      lastPredictReal = now;
      predictor.request(sim.snapshot(), {});
    }
  }

  // ---- The frame loop ----
  const origin = { x: 0, y: 0 };
  const camMap = { x: 0, y: 0, z: 0 };
  const scenePos = [0, 0, 0];
  const view = { state: sim.state, ap, controls: sim.controls, dest: null, timeScale: 1, timeScaleActual: 1, paused: false };
  let last = performance.now(), lastRender = 0, raf = 0;
  let fpsFrames = 0, fpsT = performance.now(), fps = 0, cpuMs = 0, mapSkip = 0;

  function requestFrame() { if (!raf) raf = requestAnimationFrame(frame); }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
    hud.resize?.();
    requestFrame();
  }
  window.addEventListener('resize', resize);
  // A pinch over a panel or dialog must not zoom the page (the canvas handles its own).
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  function frame(now) {
    raf = 0;
    if (paused || document.hidden) { renderOnce(); return; }
    raf = requestAnimationFrame(frame);
    if (now - lastRender < FRAME_MS - 2) return; // the 60 fps cap on fast screens
    lastRender = now;
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const s = sim.state;
    input.update(dt, sim.controls, s.onGround);
    if (window.__fsController) window.__fsController(sim, dt); // test-only landing controller
    if (crashed) { render(dt); cancelAnimationFrame(raf); raf = 0; return; } // the crash panel waits; rewind/restart restart the loop

    // Physics: fixed steps, within a per-frame budget.
    if (timeScale > 1 && !canCompress()) setTimeScale(1);
    acc += dt * timeScale;
    let steps = Math.floor(acc / STEP);
    acc -= steps * STEP;
    let done = 0;
    for (; done < steps; done++) {
      sim.step(STEP);
      if (s.crashed) { done++; break; }
      if (timeScale > 1 && (done & 7) === 7 && performance.now() - t0 > PHYSICS_BUDGET_MS) { done++; break; }
    }
    if (done < steps) acc = 0;
    if (timeScale > 1) {
      const reached = (done * STEP) / dt;
      achievedScale += (Math.min(timeScale, reached) - achievedScale) * 0.1;
      slowFrames = reached < timeScale * 0.9 ? slowFrames + 1 : 0;
      if (slowFrames > 90) { setTimeScale(RATES[RATES.indexOf(timeScale) - 1]); toast('Time compression reduced to keep the frame rate'); }
    }
    if (timeScale > 1 && !canCompress()) setTimeScale(1);

    gate.update(dt, sim.controls);
    if (landed) {
      gate.afterLanding(s);
      // Keep the arrival stand clear of parked aircraft (and of neighbours overlapping it).
      const r = gate.route;
      if (gate.phase === 'taxi-in' && r && r.stand !== arrivalStand) {
        arrivalStand = r.stand;
        const a = airports.find((ap) => ap.origin && Math.hypot(ap.origin[0] - s.pos.x, ap.origin[1] - s.pos.y) < 8000);
        if (a) world.traffic?.setPlayerStand(a.icao, r.stand);
      }
    }

    if (s.t - lastSnapT >= 1) {
      lastSnapT = s.t;
      rewind.push({ t: s.t, snap: sim.snapshot() });
      if (rewind.length > REWIND_S + 15) rewind.shift();
    }
    handleEvents();
    callouts.update(s, now / 1000);
    maybePredict(now);
    render(dt);
    cpuMs += (performance.now() - t0 - cpuMs) * 0.05;
  }

  function render(dt) {
    const s = sim.state;
    rig.update(s, camMap);
    origin.x = camMap.x; origin.y = camMap.y;
    toScene(s.pos.x, s.pos.y, s.pos.z, origin, scenePos);
    aircraft.object.position.set(scenePos[0], scenePos[1], scenePos[2]);
    aircraft.object.rotation.set(s.pitch, -s.hdg, -s.roll, 'YXZ');
    const seat = rig.view.id === 'captain' || rig.view.id === 'fo';
    aircraft.setCockpitView(seat);
    cockpit.object.visible = seat;
    aircraft.update(s, dt);
    if (seat) cockpit.update(s, sim.controls);
    // Behind the (nearly opaque) map, the 3D view only needs a few frames a second.
    if (!map.isOpen || ++mapSkip % 10 === 0) {
      world.update({ camera, origin, state: s, dt, paused });
      renderer.render(scene, camera);
    }

    view.dest = dest ? dest.end : null;
    view.destAirport = dest ? dest.airport : null;
    view.timeScale = timeScale;
    view.timeScaleActual = timeScale > 1 ? Math.round(achievedScale * 10) / 10 : 1;
    view.paused = paused;
    view.waypoints = plan?.waypoints || [];
    view.taxiRoute = gate.points;
    hud.update(view);
    if (map.isOpen) map.update(view);
    synthOpts.inside = seat; synthOpts.timeScale = timeScale; synthOpts.paused = paused;
    synth?.update(s, synthOpts);

    fpsFrames++;
    const now = performance.now();
    if (now - fpsT >= 1000) { fps = (fpsFrames * 1000) / (now - fpsT); fpsFrames = 0; fpsT = now; }
    if (!ui.perf.hidden) {
      const info = renderer.info.render;
      ui.perf.textContent = `${fps.toFixed(0)} fps  cpu ${cpuMs.toFixed(1)} ms  tris ${(info.triangles / 1000).toFixed(0)}k  calls ${info.calls}\n` +
        `x${timeScale}${timeScale > 1 ? ` (reached ${achievedScale.toFixed(1)})` : ''}  ${detentName(sim.controls.thrust)}  ${rig.view.name}`;
    }
    window.__fsStats = { fps, cpuMs, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  }
  function renderOnce() { render(0); synth?.update(sim.state, { inside: false, timeScale, paused: true }); }

  resize();
  booted = true;
  ui.loading.hidden = true;

  // ---- Test hooks (used by tests/browser-*.mjs) ----
  window.__fs = {
    sim, ap, input, rig, scorer, callouts, predictor, map, world, renderer, gate,
    get synth() { return synth; },
    get prediction() { return prediction; },
    get timeScale() { return timeScale; },
    get achievedScale() { return achievedScale; },
    get paused() { return paused; },
    get crashed() { return crashed; },
    get dest() { return dest; },
    startFlight, skipToFinal, jumpTo, setTimeScale: (r) => { if (r === 1 || canCompress()) setTimeScale(r); return timeScale; },
    setPaused, rewindNow, requestPredict: () => { predictor.request(sim.snapshot(), {}); },
    renderOnce, runwayEnds, runwayAxis,
    gridToMagDeg: (h, x, y) => gridToMag(h, x, y) / DEG,
  };

  if (TEST && params.get('origin')) {
    startFlight({ origin: params.get('origin'), depRunway: params.get('dep') || '14R', dest: params.get('dest') || 'RKPC',
      arrRunway: params.get('arr') || '07', start: params.get('start') || 'runway', stand: params.get('stand') || null, pax: 180, cargoKg: 2000,
      fuelKg: Number(params.get('fuel')) || 7500, waypoints: [] });
  } else {
    // Behind the setup screen, show the last flight's departure runway (or Gimpo 14R).
    const last = store.load('lastflight', null);
    try { placeOnRunway(last?.origin || 'RKSS', last?.depRunway || '14R', { fuelKg: 5000, payloadKg: 15000 }); }
    catch { try { placeOnRunway('RKSS', '14R', { fuelKg: 5000, payloadKg: 15000 }); } catch {} }
    rig.viewId = 'orbit';
    renderOnce();
    newFlight();
  }
}

boot().catch(fail);
