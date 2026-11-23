// The world: terrain (and sea), sky and haze, surface detail, cities and runways.
//
//   const world = await createWorld({ renderer, scene, baseUrl, heightfield, airports });
//   each rendered frame:  world.update({ camera, origin, state, dt });
//
// origin is the map position {x, y} of the scene origin (= the camera's map x/y); the
// scene frame is X = map x, Y = altitude MSL, Z = −map y (frame.js toScene). Nothing in
// here runs between frames: no timers, no workers.
//
// v0.6.0, the region: the airports' meshes, lights, signs and traffic are built
// near the camera and released far away (airport-set.js: within 200 km, beyond 400 km, one part
// a frame, at once within 100 km). world.runways, .aprons, .traffic and .taxiLights are then
// facades over the airports built now, with the same interface; a player stand set for an
// airport that isn't built applies when it is. world.ensureNear(x, y) builds what's in reach
// of a point now (a promise). With the flag off the three Korean airports are built at boot and
// kept, exactly as in v0.5.8.

import * as THREE from '../../vendor/three.module.js';
import { loadHeightfield } from './heightfield.js';
import { loadAirports, createAirports } from './runways.js';
import { createWorldUniforms, UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL, AIRCRAFT_LIGHTS_GLSL, MAX_PATCHES, MAX_RUNWAYS } from './glsl.js';
import { ATMOS_GLSL, createSky } from './sky.js';
import { WATER_GLSL } from './water.js';
import { FIELDS_GLSL, createTrees } from './detail.js';
import { createTerrain } from './terrain.js';
import { createCities } from './cities.js';
import { createRunways } from './airports.js';
import { maskAirportCover } from './airport-mask.js';
import { createAprons, apronsInSteps } from './apron.js';
import { createTraffic, trafficInSteps } from './traffic.js';
import { createClouds } from './clouds.js';
import { createPrecip } from './precip.js';
import { createRural } from './rural.js';
import { createGreenhouses } from './greenhouses.js';
import { clusterAirports, createAirportSet, MORE } from './airport-set.js';
import { placeParked, blockedByPlayer } from './traffic-layout.js';
import { GATES78, parkedDoor } from './apron-geom.js';
import { regionQuery } from './region.js';

