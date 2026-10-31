// The simple A321neo cockpit, in the model frame (built in body coordinates, like aircraft.js).
// A shell that follows the nose's inner skin with the six windows cut out (so the posts block
// the view where the real ones do), the glare shield and FCU, the main panel with six dark
// screens, the pedestal with its levers, two seats, two sidesticks and the overhead panel.
//
//   createCockpit() → { object, update(state, controls?) }

import * as THREE from '../vendor/three.module.js';
import { NOSE_X } from './geometry.js';
import { Builder, grid, boxAt, cylBetween, fusePoint, toModel, fuseMid, windowOutlines } from './aircraft.js';
import { createCockpitAlpha, cockpitAlphaV, COCKPIT_ALPHA_X } from './livery.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const C = {
  shell: '#5d6c7b', panel: '#3b4652', glare: '#23282e', fcu: '#1b1f24', screen: '#07090c',
  bezel: '#2a3038', seat: '#343c46', floor: '#2b3138', lever: '#c7ccd2', grip: '#1d2024',
  console: '#46525e', overhead: '#4d5a68',
};

const PANEL_TILT = 12 * DEG;
// The main instrument panel's base, under the glare shield. It moved 0.24 m aft in v0.1.2,
// when the nose's crown came down over the windshield.
const PANEL_X = 19.14;
// Main instrument panel surface: x at height z (body), just aft of the panel.
const panelX = (z) => PANEL_X - (z - 0.12) * Math.tan(PANEL_TILT) - 0.03;

