// The landmarks (briefs/V0-6-0.md Part 6 step 3): famous buildings as their own models, made here
// (landmark-models.js: massing from public facts, no logos, signage or names, nothing copied).
//
//   const lm = createLandmarks(scene, uniforms, chunks, { heightfield, renderer });
//   each frame: lm.update({ camMap, origin, camScene, agl });   lm.stats; lm.dispose();
//
// Only with CITIES_ON (?cities=1); the ones outside Korea also need EAST_ASIA_ON (their ground
// isn't there without it). Each model is built the first time the camera comes within BUILD_M of
// it (a few thousand triangles, a few milliseconds), drawn within SHOW_M (a 600 m tower is still a
// few pixels tall at 80 km), hidden beyond (no draw call), and released beyond RELEASE_M. One
// shared material for the buildings, one mesh per landmark; at night one point draw per landmark
// for its aviation obstruction lights (hidden by day: no extra draw calls by day).
//
// Each landmark sits on the ground (the lowest heightAt() round its base, read once when it is
// built, after the terrain tiles there are in) and is drawn relative to the moving origin: the
// mesh's position is (landmark - origin) in JS doubles each frame, with the Earth's curve for its
// distance from the camera taken off its height (curveDrop at its centre: across a building the
// difference is well under a metre at any distance it is drawn).

import * as THREE from '../../vendor/three.module.js';
import { toMap, EARTH_RADIUS } from './frame.js';
import { EAST_ASIA_ON, CITIES_ON } from './region.js';
import { MODELS } from './landmark-models.js';

export const BUILD_M = 85000;
export const SHOW_M = 80000;
export const RELEASE_M = 250000;