export async function createWorld({ renderer, scene, baseUrl = 'data/', heightfield = null, airports = null } = {}) {
  const hf = heightfield || await loadHeightfield(baseUrl);
  // airports: the loadAirports() object, or just its list of airport JSONs.
  let ap = airports || await loadAirports(baseUrl, { heightfield: hf });
  if (Array.isArray(ap)) ap = createAirports(ap, { heightfield: hf });

  maskAirportCover(hf, ap.airports); // before the cover texture is made
  const uniforms = createWorldUniforms(hf);
  const chunks = { UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL, ATMOS_GLSL, WATER_GLSL, FIELDS_GLSL, AIRCRAFT_LIGHTS_GLSL, MAX_PATCHES, MAX_RUNWAYS };

  const sky = createSky(scene, uniforms, chunks);
  // v0.4.0: the weather's own objects (nothing is drawn in clear weather).
  const clouds = createClouds(scene, uniforms);
  const precip = createPrecip(scene, uniforms);
  const terrain = createTerrain(scene, uniforms, chunks);
  const trees = createTrees(scene, uniforms, chunks, { fine: terrain.fine });
  const cities = createCities(scene, uniforms, chunks, ap);
  // M2: aprons, taxiways, stands and terminals; parked aircraft and ground vehicles. Each is
  // optional, so a failure there leaves the M1 world working.
  const optional = (name, make) => { try { return make(); } catch (e) { console.warn(`world: ${name} off:`, e); return null; } };
  // v0.6.0 Part 7: the countryside's buildings (rural.js).
  const rural = optional('rural', () => createRural(scene, uniforms, chunks, { fine: terrain.fine }));
  // v0.6.1: greenhouses as low tunnels on the greenhouse ground, near the camera (greenhouses.js; ?greenhouses=0 leaves them out).
  const GH_ON = !(typeof location !== 'undefined' && /[?&]greenhouses=0\b/.test(location.search || ''));
  if (rural && rural.setGlass) rural.setGlass(GH_ON);
  const greenhouses = GH_ON ? optional('greenhouses', () => createGreenhouses(scene, uniforms, chunks, { fine: terrain.fine })) : null;
  // v0.6.0 Part 6: the landmarks' own models (landmarks.js) and the dense centres from real
  // buildings (centres.js), whose mask keeps the procedural blocks out from under them.
  let landmarks = null, centres = null;
  {
    const [lmMod, ceMod] = await Promise.all([import('./landmarks.js').catch(() => null), import('./centres.js').catch(() => null)]);
    if (lmMod?.createLandmarks) landmarks = optional('landmarks', () => lmMod.createLandmarks(scene, uniforms, chunks, { heightfield: hf, renderer }));
    if (ceMod?.createCentres) centres = optional('centres', () => ceMod.createCentres(scene, uniforms, chunks, { heightfield: hf, renderer, baseUrl }));
    // v0.7.6: and the ground of the landmarks that stand in a generated town (landmarks.js's BLOCKS_CLEAR). Where the
    // region has none (East Asia), the mask is the centres' own function as before.
    const lmMask = lmMod?.landmarkBlockMask ? lmMod.landmarkBlockMask() : null;
    if (cities.setMask && lmMask) cities.setMask((x, y) => (centres ? centres.maskAt(x, y) : false) || lmMask(x, y), centres ? centres.maskVersion : null);
    else if (centres && cities.setMask) cities.setMask(centres.maskAt, centres.maskVersion);
    if (centres && cities.towns77) cities.setCentreBoxes(centres.boxes);   // v0.7.7 towns: the blend round the real centres
  }
  let runways, aprons, traffic, cityLights, taxiLights, airportSet = null, streamView = null;
  {
    // v0.6.0: the airports near the camera (one group per kind, in v0.5.8's scene order).
    const box = (name) => { const g = new THREE.Group(); g.name = name; scene.add(g); return g; };
    const boxes = { runways: box('runways'), aprons: box('aprons'), traffic: box('traffic') };
    const [clMod, tlMod] = await Promise.all([import('./citylights.js').catch(() => null), import('./taxilights.js').catch(() => null)]);
    cityLights = clMod?.createCityLights ? optional('city lights', () => clMod.createCityLights(scene, uniforms, chunks, { heightfield: hf, airports: ap.airports })) : null;
    boxes.taxiLights = box('taxi-lights');
    const S = createAirportStreams({ uniforms, chunks, renderer, hf, ap, boxes, taxiLightsInSteps: tlMod?.taxiLightsInSteps || null });
    ({ runways, aprons, traffic, taxiLights, set: airportSet } = S);
    streamView = S.view;
  }

  const camMap = { x: 0, y: 0 };
  const camScene = new THREE.Vector3();
  const viewFrustum = new THREE.Frustum(), projView = new THREE.Matrix4();   // v0.6.1: the view's, each frame
  // (?cull=0 on the URL draws everything, in view or not, as v0.6.0 did: for comparing pictures.)
  const CULL = !(typeof location !== 'undefined' && /[?&]cull=0\b/.test(location.search || ''));
  let time = 0;
  let lastCamGround = 0;   // the ground under the camera when its tile was last resident
  const stats = { drawCalls: 0, triangles: 0, terrainLevels: 0, finestStep: 0, trees: 0, buildings: 0, lights: 0, agl: 0 };

  const world = {
    heightfield: hf, airports: ap, uniforms, sun: sky.sun.clone(), sky, terrain, trees, cities, runways, aprons, traffic, cityLights, taxiLights, stats,
    airportSet,

    // v0.4.0: the settings (normalizeWeather()'s shape, or null for the default weather), whenever they change.
    setWeather(settings) { sky.setWeather?.(settings); clouds.setWeather(settings); precip.setWeather(settings); },
    // v0.6.0: build the airports within reach of a map point now (a new flight, a loaded scenario, a jump).
    // Resolves with the clusters built there (ids such as 'RJTT+RJAA'); with the flag off, at once.
    ensureNear(x, y) { return Promise.resolve(airportSet ? airportSet.ensureNear(x, y) : []); },
    update({ camera, origin, state, dt = 1 / 60, paused = false }) {
      time += dt;
      camera.updateMatrixWorld();
      camScene.setFromMatrixPosition(camera.matrixWorld);
      camMap.x = origin.x + camScene.x;
      camMap.y = origin.y - camScene.z;
      // v0.6.1: the view's frustum (scene coordinates), for the parts that leave out what is
      // behind the camera or beside its view (the cities' tiles, the centres' rows, parked aircraft).
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      viewFrustum.setFromProjectionMatrix(projView);
      const frustum = CULL ? viewFrustum : null;
      // v0.6.0: the camera's own ground, only once its tile is in (a frame drawn behind the menu,
      // or the first after a jump, would read open sea and count a miss that isn't the sim's);
      // until then the last ground it knew. With Korea's tiles all resident this is heightAt().
      const camT = hf.tiles;
      const ground = !camT || !camT.isReady || camT.isReady(camMap.x, camMap.y, 0) ? (lastCamGround = hf.heightAt(camMap.x, camMap.y)) : lastCamGround;
      const agl = Math.max(camScene.y - ground, 0);
      if (airportSet) { streamView.camera = camera; airportSet.update(camMap.x, camMap.y); }

      const u = uniforms;
      u.uOrigin.value.set(origin.x, origin.y);
      u.uCamPos.value.copy(camScene);
      u.uCamAlt.value = camScene.y;
      u.uCamAgl.value = agl;
      u.uTime.value = time % 3600;
      const h = renderer ? renderer.getDrawingBufferSize(_size).y : 900;
      u.uPxScale.value = h / (2 * Math.tan((camera.fov || 60) * Math.PI / 360));

      sky.update(camera, camScene.y);
      clouds.update({ camera, origin, state, dt, paused });
      precip.update({ camera, origin, state, dt, paused });
      const t = terrain.update(camMap, origin, agl);
      const treeTris = trees.update(camMap, origin, agl);
      const c = cities.update(camMap, origin, agl, frustum);
      const ru = rural ? rural.update(camMap, origin, agl) : NONE;   // v0.6.0 Part 7
      const gh = greenhouses ? greenhouses.update(camMap, origin, agl) : NONE;   // v0.6.1
      // v0.6.0 Part 6: their own stats objects ({ drawCalls, triangles, … }).
      if (landmarks) landmarks.update({ camMap, origin, camScene, agl });
      if (centres) centres.update({ camMap, origin, camScene, agl, frustum });
      const p6calls = (landmarks?.stats.drawCalls || 0) + (centres?.stats.drawCalls || 0), p6tris = (landmarks?.stats.triangles || 0) + (centres?.stats.triangles || 0);
      const r = runways.update(camMap, origin, camScene);
      const a = aprons ? aprons.update({ camMap, origin }) : NONE;
      const tr = traffic ? traffic.update({ camera, origin, camMap, frustum }, paused ? 0 : dt) : NONE;
      const cl = cityLights ? cityLights.update({ camMap, origin, camScene, agl }) || NONE : NONE;
      const tl = taxiLights ? taxiLights.update({ camMap, origin, camScene }) || NONE : NONE;

      stats.agl = agl;
      stats.terrainLevels = t.drawCalls - 1;
      stats.finestStep = 2 * 2 ** terrain.finest;
      stats.trees = treeTris;
      stats.buildings = c.instances;
      stats.lights = r.lights + (tl.lights || 0);
      stats.cityLights = cl.lights || 0;
      stats.drawCalls = (sky.drawCalls ?? 1) + t.drawCalls + trees.drawCalls + c.drawCalls + r.drawCalls + a.drawCalls + tr.drawCalls + (cl.drawCalls || 0) + (tl.drawCalls || 0) + (ru.drawCalls || 0) + (gh.drawCalls || 0) + p6calls;
      stats.triangles = 960 * 2 + t.tris + treeTris + c.tris + r.tris + a.triangles + tr.triangles + (cl.tris || 0) + (tl.tris || 0) + (ru.tris || 0) + (gh.tris || 0) + p6tris;
      if (airportSet) stats.airportsBuilt = airportSet.built().join(' ');
    },

    // Ground height and kind for anything that needs it (same as the sim's).
    heightAt: (x, y) => hf.heightAt(x, y),
  };
  Object.assign(world, { rural, greenhouses, landmarks, centres });   // v0.6.0 Parts 6 and 7 (null without their flags)
  return world;
}

