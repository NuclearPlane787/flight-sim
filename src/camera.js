// The four views and the camera controls. Press and drag on the view (one finger, v0.2.1) or a
// two-finger swipe (wheel) looks around or orbits, pinch (wheel with ctrlKey, as Chrome on
// macOS reports it) zooms, double-click recentres.
// Positions are worked out in map metres; main.js makes the camera the scene origin.

import * as THREE from '../vendor/three.module.js';
import { EYES } from './geometry.js';

// The names match the view switch (v0.2.1: Cockpit, Nose, 3rd person; ui/hud.js).
export const VIEWS = [
  { id: 'nose', name: 'Nose' },
  { id: 'orbit', name: '3rd person' },
  { id: 'captain', name: "Cockpit: captain's seat" },
  { id: 'fo', name: "Cockpit: first officer's seat" },
];

const DEG = Math.PI / 180;
const DEFAULTS = {
  nose: { yaw: 0, pitch: -3 * DEG, fov: 60 },
  orbit: { yaw: 0, pitch: 12 * DEG, fov: 50, dist: 75 },
  captain: { yaw: 0, pitch: -6 * DEG, fov: 62 },
  fo: { yaw: 0, pitch: -6 * DEG, fov: 62 },
};

export function createCameraRig(dom) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 10, 0.1, 500000);
  const looks = structuredClone(DEFAULTS);
  let index = 0;

  const modelQ = new THREE.Quaternion();
  const lookQ = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3();

  // Turn the current view's look by (dyaw, dpitch) radians. +yaw turns the view left (orbit:
  // the camera goes round to its left), +pitch up (orbit: the camera climbs). In the nose and
  // the seats you can look up to 80° up or down and 170° either way.
  function turn(dyaw, dpitch) {
    const look = looks[VIEWS[index].id];
    look.yaw += dyaw;
    look.pitch += dpitch;
    const lim = look.dist !== undefined ? 85 * DEG : 80 * DEG;
    look.pitch = Math.max(-lim, Math.min(lim, look.pitch));
    if (look.dist === undefined) look.yaw = Math.max(-170 * DEG, Math.min(170 * DEG, look.yaw));
  }

  function onWheel(e) {
    e.preventDefault();
    const look = looks[VIEWS[index].id];
    if (e.ctrlKey) {
      // Pinch: deltaY < 0 is fingers apart (zoom in).
      const f = Math.exp(e.deltaY * 0.01);
      if (look.dist !== undefined) look.dist = Math.min(1500, Math.max(18, look.dist * f));
      else look.fov = Math.min(90, Math.max(15, look.fov * f));
    } else {
      const k = 0.0035 * (look.fov / 60);
      turn(-e.deltaX * k, -e.deltaY * k);
    }
  }

  // Drag (v0.2.1). Shane: "For steering the camera, I have to use two fingers, but I am not used
  // to that, so change it to clicking and dragging with one finger." Press on the view and drag:
  // the view follows the finger, as the swipe does (drag right and the scene moves right). A
  // press that moves less than DRAG_PX is a click (two still recentre). Speeds per screen
  // height: looking, DRAG_LOOK × the field of view (so finer when zoomed in); orbiting,
  // DRAG_ORBIT radians.
  const DRAG_PX = 4, DRAG_LOOK = 2.5, DRAG_ORBIT = 3.2;
  let drag = null, dragged = false;
  function onDown(e) {
    if (e.button !== 0 || !e.isPrimary) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
    dragged = false;
    try { dom.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      drag.on = dragged = true;
      dom.classList.add('drag');
    }
    drag.x = e.clientX; drag.y = e.clientY;
    const look = looks[VIEWS[index].id];
    const h = dom.clientHeight || window.innerHeight || 800;
    const k = (look.dist !== undefined ? DRAG_ORBIT : DRAG_LOOK * look.fov * DEG) / h;
    turn(dx * k, dy * k);
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    dom.classList.remove('drag');
  }
  function recentre() {
    const id = VIEWS[index].id;
    const keepDist = looks[id].dist;
    looks[id] = { ...DEFAULTS[id] };
    if (keepDist !== undefined) looks[id].dist = keepDist;
  }
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('lostpointercapture', onUp);
  // A double-click recentres; not one whose second press was a drag.
  dom.addEventListener('dblclick', () => { if (!dragged) recentre(); });

  // Camera map position {x, y, z} for this frame; sets camera.quaternion and fov.
  function update(s, out = { x: 0, y: 0, z: 0 }) {
    const id = VIEWS[index].id;
    const look = looks[id];
    euler.set(s.pitch, -s.hdg, -s.roll, 'YXZ');
    modelQ.setFromEuler(euler);

    if (id === 'orbit') {
      const az = s.hdg + Math.PI + look.yaw;
      const cp = Math.cos(look.pitch);
      out.x = s.pos.x + look.dist * cp * Math.sin(az);
      out.y = s.pos.y + look.dist * cp * Math.cos(az);
      out.z = s.pos.z + 2 + look.dist * Math.sin(look.pitch);
      const floor = (s.groundH ?? 0) + 1.5;
      if (out.z < floor) out.z = floor;
      // Look at the aircraft (scene frame: X east, Y up, Z south).
      const dx = s.pos.x - out.x, dy = s.pos.y - out.y, dz = s.pos.z + 2 - out.z;
      camera.position.set(0, out.z, 0);
      camera.up.set(0, 1, 0);
      camera.lookAt(dx, out.z + dz, -dy);
    } else {
      const eye = EYES[id];
      v.set(-eye.y, eye.z, -eye.x).applyQuaternion(modelQ); // body → model → scene
      out.x = s.pos.x + v.x;
      out.y = s.pos.y - v.z;
      out.z = s.pos.z + v.y;
      euler.set(look.pitch, look.yaw, 0, 'YXZ');
      lookQ.setFromEuler(euler);
      camera.quaternion.copy(modelQ).multiply(lookQ);
    }
    camera.position.set(0, out.z, 0); // the camera is the scene origin (horizontally)
    if (camera.fov !== look.fov) { camera.fov = look.fov; camera.updateProjectionMatrix(); }
    // Near plane: close in the cockpit, further out elsewhere for depth precision.
    const near = id === 'captain' || id === 'fo' ? 0.05 : id === 'nose' ? 0.25 : 0.5;
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
    return out;
  }

  // A scenario save (v0.2.0): the view and each view's look (yaw, pitch, fov, orbit dist).
  function serialize() {
    return { viewId: VIEWS[index].id, looks: JSON.parse(JSON.stringify(looks)) };
  }
  // Back from serialize(). Unknown view ids and non-numbers are ignored; missing fields keep
  // their defaults.
  function load(o) {
    if (!o) return;
    for (const id of Object.keys(DEFAULTS)) {
      const src = o.looks?.[id];
      if (!src) continue;
      const look = { ...DEFAULTS[id] };
      for (const k of Object.keys(DEFAULTS[id])) if (Number.isFinite(src[k])) look[k] = src[k];
      looks[id] = look;
    }
    const i = VIEWS.findIndex((w) => w.id === o.viewId);
    if (i >= 0) index = i;
  }

  return {
    camera,
    update,
    recentre,
    serialize,
    load,
    get view() { return VIEWS[index]; },
    set viewId(id) { index = Math.max(0, VIEWS.findIndex((w) => w.id === id)); },
    next() { index = (index + 1) % VIEWS.length; return VIEWS[index]; },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    looks,
  };
}
