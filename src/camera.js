// The four views and the touchpad camera. Two-finger swipe (wheel) looks around or orbits,
// pinch (wheel with ctrlKey, as Chrome on macOS reports it) zooms, double-click recentres.
// Positions are worked out in map metres; main.js makes the camera the scene origin.

import * as THREE from '../vendor/three.module.js';
import { EYES } from './geometry.js';

export const VIEWS = [
  { id: 'nose', name: '1st person' },
  { id: 'orbit', name: '3rd person' },
  { id: 'captain', name: "Captain's seat" },
  { id: 'fo', name: "First Officer's seat" },
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
      look.yaw -= e.deltaX * k;
      look.pitch -= e.deltaY * k;
      const lim = look.dist !== undefined ? 85 * DEG : 80 * DEG;
      look.pitch = Math.max(-lim, Math.min(lim, look.pitch));
      if (look.dist === undefined) look.yaw = Math.max(-170 * DEG, Math.min(170 * DEG, look.yaw));
    }
  }
  function recentre() {
    const id = VIEWS[index].id;
    const keepDist = looks[id].dist;
    looks[id] = { ...DEFAULTS[id] };
    if (keepDist !== undefined) looks[id].dist = keepDist;
  }
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('dblclick', recentre);

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

  return {
    camera,
    update,
    recentre,
    get view() { return VIEWS[index]; },
    set viewId(id) { index = Math.max(0, VIEWS.findIndex((w) => w.id === id)); },
    next() { index = (index + 1) % VIEWS.length; return VIEWS[index]; },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    looks,
  };
}