const _size = new THREE.Vector2();
const NONE = { drawCalls: 0, triangles: 0 };

// ------------------------------------------------------------------ v0.6.0: the airports near the camera

// Everything a part added: its group out of the scene, its geometries, its materials and the
// textures its materials own (uniforms of its own, never the world's shared ones).
function disposeGroup(group, shared) {
  group.parent?.remove(group);
  const geos = new Set(), mats = new Set(), texs = new Set();
  group.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) for (const m of [].concat(o.material)) mats.add(m);
  });
  for (const m of mats) {
    for (const [k, u] of Object.entries(m.uniforms || {})) {
      if (shared[k] === u || !u) continue;
      for (const v of [].concat(u.value)) if (v && v.isTexture) texs.add(v);
    }
  }
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  for (const t of texs) t.dispose();
}

function createAirportStreams({ uniforms, chunks, renderer, hf, ap, boxes, taxiLightsInSteps }) {
  const parts = { runways: [], aprons: [], traffic: [], taxiLights: [] };
  const heightAt = (x, y) => hf.heightAt(x, y);
  let player = null;   // the last setPlayerStand(): { icao, ref, opts }
  const view = { camera: null };   // the last frame's camera, to compile a new part's shaders before it's in sight
  const prep = createAirportPrep();

  // v0.7.8 (GATES78, apron-geom.js): each built airport's jet bridges at the doors of the aircraft at its gates, the
  // parked ones (those not hidden for the player) and the player's own (playerDoor, from its type). Run when an
  // airport's aprons or traffic are built and when the player's stand changes; an airport whose doors are as they
  // were is left alone (aprons' setGateDoors()).
  let playerDoor = null;
  const syncGateDoors = () => {
    if (!GATES78) return;
    for (const ap of parts.aprons) {
      if (!ap.setGateDoors) continue;
      for (const s of ap.sites) {
        const doors = new Map();
        let t = null;
        for (const p of parts.traffic) { t = (p.sites || []).find((x) => x.a && x.a.icao === s.icao); if (t) break; }
        if (t) {
          const byRef = new Map((t.a.stands || []).map((st) => [String(st.ref), st]));
          t.parked.forEach((p, i) => {
            const st = byRef.get(String(p.stand));
            const d = st && !t.hidden.has(i) ? parkedDoor(st, p) : null;
            if (d) doors.set(String(p.stand), d);
          });
        }
        if (player && player.icao === s.icao && player.ref != null && playerDoor) doors.set(String(player.ref), playerDoor);
        try { ap.setGateDoors(s.icao, doors); } catch { /* the bridges stay as they were */ }
      }
    }
  };
  // One part, made into its kind's group: listed, and a handle that undoes both.
  const register = (kind, p) => {
    if (!p) return null;
    parts[kind].push(p);
    // Its shaders compiled now, in parallel where the GPU can (it's drawn from 80 km at most).
    if (renderer?.compileAsync && view.camera && p.group.parent?.parent) {
      try { renderer.compileAsync(p.group, view.camera, p.group.parent.parent).catch(() => {}); } catch { /* drawn compiles it */ }
    }
    if (kind === 'traffic' && player) p.setPlayerStand(player.icao, player.ref, player.opts);
    if (kind === 'traffic' || kind === 'aprons') syncGateDoors();
    return {
      part: p,
      dispose() {
        const i = parts[kind].indexOf(p);
        if (i >= 0) parts[kind].splice(i, 1);
        disposeGroup(p.group, uniforms);
      },
    };
  };
  // A part built in slices: its builder (a generator) runs one slice a call and returns MORE until it's
  // done. Nothing joins the scene before the last slice, so a cancelled one leaves nothing on the GPU.
  // A failure leaves that part off, as createWorld's optional() does.
  const sliced = (name, kind, makeGen, ctx = null) => {
    let gen = null;
    return {
      name,
      run(opts) {
        let r;
        if (ctx) ctx.urgent = !!(opts && opts.urgent);
        try {
          if (!gen) gen = makeGen(boxes[kind]);
          r = gen.next();
        } catch (e) { console.warn(`world: ${name} off:`, e); gen = null; return null; }
        if (!r.done) return typeof r.value === 'string' ? { more: true, label: r.value } : MORE;
        gen = null;
        return register(kind, r.value);
      },
      cancel() { try { gen?.return(); } catch { /* nothing to undo */ } gen = null; },
    };
  };
  const makeSteps = (cluster) => {
    // The worker starts on the cluster's airports now, while the main thread builds their runways.
    const ctx = { urgent: false };
    for (const a of cluster.airports) prep.request(a);
    const pre = prep.available ? { get: (icao) => prep.get(icao), urgent: () => ctx.urgent } : null;
    const steps = [];
    for (const a of cluster.airports) {
      steps.push({ name: `runways ${a.icao}`, run: () => register('runways', createRunways(boxes.runways, uniforms, chunks, [a], renderer, hf)) });
      steps.push(sliced(`aprons ${a.icao}`, 'aprons', (g) => apronsInSteps(g, uniforms, chunks, [a], hf, pre), ctx));
      if (taxiLightsInSteps) steps.push(sliced(`taxi lights ${a.icao}`, 'taxiLights', (g) => taxiLightsInSteps(g, uniforms, chunks, [a], hf, pre), ctx));
    }
    steps.push({ name: `done ${cluster.id}`, run: () => { for (const a of cluster.airports) prep.forget(a.icao); return null; } });
    // The cluster's traffic in one set (its instanced meshes serve both airports: fewer draw calls).
    steps.push(sliced(`traffic ${cluster.id}`, 'traffic', (g) => trafficInSteps(g, uniforms, chunks, cluster.airports, hf)));
    return steps;
  };
  const set = createAirportSet({
    clusters: clusterAirports(ap.airports), makeSteps,
    onReleased: (c) => { for (const a of c.airports) prep.forget(a.icao); },
    onBuilt: (c, rec) => console.info(`world: airports ${c.id} built in ${rec.ms.toFixed(0)} ms, ${rec.slices} slices, the longest ${rec.worstSlice.toFixed(0)} ms, ${rec.worstSliceName} (${rec.parts.map((p) => `${p.name} ${p.ms.toFixed(0)}`).join(', ')})`),
  });

  const sum = (list, f, keys) => {
    const out = {};
    for (const k of keys) out[k] = 0;
    for (const p of list) { const r = f(p) || NONE; for (const k of keys) out[k] += r[k] || 0; }
    return out;
  };

  const runways = {
    group: boxes.runways,
    get parts() { return parts.runways; },
    update: (camMap, origin, camScene) => sum(parts.runways, (p) => p.update(camMap, origin, camScene), ['lights', 'tris', 'drawCalls']),
  };
  const aprons = {
    group: boxes.aprons,
    get sites() { return parts.aprons.flatMap((p) => p.sites); },
    update: (ctx) => sum(parts.aprons, (p) => p.update(ctx), ['drawCalls', 'triangles']),
  };
  const tstats = { drawCalls: 0, triangles: 0, parked: 0, vehicles: 0, updateMs: 0 };
  const parkedCache = new Map();
  const traffic = {
    group: boxes.traffic,
    stats: tstats,
    get sites() { return parts.traffic.flatMap((p) => p.sites); },
    update(ctx, dt) {
      const r = sum(parts.traffic, (p) => p.update(ctx, dt), ['drawCalls', 'triangles']);
      const s = sum(parts.traffic, (p) => p.stats, ['parked', 'vehicles']);
      tstats.drawCalls = r.drawCalls; tstats.triangles = r.triangles; tstats.parked = s.parked; tstats.vehicles = s.vehicles;
      return r;
    },
    // As createTraffic's: remembered, so an airport built later starts with it.
    setPlayerStand(icao, ref, opts = null, door = null) {
      player = { icao, ref, opts };
      playerDoor = door;   // v0.7.8: the player's own front door, for the bridge at its gate
      for (const p of parts.traffic) p.setPlayerStand(icao, ref, opts);
      syncGateDoors();
    },
    // As createTraffic's; for an airport not built now, from the same seeded placement.
    occupiedStands(icao) {
      const t = parts.traffic.find((p) => p.sites.some((s) => s.a.icao === icao));
      if (t) return t.occupiedStands(icao);
      const a = ap.airports.find((x) => x.icao === icao);
      if (!a) return [];
      let parked = parkedCache.get(icao);
      if (!parked) { parked = placeParked(a, { heightAt }); parkedCache.set(icao, parked); }
      const hidden = player && player.icao === icao && player.ref != null ? blockedByPlayer(a, parked, player.ref, player.opts) : new Set();
      return parked.filter((p, i) => !hidden.has(i)).map((p) => p.stand);
    },
  };
  const taxiLights = taxiLightsInSteps ? {
    group: boxes.taxiLights,
    get sets() { return parts.taxiLights.flatMap((p) => p.sets); },
    update: (ctx) => sum(parts.taxiLights, (p) => p.update(ctx), ['drawCalls', 'tris', 'lights']),
  } : null;
  return { runways, aprons, traffic, taxiLights, set, view };
}

