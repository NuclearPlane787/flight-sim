// The taxi route drawn on the ground: a bright green-yellow ribbon, about 0.6 m wide,
// a little above the pavement, in one draw call (PLAN.md → Airports → Gate starts).
//
//   const tr = createTaxiRoute(scene, { uniforms, heightAt });
//   tr.set(points, { h })      // [[x, y], …] in map metres; h = ground height (m MSL)
//   tr.clear();  tr.visible = false;
//   tr.points                  // the route's points (for the ND), or []
//   tr.setOrigin(origin)       // only without `uniforms` (else uniforms.uOrigin is read)
//
// Camera-relative like src/world/airports.js: vertices are kept relative to an anchor
// (the route's first point), and each frame the mesh sits at anchor − origin. The
// vertex shader drops it with the Earth's curvature and pulls it a little towards the
// camera, so it draws over the runway and the terrain without fighting them.

import * as THREE from '../../vendor/three.module.js';
import { EARTH_RADIUS } from './frame.js';

const WIDTH = 0.6;        // m (a guidance line, not a carpet, seen from the nose 3.7 m up)
const LIFT = 0.25;        // m above the ground
const STEP = 25;          // m: long legs are split so the curvature drop follows the ground
const COLOR = 0xc8ff2a;   // green-yellow

const VERT = `
uniform vec3 uRel;        // anchor − origin, scene frame
uniform float uPxScale;   // pixels per radian of view
varying float vAlong;
attribute float along;
attribute vec2 offs;      // half-width offset per metre of width (mitred), scene x/z
void main() {
  vec3 wp = position + uRel;
  // 0.6 m wide, but never thinner than about 2.5 pixels, so it reads from far above.
  float w = max(${WIDTH.toFixed(2)}, 2.5 * distance(wp, cameraPosition) / uPxScale);
  wp.xz += offs * w;
  wp.y -= dot(wp.xz, wp.xz) / ${(2 * EARTH_RADIUS).toFixed(1)};
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = length(mv.xyz);
  mv.xyz *= 1.0 - min((0.08 + d * 0.0015) / max(d, 1e-3), 0.5);   // pull towards the camera
  vAlong = along;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uColor;
uniform float uTime;
varying float vAlong;
void main() {
  // A soft travelling brightening (every 30 m) so the direction reads at a glance.
  float pulse = 0.82 + 0.18 * smoothstep(0.6, 1.0, fract(vAlong / 30.0 - uTime * 0.4));
  gl_FragColor = vec4(uColor * pulse * 0.85, 0.7);
}`;

export function createTaxiRoute(scene, { uniforms = null, heightAt = null } = {}) {
  const u = {
    uRel: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color(COLOR) },
    uTime: uniforms?.uTime || { value: 0 },
    uPxScale: uniforms?.uPxScale || { value: 780 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
    depthWrite: false, fog: false, side: THREE.DoubleSide, transparent: true,
  });
  const geo = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'taxi-route';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  scene.add(mesh);

  const anchor = { x: 0, y: 0 };
  const own = { x: 0, y: 0 };
  let pts = [];

  mesh.onBeforeRender = () => {
    const o = uniforms?.uOrigin ? uniforms.uOrigin.value : own;
    u.uRel.value.set(anchor.x - o.x, 0, -(anchor.y - o.y));
  };

  // Points → a ribbon with mitred joins, legs split every STEP metres.
  function set(points, opts = {}) {
    pts = (points || []).map((p) => [p[0], p[1]]);
    if (pts.length < 2) { clear(); return; }
    const hOf = (x, y) => (opts.h ?? (heightAt ? heightAt(x, y) : 0)) + LIFT;
    // Densify.
    const P = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
      for (let k = 1; k <= n; k++) P.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
    }
    anchor.x = P[0][0]; anchor.y = P[0][1];
    const n = P.length;
    const pos = new Float32Array(n * 2 * 3), al = new Float32Array(n * 2), off = new Float32Array(n * 2 * 2);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[Math.min(n - 1, i + 1)];
      // Unit directions of the legs before and after, and the mitre.
      let d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = c[0] - b[0], d2y = c[1] - b[1];
      const l1 = Math.hypot(d1x, d1y) || 1, l2 = Math.hypot(d2x, d2y) || 1;
      d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
      if (i === 0) { d1x = d2x; d1y = d2y; }
      if (i === n - 1) { d2x = d1x; d2y = d1y; }
      let tx = d1x + d2x, ty = d1y + d2y;
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;                                         // left normal
      const k = Math.min(3, 1 / Math.max(0.33, nx * -d1y + ny * d1x)); // mitre length, capped
      const w = k / 2;
      if (i > 0) s += Math.hypot(b[0] - a[0], b[1] - a[1]);
      const h = hOf(b[0], b[1]);
      for (let side = 0; side < 2; side++) {
        const sg = side ? -1 : 1;
        pos.set([b[0] - anchor.x, h, -(b[1] - anchor.y)], (i * 2 + side) * 3);
        off.set([sg * nx * w, -sg * ny * w], (i * 2 + side) * 2);
        al[i * 2 + side] = s;
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.dispose(); // frees the old route's GPU buffers; new ones upload on the next draw
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('along', new THREE.BufferAttribute(al, 1));
    geo.setAttribute('offs', new THREE.BufferAttribute(off, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    mesh.visible = true;
  }

  function clear() {
    pts = [];
    mesh.visible = false;
  }

  return {
    mesh, set, clear,
    setOrigin(o) { own.x = o.x; own.y = o.y; },
    get points() { return pts; },
    get visible() { return mesh.visible; },
    set visible(v) { mesh.visible = !!v && pts.length >= 2; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