export function createCockpit() {
  const object = new THREE.Group();
  object.name = 'cockpit';

  // Shell: the nose's inner skin, with the windows cut out by an alpha map.
  {
    const rows = [], uvs = [];
    const NA = 72;
    for (let i = 0; i <= 40; i++) {
      const x = 16.6 + (NOSE_X - 0.05 - 16.6) * Math.sin((i / 40) * Math.PI / 2);
      const row = [], urow = [];
      for (let j = 0; j <= NA; j++) {
        const th = -90 + (360 * j) / NA;
        row.push(fusePoint(x, th, -0.05));
        urow.push([(x - COCKPIT_ALPHA_X[0]) / (COCKPIT_ALPHA_X[1] - COCKPIT_ALPHA_X[0]), cockpitAlphaV(th)]);
      }
      rows.push(row); uvs.push(urow);
    }
    const g = grid(rows, { uvs, expect: (c) => V(0, c.y, c.z - fuseMid(c.x)) });
    const b = new Builder();
    b.add(g, 0, '#ffffff', 'keep');
    const mat = new THREE.MeshStandardMaterial({
      color: C.shell, roughness: 0.85, metalness: 0, side: THREE.BackSide,
      emissive: '#27313b', // stands in for the light bouncing round the flight deck
      alphaMap: createCockpitAlpha(windowOutlines()), alphaTest: 0.5, alphaToCoverage: true,
    });
    const m = new THREE.Mesh(b.build(), mat);
    m.name = 'cockpit-shell';
    object.add(m);
  }

  // Static interior, one merged mesh with vertex colours.
  const b = new Builder();
  const add = (g, color) => b.add(g, 0, color);
  add(boxAt(18.3, 0, -0.38, 3.2, 2.5, 0.06), C.floor);
  add(boxAt(16.72, 0, 0.75, 0.06, 3.7, 2.9), C.shell);                 // rear bulkhead
  add(boxAt(16.69, 0.45, 0.45, 0.02, 0.8, 1.9), C.panel);              // its door
  // Glare shield, just under the windshield's lower frame from the seats, and the FCU on its face.
  add(boxAt(19.04, 0, 0.535, 0.28, 1.6, 0.07), C.glare);
  add(boxAt(18.9, 0, 0.485, 0.08, 0.95, 0.13), C.fcu);
  for (const s of [1, -1]) add(boxAt(18.9, s * 0.66, 0.485, 0.08, 0.34, 0.13), C.fcu);
  // Main panel, tilted back.
  add(boxAt(PANEL_X, 0, 0.12, 0.05, 2.0, 0.68).applyMatrix4(tiltAbout(PANEL_X, 0.12)), C.panel);
  // Six screens: Captain PFD and ND, E/WD and SD in the centre, FO ND and PFD.
  const screens = [[0.72, 0.2], [0.47, 0.2], [0, 0.26], [0, 0.0], [-0.47, 0.2], [-0.72, 0.2]];
  for (const [y, z] of screens) {
    add(boxAt(panelX(z), y, z, 0.012, 0.215, 0.215).applyMatrix4(tiltAbout(panelX(z), z)), C.bezel);
    add(boxAt(panelX(z) - 0.008, y, z, 0.006, 0.185, 0.185).applyMatrix4(tiltAbout(panelX(z) - 0.008, z)), C.screen);
  }
  // Pedestal and side consoles.
  add(boxAt(18.6, 0, -0.12, 1.06, 0.44, 0.5), C.console);
  add(boxAt(18.96, 0, 0.04, 0.4, 0.44, 0.3).applyMatrix4(tiltAbout(18.96, 0.04, -30 * DEG)), C.console);
  for (const s of [1, -1]) add(boxAt(18.45, s * 1.12, -0.06, 1.3, 0.4, 0.5), C.console);
  // Seats.
  for (const s of [1, -1]) {
    const y = s * 0.53;
    add(boxAt(18.38, y, -0.12, 0.4, 0.4, 0.5), C.floor);
    add(boxAt(18.38, y, 0.1, 0.55, 0.55, 0.14), C.seat);
    add(boxAt(18.05, y, 0.6, 0.13, 0.55, 0.9).applyMatrix4(tiltAbout(18.05, 0.6, -10 * DEG)), C.seat);
    add(boxAt(17.97, y, 1.17, 0.12, 0.32, 0.24), C.seat);
    add(boxAt(18.38, y - s * 0.3, 0.32, 0.4, 0.06, 0.06), C.seat); // inboard armrest
  }
  // Overhead panel.
  add(boxAt(17.85, 0, 1.6, 0.9, 0.8, 0.1).applyMatrix4(tiltAbout(17.85, 1.6, 14 * DEG)), C.overhead);

  const stat = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, emissive: '#161b21' }));
  stat.name = 'cockpit-interior';
  object.add(stat);

  // Moving parts: each a mesh whose origin is its pivot.
  const levMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, emissive: '#161b21' });
  function part(pivot, build) {
    const pb = new Builder();
    build((g, color) => pb.add(g.translate(-pivot.x, -pivot.y, -pivot.z), 0, color));
    const m = new THREE.Mesh(pb.build(), levMat);
    m.position.copy(toModel(pivot.x, pivot.y, pivot.z));
    object.add(m);
    return m;
  }
  // Thrust levers (both, they move together).
  const thrust = part(V(18.95, 0, 0.13), (a) => {
    for (const y of [0.07, -0.07]) {
      a(boxAt(18.95, y, 0.22, 0.025, 0.025, 0.18), C.lever);
      a(boxAt(18.95, y, 0.32, 0.05, 0.09, 0.04), C.grip);
    }
  });
  const flap = part(V(18.6, -0.17, 0.13), (a) => {
    a(boxAt(18.6, -0.17, 0.2, 0.02, 0.02, 0.14), C.lever);
    a(boxAt(18.6, -0.17, 0.28, 0.06, 0.04, 0.04), C.lever);
  });
  const sbrake = part(V(18.6, 0.17, 0.13), (a) => {
    a(boxAt(18.6, 0.17, 0.2, 0.02, 0.02, 0.14), C.lever);
    a(boxAt(18.6, 0.17, 0.28, 0.05, 0.05, 0.03), C.grip);
  });
  const gearPivot = V(panelX(0.0) - 0.01, -0.3, 0.0);
  const gear = part(gearPivot, (a) => {
    a(cylBetween(gearPivot, gearPivot.clone().add(V(-0.12, 0, 0)), 0.01, 0.01, 6), C.lever);
    a(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12).translate(gearPivot.x - 0.13, gearPivot.y, gearPivot.z), C.lever);
  });
  const sticks = [1, -1].map((s) => part(V(18.55, s * 1.02, 0.2), (a) => {
    a(cylBetween(V(18.55, s * 1.02, 0.2), V(18.55, s * 1.02, 0.3), 0.012, 0.012, 8), C.grip);
    a(boxAt(18.56, s * 1.02, 0.36, 0.06, 0.05, 0.12), C.grip);
  }));

  // Rotations about body axes, expressed in the model frame.
  const AY = toModel(0, 1, 0), AX = toModel(1, 0, 0);
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const setRot = (m, aboutY, aboutX = 0) => {
    q1.setFromAxisAngle(AY, aboutY); q2.setFromAxisAngle(AX, aboutX);
    m.quaternion.copy(q1).multiply(q2);
  };

  function update(state = {}, controls = null) {
    const tl = state.thrustLever ?? controls?.thrust ?? 0;
    // IDLE leans 20° aft, TOGA 25° forward (TLA 45°); reverse pulls further aft.
    setRot(thrust, (tl >= 0 ? -20 + 45 * tl : -20 + 20 * tl) * DEG);
    const fl = controls?.flapLever ?? state.flapLever ?? 0;
    setRot(flap, (25 - fl * 12.5) * DEG);
    const sb = controls?.speedbrake ?? state.speedbrake ?? 0;
    setRot(sbrake, (20 - clamp(sb, 0, 1) * 40) * DEG);
    const down = controls ? controls.gearDown : (state.gearPos ?? 1) > 0.5;
    setRot(gear, (down ? -30 : 30) * DEG);
    const p = controls?.pitch ?? 0, r = controls?.roll ?? 0;
    for (const st of sticks) setRot(st, -p * 16 * DEG, r * 16 * DEG);
  }
  update();
  return { object, update };
}

// Rotation by `a` about the body y axis through (x, z): tilts panels back.
function tiltAbout(x, z, a = -PANEL_TILT) {
  return new THREE.Matrix4().makeTranslation(x, 0, z)
    .multiply(new THREE.Matrix4().makeRotationY(a))
    .multiply(new THREE.Matrix4().makeTranslation(-x, 0, -z));
}
