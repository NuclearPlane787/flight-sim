// The Boeing widebodies' simple cockpit, in the model frame (built in body coordinates, like
// aircraft.js), parametric, for the 787-9 and the 777-300ER: every station is measured from the
// type's eye point and every wide part is fitted to the type's nose. A shell that follows the
// nose's inner skin with the windows cut out (so the posts block the view where the real ones do),
// the glare shield with the MCP on its face, the main panel with the type's screens (LAYOUTS below),
// the pedestal, two control columns with their wheels, two seats, the overhead panel and, on the
// 787 only, the stowed head-up display.
//
//   createBoeingCockpit(spec) → { object, update(state, controls?), setNight(0..1) }
//     spec: from src/widebody-specs.js, plus flapLever: the type's FLAP_LEVER (src/sim/<id>.js), whose
//     length sets the flap lever's detents. Read by the page only through src/type-assets.js.
//
// Light as in cockpit.js: three's sun and hemisphere lights, plus each material's emissive standing
// in for the light bouncing round the flight deck; at night setNight() swaps that for a dim, warm
// flood, and the screens glow faintly as lit LCDs. The working screens are on the HUD, as in the A321.

import * as THREE from '../vendor/three.module.js';
import { Builder, grid, boxAt, cylBetween, toModel } from './aircraft.js';
import { fuselageShape } from './widebody-shape.js';
import { boeingWindowOutlines } from './cockpit-windows-boeing.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);

const C = {
  shell: '#5d6c7b', panel: '#3b4652', glare: '#23282e', mcp: '#1b1f24', screen: '#07090c',
  bezel: '#2a3038', seat: '#343c46', floor: '#2b3138', lever: '#c7ccd2', grip: '#1d2024',
  console: '#46525e', overhead: '#4d5a68', door: '#3b4652', knob: '#6a727b', readout: '#2a1c08',
  wheel: '#23272c', combiner: '#39505c',
};

// What differs between the types' flight decks. All else follows from the eye and the nose.
//   screen      one display's width and height. displays(seatY, z, h): where they go, on the panel
//   pedestalScreen  a display on the pedestal's slope as well
//   lowestY     how far below the row's centre the lowest display on the panel ends, in terms of (h)
//   panelBelow  how far the panel runs below that; aisleDrop: how far the aisle stand is under the eye
//   standby     the standby instrument's place: y, and z above the row's centre
//   gearY       the gear lever's y, in a gap between the displays
//   lipFall     how much lower the glare shield's lip is outboard of the seat, for a sill that falls away
//   wheel       'open' or 'horn': the shape of the control wheel; hud: has head-up displays
const LAYOUTS = {
  // Five big upright screens: two columns of two across the panel and the fifth on the pedestal. 15.1 in,
  // 4:3, upright [public figures].
  'b787-9': {
    screen: { w: 0.235, h: 0.305 }, pedestalScreen: true, lowest: (h) => h / 2, panelBelow: 0.13, aisleDrop: 0.9,
    displays: (seatY, z) => [seatY + 0.13, seatY - 0.13, -seatY + 0.13, -seatY - 0.13].map((y) => ({ y, z })),
    standby: { y: 0, dz: 0.07 }, gearY: -0.17, lipFall: 0, wheel: 'open', hud: true,
  },
  // Six square displays: PFD and ND before each pilot, EICAS in the middle of the row, and the lower
  // centre display under it. 8 in square [public figures]. The lower one needs the panel to run lower
  // and the aisle stand to sit lower beneath it; the standby goes in the gap left of EICAS and the gear
  // lever in the gap right of it, as on the real panel. No. 1's sill is level, so off to the side it's
  // further down from the eye than straight ahead (24° at 20° of azimuth): hence the lip's fall.
  'b777-300er': {
    screen: { w: 0.2, h: 0.2 }, pedestalScreen: false, lowest: (h) => h * 1.5 + 0.02, panelBelow: 0.05, aisleDrop: 0.98,
    displays: (seatY, z, h) => [
      { y: seatY + 0.12, z }, { y: seatY - 0.12, z }, { y: 0, z }, { y: -seatY + 0.12, z }, { y: -seatY - 0.12, z },
      { y: 0, z: z - h - 0.02 },
    ],
    standby: { y: 0.205, dz: 0 }, gearY: -0.205, lipFall: 0.07, wheel: 'horn', hud: false,
  },
};