// The worker (airport-worker.js) that prepares an airport's pure parts (sign sites, edge lines, the
// taxiway lights' layout) while the main thread builds the rest. request(a) sends it once; get(icao) ->
// { state, value }. Without workers, or if one fails, the builders compute the same themselves.
function createAirportPrep() {
  let worker = null, failed = typeof Worker === 'undefined';
  const jobs = new Map();   // icao -> { state, value }
  let next = 1;
  const byId = new Map();
  function start() {
    if (worker || failed) return worker;
    try {
      worker = new Worker(new URL('./airport-worker.js' + regionQuery(), import.meta.url), { type: 'module' });   // v0.7.0: in the page's region (it reaches frame.js)
      worker.onmessage = (e) => {
        const icao = byId.get(e.data.id);
        byId.delete(e.data.id);
        const j = icao && jobs.get(icao);
        if (!j) return;
        if (e.data.ok) { j.state = 'ready'; j.value = e.data; }
        else { j.state = 'failed'; console.warn(`world: airport worker failed on ${icao}:`, e.data.error); }
      };
      worker.onerror = (e) => {
        console.warn('world: airport worker off:', e.message || e);
        failed = true;
        for (const j of jobs.values()) if (j.state === 'pending') j.state = 'failed';
      };
    } catch (e) { failed = true; worker = null; }
    return worker;
  }
  return {
    get available() { return !failed; },
    request(a) {
      if (jobs.has(a.icao) || !start()) return;
      const id = next++;
      try {
        worker.postMessage({ id, airport: a });
        jobs.set(a.icao, { state: 'pending', value: null });
        byId.set(id, a.icao);
      } catch (e) { jobs.set(a.icao, { state: 'failed', value: null }); }
    },
    get: (icao) => jobs.get(icao) || { state: 'failed', value: null },
    forget(icao) { jobs.delete(icao); },
  };
}
