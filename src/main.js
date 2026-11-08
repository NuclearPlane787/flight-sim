// Flight Sim: boot, the frame loop, and the glue between the sim, the world, the aircraft,
// the screens and the sound. Fixed 1/120 s physics steps, rendering capped at 60 fps,
// nothing running while paused or hidden.

import * as THREE from '../vendor/three.module.js';
import { toScene, gridToMag, toGeo } from './world/frame.js';
import { createInput } from './input.js';
import { createCameraRig } from './camera.js';
import { createCallouts } from './audio/callouts.js';
import { createScorer, runwayFrame, aimingPoint, landingRunway, runwayEndRefs } from './score.js';
import { createLogbook } from './ui/logbook.js';
import { createScorePanel } from './ui/score-panel.js';
import * as store from './store.js';
import { createGateFlow } from './ground/gate-flow.js';
import { standHeading } from './world/traffic-layout.js';
import { VERSION } from './version.js';
import { ScenarioStore, whereText, legacyId } from './scenarios.js';
import { createMenu, createSettingsPage, createControlsPage } from './ui/menu.js';
import { createClock, afternoonOf } from './clock.js';
import { typeById, DEFAULT_TYPE } from './sim/types.js';

const STEP = 1 / 120;
const KT = 1.943844, FT = 3.28084, NM = 1852, DEG = Math.PI / 180;
const RATES = [1, 2, 4, 8, 16];
const PUSH_MAX_RATE = 4;     // time compression in a pushback
const TC_MIN_AGL = 2000 / FT;   // time compression only above 2,000 ft AGL
const PHYSICS_BUDGET_MS = 7;    // per frame; beyond it, steps are dropped and the rate falls
const FRAME_MS = 1000 / 60;
const REWIND_S = 30;
const AUTOSAVE_MS = 60000;      // autosave every 60 s in flight, as in Satisfactory
const MENU_STILLS = ['assets/menu/gimpo-gate.jpg', 'assets/menu/jeju-final.jpg', 'assets/menu/seoul.jpg', 'assets/menu/seoul-night.jpg'];

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
  const [simMod, predMod, worldMod, hfMod, rwMod, assetsMod, hudMod, mapMod, setupMod, synthMod, lightsMod, skyWinMod] = await Promise.all([
    import('./sim/sim.js'), import('./sim/predict.js').catch(() => ({ createPredictor: () => ({ request() {}, cancel() {} }) })), import('./world/world.js'),
    import('./world/heightfield.js'), import('./world/runways.js'), import('./type-assets.js'),
    import('./ui/hud.js'), import('./ui/map.js'), import('./ui/setup.js'),
    import('./audio/synth.js').catch(() => null),
    // v0.2.0, night: optional, so the game runs without them.
    import('./aircraft-lights.js').catch(() => null), import('./ui/sky-window.js').catch(() => null),
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
  // The aircraft and its cockpit, one pair per type, built the first time it's flown (v0.3.0).
  let aircraft = null, cockpit = null;
  const models = new Map();
  function modelFor(id) {
    let m = models.get(id);
    if (!m) {
      const b = assetsMod.buildersFor(id);
      m = { aircraft: b.createAircraft(), cockpit: b.createCockpit() };
      m.aircraft.object.add(m.cockpit.object);
      models.set(id, m);
    }
    return m;
  }
  function showModel(id) {
    if (aircraft) scene.remove(aircraft.object);
    ({ aircraft, cockpit } = modelFor(id));
    scene.add(aircraft.object);
    lastNight = -1;     // the night's look goes to the new model at the next frame
  }

  // The sim and its ground.
  const g = { h: 0, kind: 'ground' };
  const ground = (x, y) => { g.h = hf.heightAt(x, y); g.kind = rw.groundKind(x, y); return g; };
  const sim = simMod.createSim({ ground, type: DEFAULT_TYPE });
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
  // Saved settings: { muted, volume (0..1), showPerf }.
  const settings = store.load('settings', {}) || {};
  const saveSetting = (k, v) => store.save('settings', { ...(store.load('settings', {}) || {}), [k]: v });
  if (settings.muted) callouts.muted = true;

  // The fonts (style.css, vendor/fonts): loaded before the canvases first draw, at most 3 s.
  if (document.fonts?.load) {
    await Promise.race([
      Promise.all(['400 16px B612', '700 16px B612', '400 16px "B612 Mono"', '700 16px "B612 Mono"', '400 16px Barlow', '600 16px Barlow']
        .map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 3000)),
    ]).catch(() => {});
  }
  // The aircraft type: everything that reads it, in one place. Before a reset or a restore.
  let flyingType = null;
  function useType(id) {
    const def = typeById(id);
    if (flyingType === def.id) return def;
    flyingType = def.id;
    sim.setType(def.id);
    showModel(def.id);
    rig.setType(def);
    scorer.setType(def);
    callouts.setType(def);
    input.setDetents(def.data.THRUST_DETENTS);
    synth?.setType?.(def);
    hud?.setType?.(def);
    controlsPage?.setFamily?.(def.family);
    return def;
  }
  const hud = hudMod.createHud($('hud'), { airports, coast });
  const map = mapMod.createMap($('map-root'), { airports, coast });
  const setup = setupMod.createSetup($('setup-root'), { airports, coast });

  // ---- Scenarios (save slots with the whole state; src/scenarios.js) ----
  let scenarios = null;
  try { scenarios = new ScenarioStore(window.localStorage); } catch { scenarios = null; }
  try { scenarios?.migrate(); } catch (e) { console.warn('scenario migration', e); }
  let current = null;            // { id, name } of the scenario being flown, or null (test starts)
  let inMenu = false;
  let lastAutosave = 0, lastSaveMs = 0;
  // The clock (src/clock.js): KST time and date, whether it runs, and its speed. It steps with
  // the sim, so time compression speeds it up too. A new flight starts at Now unless the setup
  // picks a time; a migrated Scenario 1 starts in the afternoon.
  const clock = createClock({ ms: Date.now(), running: true, speed: 1 });
  let skyWin = null;   // the Sky window (src/ui/sky-window.js), once it's loaded
  const geo = [0, 0];
  function placeNow() { const s = sim.state; const g = toGeo(s.pos.x, s.pos.y); return { lat: g[0], lon: g[1] }; }

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
    const toFlap = sim.type.data.TAKEOFF_FLAP_LEVER;
    sim.reset({ x, y, hdg: ax.hdg, onGround: true, flapLever: toFlap, gearDown: true,
      fuelKg: keep ? keep.fuelKg : plan.fuelKg, payloadKg: keep ? keep.payloadKg : payloadOf(plan) });
    sim.controls.flapLever = toFlap;
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
    // A heavy Boeing: 180 kt would be under its minimum manoeuvring speed, so flaps 5 and at least 10 kt
    // above it. (The A321's start is as it always was.)
    const finalFlap = sim.type.data.FINAL_FLAP_LEVER ?? 1;
    const ic = { x, y, z, hdg: ax.hdg, onGround: false, iasMs: 180 / KT, flapLever: finalFlap, gearDown: false,
      fuelKg: keep ? keep.fuelKg : plan.fuelKg, payloadKg: keep ? keep.payloadKg : payloadOf(plan) };
    sim.reset(ic);
    let finalKt = 180;
    if (sim.state.vmm && sim.state.vmm * KT + 10 > finalKt) {
      finalKt = Math.round(sim.state.vmm * KT + 10);
      sim.reset({ ...ic, iasMs: finalKt / KT });
    }
    sim.controls.flapLever = finalFlap;
    sim.controls.gearDown = false;
    sim.controls.speedbrake = 0;
    // The lever at the trim thrust (sim.reset puts it there), at most CL: the A/THR takes it
    // from there and moves it (v0.2.2; before, it sat in CL).
    input.lever = sim.controls.thrust = Math.min(sim.controls.thrust, sim.leverClimb);
    ap.setHdg(Math.round(gridToMag(ax.hdg, x, y) / DEG) % 360 || 360);
    ap.hdgSel?.();       // a Boeing's window is only the mode once it's selected
    ap.setAlt(Math.round((z * FT) / 100) * 100);
    ap.setSpd(finalKt);
    ap.engageAp();
    if (!ap.athr) ap.toggleAthr();
    syncNav();
    setTimeScale(1);
  }

  // What a widebody needs kept clear round its stand (undefined for code C: as before v0.3.0).
  function standClear() {
    const t = sim.type;
    return t.icaoCode === 'E' ? { span: t.geo.SPAN, length: t.geo.LENGTH, path: gate.pushPath?.() } : undefined;
  }
  // What a Boeing's LOC, G/S and LNAV follow: the destination's ILS and the map's route (v0.3.0).
  // sim.reset() clears them, so after every reset, and when the route changes.
  let navKey = '';
  function syncNav() {
    if (!ap.setIls) return;
    if (dest) {
      const ax = runwayAxis(dest.end, dest.other);
      ap.setIls({ x: ax.tx, y: ax.ty, hdgGrid: ax.hdg, elev: dest.end.elevM ?? dest.airport.elevM ?? 0, gsDeg: 3 });
    } else ap.setIls(null);
    const wp = map.waypoints || [];
    navKey = navKeyNow();
    ap.setRoute(dest ? [...wp, [dest.end.x, dest.end.y]] : wp);
  }
  const navKeyNow = () => (map.waypoints || []).join(';') + '|' + (dest ? dest.end.x + ',' + dest.end.y : '');
  const payloadOf = (p) => (p.pax || 0) * (sim.type.limits.PAX_KG || 84) + (p.cargoKg || 0);

  function startFlight(p, { keepClock = false } = {}) {
    plan = p;
    useType(p.type);
    store.save('lastflight', p);
    map.setWaypoints(p.waypoints || []);
    // The time of day: Now (the real time in Korea), or the one picked in the setup. Restart the
    // flight keeps the clock as it is (a night the player set stays night).
    if (!keepClock) {
      clock.set(p.time?.mode === 'set' && Number.isFinite(p.time.ms) ? p.time.ms : Date.now());
      clock.setRunning(true); clock.setSpeed(1);
    }
    dest = runwayEnds(p.dest, p.arrRunway);
    destOther = dest ? dest.other : null;
    scorer.reset();
    if (dest) scorer.setRunway(dest.end, dest.other);
    landed = false; arrivalStand = null;
    if (p.start === 'gate' && p.stand) {
      gate.start(p);
      input.lever = 0;
      world.traffic?.setPlayerStand(p.origin, gate.stand?.ref ?? p.stand, standClear());   // the flow may have changed the stand
    } else {
      gate.clear();
      world.traffic?.setPlayerStand(p.origin, null);
      if (p.start === 'final' && dest) placeOnFinal(null);
      else placeOnRunway(p.origin, p.depRunway, null);
    }
    syncNav();
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

  // A new flight inside the scenario (the pause menu, the crash panel, the score card): it
  // replaces the scenario's flight. Parked at a stand after arriving, it starts from there.
  async function newFlight() {
    if (skyWin?.isOpen) skyWin.close();
    setPaused(true, true);
    input.setEnabled(false);
    const last = plan || store.load('lastflight', null);
    const defaults = { ...(last || { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway' }) };
    const at = arrivedAt();
    if (at) Object.assign(defaults, { origin: at.icao, start: 'gate', stand: at.stand, depRunway: '' });
    if (!defaults.type) defaults.type = sim.type.id;   // a plan from before v0.3.0
    const p = await setup.show(defaults, { title: 'New flight', cancel: !!plan, lockType: !!current });
    if (!p) {
      input.setEnabled(true);
      // Cancelled after a crash: back to the crash panel (the flight can't go on).
      if (crashed || sim.state.crashed) { crashed = true; ui.crash.hidden = false; return; }
      if (plan) setPaused(true);
      return;
    }
    input.setEnabled(true);
    startFlight(p);
    saveNow('new flight');
  }
  // Parked (or taxiing in) at a stand after landing: { icao, stand }, else null.
  function arrivedAt() {
    if (!plan || !landed || !sim.state.onGround) return null;
    const r = gate.route, st = gate.stand;
    const ref = (gate.phase === 'arrived' || gate.phase === 'taxi-in') ? (r?.stand ?? st?.ref) : null;
    if (!ref) return null;
    const s = sim.state;
    const a = airports.find((ap) => ap.origin && Math.hypot(ap.origin[0] - s.pos.x, ap.origin[1] - s.pos.y) < 8000);
    return a ? { icao: a.icao, stand: ref } : null;
  }

  // ---- Scenarios: save, load, the main menu ----
  const nearAirport = (s) => airports.find((ap) => ap.origin && Math.hypot(ap.origin[0] - s.pos.x, ap.origin[1] - s.pos.y) < 8000) || null;
  function summaryNow() {
    const s = sim.state, a = nearAirport(s);
    let distNm = null;
    if (dest) distNm = Math.hypot(dest.end.x - s.pos.x, dest.end.y - s.pos.y) / NM;
    return {
      route: `${plan.origin}–${plan.dest}`,
      where: whereText({ onGround: s.onGround, altFt: s.pos.z * FT, distNm, destIcao: plan.dest, phase: gate.phase,
        icao: a ? a.icao : plan.origin, stand: gate.phase === 'arrived' ? (gate.route?.stand ?? gate.stand?.ref) : (gate.phase === 'parked' ? (gate.stand?.ref ?? plan.stand) : null), crashed: !!crashed }),
    };
  }
  function captureState() {
    return {
      v: 1, plan: { ...plan, waypoints: (map.waypoints || plan.waypoints || []).map((p) => [Math.round(p[0]), Math.round(p[1])]) },
      sim: sim.snapshot(), gate: gate.serialize(),
      flight: { landed, arrivalStand, arrivalIcao: arrivalStand ? nearAirport(sim.state)?.icao ?? null : null, liftoffT, fuelAtStart, lever: input.lever },
      scorer: scorer.serialize(endRefs.identify), camera: rig.serialize(), clock: clock.serialize(),
    };
  }
  // Never a crashed state: a crash leaves the last good save.
  function saveNow(reason = '') {
    if (!scenarios || !current || !plan || crashed || sim.state.crashed) return false;
    const t0 = performance.now();
    const res = scenarios.write(current.id, captureState(), summaryNow());
    lastSaveMs = performance.now() - t0;
    lastAutosave = performance.now();
    window.__fsLastSave = { reason, ms: lastSaveMs, ok: res.ok, at: Date.now() };
    if (!res.ok) toast(res.error === 'quota' ? 'Could not save: the browser’s storage is full' : 'Could not save the scenario', 4000);
    return res.ok;
  }
  const endRefs = runwayEndRefs(airports);
  function applyState(st) {
    plan = st.plan;
    store.save('lastflight', plan);
    dest = runwayEnds(plan.dest, plan.arrRunway);
    destOther = dest ? dest.other : null;
    useType(st.sim?.type || plan.type);       // a save from before v0.3.0 is the A321neo
    gate.deserialize(st.gate, plan);          // may reset the sim (a gate start), so before restore
    sim.restore(st.sim);
    gate.afterLoad();
    const f = st.flight || {};
    landed = !!f.landed; arrivalStand = f.arrivalStand ?? null;
    liftoffT = f.liftoffT ?? null; fuelAtStart = f.fuelAtStart ?? sim.state.fuelKg;
    input.lever = Number.isFinite(f.lever) ? f.lever : sim.controls.thrust;
    // The stand left behind stays free while the aircraft is near it, as in live play.
    if (plan.start === 'gate' && !landed && ['parked', 'pushback', 'taxi', 'departed'].includes(gate.phase)) world.traffic?.setPlayerStand(plan.origin, gate.stand?.ref ?? plan.stand, standClear());
    else if (arrivalStand && f.arrivalIcao) world.traffic?.setPlayerStand(f.arrivalIcao, arrivalStand, standClear());
    else world.traffic?.setPlayerStand(plan.origin, null);
    scorer.reset();
    if (dest) scorer.setRunway(dest.end, dest.other);
    if (st.scorer) scorer.load(st.scorer, endRefs.resolve);
    if (st.camera) rig.load(st.camera);
    clock.load(st.clock);
    map.setWaypoints(plan.waypoints || []);
    navKey = navKeyNow();                  // the save's ILS and route came with the snapshot
    rewind = []; lastSnapT = sim.state.t; acc = 0;
    crashed = false; clearPrediction();
    callouts.reset();
    sim.events.length = 0;
    ui.crash.hidden = true; ui.score.hidden = true;
    setTimeScale(1);
  }

  function loadScenario(id) {
    const rec = scenarios?.get(id);
    if (!rec) { toast('That scenario could not be read'); menu.refresh(); return; }
    current = { id: rec.id, name: rec.name };
    hideMenu();
    const st = rec.state;
    try {
      if (!st || st.fresh || !st.sim) {
        startFlight(st?.plan || { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: 190, cargoKg: 1500, fuelKg: 4000, waypoints: [] });
        if (!st?.plan?.time && st?.clock) clock.load(st.clock);   // the migrated Scenario 1: the afternoon
        saveNow('load fresh');
      } else {
        applyState(st);
        setPaused(false);
      }
    } catch (e) {
      console.error(e);
      toast('That scenario could not be loaded: ' + (e.message || e), 5000);
      showMenu();
      return;
    }
    lastAutosave = performance.now();
  }
  async function newScenario() {
    menu.hide();
    const last = store.load('lastflight', null);
    const p = await setup.show(last || { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway' },
      { title: 'New scenario', name: scenarios ? scenarios.defaultName() : 'Scenario 1', nameField: true, cancel: true });
    if (!p) { menu.show(); menu.refresh(); return; }
    const name = p.name; delete p.name;
    if (!scenarios) toast('Browser storage is off: flying without saving', 4000);
    if (scenarios) {
      const res = scenarios.create(name, { v: 1, fresh: true, plan: p }, { route: `${p.origin}–${p.dest}`, where: 'Not flown yet' });
      if (res.ok) current = { id: res.id, name: res.entry?.name ?? name };
      else { current = null; toast(res.error === 'quota' ? 'Could not save: the browser’s storage is full. Flying without saving.' : 'Could not create the scenario', 5000); }
    }
    hideMenu();
    startFlight(p);
    saveNow('new scenario');
  }
  function exitToMenu() {
    saveNow('exit to menu');
    setPaused(true, true);
    ui.pause.hidden = true; ui.crash.hidden = true; ui.score.hidden = true;
    if (map.isOpen) map.close();
    showMenu();
  }
  function showMenu() {
    inMenu = true;
    if (skyWin?.isOpen) skyWin.close();   // else its Esc handler would still catch the menu's Esc
    input.setEnabled(false);
    paused = true;
    if (synth && audioStarted) synth.stop();
    document.body.classList.add('in-menu');
    menu.refresh();
    menu.show();
  }
  function hideMenu() {
    inMenu = false;
    document.body.classList.remove('in-menu');
    menu.hide();
    input.setEnabled(true);
  }

  // After the sim jumps (restore, rewind, skip to final): the keyboard's thrust lever follows
  // the restored one, the old predicted path and pending prediction go, the callouts re-arm,
  // and the rewind buffer records from here.
  function afterJump(rewound = false) {
    // A jump or skip leaves the ground flow behind; a rewind carries it on from where the
    // aircraft now is (the gate state isn't in the sim's snapshots).
    if (rewound) gate.afterRestore(); else gate.clear();
    input.lever = Math.max(sim.state.onGround ? -1 : 0, sim.controls.thrust);
    navKey = '';   // a snapshot brings its own ILS and route: back to the current ones (v0.3.0)
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

  // ---- Changing the route (v0.2.1) ----
  // Shane: "Be able to change the route during a flight." A new destination and runway from
  // the map (Change route, or a click on an airport). The magenta line then goes direct from
  // where the aircraft is, and waypoints can be dragged onto it again. The ND, the PFD's
  // approach scales, skip to final, the score and the saved scenario all follow `dest`. The
  // departure stays as it was. Once landed there's nothing to change: a new flight does that.
  function changeRoute(icao, ident) {
    if (!plan || crashed) return { ok: false, error: 'There’s no flight to change' };
    if (landed && sim.state.onGround) return { ok: false, error: 'You’ve landed. A new flight (Esc → New flight) starts from here.' };
    const d = runwayEnds(icao, ident);
    if (!d) return { ok: false, error: `${icao} has no runway ${ident}` };
    const same = dest && d.end === dest.end;
    plan.dest = icao; plan.arrRunway = ident; plan.waypoints = [];
    dest = d; destOther = d.other;
    map.setWaypoints([]);
    // Until the touchdown the scorer only holds the planned runway (the touchdown sets the
    // one actually landed on); the approach track it keeps isn't tied to either.
    if (!scorer.touchedDown) scorer.setRunway(d.end, d.other);
    syncNav();
    toast(same ? `Direct to ${icao} ${ident}` : `New route: ${plan.origin} to ${icao}, runway ${ident}`, 2500);
    saveNow('route');
    return { ok: true };
  }

  // ---- Views (v0.2.1): the switch at the top right, and 1, 2, 3 ----
  // Cockpit is the captain's seat. In a seat it does nothing (v0.2.2: it used to swap seats;
  // Shane: "When you are in cockpit view, you can transfer to the first officer's seat by
  // pressing the button again."). V still steps through all four views, the first officer's too.
  const isSeat = (id) => id === 'captain' || id === 'fo';
  function selectView(which) {
    const cur = rig.view.id;
    let id = which;
    // Cockpit (or 1) from outside goes to the captain's seat; pressed again in a seat, it swaps to the
    // other one (v0.3.1: Shane wanted the swap; v0.2.2 had taken it out).
    if (which === 'cockpit') id = cur === 'captain' ? 'fo' : cur === 'fo' ? 'captain' : 'captain';
    if (id === cur) return;
    rig.viewId = id;
    toast(rig.view.name, 1000);
    if (paused) renderOnce();
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
  // Time compression: with the autopilot on and 2,000 ft up, or in a pushback (up to 4x, so
  // the tug keeps its real speed without the wait).
  function pushing() { return gate.phase === 'pushback' && !!gate.pushback?.state.running && !crashed; }
  function canCompress() {
    const s = sim.state;
    if (pushing()) return timeScale <= PUSH_MAX_RATE;
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
    if (dir > 0 && !canCompress()) { toast('Time compression needs the autopilot on and 2,000 ft above the ground, or a pushback'); return; }
    if (dir > 0 && pushing() && RATES[i] > PUSH_MAX_RATE) { toast(`Pushback: up to ${PUSH_MAX_RATE}×`); return; }
    setTimeScale(RATES[i]);
  }

  // ---- Rewind ----
  function rewindNow() {
    const target = sim.state.t - REWIND_S;
    let snap = null;
    let clockMs = null;
    for (let i = rewind.length - 1; i >= 0; i--) if (rewind[i].t <= target) { snap = rewind[i].snap; clockMs = rewind[i].clockMs; rewind.length = i + 1; break; }
    if (!snap && rewind.length) { snap = rewind[0].snap; clockMs = rewind[0].clockMs; rewind.length = 1; }
    if (!snap) { toast('Nothing to rewind to yet'); return; }
    sim.restore(snap);
    if (Number.isFinite(clockMs)) clock.set(clockMs);   // the time of day goes back too
    afterJump(true);
    landed = gate.phase === 'taxi-in' || gate.phase === 'arrived';
    crashed = false;
    ui.crash.hidden = true;
    setTimeScale(1);
    scorer.reset(true); // the approach flown before the rewound-to moment still counts
    if (dest) scorer.setRunway(dest.end, dest.other);
    setPaused(false);
  }

  // ---- Pause ----
  function setPaused(v, quiet = false) {
    if (v && !paused && !inMenu) saveNow('pause');
    paused = v;
    // Paused, the audio thread stops too (the CPU rules); it resumes only if sound had started.
    if (synth && audioStarted) { if (v) synth.stop(); else synth.start(); }
    ui.pause.hidden = !v || quiet || crashed;
    if (v && !ui.pause.hidden) { const ps = $('pause-scenario'); if (ps) ps.textContent = current ? current.name : ''; }
    input.dropAll();
    if (!v) { last = performance.now(); requestFrame(); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !paused) setPaused(true);
    else if (document.hidden && !inMenu) saveNow('hidden');
  });
  // Closing or leaving the page saves (localStorage is synchronous, so this completes).
  window.addEventListener('pagehide', () => { if (!inMenu) saveNow('pagehide'); });

  // ---- Actions ----
  input.onAction((a) => {
    if (!plan || inMenu || setup.isOpen) return;
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
      case 'toga': ap.toga?.(); break;
      case 'athr': ap.toggleAthr(); break;
      case 'faster': changeRate(1); break;
      case 'slower': changeRate(-1); break;
      case 'map': map.toggle(); if (map.isOpen) apKey = ''; else predictor.cancel(); break;
      case 'view': { const v = rig.next(); toast(v.name, 1000); break; }
      case 'viewCockpit': selectView('cockpit'); break;
      case 'viewNose': selectView('nose'); break;
      case 'viewOrbit': selectView('orbit'); break;
      case 'pushback':
        if (gate.phase === 'parked' || gate.phase === 'pushback') gate.onKey('pushback');
        else toast('Pushback works from a gate start (Flight setup → At the gate)');
        break;
      case 'perf': setPerf(ui.perf.hidden); break;
      case 'rewind': break; // T: handled above, only from the pause or crash screens
      default:
        if (a === 'flapUp' || a === 'flapDown') {
          const n = sim.type.data.FLAP_LEVER.length;
          c.flapLever = Math.max(0, Math.min(n - 1, (c.flapLever | 0) + (a === 'flapDown' ? 1 : -1)));
          toast('Flaps ' + sim.type.data.FLAP_LEVER[c.flapLever], 900);
        } else if (a.startsWith('flap')) c.flapLever = sim.type.data.FLAP_KEYS[Number(a.slice(4))];
    }
  });

  const scoreCard = createScorePanel(ui.score, { onnewflight: () => { ui.crash.hidden = true; crashed = false; newFlight(); } });
  const logbook = createLogbook($('logbook-root'), { load: store.load, save: store.save, onclose: () => { if (!inMenu) input.setEnabled(true); } });
  const scenarioList = () => (scenarios ? scenarios.list().map((e) => ({ id: e.id, name: e.name })) : []);
  const legacy = () => (scenarios ? legacyId(scenarios.list()) : null);
  function openLogbook(scoped) {
    input.setEnabled(false);
    logbook.open(scoped && current ? { scenarioId: current.id, scenarios: scenarioList(), legacyId: legacy() } : { scenarios: scenarioList(), legacyId: legacy() });
  }

  // ---- Settings and Controls (from the main menu and the pause menu) ----
  function setCallouts(on) { callouts.muted = !on; saveSetting('muted', callouts.muted); }
  const settingsPage = createSettingsPage($('pages-root'), {
    get: () => ({ volume: callouts.volume ?? 1, callouts: !callouts.muted, showPerf: !ui.perf.hidden }),
    onVolume: (v) => { setVolume(v); previewVolume(); },
    onCallouts: (on) => setCallouts(on),
    onPerf: (on) => setPerf(on),
    ...(skyWinMod?.createSkyWindow ? { onSky: () => {
      if (inMenu || !plan) { toast('The Sky window opens in flight: start or load a scenario'); return; }
      setPaused(false); openSky();
    } } : {}),
  });
  const controlsPage = createControlsPage($('pages-root'), { sky: !!skyWinMod?.createSkyWindow });
  for (const pg of [settingsPage, controlsPage]) pg.onclose = () => { if (!inMenu && !paused) input.setEnabled(true); };

  for (const btn of document.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'resume') setPaused(false);
      else if (act === 'save') {
        if (!scenarios) toast('Browser storage is off: flying without saving');
        else if (!current) toast('This flight isn’t a scenario (a test start): nothing to save to');
        else if (crashed || sim.state.crashed) toast('Crashed: the last good save is kept');
        else if (saveNow('save')) toast(`Saved “${current.name}”`, 1500);
      }
      else if (act === 'rewind') rewindNow();
      else if (act === 'restart') { startFlight(plan, { keepClock: true }); saveNow('restart'); }
      else if (act === 'setup') { ui.crash.hidden = true; ui.score.hidden = true; newFlight(); }
      else if (act === 'logbook') openLogbook(true);
      else if (act === 'settings') settingsPage.open();
      else if (act === 'controls') controlsPage.open();
      else if (act === 'sky') { setPaused(false); openSky(); }
      else if (act === 'menu') exitToMenu();
    });
  }

  // ---- Master volume (the Settings page) ----
  // Scales the synth's master gain and the callouts' voice; 100% is the level before v0.1.3.
  function setVolume(v, save = true) {
    v = Math.max(0, Math.min(1, Number(v) || 0));
    if (synth) synth.volume = synthMod.FULL_VOLUME * v;
    callouts.volume = v;
    if (save) saveSetting('volume', v);
  }
  setVolume(settings.volume ?? 1, false);
  // A moment after the slider stops, a blip at the new level: the audio is stopped while
  // paused or in the menu. The slider is a user gesture, so this may start the audio too.
  let previewTimer = 0, previewDelay = 0;
  function previewVolume() {
    if (!synth) return;
    clearTimeout(previewDelay);
    previewDelay = setTimeout(() => {
      audioStarted = true;
      clearTimeout(previewTimer);
      synth.start().then(() => {
        synth.blip();
        previewTimer = setTimeout(() => { if (paused || inMenu) synth.stop(); }, 600);
      });
    }, 250);
  }
  // The first click or key starts the audio (browsers need a user gesture).
  const startAudio = () => { if (paused) return; audioStarted = true; synth?.start(); window.removeEventListener('pointerdown', startAudio); window.removeEventListener('keydown', startAudio); };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);

  hud.onlaw = (law) => { sim.controls.law = law; };
  hud.onview = (which) => selectView(which);
  map.onjump = (sample) => jumpTo(sample);
  map.onskipfinal = () => { map.close(); skipToFinal(); };
  map.onroute = (icao, ident) => changeRoute(icao, ident);
  predictor.onresult = (res) => {
    prediction = res.samples;
    map.setPrediction(prediction);
    // Once per autopilot setting, not at every 20 s re-run.
    if (res.reason === 'terrain' && map.isOpen && terrainToastKey !== apKey) { terrainToastKey = apKey; toast('The predicted path meets the terrain (red cross)', 3500); }
  };

  // ---- Events from the sim ----
  // The runway a touchdown was on, whichever it is (not necessarily the planned one), or
  // null for none (score.js: landingRunway).
  const allRunways = airports.flatMap((a) => a.runways || []);

  function handleEvents() {
    const evs = sim.events;
    if (!evs.length) { const res = scorer.update(sim.state, evs); if (res) showScore(res); return; }
    for (const e of evs) {
      if (e.type === 'liftoff') landed = false;
      if (e.type === 'liftoff' && liftoffT === null) liftoffT = sim.state.t;
      if (e.type === 'touchdown') landed = true;
      if (e.type === 'touchdown' && !scorer.touchedDown) {
        scorer.setLanding(landingRunway(allRunways, e.x, e.y, sim.state.hdg));
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
      if (e.type === 'apDisconnect' && e.reason === 'rollout') toast('Rollout done: the autopilot’s off, you have the aircraft', 3500);
      if (e.type === 'athrWake') toast('AIRSPEED LOW: the autothrottle woke up', 3000);
      // v0.2.2: R or F while the A/THR moved the lever took it over (to idle, at the RETARD,
      // it goes quietly, as before).
      if (e.type === 'athrDisconnect') {
        clearPrediction();
        if (e.reason === 'lever') toast('A/THR off: the thrust levers are yours (X turns it back on)', 2500);
      }
    }
    const res = scorer.update(sim.state, evs);
    evs.length = 0;
    if (res) showScore(res);
  }

  function showScore(res) {
    const s = sim.state;
    // The runway (and airport) of the touchdown, not wherever the rollout ended.
    const le = res.offRunway ? null : scorer.landing;
    const arr = le ? airports.find((a) => a.runways.some((r) => r.ends.includes(le.end)))
      : airports.find((a) => a.origin && Math.hypot(a.origin[0] - s.pos.x, a.origin[1] - s.pos.y) < 8000) || null;
    const rf = le ? runwayFrame(le.end, le.other) : null;
    const rwy = le ? airports.flatMap((a) => a.runways).find((x) => x.ends.includes(le.end)) : null;
    scoreCard.show(res, {
      route: `${plan.origin}–${arr ? arr.icao : plan.dest}`, runway: le ? le.end.ident : null,
      runwayLengthM: rf ? rf.lda : undefined, runwayWidthM: rwy?.widthM, aimM: rf ? aimingPoint(rf.lda) : 400,
    });
    store.addLogEntry({
      date: new Date().toISOString(), version: VERSION.number, type: sim.type.id,
      ...(current ? { scenarioId: current.id, scenarioName: current.name } : { scenarioId: 'unsaved', scenarioName: 'Unsaved flights' }), route: `${plan.origin}–${arr ? arr.icao : plan.dest}`,
      depRunway: plan.start === 'runway' ? plan.depRunway : null, arrRunway: le ? le.end.ident : null, gate: plan.start === 'gate' ? plan.stand ?? null : null,
      airTimeS: liftoffT !== null ? Math.round(res.touchdown.t - liftoffT) : null,
      fuelUsedKg: Math.round(fuelAtStart - s.fuelKg),
      score: { points: res.points, grade: res.grade, parts: res.parts, ...(res.offRunway ? { offRunway: true } : {}) },
    });
    window.__fsLastScore = res;
    saveNow('landed');   // so a reload never scores (and logs) the same landing again
  }

  // ---- Prediction ----
  function maybePredict(now) {
    if (!ap.ap && prediction) clearPrediction(); // the path shows only with the autopilot on
    if (!map.isOpen || !ap.ap) return;
    const key = [ap.hdgDeg, ap.altFt, ap.vsFpm, ap.spdKt, ap.vertical, ap.lateral, ap.athr, ap.armedLateral, ap.armedVertical, ap.route?.length].join('|');
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
  let simMs = 0, stepsAvg = 0, drawMs = 0, perfShownAt = 0; // for the performance readout

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
    input.update(dt, sim.controls, s.onGround, s.athrActive);   // the A/THR moves the lever (v0.2.2)
    if (window.__fsController) window.__fsController(sim, dt); // test-only landing controller
    if (crashed) { render(dt); cancelAnimationFrame(raf); raf = 0; return; } // the crash panel waits; rewind/restart restart the loop

    // Physics: fixed steps, within a per-frame budget.
    if (timeScale > 1 && !canCompress()) setTimeScale(1);
    acc += dt * timeScale;
    let steps = Math.floor(acc / STEP);
    acc -= steps * STEP;
    let done = 0;
    const tSim = performance.now();
    for (; done < steps; done++) {
      sim.step(STEP);
      if (s.crashed) { done++; break; }
      if (timeScale > 1 && (done & 7) === 7 && performance.now() - t0 > PHYSICS_BUDGET_MS) { done++; break; }
    }
    clock.step(done * STEP);   // the sim time stepped: time compression speeds the clock too
    simMs += (performance.now() - tSim - simMs) * 0.05;
    stepsAvg += (done - stepsAvg) * 0.05;
    if (done < steps) acc = 0;
    if (timeScale > 1) {
      const reached = (done * STEP) / dt;
      achievedScale += (Math.min(timeScale, reached) - achievedScale) * 0.1;
      slowFrames = reached < timeScale * 0.9 ? slowFrames + 1 : 0;
      if (slowFrames > 90) { setTimeScale(RATES[RATES.indexOf(timeScale) - 1]); toast('Time compression reduced to keep the frame rate'); }
    }
    if (timeScale > 1 && !canCompress()) setTimeScale(1);

    gate.update(gate.phase === 'pushback' && timeScale > 1 ? done * STEP : dt, sim.controls);   // the tug at the sim's rate
    if (landed) {
      gate.afterLanding(s);
      // Keep the arrival stand clear of parked aircraft (and of neighbours overlapping it).
      const r = gate.route;
      if (gate.phase === 'taxi-in' && r && r.stand !== arrivalStand) {
        arrivalStand = r.stand;
        const a = airports.find((ap) => ap.origin && Math.hypot(ap.origin[0] - s.pos.x, ap.origin[1] - s.pos.y) < 8000);
        if (a) world.traffic?.setPlayerStand(a.icao, r.stand, standClear());
      }
    }

    if (s.t - lastSnapT >= 1) {
      lastSnapT = s.t;
      if (ap.setRoute && navKeyNow() !== navKey) syncNav();   // a waypoint dragged on the map
      rewind.push({ t: s.t, snap: sim.snapshot(), clockMs: clock.ms });
      if (rewind.length > REWIND_S + 15) rewind.shift();
    }
    handleEvents();
    if (current && now - lastAutosave >= AUTOSAVE_MS) saveNow('autosave');
    callouts.update(s, now / 1000);
    maybePredict(now);
    render(dt);
    cpuMs += (performance.now() - t0 - cpuMs) * 0.05;
  }

  // The sky, the light and the night lights follow the clock at the aircraft's position.
  let skyWinTick = 0, lastNight = -1;
  function updateSky(dt) {
    const s = sim.state, sky = world.sky;
    if (sky?.setTime) {
      const g = toGeo(s.pos.x, s.pos.y);
      sky.setTime(clock.ms, g[0], g[1]);
      if (sky.state && Number.isFinite(sky.state.exposure)) renderer.toneMappingExposure = sky.state.exposure;
    }
    const night = world.uniforms.uNight.value;
    if (night !== lastNight) { lastNight = night; aircraft.setNight?.(night); cockpit.setNight?.(night); }
    updateAircraftLights(s);
    if (skyWin?.isOpen && ++skyWinTick % 6 === 0) skyWin.update();
  }
  // The A321's lights by phase (src/aircraft-lights.js), and its lamps' beam for the ground's shaders.
  const lampP = new THREE.Vector3(), lampD = new THREE.Vector3();
  function updateAircraftLights(s) {
    if (!lightsMod || !aircraft.setLights) return;
    const lights = lightsMod.lightsFor({
      onGround: s.onGround, gs: s.gs, agl: s.agl, altFt: s.pos.z * FT,
      enginesRunning: (s.engines || []).some((e) => e.n1 > 15 || e.running), gatePhase: gate.phase,
      onRunway: !!s.onGround && !!rw.onRunway?.(s.pos.x, s.pos.y), gearDown: sim.controls.gearDown,
    });
    aircraft.setLights(lights);
    const u = world.uniforms, pose = aircraft.lampPose?.();
    // The beams' pools on the ground show only in the dark.
    const dark = u.uNight.value;
    u.uLandOn.value = (lights.landing || 0) * dark;
    u.uTaxiOn.value = (lights.taxi || 0) * dark;
    if (pose) {
      aircraft.object.updateMatrixWorld();
      lampP.fromArray(pose.pos).applyMatrix4(aircraft.object.matrixWorld);
      lampD.fromArray(pose.dir).transformDirection(aircraft.object.matrixWorld);
      u.uLandPos.value.copy(lampP); u.uLandDir.value.copy(lampD);
    }
  }

  let wingLift = 0;
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
    // A Boeing's wings bend with the lift they carry (none on the wheels), eased so they rise through
    // the rotation. V030.md's "nice" list.
    if (aircraft.setWingFlex) {
      const lift = s.onGround ? 0 : Math.max(-0.5, s.nz) * s.mass / sim.type.limits.MTOW;
      wingLift += (lift - wingLift) * Math.min(1, dt / 1.5);
      aircraft.setWingFlex(wingLift * sim.type.wingFlexM);
    }
    if (seat) cockpit.update(s, sim.controls);
    // Behind the (nearly opaque) map, the 3D view only needs a few frames a second.
    if (!map.isOpen || ++mapSkip % 10 === 0) {
      updateSky(dt);
      const tDraw = performance.now();
      world.update({ camera, origin, state: s, dt, paused });
      renderer.render(scene, camera);
      drawMs += (performance.now() - tDraw - drawMs) * 0.1;
    }

    view.dest = dest ? dest.end : null;
    view.destAirport = dest ? dest.airport : null;
    view.timeScale = timeScale;
    view.timeScaleActual = timeScale > 1 ? Math.round(achievedScale * 10) / 10 : 1;
    view.paused = paused;
    // The map's waypoints, which it edits in flight (v0.2.1: this was plan.waypoints, the
    // setup's, so a waypoint dragged on the map never showed or counted).
    view.waypoints = map.waypoints;
    view.taxiRoute = gate.points;
    view.viewId = rig.view.id;
    hud.update(view);
    if (map.isOpen) map.update(view);
    synthOpts.inside = seat; synthOpts.timeScale = timeScale; synthOpts.paused = paused;
    // Outside, where the listener is (v0.2.2): the nose camera is ahead of the engines; 3rd
    // person goes round (yaw 0 = behind) at its orbit's distance.
    const orbit = rig.view.id === 'orbit', lk = rig.looks.orbit;
    synthOpts.aft = orbit ? Math.cos(lk.yaw) * Math.cos(lk.pitch) : -1;
    synthOpts.dist = orbit ? lk.dist : 0;
    synth?.update(s, synthOpts);

    fpsFrames++;
    const now = performance.now();
    if (now - fpsT >= 1000) { fps = (fpsFrames * 1000) / (now - fpsT); fpsFrames = 0; fpsT = now; }
    if (!ui.perf.hidden && now - perfShownAt >= 500) { perfShownAt = now; ui.perf.textContent = perfLine(); }
    window.__fsStats = { fps, cpuMs, simMs, drawMs, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  }
  function renderOnce() {
    render(0);
    synth?.update(sim.state, { inside: false, timeScale, paused: true });
    if (!ui.perf.hidden && paused) ui.perf.textContent = perfLine();
  }

  // ---- The performance readout (F3 or `, or the pause menu) ----
  // One line across the top, as in Satisfactory, refreshed twice a second. The HUD moves
  // down by its height while it shows.
  const PERF_BAR_H = 22;
  const perfBtn = document.querySelector('#pause [data-act="perf"]');
  const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)));
  function perfLine() {
    const ri = renderer.info, w = world.stats || {}, heap = performance.memory?.usedJSHeapSize;
    return [
      paused ? 'paused' : null,
      `${fps.toFixed(0)} fps`,
      `${cpuMs.toFixed(1)} ms/frame (sim ${simMs.toFixed(1)}, draw ${drawMs.toFixed(1)})`,
      `${stepsAvg.toFixed(0)} steps`,
      `${ri.render.calls} draws`,
      `${kfmt(ri.render.triangles)} tris`,
      `${ri.memory.geometries} geo · ${ri.memory.textures} tex · ${ri.programs ? ri.programs.length : 0} shaders`,
      `${w.terrainLevels ?? '–'} terrain rings`,
      `${kfmt(w.buildings || 0)} buildings`,
      `${kfmt(w.lights || 0)} lights`,
      `${canvas.width}×${canvas.height}`,
      heap ? `${Math.round(heap / 1048576)} MB heap` : null,
      timeScale > 1 ? `×${timeScale} (reached ×${achievedScale.toFixed(1)})` : '×1',
    ].filter(Boolean).join(' · ');
  }
  function setPerf(on) {
    ui.perf.hidden = !on;
    document.body.classList.toggle('perf-on', on);
    hud.setTopInset(on ? PERF_BAR_H : 0);
    if (perfBtn) perfBtn.textContent = 'Performance readout: ' + (on ? 'on' : 'off');
    saveSetting('showPerf', on);
    if (on) { perfShownAt = 0; ui.perf.textContent = perfLine(); }
  }

  // ---- The main menu ----
  const menu = createMenu($('menu-root'), {
    version: VERSION.label,
    backdrops: MENU_STILLS.map((u) => new URL('../' + u, import.meta.url).href),
    scenarios: scenarios || { list: () => [], rename: () => ({ ok: false, error: 'storage' }), remove: () => false, newest: () => null },
    onContinue: (id) => loadScenario(id),
    onLoad: (id) => loadScenario(id),
    onNew: () => newScenario(),
    onLogbook: () => openLogbook(false),
    onSettings: () => settingsPage.open(),
    onControls: () => controlsPage.open(),
  });

  // ---- The Sky window (L, or Cmd/Ctrl+L as in Satisfactory) ----
  if (skyWinMod?.createSkyWindow) {
    skyWin = skyWinMod.createSkyWindow($('skywin-root'), { clock, place: placeNow });
    skyWin.onclose = () => requestFrame();
    // A time set in the window shows at once, also while paused (the game draws on demand then).
    skyWin.onchange = () => { if (paused) renderOnce(); else requestFrame(); };
  } else for (const b of document.querySelectorAll('[data-sky]')) b.hidden = true;
  function openSky() { if (!skyWin || inMenu || !plan) return; if (!skyWin.isOpen) toggleSky(); }
  function toggleSky() {
    if (!skyWin || inMenu || !plan) return;
    skyWin.toggle();
    if (skyWin.isOpen) { skyWin.update(); requestFrame(); }
  }
  // Cmd/Ctrl+L is the one Ctrl binding (PLAN.md): it can't lose anything, so it's the exception.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyL' || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!skyWin || inMenu || !plan || setup.isOpen) return;
    e.preventDefault();
    toggleSky();
  }, true);

  useType(DEFAULT_TYPE);
  resize();
  if (settings.showPerf) setPerf(true);
  booted = true;
  ui.loading.hidden = true;

  // ---- Test hooks (used by tests/browser-*.mjs) ----
  window.__fs = {
    sim, ap, input, rig, scorer, callouts, predictor, map, world, renderer, gate, airports, scene, menu, setup, logbook, settingsPage, controlsPage,
    get aircraft() { return aircraft; }, get cockpit() { return cockpit; }, useType,
    get synth() { return synth; },
    get prediction() { return prediction; },
    get timeScale() { return timeScale; },
    get achievedScale() { return achievedScale; },
    get paused() { return paused; },
    get crashed() { return crashed; },
    get dest() { return dest; },
    startFlight, skipToFinal, jumpTo, changeRoute, selectView, scenarios, clock, captureState, applyState, saveNow, loadScenario, exitToMenu, newScenario,
    get current() { return current; }, get inMenu() { return inMenu; }, get lastSaveMs() { return lastSaveMs; }, get frames() { return renderer.info.render.frame; },
    get landed() { return landed; }, get plan() { return plan; }, setTimeScale: (r) => { if (r === 1 || canCompress()) setTimeScale(r); return timeScale; },
    setPaused, rewindNow, requestPredict: () => { predictor.request(sim.snapshot(), {}); },
    renderOnce, runwayEnds, runwayAxis,
    gridToMagDeg: (h, x, y) => gridToMag(h, x, y) / DEG,
  };

  if (TEST && params.get('origin')) {
    startFlight({ origin: params.get('origin'), depRunway: params.get('dep') || '14R', dest: params.get('dest') || 'RKPC',
      arrRunway: params.get('arr') || '07', start: params.get('start') || 'runway', stand: params.get('stand') || null, pax: 180, cargoKg: 2000,
      fuelKg: Number(params.get('fuel')) || 7500, waypoints: [], type: params.get('type') || undefined });
  } else {
    // The main menu, over a still: nothing renders or steps behind it (PLAN.md → CPU at runtime).
    paused = true;
    showMenu();
  }
}

boot().catch(fail);