// The list. lat, lon: the base's centre (OpenStreetMap's footprint where the bake has it, else
// the article's coordinates); heightM: to the top of the model (the architectural height);
// footprintM: the radius of a circle round the base's centre that covers the plan (parts: the
// circles of a landmark's separate towers, map metres from its centre, for the real centres'
// extrusion to leave out); source: where the height was checked (2026-11-19). [EST] marks a figure
// estimated, not read. brg: the plan's grid bearing (from the OSM footprint's sides).
export const LANDMARKS = [
  // Seoul
  { id: 'lotte', city: 'seoul', country: 'KR', lat: 37.51254, lon: 127.10266, heightM: 554.5, footprintM: 44, brg: 68, floors: 123,
    source: 'Wikipedia "Lotte World Tower": 555 m architectural; OSM height=554.5; footprint 72 m (OSM)' },
  { id: 'b63', city: 'seoul', country: 'KR', lat: 37.51985, lon: 126.94025, heightM: 249.6, footprintM: 36, brg: 52, floors: 60,
    source: 'Wikipedia "63 Building": 249.6 m (antenna 274 m not modelled); OSM footprint 60 x 27 m' },
  { id: 'nseoul', city: 'seoul', country: 'KR', lat: 37.55120, lon: 126.98823, heightM: 236.7, footprintM: 34, brg: 0,
    source: 'Wikipedia "Namsan Seoul Tower": 236 m (lead; the infobox gives 279 m to the spire), 236.7 m [EST, the commonly quoted figure]; pod heights [EST] from OSM parts' },
  { id: 'parc1', city: 'seoul', country: 'KR', lat: 37.52668, lon: 126.92722, heightM: 333, footprintM: 110, brg: 142, floors: 69,
    parts: [[0, 0, 40], [56, 43, 40]],
    source: 'Wikipedia "Parc1": 333 m architectural, roof 318 m; Tower 2 256 m (OSM height); towers placed from OSM' },
  // Shanghai
  { id: 'shtower', city: 'shanghai', country: 'CN', lat: 31.23555, lon: 121.50127, heightM: 632, footprintM: 44, brg: 0, floors: 128,
    source: 'Wikipedia "Shanghai Tower": 632 m, roof 587.4 m; zones from OSM parts (85 m to 49 m across)' },
  { id: 'swfc', city: 'shanghai', country: 'CN', lat: 31.23657, lon: 121.50304, heightM: 492, footprintM: 42, brg: -1, floors: 101,
    source: 'Wikipedia "Shanghai World Financial Center": 492 m architectural, roof 487.4 m; the top 85 x 16 m along bearing 44 (OSM)' },
  { id: 'jinmao', city: 'shanghai', country: 'CN', lat: 31.23725, lon: 121.50140, heightM: 420.5, footprintM: 44, brg: 3, floors: 88,
    source: 'Wikipedia "Jin Mao Tower": 420.5 m, roof 385.5 m, sixteen tiers each 1/8 shorter; base 62 m (OSM)' },
  { id: 'pearl', city: 'shanghai', country: 'CN', lat: 31.24189, lon: 121.49526, heightM: 468, footprintM: 50, brg: 0,
    source: 'Wikipedia "Oriental Pearl Tower": 468 m; sphere sizes and heights [EST]' },
  // Tokyo
  { id: 'skytree', city: 'tokyo', country: 'JP', lat: 35.71005, lon: 139.81072, heightM: 634, footprintM: 41, brg: 0,
    source: 'Wikipedia "Tokyo Skytree": 634.0 m, decks 350 m and 450 m, triangle to circle by 320 m; base side 68 m [EST]' },
  { id: 'tokyotower', city: 'tokyo', country: 'JP', lat: 35.65859, lon: 139.74545, heightM: 332.9, footprintM: 50, brg: 27,
    source: 'Wikipedia "Tokyo Tower": 332.9 m to the spire (333 m), Main Deck 150 m, Top Deck 249.6 m; base width [EST]' },
  { id: 'azabudai', city: 'tokyo', country: 'JP', lat: 35.66085, lon: 139.74066, heightM: 325.2, footprintM: 52, brg: 18, floors: 64,
    source: 'Wikipedia "Azabudai Hills": Mori JP Tower 325.2 m; footprint 75 m (OSM)' },
  { id: 'tmg', city: 'tokyo', country: 'JP', lat: 35.68950, lon: 139.69171, heightM: 242.9, footprintM: 62, brg: 162, floors: 48,
    source: 'Wikipedia "Tokyo Metropolitan Government Building": 242.9 m, splits at the 33rd floor; the towers from OSM' },
  { id: 'ylmt', city: 'yokohama', country: 'JP', lat: 35.45460, lon: 139.63148, heightM: 296.3, footprintM: 52, brg: 50, floors: 70,
    source: 'Wikipedia "Yokohama Landmark Tower": 296.3 m; footprint 75 m with the flare (OSM)' },
  // With the new airports
  { id: 'lct', city: 'busan', country: 'KR', lat: 35.15993, lon: 129.16973, heightM: 411.6, footprintM: 260, brg: 117, floors: 101,
    parts: [[0, 0, 40], [-160, 151, 38], [-78, 95, 38]],
    source: 'Wikipedia "Haeundae LCT The Sharp": Landmark Tower 411.6 m, residential towers 339.1 m and 333 m; placed from OSM' },
  { id: 'neatt', city: 'songdo', country: 'KR', lat: 37.38924, lon: 126.64423, heightM: 305, footprintM: 42, brg: 40, floors: 68,
    source: 'Wikipedia "Posco Tower-Songdo" (Northeast Asia Trade Tower): 305 m, a square base tapering to a triangular roof' },
  { id: 'harukas', city: 'osaka', country: 'JP', lat: 34.64601, lon: 135.51350, heightM: 300, footprintM: 62, brg: 8, floors: 60,
    source: 'Wikipedia "Abeno Harukas": 300 m; footprint 88 m (OSM); the setbacks\' sides [EST]' },
  { id: 'umeda', city: 'osaka', country: 'JP', lat: 34.70530, lon: 135.49007, heightM: 173, footprintM: 64, brg: -2, floors: 40,
    source: 'Wikipedia "Umeda Sky Building": roof 170 m (spire 190 m), 173 m to the parapet [EST]; towers from OSM' },
  { id: 'fktower', city: 'fukuoka', country: 'JP', lat: 33.59331, lon: 130.35148, heightM: 234, footprintM: 15, brg: 140,
    source: 'Wikipedia "Fukuoka Tower": 234 m, decks 116-123 m, mast 111 m above the top deck; triangle 24 m (OSM)' },
  { id: 'fkdome', city: 'fukuoka', country: 'JP', lat: 33.5953, lon: 130.3622, heightM: 84, footprintM: 109, brg: 0,
    source: 'Wikipedia "Mizuho PayPay Dome Fukuoka" (coordinates; no size given): 216 m across and 84 m high [EST, the brief]' },
];
// The cities' boxes (lat S, W, N, E) the tests check the list against.
export const CITY_BOXES = {
  seoul: [37.42, 126.80, 37.70, 127.20], shanghai: [31.10, 121.30, 31.35, 121.65], tokyo: [35.55, 139.60, 35.80, 139.90],
  yokohama: [35.40, 139.55, 35.52, 139.70], busan: [35.05, 128.90, 35.30, 129.25], songdo: [37.34, 126.58, 37.44, 126.70],
  osaka: [34.60, 135.40, 34.75, 135.60], fukuoka: [33.54, 130.30, 33.65, 130.45],
};