const PANEL_TILT = 12 * DEG;
const SHELL_OFF = 0.03;     // the shell sits this far inside the outer skin

// Night flood (cockpit.js's): the emissive becomes the surface colour × a warm flood × uNightK.
const FLOOD = new THREE.Color(1.0, 0.74, 0.48);
function withFlood(mat, nightU, strength) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNightK = nightU;
    sh.uniforms.uFlood = { value: FLOOD.clone().multiplyScalar(strength) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBodyZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyZ = (modelMatrix * vec4(position, 1.0)).y - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBodyZ;\nuniform float uNightK;\nuniform vec3 uFlood;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float floodH = 1.0 - 0.55 * smoothstep(0.3, 1.4, vBodyZ);   // brightest at panel height
        totalEmissiveRadiance = mix(totalEmissiveRadiance, diffuseColor.rgb * uFlood * floodH, uNightK);`);
  };
  return mat;
}

// One texture for the shell's colour and its cut-outs: white wall, a grey frame round each window
// (alphaMap reads green, and the frame's stays over the alpha test), black in the window. Left linear,
// so that the frame's grey means the same to both maps.
function shellTexture(outlines, x0, x1) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 2048;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  const path = (w, mirror) => {
    ctx.beginPath();
    w.forEach(([x, th], i) => {
      const px = ((x - x0) / (x1 - x0)) * c.width, py = (1 - (mirror ? 180 - th : th) / 180) * c.height;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  for (const pass of ['frame', 'glass']) for (const mirror of [false, true]) for (const w of outlines) {
    path(w, mirror);
    if (pass === 'frame') { ctx.strokeStyle = '#a8a8a8'; ctx.lineWidth = 60; ctx.stroke(); }
    else { ctx.fillStyle = '#000'; ctx.fill(); }
  }
  // The frames are close enough to the eye for a texel to span 5 pixels. Softening the edge over a
  // few texels keeps the alpha test's line straight instead of showing the canvas's stairs.
  ctx.filter = 'blur(1.6px)';
  ctx.drawImage(c, 0, 0);
  ctx.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

export function createBoeingCockpit(spec) {
  const L = LAYOUTS[spec.id];
  if (!L) throw new Error(`no cockpit layout for type ${spec.id}`);
  const object = new THREE.Group();
  object.name = 'cockpit';
  const nightU = { value: 0 };
  const shape = fuselageShape(spec);
  const E = spec.geo.EYES.captain, ex = E.x, ez = E.z;
  const seatY = Math.abs(E.y);

  // Half-width of the room at height z at station x, `m` metres inside the outer skin.
  const roomY = (x, z, m = SHELL_OFF + 0.02) => {
    const s = shape.fuseSection(x), hh = (z >= s.zc ? s.up : s.down) - m;
    const t = (z - s.zc) / hh;
    return Math.abs(t) >= 1 ? 0 : (s.hw - m) * Math.sqrt(1 - t * t);
  };
  // Height of the ceiling at (x, y), `m` metres inside the outer skin.
  const roofZ = (x, y, m) => {
    const s = shape.fuseSection(x), t = y / (s.hw - m);
    return s.zc + (s.up - m) * Math.sqrt(Math.max(0, 1 - t * t));
  };

  // The layout, all from the eye. Looking down from it, what sets every height here is the sight
  // line over the nose: the glare shield's lip stays under it.
  const FLOOR_Z = ez - 1.29;
  const BULKHEAD_X = ex - (spec.splitBehindEye ?? 1.85) + 0.07;      // ahead of where the nose model is cut
  const SHELL_X0 = BULKHEAD_X - 0.15;
  const LIP_X = ex + 0.62;
  const PANEL_TOP = ez - 0.445, SCREEN_H = L.screen.h, SCREEN_W = L.screen.w;
  const SCREEN_Z = PANEL_TOP - 0.01 - SCREEN_H / 2 - 0.02;
  const panelX = (z) => ex + 0.76 - (z - SCREEN_Z) * Math.tan(PANEL_TILT);
  const LOW_Z = SCREEN_Z - L.lowest(SCREEN_H);     // the foot of the lowest display on the panel
  const PANEL_BOT = LOW_Z - L.panelBelow;
  const KNEE_RUN = 0.28;      // how far forward the well below the panel goes
  // The lip in front of each seat, 22° under the eye at most (a degree under the document's 21° of
  // view) and lower towards the centre and the sides, where it's further from the eye but would
  // still cross the sill. Capped so it doesn't hide too much of the far window from the other seat.
  const lipZ = (y) => {
    const a = Math.abs(y);
    const cap = ez - 0.62 * Math.tan(22 * DEG) - 0.04;
    return cap - 0.055 * (1 - smooth(0, 0.3, a)) - 0.05 * smooth(0.85, 1.15, a) - L.lipFall * smooth(0.55, 0.95, a);
  };

  // A surface from rows of [x, y, z], whichever way round, facing `n` (a function of the centroid).
  const surface = (rows, n) => grid(rows.map((r) => r.map(([x, y, z]) => ({ x, y, z }))), { expect: n });
  const tiltAbout = (x, z, a) => new THREE.Matrix4().makeTranslation(x, 0, z)
    .multiply(new THREE.Matrix4().makeRotationY(a))
    .multiply(new THREE.Matrix4().makeTranslation(-x, 0, -z));
  const onPanel = (g, z) => g.applyMatrix4(tiltAbout(panelX(z), z, -PANEL_TILT));

  // Shell: the nose's inner skin, with the windows cut out.
  {
    const rows = [], uvs = [];
    const NA = 72, X1 = shape.noseX;
    // A vertex's place in the cut-outs is where the line from the near seat's eye through it meets
    // the outer skin, not simply its own (x, θ). The shell is nearer the eye than the glass is, and
    // the windows' tops are only 0.4 m from it, so even 3 cm would otherwise show as 3° there. This
    // way each pilot sees his own frames exactly where the outlines put them.
    const outside = (p) => {
      const s = shape.fuseSection(p[0]);
      return Math.hypot(p[1] / s.hw, (p[2] - s.zc) / (p[2] >= s.zc ? s.up : s.down)) >= 1;
    };
    const cutUV = (v) => {
      // Blended to the middle over the crown, so the centre post comes out the same from both sides.
      const ey = Math.sign(v.y) * seatY * smooth(0, 0.1, Math.abs(v.y));
      const d = [v.x - ex, v.y - ey, v.z - ez];
      const at = (t) => [ex + d[0] * t, ey + d[1] * t, ez + d[2] * t];
      let t0 = 1, t1 = 1.02;
      for (let k = 0; k < 40 && !outside(at(t1)); k++) { t0 = t1; t1 += 0.02; }
      for (let k = 0; k < 24; k++) { const m = (t0 + t1) / 2; if (outside(at(m))) t1 = m; else t0 = m; }
      const q = at((t0 + t1) / 2), s = shape.fuseSection(q[0]);
      const th = Math.atan2((q[2] - s.zc) / (q[2] >= s.zc ? s.up : s.down), q[1] / s.hw) / DEG;
      return [(q[0] - SHELL_X0) / (X1 - SHELL_X0), (th < -90 ? th + 360 : th) / 180];
    };
    for (let i = 0; i <= 40; i++) {
      const x = SHELL_X0 + (X1 - 0.05 - SHELL_X0) * Math.sin((i / 40) * Math.PI / 2);
      const row = [], urow = [];
      for (let j = 0; j <= NA; j++) {
        const th = -90 + (360 * j) / NA;
        const p = shape.fusePoint(x, th, -SHELL_OFF);
        row.push(p);
        urow.push(cutUV(p));
      }
      rows.push(row); uvs.push(urow);
    }
    const g = grid(rows, { uvs, expect: (c) => V(0, c.y, c.z - shape.fuseMid(c.x)) });
    const b = new Builder();
    b.add(g, 0, '#ffffff', 'keep');
    const mat = new THREE.MeshStandardMaterial({
      color: C.shell, roughness: 0.85, metalness: 0, side: THREE.BackSide,
      emissive: '#27313b', // stands in for the light bouncing round the flight deck
      alphaTest: 0.33, alphaToCoverage: true,   // halfway from the frame's grey to the glass's black
    });
    if (typeof document !== 'undefined') {          // node tests build the geometry alone
      mat.map = mat.alphaMap = shellTexture(boeingWindowOutlines(spec, shape), SHELL_X0, X1);
    }
    withFlood(mat, nightU, 0.3);
    const m = new THREE.Mesh(b.build(), mat);
    m.name = 'cockpit-shell';
    m.userData.cutX = [SHELL_X0, X1];     // what its u means, for tests/cockpit-boeing.test.mjs
    object.add(m);
  }

  // Static interior, one merged mesh with vertex colours; the screens and readouts another.
  const b = new Builder(), sb = new Builder();
  const add = (g, color) => b.add(g, 0, color);
  const up = () => V(0, 0, 1), aft = () => V(-1, 0, 0), fwd = () => V(1, 0, 0);

  // Floor, and the bulkhead behind the seats with its door.
  {
    const FX = panelX(PANEL_BOT) + KNEE_RUN + 0.03;     // under the knee well's foot
    add(surface(range(BULKHEAD_X, FX, 6).map((x) => {
      const Y = roomY(x, FLOOR_Z);
      return [[x, -Y, FLOOR_Z], [x, 0, FLOOR_Z], [x, Y, FLOOR_Z]];
    }), up), C.floor);
    add(surface(range(FLOOR_Z, roofZ(BULKHEAD_X, 0, SHELL_OFF + 0.02), 10).map((z) => {
      const Y = roomY(BULKHEAD_X, z);
      return [[BULKHEAD_X, -Y, z], [BULKHEAD_X, 0, z], [BULKHEAD_X, Y, z]];
    }), fwd), C.shell);
    add(boxAt(BULKHEAD_X + 0.015, 0, FLOOR_Z + 0.97, 0.02, 0.84, 1.94), C.door);
    add(boxAt(BULKHEAD_X + 0.03, -0.32, FLOOR_Z + 1.0, 0.03, 0.04, 0.12), C.lever);
  }

  // The glare shield: a lip, the slope running forward under the windows, and the face below the
  // lip that carries the MCP. A ridge line per column, so the lip can follow lipZ().
  {
    const NY = 16, rowsTop = [];
    const SLOPE = 0.5;
    // How far out a row reaches: to the wall, at the height the row has out there.
    const reach = (x, drop) => { let Y = 1; for (let k = 0; k < 4; k++) Y = roomY(x, lipZ(Y) - drop); return Y; };
    for (const dx of [0, 0.03, 0.12, 0.3, 0.46, 0.6]) {
      const x = LIP_X + dx, Y = reach(x, dx * SLOPE);
      rowsTop.push(range(-Y, Y, NY).map((y) => [x, y, lipZ(y) - dx * SLOPE]));
    }
    add(surface(rowsTop, up), C.glare);
    const Yf = Math.min(reach(LIP_X, 0), roomY(panelX(PANEL_TOP), PANEL_TOP));
    add(surface([0, 1].map((t) => range(-Yf, Yf, NY).map((y) => {
      const z = lipZ(y) + (PANEL_TOP - lipZ(y)) * t;
      return [LIP_X + (panelX(PANEL_TOP) - LIP_X) * t, y, z];
    })), aft), C.glare);
  }

  // The MCP along the middle of the face and the two EFIS panels beside it, with their readouts
  // (in the screens' mesh, so they glow at night) and a row of knobs.
  const MCP_Z = PANEL_TOP + 0.045, MCP_X = LIP_X + 0.055;
  add(boxAt(MCP_X, 0, MCP_Z, 0.08, 0.66, 0.085), C.mcp);
  for (const s of [1, -1]) {
    add(boxAt(MCP_X, s * 0.46, MCP_Z, 0.07, 0.22, 0.085), C.mcp);
    add(boxAt(MCP_X - 0.042, s * 0.46, MCP_Z - 0.012, 0.012, 0.02, 0.02), C.knob);
    add(boxAt(MCP_X - 0.042, s * 0.40, MCP_Z - 0.012, 0.012, 0.02, 0.02), C.knob);
    add(boxAt(MCP_X - 0.042, s * 0.52, MCP_Z - 0.012, 0.012, 0.02, 0.02), C.knob);
    sb.add(boxAt(MCP_X - 0.038, s * 0.46, MCP_Z + 0.02, 0.006, 0.1, 0.018), 0, C.readout);
  }
  for (const y of [0.26, 0.11, -0.05, -0.2]) {
    add(boxAt(MCP_X - 0.045, y, MCP_Z - 0.014, 0.014, 0.024, 0.024), C.knob);
    sb.add(boxAt(MCP_X - 0.042, y, MCP_Z + 0.022, 0.006, 0.075, 0.018), 0, C.readout);
  }

  // The main panel, tilted back and fitted to the sidewalls, and the dark well for the knees below it.
  add(surface(range(PANEL_TOP, PANEL_BOT, 4).map((z) => {
    const x = panelX(z), Y = roomY(x, z);
    return [[x, -Y, z], [x, 0, z], [x, Y, z]];
  }), aft), C.panel);
  add(surface(range(PANEL_BOT, FLOOR_Z, 4).map((z) => {
    const x = panelX(PANEL_BOT) + KNEE_RUN * (PANEL_BOT - z) / (PANEL_BOT - FLOOR_Z), Y = roomY(x, z);
    return [[x, -Y, z], [x, 0, z], [x, Y, z]];
  }), aft), C.floor);

  // Screens, as the type lays them out; each pilot's pair meets at the seat's centre, in front of his
  // control column.
  const displays = L.displays(seatY, SCREEN_Z, SCREEN_H);
  for (const { y, z } of displays) {
    const x = panelX(z);
    add(onPanel(boxAt(x - 0.008, y, z, 0.016, SCREEN_W + 0.025, SCREEN_H + 0.025), z), C.bezel);
    sb.add(onPanel(boxAt(x - 0.018, y, z, 0.006, SCREEN_W, SCREEN_H), z), 0, C.screen);
  }
  // Standby instrument.
  {
    const z = SCREEN_Z + L.standby.dz, x = panelX(z);
    add(onPanel(boxAt(x - 0.008, L.standby.y, z, 0.016, 0.15, 0.13), z), C.bezel);
    sb.add(onPanel(boxAt(x - 0.018, L.standby.y, z, 0.006, 0.125, 0.105), z), 0, C.screen);
  }

  // Pedestal: its slope down from the panel, on the 787 carrying the fifth screen, then the flat aisle stand.
  const AISLE_Z = ez - L.aisleDrop, AISLE_X0 = ex - 0.34, AISLE_X1 = ex + 0.4;
  {
    const topZ = LOW_Z - 0.015, topX = panelX(topZ);
    add(boxAt((AISLE_X0 + topX) / 2, 0, (AISLE_Z + FLOOR_Z) / 2, topX - AISLE_X0, 0.5, AISLE_Z - FLOOR_Z), C.console);
    const { pedestalScreen } = L;
    const dx = topX - AISLE_X1, dz = topZ - AISLE_Z, R = Math.hypot(dx, dz), a = Math.atan2(dx, dz);
    const cx = (topX + AISLE_X1) / 2, cz = (topZ + AISLE_Z) / 2;
    // Built upright about the slope's middle, then laid back onto it (−x becomes its normal).
    const atSlope = (g) => g.applyMatrix4(tiltAbout(cx, cz, a));
    add(atSlope(boxAt(cx + 0.05, 0, cz, 0.1, 0.5, R + 0.02)), C.console);
    if (pedestalScreen) {
      add(atSlope(boxAt(cx - 0.008, 0, cz, 0.016, SCREEN_W + 0.025, Math.min(R - 0.01, SCREEN_H + 0.025))), C.bezel);
      sb.add(atSlope(boxAt(cx - 0.018, 0, cz, 0.006, SCREEN_W, Math.min(R - 0.03, SCREEN_H))), 0, C.screen);
    }
  }
  // On the aisle stand: the lever quadrant's block, and the radios and such behind it.
  add(boxAt(ex + 0.18, 0, AISLE_Z + 0.03, 0.34, 0.36, 0.06), C.bezel);
  for (const [x, y] of [[ex - 0.09, 0.11], [ex - 0.09, -0.11], [ex - 0.24, 0.11], [ex - 0.24, -0.11]]) {
    add(boxAt(x, y, AISLE_Z + 0.008, 0.12, 0.2, 0.016), C.bezel);
    sb.add(boxAt(x, y, AISLE_Z + 0.018, 0.08, 0.16, 0.004), 0, C.screen);
  }

  // Side consoles, fitted to the wall, below the side windows' sills. A top and an inner face.
  for (const s of [1, -1]) {
    const CZ = ez - 0.74, IN = seatY + 0.42, xs = range(ex - 0.8, ex + 0.55, 5);
    add(surface(xs.map((x) => [[x, s * IN, CZ], [x, s * Math.max(IN + 0.02, roomY(x, CZ)), CZ]]), up), C.console);
    add(surface(xs.map((x) => [[x, s * IN, CZ], [x, s * IN, FLOOR_Z]]), () => V(0, -s, 0)), C.console);
    add(boxAt(ex + 0.2, s * (IN + 0.1), CZ + 0.03, 0.09, 0.05, 0.06), C.grip);       // the tiller
  }

  // Seats, as cockpit.js's, around the same point below and behind the eye.
  for (const s of [1, -1]) {
    const y = s * seatY, SX = ex + 0.03;
    add(boxAt(SX, y, (FLOOR_Z + ez - 0.9) / 2, 0.4, 0.4, ez - 0.9 - FLOOR_Z), C.floor);
    add(boxAt(SX, y, ez - 0.85, 0.55, 0.55, 0.14), C.seat);
    add(boxAt(ex - 0.3, y, ez - 0.35, 0.13, 0.55, 0.9).applyMatrix4(tiltAbout(ex - 0.3, ez - 0.35, -10 * DEG)), C.seat);
    add(boxAt(ex - 0.38, y, ez + 0.22, 0.12, 0.32, 0.24), C.seat);
    for (const k of [1, -1]) add(boxAt(SX, y + k * 0.3, ez - 0.63, 0.4, 0.06, 0.06), C.seat);
  }

  // Rudder pedals, on the knee well's slope.
  for (const y0 of [seatY, -seatY]) for (const k of [1, -1]) {
    add(boxAt(ex + 0.82, y0 + k * 0.1, FLOOR_Z + 0.16, 0.03, 0.09, 0.26).applyMatrix4(tiltAbout(ex + 0.82, FLOOR_Z + 0.16, -22 * DEG)), C.grip);
  }

  // Overhead panel, following the crown from just aft of the windows' tops, with two rows of switch
  // blocks. Only its front is ever in front of the pilots.
  {
    const HW = 0.42, xs = range(ex - 1.25, ex + 0.04, 4);
    add(surface(xs.map((x) => range(-HW, HW, 4).map((y) => [x, y, roofZ(x, y, 0.15)])), () => V(0, 0, -1)), C.overhead);
    const xf = xs[xs.length - 1];
    add(surface([0, 1].map((t) => range(-HW, HW, 4).map((y) => [xf, y, roofZ(xf, y, 0.15 - t * 0.1)])), aft), C.overhead);
    for (const x of [ex - 0.12, ex - 0.45, ex - 0.8]) for (const y of [-0.24, 0, 0.24]) {
      add(boxAt(x, y, roofZ(x, y, 0.155), 0.2, 0.2, 0.012), C.bezel);
    }
  }

  // The head-up display, stowed: its projector above and behind each pilot's head, and the combiner
  // folded up flat under the ceiling in front of it.
  if (L.hud) for (const s of [1, -1]) {
    const y = s * seatY, px = ex - 0.1, cx = ex + 0.1;
    const pz = roofZ(px, seatY + 0.09, 0.2), cz = roofZ(cx + 0.11, seatY + 0.09, 0.08);
    add(boxAt(px, y, pz, 0.26, 0.17, 0.1), C.grip);
    add(boxAt(cx, y, cz, 0.24, 0.18, 0.012).applyMatrix4(tiltAbout(cx, cz, -22 * DEG)), C.combiner);
  }

  const stat = new THREE.Mesh(b.build(), withFlood(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, emissive: '#161b21' }), nightU, 1.2));
  stat.name = 'cockpit-interior';
  object.add(stat);
  // The screens: their own unlit material, a lit LCD's dark glow at night.
  const screenMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  screenMat.color.setRGB(4, 4, 4);
  const screenMesh = new THREE.Mesh(sb.build(), screenMat);
  screenMesh.name = 'cockpit-screens';
  screenMesh.userData.displays = displays.length + (L.pedestalScreen ? 1 : 0);   // for the tests
  object.add(screenMesh);

  // Moving parts: each a mesh whose origin is its pivot.
  const levMat = withFlood(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, emissive: '#161b21' }), nightU, 1.2);
  function part(pivot, build, parent = object, parentPivot = V(0, 0, 0)) {
    const pb = new Builder();
    build((g, color) => pb.add(g.translate(-pivot.x, -pivot.y, -pivot.z), 0, color));
    const m = new THREE.Mesh(pb.build(), levMat);
    m.position.copy(toModel(pivot.x - parentPivot.x, pivot.y - parentPivot.y, pivot.z - parentPivot.z));
    parent.add(m);
    return m;
  }
  const QZ = AISLE_Z + 0.06, LX = ex + 0.26;       // the quadrant's top, the thrust levers' pivot
  const thrust = part(V(LX, 0, QZ), (a) => {
    for (const y of [0.055, -0.055]) {
      a(boxAt(LX, y, QZ + 0.1, 0.022, 0.022, 0.2), C.lever);
      a(boxAt(LX, y, QZ + 0.21, 0.05, 0.085, 0.04), C.grip);
    }
  });
  // The reverse levers ride on the thrust levers; they lift only below idle.
  const reverse = part(V(LX + 0.012, 0, QZ + 0.13), (a) => {
    for (const y of [0.055, -0.055]) a(boxAt(LX + 0.05, y, QZ + 0.14, 0.09, 0.016, 0.016), C.grip);
  }, thrust, V(LX, 0, QZ));
  const flap = part(V(ex + 0.1, -0.15, QZ), (a) => {
    a(boxAt(ex + 0.1, -0.15, QZ + 0.08, 0.02, 0.02, 0.16), C.lever);
    a(boxAt(ex + 0.1, -0.15, QZ + 0.17, 0.07, 0.05, 0.04), C.lever);
  });
  const sbrake = part(V(ex + 0.1, 0.15, QZ), (a) => {
    a(boxAt(ex + 0.1, 0.15, QZ + 0.08, 0.02, 0.02, 0.16), C.lever);
    a(boxAt(ex + 0.1, 0.15, QZ + 0.17, 0.05, 0.06, 0.03), C.grip);
  });
  const gearZ = SCREEN_Z - 0.06, gearPivot = V(panelX(gearZ) - 0.01, L.gearY, gearZ);
  const gear = part(gearPivot, (a) => {
    a(cylBetween(gearPivot, gearPivot.clone().add(V(-0.12, 0, 0)), 0.01, 0.01, 6), C.lever);
    a(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12).translate(gearPivot.x - 0.13, gearPivot.y, gearPivot.z), C.lever);
  });
  // Control columns, pivoting at the floor, with their wheels on top. The 787's wheel is open at the
  // top, with two horns on straight arms; the 777's joins its horns with an arc under the hub.
  const COL_X = ex + 0.5, HUB_Z = ez - 0.56, HUB_X = ex + 0.44;
  const yokes = [seatY, -seatY].map((y) => {
    const pivot = V(COL_X + 0.07, y, FLOOR_Z + 0.06), hub = V(HUB_X, y, HUB_Z);
    const column = part(pivot, (a) => {
      a(cylBetween(pivot, V(HUB_X + 0.03, y, HUB_Z - 0.03), 0.032, 0.026, 8), C.wheel);
      a(boxAt(pivot.x, y, FLOOR_Z + 0.03, 0.14, 0.12, 0.06), C.wheel);
    });
    const wheel = part(hub, (a) => {
      a(boxAt(HUB_X, y, HUB_Z, 0.05, 0.11, 0.075), C.wheel);
      a(cylBetween(V(HUB_X, y + 0.05, HUB_Z), V(HUB_X, y + 0.155, HUB_Z + 0.01), 0.014, 0.014, 6), C.wheel);
      a(cylBetween(V(HUB_X, y - 0.05, HUB_Z), V(HUB_X, y - 0.155, HUB_Z + 0.01), 0.014, 0.014, 6), C.wheel);
      if (L.wheel === 'horn') {
        const arc = [-180, -150, -120, -90, -60, -30, 0].map((d) => V(HUB_X, y + 0.155 * Math.cos(d * DEG), HUB_Z + 0.01 + 0.12 * Math.sin(d * DEG)));
        for (let i = 0; i < arc.length - 1; i++) a(cylBetween(arc[i], arc[i + 1], 0.013, 0.013, 6), C.wheel);
      }
      for (const k of [1, -1]) {
        a(cylBetween(V(HUB_X, y + k * 0.155, HUB_Z - 0.035), V(HUB_X, y + k * 0.175, HUB_Z + 0.075), 0.019, 0.019, 6), C.grip);
        a(cylBetween(V(HUB_X, y + k * 0.175, HUB_Z + 0.075), V(HUB_X, y + k * 0.145, HUB_Z + 0.125), 0.016, 0.012, 6), C.grip);
      }
    }, column, pivot);
    return { column, wheel };
  });

  // Rotations about body axes, expressed in the model frame.
  const AY = toModel(0, 1, 0), AX = toModel(1, 0, 0);
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const setRot = (m, aboutY, aboutX = 0) => {
    q1.setFromAxisAngle(AY, aboutY); q2.setFromAxisAngle(AX, aboutX);
    m.quaternion.copy(q1).multiply(q2);
  };
  const detents = Math.max(1, (spec.flapLever?.length ?? 10) - 1);

  function update(state = {}, controls = null) {
    const tl = state.thrustLever ?? controls?.thrust ?? 0;
    // Idle leans 22° aft, full thrust 22° forward; below idle the thrust levers stay put and the
    // reverse levers lift, as Boeing's do.
    setRot(thrust, (-22 + 44 * clamp(tl, 0, 1)) * DEG);
    setRot(reverse, -clamp(-tl, 0, 1) * 55 * DEG);
    // Boeing's flap lever runs from UP, forward, to the last detent, aft.
    const fl = controls?.flapLever ?? state.flapLever ?? 0;
    setRot(flap, (22 - clamp(fl / detents, 0, 1) * 44) * DEG);
    const sb = controls?.speedbrake ?? state.speedbrake ?? 0;
    setRot(sbrake, (20 - clamp(sb, 0, 1) * 40) * DEG);
    const down = controls ? controls.gearDown : (state.gearPos ?? 1) > 0.5;
    setRot(gear, (down ? -30 : 30) * DEG);
    // Pull (+pitch) brings the column aft; +roll turns the wheel clockwise, to the right.
    const p = controls?.pitch ?? 0, r = controls?.roll ?? 0;
    for (const y of yokes) { setRot(y.column, -p * 9 * DEG); setRot(y.wheel, 0, r * 75 * DEG); }
  }
  // n: 0 by day … 1 at night.
  const SCREEN_DAY = new THREE.Color(4, 4, 4), SCREEN_NIGHT = new THREE.Color(6, 8, 11);
  function setNight(n) {
    nightU.value = clamp(n || 0, 0, 1);
    screenMat.color.copy(SCREEN_DAY).lerp(SCREEN_NIGHT, nightU.value);
  }
  update();
  return { object, update, setNight };
}
