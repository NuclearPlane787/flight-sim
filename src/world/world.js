// The world: terrain (and sea), sky and haze, surface detail, cities and runways.
//
//   const world = await createWorld({ renderer, scene, baseUrl, heightfield, airports });
//   each rendered frame:  world.update({ camera, origin, state, dt });
//
// origin is the map position {x, y} of the scene origin (= the camera's map x/y); the
// scene frame is X = map x, Y = altitude MSL, Z = −map y (frame.js toScene). Nothing in
// here runs between frames: no timers, no workers.

import * as THREE from '../../vendor/three.module.js';
import { loadHeightfield } from './heightfield.js';
import { loadAirports, createAirports } from './runways.js';
import { createWorldUniforms, UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL, MAX_PATCHES, MAX_RUNWAYS } from './glsl.js';
import { ATMOS_GLSL, createSky } from './sky.js';
import { WATER_GLSL } from './water.js';
import { FIELDS_GLSL, createTrees } from './detail.js';
import { createTerrain } from './terrain.js';
import { createCities } from './cities.js';
import { createRunways } from './airports.js';
import { maskAirportCover } from './airport-mask.js';
import { createAprons } from './apron.js';
import { createTraffic } from './traffic.js';

export async function createWorld({ renderer, scene, baseUrl = 'data/', heightfield = null, airports = null } = {}) {
  const hf = heightfield || await loadHeightfield(baseUrl);
  // airports: the loadAirports() object, or just its list of airport JSONs.
  let ap = airports || await loadAirports(baseUrl, { heightfield: hf });
  if (Array.isArray(ap)) ap = createAirports(ap, { heightfield: hf });

  maskAirportCover(hf, ap.airports); // before the cover texture is made
  const uniforms = createWorldUniforms(hf);
  const chunks = { UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL, ATMOS_GLSL, WATER_GLSL, FIELDS_GLSL, MAX_PATCHES, MAX_RUNWAYS };

  const sky = createSky(scene, uniforms, chunks);
  const terrain = createTerrain(scene, uniforms, chunks);
  const trees = createTrees(scene, uniforms, chunks);
  const cities = createCities(scene, uniforms, chunks, ap);
  const runways = createRunways(scene, uniforms, chunks, ap.airports, renderer, hf);
  // M2: aprons, taxiways, stands and terminals; parked aircraft and ground vehicles. Each is
  // optional, so a failure there leaves the M1 world working.
  const optional = (name, make) => { try { return make(); } catch (e) { console.warn(`world: ${name} off:`, e); return null; } };
  const aprons = optional('aprons', () => createAprons(scene, uniforms, chunks, ap.airports, hf));
  const traffic = optional('traffic', () => createTraffic(scene, uniforms, chunks, ap.airports, hf));

  const camMap = { x: 0, y: 0 };
  const camScene = new THREE.Vector3();
  let time = 0;
  const stats = { drawCalls: 0, triangles: 0, terrainLevels: 0, finestStep: 0, trees: 0, buildings: 0, lights: 0, agl: 0 };

  const world = {
    heightfield: hf, airports: ap, uniforms, sun: sky.sun.clone(), sky, terrain, trees, cities, runways, aprons, traffic, stats,

    update({ camera, origin, dt = 1 / 60, paused = false }) {
      time += dt;
      camera.updateMatrixWorld();
      camScene.setFromMatrixPosition(camera.matrixWorld);
      camMap.x = origin.x + camScene.x;
      camMap.y = origin.y - camScene.z;
      const ground = hf.heightAt(camMap.x, camMap.y);
      const agl = Math.max(camScene.y - ground, 0);

      const u = uniforms;
      u.uOrigin.value.set(origin.x, origin.y);
      u.uCamPos.value.copy(camScene);
      u.uCamAlt.value = camScene.y;
      u.uCamAgl.value = agl;
      u.uTime.value = time % 3600;
      const h = renderer ? renderer.getDrawingBufferSize(_size).y : 900;
      u.uPxScale.value = h / (2 * Math.tan((camera.fov || 60) * Math.PI / 360));

      sky.update(camera, camScene.y);
      const t = terrain.update(camMap, origin, agl);
      const treeTris = trees.update(camMap, origin, agl);
      const c = cities.update(camMap, origin, agl);
      const r = runways.update(camMap, origin, camScene);
      const a = aprons ? aprons.update({ camMap, origin }) : NONE;
      const tr = traffic ? traffic.update({ camera, origin, camMap }, paused ? 0 : dt) : NONE;

      stats.agl = agl;
      stats.terrainLevels = t.drawCalls - 1;
      stats.finestStep = 2 * 2 ** terrain.finest;
      stats.trees = treeTris;
      stats.buildings = c.instances;
      stats.lights = r.lights;
      stats.drawCalls = 1 + t.drawCalls + trees.drawCalls + c.drawCalls + r.drawCalls + a.drawCalls + tr.drawCalls;
      stats.triangles = 960 * 2 + t.tris + treeTris + c.tris + r.tris + a.triangles + tr.triangles;
    },

    // Ground height and kind for anything that needs it (same as the sim's).
    heightAt: (x, y) => hf.heightAt(x, y),
  };
  return world;
}

const _size = new THREE.Vector2();
const NONE = { drawCalls: 0, triangles: 0 };