for (const L of LANDMARKS) {
  const [x, y] = toMap(L.lat, L.lon);
  L.x = x; L.y = y;
}

// The real centres' extrusion leaves these out: one circle per tower, in map metres.
export function landmarkFootprints() {
  const out = [];
  for (const L of LANDMARKS) {
    if (L.parts) for (const [dx, dy, r] of L.parts) out.push({ id: L.id, x: L.x + dx, y: L.y + dy, r });
    else out.push({ id: L.id, x: L.x, y: L.y, r: L.footprintM });
  }
  return out;
}

export function buildModel(L) {
  const f = MODELS[L.id];
  if (L.id === 'parc1') return f(L.brg, L.parts[1].slice(0, 2));
  if (L.id === 'lct') return f(undefined, L.brg);
  return f(L.brg);   // (the round ones take no bearing and ignore it)
}

// Is this landmark on in the scene now (the flags)?
export const landmarkOn = (L) => CITIES_ON && (L.country === 'KR' || EAST_ASIA_ON);

// ------------------------------------------------------------------ the shaders

function buildingMaterial(uniforms, chunks) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      attribute vec3 aCol, aGlow;
      attribute vec4 aFac, aExt;
      varying vec3 vRel, vN, vLocal, vCol, vGlow;
      varying vec4 vFac, vExt;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vRel = wp.xyz - uCamPos;
        vN = mat3(modelMatrix) * normal;
        vLocal = position;
        vCol = aCol; vGlow = aGlow; vFac = aFac; vExt = aExt;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.ATMOS_GLSL}
      ${chunks.NOISE_GLSL}
      varying vec3 vRel, vN, vLocal, vCol, vGlow;
      varying vec4 vFac, vExt;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float dist = length(vRel);
        // A lattice's far stand-in: not drawn within about 3 km (a dithered hand-over).
        if (vExt.z > 0.5 && hash12(floor(gl_FragCoord.xy)) > smoothstep(1800.0, 3600.0, dist)) discard;
        vec3 n = normalize(vN);
        vec3 V = -vRel / max(dist, 1e-3);
        if (dot(n, V) < 0.0 && vExt.z < 0.5) n = -n;     // thin members seen from behind
        vec3 alb = vCol;
        vec3 glow = vec3(0.0);
        float refl = 0.0;
        float y = vLocal.y;
        if (vFac.x > 0.0 && abs(n.y) < 0.8) {
          // The curtain wall: floors, the spandrel between them, mullions every bay.
          float fh = vFac.x, bw = vFac.y, u = vExt.x;
          float fl = fract(y / fh), bu = fract(u / bw);
          float fw = max(fwidth(y) / fh, fwidth(u) / bw);
          float win = smoothstep(0.10, 0.18, fl) * (1.0 - smoothstep(0.86, 0.94, fl));
          win *= smoothstep(0.02, 0.08, bu) * (1.0 - smoothstep(0.92, 0.98, bu));
          win = mix(win, 0.72, smoothstep(0.35, 1.2, fw));       // averaged out once a floor is a pixel or two
          vec3 frame = mix(alb, vec3(0.36, 0.37, 0.38), 0.45);
          alb = mix(frame, alb * 0.75, win);
          refl = vFac.z * win;
          if (uNight > 0.01 && vFac.w > 0.0) {
            // Lit windows, as the cities' are: one cell per two bays and floor, a share of them lit.
            vec2 cid = vec2(floor(u / (2.0 * bw)), floor(y / fh));
            float hs = hash12(cid + vec2(vExt.y * 913.0, vExt.y * 371.0));
            float lit = step(hs, vFac.w);
            float hk = hash12(cid * 1.37 + vExt.y * 77.0 + 3.1);
            vec3 wc = hk < 0.55 ? vec3(1.0, 0.78, 0.50) : (hk < 0.9 ? vec3(0.85, 0.88, 0.95) : vec3(1.0, 0.58, 0.28));
            float dim = 0.5 + 0.5 * hash12(cid + 11.7 + vExt.y * 19.0);
            float avg = smoothstep(0.5, 1.6, max(fwidth(y) / fh, fwidth(u) / (2.0 * bw)));
            glow += mix(wc * lit * dim, vec3(1.0, 0.8, 0.55) * vFac.w * 0.45, avg) * win * uNight * 0.8;
          }
        } else if (vFac.z > 0.0) {
          refl = vFac.z;
        }
        if (uSnow > 0.0) alb = mix(alb, vec3(0.55, 0.57, 0.60), uSnow * 0.75 * smoothstep(0.55, 0.9, n.y));
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
        // Glass and metal: the sky (and the ground below the horizon) by Fresnel, and the sun's glint.
        vec3 R = reflect(-V, n);
        float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        float rw = refl * mix(0.35, 1.0, fres);
        float hd = horizonDip();
        vec3 sky = hazeColor(vec3(R.x, max(R.y, hd), R.z));
        vec3 env = mix(mix(sky, vec3(0.10, 0.105, 0.10) * (0.25 + uSunColor * 0.6), 0.6), sky, smoothstep(hd - 0.25, hd + 0.03, R.y));
        // gold or tinted glass reflects in its own colour (vExt.w > 0.7: a metallic coating)
        env *= vExt.w > 0.7 ? mix(vec3(1.0), normalize(vCol + 1e-3) * 1.7, 0.75) : vec3(1.0);
        col = mix(col, env * 0.9, rw * 0.85);
        float sp = pow(max(dot(R, uSunDir), 0.0), 180.0) * (refl * 3.0 + vExt.w * 0.6);
        col += uSunColor * sp * uSunVis;
        // At night the facade's own light (the famous floodlights), and the windows.
        col += (vGlow * uNight) * (0.55 + 0.45 * max(dot(n, V), 0.0)) + glow;
        gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// The aviation lights: points that hold their size on screen (as airports.js's), dimmer rather
// than smaller far away; the top ones flash slowly (about 30 a minute), the rest steady.
function lightMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 uCamPos;
      uniform float uCamAlt, uTime, uPxScale, uNight, uHazeSigma0, uHazeH, uLightCarry;
      attribute float aKind;
      varying vec3 vCol;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 r = wp.xyz - uCamPos;
        float dist = length(r);
        float I = 1.0;
        if (aKind > 0.5) {
          // a slow flash, each tower its own phase (from its position: the same every run)
          float ph = fract(uTime * 0.5 + fract(position.x * 0.013 + position.z * 0.007));
          I = 0.08 + 1.4 * exp(-pow((ph - 0.25) / 0.12, 2.0));
        }
        float od = uHazeSigma0 * dist * exp(-max(min(uCamAlt, wp.y + 0.5 * r.y), 0.0) / uHazeH);
        I *= exp(-od * uLightCarry);
        float px = 3.0 * uPxScale / max(dist, 1.0);
        float minPx = 2.5;
        I *= clamp(pow(px / minPx, 0.35), 0.3, 1.0);
        float S = clamp(px, minPx, 10.0) * (aKind > 0.5 ? 2.6 : 2.0);
        gl_PointSize = S * step(0.002, I);
        vCol = vec3(1.0, 0.07, 0.03) * I * uNight * 1.6;
        vec4 mv = viewMatrix * wp;
        float d = length(mv.xyz);
        mv.xyz *= 1.0 - min((1.5 + d * 0.002) / max(d, 1e-3), 0.5);    // pulled in a little: off the facade
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vCol * (exp(-r2 * 9.0) * 1.4 + exp(-r2 * 2.5) * 0.25), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ the runtime

// The ground under a landmark: the lowest of heightAt at its centre and round its plan (so no
// side floats), less half a metre.
export function baseHeight(L, heightAt) {
  let h = heightAt(L.x, L.y);
  const circles = L.parts ? L.parts.map(([dx, dy, r]) => [L.x + dx, L.y + dy, r]) : [[L.x, L.y, L.footprintM]];
  for (const [x, y, r] of circles) {
    h = Math.min(h, heightAt(x, y));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; h = Math.min(h, heightAt(x + 0.8 * r * Math.cos(a), y + 0.8 * r * Math.sin(a))); }
  }
  return h - 0.5;
}

export function createLandmarks(scene, uniforms, chunks, { heightfield = null, renderer = null } = {}) {
  void renderer;
  const hf = heightfield;
  const heightAt = (x, y) => (hf ? hf.heightAt(x, y) : 0);
  const group = new THREE.Group();
  group.name = 'landmarks';
  let mat = null, lmat = null, added = false;
  const items = LANDMARKS.map((L) => ({ L, state: 'none', mesh: null, pts: null, ground: 0, tris: 0, ms: 0 }));
  const stats = { drawCalls: 0, triangles: 0, shown: 0, built: 0, lights: 0, buildMs: 0 };

  function build(it) {
    const t0 = performance.now();
    if (!mat) { mat = buildingMaterial(uniforms, chunks); lmat = lightMaterial(uniforms); }
    const { geometry, lights } = buildModel(it.L);
    it.ground = baseHeight(it.L, heightAt);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = `landmark-${it.L.id}`;
    mesh.matrixAutoUpdate = true;
    mesh.visible = false;
    it.mesh = mesh;
    it.tris = geometry.getAttribute('position').count / 3;
    if (lights.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lights.flatMap((l) => [l[0], l[1], l[2]]), 3));
      g.setAttribute('aKind', new THREE.Float32BufferAttribute(lights.map((l) => l[3]), 1));
      g.computeBoundingSphere();
      g.boundingSphere.radius += 10;
      const pts = new THREE.Points(g, lmat);
      pts.name = `landmark-lights-${it.L.id}`;
      pts.renderOrder = 9;
      pts.visible = false;
      it.pts = pts;
      group.add(pts);
    }
    group.add(mesh);
    it.state = 'built';
    it.ms = performance.now() - t0;
    stats.buildMs = Math.max(stats.buildMs, it.ms);
    if (hf && hf.tiles && hf.tiles.release) hf.tiles.release(`landmark:${it.L.id}`);
  }
  function release(it) {
    if (it.mesh) { group.remove(it.mesh); it.mesh.geometry.dispose(); }
    if (it.pts) { group.remove(it.pts); it.pts.geometry.dispose(); }
    // A landmark released while its tiles were still loading gives its pin back too.
    if (it.state === 'pending' && hf && hf.tiles && hf.tiles.release) hf.tiles.release(`landmark:${it.L.id}`);
    it.mesh = null; it.pts = null; it.state = 'none';
  }
  function request(it) {
    const T = hf && hf.tiles;
    if (T && T.whenReady && !T.isReady?.(it.L.x, it.L.y, 600)) {
      it.state = 'pending';
      T.whenReady(it.L.x, it.L.y, 600, `landmark:${it.L.id}`).then(() => { if (it.state === 'pending') build(it); }, () => { it.state = 'none'; });
    } else build(it);
  }

  const api = {
    group, stats, items,
    // camMap: the camera's map x, y; origin: the scene origin's; camScene: the camera's scene position.
    // Off: everything hidden (a dev page's on/off comparison); nothing is released.
    enabled: true,
    update({ camMap, origin, camScene = null }) {
      let calls = 0, tris = 0, shown = 0, built = 0, lightsN = 0;
      if (!api.enabled) {
        for (const it of items) { if (it.mesh) it.mesh.visible = false; if (it.pts) it.pts.visible = false; }
        stats.drawCalls = 0; stats.triangles = 0; stats.shown = 0; stats.lights = 0;
        return stats;
      }
      const night = uniforms.uNight.value >= 0.01;
      const cx = camScene ? camScene.x : 0, cz = camScene ? camScene.z : 0;
      for (const it of items) {
        const L = it.L;
        const on = landmarkOn(L);
        if (!on) { if (it.state !== 'none') release(it); continue; }
        const d = Math.hypot(L.x - camMap.x, L.y - camMap.y);
        if (it.state === 'none' && d < BUILD_M) request(it);
        else if (it.state === 'built' && d > RELEASE_M) release(it);
        if (it.state !== 'built') continue;
        built++;
        const vis = d < SHOW_M;
        const px = L.x - origin.x, pz = -(L.y - origin.y);
        const dx = px - cx, dz = pz - cz;
        const py = it.ground - (dx * dx + dz * dz) / (2 * EARTH_RADIUS);
        it.mesh.visible = vis;
        if (vis) { it.mesh.position.set(px, py, pz); calls++; tris += it.tris; shown++; }
        if (it.pts) {
          it.pts.visible = vis && night;
          if (it.pts.visible) { it.pts.position.set(px, py, pz); calls++; lightsN += it.pts.geometry.getAttribute('position').count; }
        }
      }
      if (built > 0 && !added) { scene.add(group); added = true; }
      else if (built === 0 && added) { scene.remove(group); added = false; }
      stats.drawCalls = calls; stats.triangles = tris; stats.shown = shown; stats.built = built; stats.lights = lightsN;
      return stats;
    },
    dispose() {
      for (const it of items) release(it);
      if (added) scene.remove(group);
      added = false;
      mat?.dispose(); lmat?.dispose(); mat = lmat = null;
    },
  };
  return api;
}
