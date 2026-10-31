// The Nuclear Airlines livery, drawn on canvases at load time (no image files).
// One 2048² atlas holds every textured part, so the whole airframe is one material:
//   fuselage  canvas x 0…2048, y 0…1024     u = (x_body − TAIL_X) / LENGTH, v around (below)
//   fin       canvas x 0…1024, y 1024…2048  side-on projection of the fin and rudder
//   nacelle   canvas x 1024…2048, y 1024…1536  u around, v along the intake/fan-cowl profile
//   plain     canvas x 1024…2048, y 1536…2048  white; parts there take their vertex colour
// Fuselage v: θ is the angle round the cross-section (0 = left side, 90° = crown, 180° = right
// side, 270° = belly), v = (θ + 90°) / 360°, so the seam is under the belly.
// The emissive atlas has the same layout: black except the glowing green and blue accents.

import * as THREE from '../vendor/three.module.js';
import { LENGTH, TAIL_X } from './geometry.js';

export const COLORS = {
  white: '#f3f5f7',
  navy: '#122654',
  lime: '#7cff3a',
  blue: '#2ea8ff',
  yellow: '#ffc61a',
  black: '#121316',
  glass: '#141a22',
};

export const ATLAS = 2048;
// UV regions in texture space (v up, as three.js samples with flipY).
export const UV = {
  fuselage: { u0: 0, u1: 1, v0: 0.5, v1: 1 },
  fin: { u0: 0, u1: 0.5, v0: 0, v1: 0.5 },
  nacelle: { u0: 0.5, u1: 1, v0: 0.25, v1: 0.5 },
  plain: { u: 0.75, v: 0.125 },
};

// Fin projection (body x, z) to its region.
export const FIN_BOX = { x0: -22.6, x1: -14.0, z0: 0.9, z1: 8.0 };

// Nacelle profile bands (v along the intake/fan-cowl lathe).
export const NACELLE_V = { intake: [0, 0.3], lip: [0.3, 0.55], cowl: [0.55, 1] };

const DEG = Math.PI / 180;

// The cockpit windows' outlines come from cockpit-windows.js (via aircraft.js), in (x_body, θ°)
// on the left side; the right side mirrors θ → 180° − θ.

// Mid-fuselage cabin doors (x centre). Type C doors, 0.81 × 1.85 m.
export const DOORS = [16.55, 7.9, -3.1, -14.5];

function fuseU(x) { return (x - TAIL_X) / LENGTH; }
// Fuselage (x, θ in degrees) → fuselage-canvas pixel (region at the top of the atlas).
export function fusePx(x, thetaDeg) {
  const vLocal = (thetaDeg + 90) / 360;
  return [fuseU(x) * ATLAS, (1 - vLocal) * 1024];
}

// The belly/cheatline boundary angle (degrees) at body x: level along the cabin, then it
// sweeps up over the tail cone into the navy fin.
export function bellyTheta(x) {
  const base = -24;
  if (x > -8) return base;
  const t = Math.min(1, (-8 - x) / 11.5);
  const s = t * t * (3 - 2 * t);
  return base + s * 120;
}

function stripes(ctx, x, y, w, h, period, color, slant) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = color;
  for (let s = x - h * Math.abs(slant) - period; s < x + w + period; s += period) {
    ctx.beginPath();
    ctx.moveTo(s, y + h);
    ctx.lineTo(s + period / 2, y + h);
    ctx.lineTo(s + period / 2 + h * slant, y);
    ctx.lineTo(s + h * slant, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Stylised atom: three elliptical orbits round a glowing core. (cx, cy) centre, r radius in px.
function atom(ctx, cx, cy, r, sx, glow) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, 1);
  ctx.lineWidth = r * 0.085;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 3 + Math.PI / 2);
    ctx.strokeStyle = glow ? '#1f7fd0' : COLORS.blue;
    if (!glow) { ctx.shadowColor = COLORS.blue; ctx.shadowBlur = r * 0.12; }
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.26);
  g.addColorStop(0, glow ? '#d8ffb8' : '#eaffd8');
  g.addColorStop(0.45, COLORS.lime);
  g.addColorStop(1, glow ? 'rgba(60,160,20,0)' : 'rgba(124,255,58,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = glow ? '#9cff6a' : COLORS.lime;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Sets a transform so drawing in centimetres reads correctly from outside, on one side.
// side +1 = left (θ ≈ 0°), −1 = right (θ ≈ 180°). (x, theta) is the local origin, theta measured on the left side (mirrored for the right).
function sideTransform(ctx, side, x, thetaDeg, hh = 2.07) {
  const [px, py] = fusePx(x, side > 0 ? thetaDeg : 180 - thetaDeg);
  const sx = ATLAS / LENGTH / 100;          // px per cm along the fuselage
  const sy = 1024 / (2 * Math.PI * hh) / 100; // px per cm of arc on the side
  // Left: reading direction is aft (−canvas x), up is −canvas y.
  // Right: reading direction is forward (+canvas x), up is +canvas y.
  if (side > 0) ctx.setTransform(-sx, 0, 0, sy, px, py);
  else ctx.setTransform(sx, 0, 0, -sy, px, py);
}

function polyFuse(ctx, pts, mirror) {
  ctx.beginPath();
  pts.forEach(([x, th], i) => {
    const [px, py] = fusePx(x, mirror ? 180 - th : th);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  });
  ctx.closePath();
}

function paintFuselage(ctx, glow, windows = []) {
  const W = ATLAS, H = 1024;
  ctx.fillStyle = glow ? '#000' : COLORS.white;
  ctx.fillRect(0, 0, W, H);

  // Belly and cheatline, one column at a time (both sides, mirrored about the crown).
  for (let px = 0; px < W; px++) {
    const x = TAIL_X + (px + 0.5) / W * LENGTH;
    const tb = bellyTheta(x);
    // θ range [t0, t1] on the left side and its mirror [180 − t1, 180 − t0] on the right.
    const band = (t0, t1, color) => {
      ctx.fillStyle = color;
      for (const [a, b] of [[t0, t1], [180 - t1, 180 - t0]]) {
        const ya = fusePx(x, b)[1], yb = fusePx(x, a)[1];
        if (yb > ya) ctx.fillRect(px, ya, 1, yb - ya);
      }
    };
    if (!glow) {
      ctx.fillStyle = COLORS.navy; ctx.fillRect(px, 0, 1, H);
      if (tb < 90) {
        const ya = fusePx(x, 180 - tb)[1], yb = fusePx(x, tb)[1];
        ctx.fillStyle = COLORS.white; ctx.fillRect(px, ya, 1, yb - ya);
      }
      band(tb, tb + 4, COLORS.lime);
      band(tb + 5.2, tb + 10.5, COLORS.blue);
    } else {
      band(tb, tb + 4, '#3a9a14');
      band(tb + 5.2, tb + 10.5, '#0f5a98');
    }
  }
  if (glow) return;

  // Cabin windows: 0.23 × 0.33 m, on a 0.533 m pitch, centred at θ ≈ 8.5°.
  const doorClear = (x) => DOORS.every((d) => Math.abs(x - d) > 0.75);
  const wingExit = (x) => true;
  for (const side of [1, -1]) {
    for (let x = 15.6; x > -13.6; x -= 0.533) {
      if (!doorClear(x) || !wingExit(x)) continue;
      sideTransform(ctx, side, x, 8.5);
      ctx.fillStyle = COLORS.glass;
      ctx.beginPath(); ctx.roundRect(-11.5, -16.5, 23, 33, 9); ctx.fill();
      ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    // Doors: outline, sill at z ≈ −0.85, with a small window.
    for (const d of DOORS) {
      sideTransform(ctx, side, d, 0);
      ctx.strokeStyle = '#8a929c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(-40.5, -98, 81, 185, 16); ctx.stroke();
      ctx.fillStyle = COLORS.glass;
      ctx.beginPath(); ctx.roundRect(-10, -14, 20, 28, 8); ctx.fill();
    }
    // Titles: NUCLEAR, between doors 1 and 2, above the windows.
    sideTransform(ctx, side, 12.0, 45);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 118px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = COLORS.navy;
    ctx.fillText('NUCLEAR', 0, 0);
    const tw = ctx.measureText('NUCLEAR').width;
    ctx.fillStyle = COLORS.lime;
    ctx.fillRect(-tw / 2, 58, tw * 0.62, 8);
    ctx.fillStyle = COLORS.blue;
    ctx.fillRect(-tw / 2 + tw * 0.65, 58, tw * 0.35, 8);
    ctx.font = '700 28px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = COLORS.blue;
    ctx.fillText('A I R L I N E S', tw * 0.32, 84);
    // Small atom ahead of the title.
    atom(ctx, -tw / 2 - 75, 0, 52, 1, false);
    // Registration on the rear fuselage.
    sideTransform(ctx, side, -10.6, 30);
    ctx.font = '700 40px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = COLORS.navy;
    ctx.fillText('HL8787', 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Cockpit windows: the glass itself is geometry (aircraft.js); this is the dark frame round it.
  for (const mirror of [false, true]) {
    for (const w of windows) {
      polyFuse(ctx, w, mirror);
      ctx.fillStyle = COLORS.glass; ctx.fill();
      ctx.strokeStyle = '#2a3038'; ctx.lineWidth = 3; ctx.stroke();
    }
  }
}

function paintFin(ctx, glow, fuseTop) {
  const X0 = 0, Y0 = 1024, S = 1024;
  const fx = (x) => X0 + (x - FIN_BOX.x0) / (FIN_BOX.x1 - FIN_BOX.x0) * S;
  const fy = (z) => Y0 + (1 - (z - FIN_BOX.z0) / (FIN_BOX.z1 - FIN_BOX.z0)) * S;
  ctx.fillStyle = glow ? '#000' : COLORS.navy;
  ctx.fillRect(X0, Y0, S, S);
  // Hazard band at the base, following the fuselage's top line.
  if (!glow) {
    for (let px = 0; px < S; px++) {
      const x = FIN_BOX.x0 + (px + 0.5) / S * (FIN_BOX.x1 - FIN_BOX.x0);
      const z0 = fuseTop(x) - 0.05, z1 = z0 + 0.5;
      const ya = fy(z1), yb = fy(z0);
      ctx.fillStyle = COLORS.yellow;
      ctx.fillRect(X0 + px, ya, 1, yb - ya);
      // diagonal black stripes, 0.45 m period
      ctx.fillStyle = COLORS.black;
      for (let y = Math.floor(ya); y < yb; y++) {
        const z = FIN_BOX.z0 + (1 - (y + 0.5 - Y0) / S) * (FIN_BOX.z1 - FIN_BOX.z0);
        const ph = ((x + (z - z0) * 0.9) / 0.45) % 1;
        if ((ph + 1) % 1 < 0.5) ctx.fillRect(X0 + px, y, 1, 1);
      }
      // thin lime line above the band
      ctx.fillStyle = COLORS.lime;
      ctx.fillRect(X0 + px, fy(z1 + 0.08), 1, fy(z1) - fy(z1 + 0.08));
    }
  } else {
    for (let px = 0; px < S; px++) {
      const x = FIN_BOX.x0 + (px + 0.5) / S * (FIN_BOX.x1 - FIN_BOX.x0);
      const z1 = fuseTop(x) + 0.45;
      ctx.fillStyle = '#2d7a10';
      ctx.fillRect(X0 + px, fy(z1 + 0.08), 1, fy(z1) - fy(z1 + 0.08));
    }
  }
  // Cherenkov-blue sweep up the leading edge.
  ctx.save();
  ctx.beginPath(); ctx.rect(X0, Y0, S, S); ctx.clip();
  ctx.strokeStyle = glow ? '#0d4f88' : COLORS.blue;
  ctx.lineWidth = 0.16 / (FIN_BOX.x1 - FIN_BOX.x0) * S;
  ctx.beginPath();
  ctx.moveTo(fx(-14.2), fy(2.6)); ctx.lineTo(fx(-19.0), fy(7.95));
  ctx.stroke();
  ctx.restore();
  // The atom, centred on the fin.
  const cx = fx(-19.3), cy = fy(4.9);
  const r = 2.0 / (FIN_BOX.z1 - FIN_BOX.z0) * S;
  const sx = ((FIN_BOX.z1 - FIN_BOX.z0)) / (FIN_BOX.x1 - FIN_BOX.x0); // undo the projection stretch
  atom(ctx, cx, cy, r, sx, glow);
}

function paintNacelle(ctx, glow) {
  const X0 = 1024, Y0 = 1024, W = 1024, H = 512;
  const vy = (v) => Y0 + (1 - v) * H;
  ctx.fillStyle = glow ? '#000' : COLORS.navy;
  ctx.fillRect(X0, Y0, W, H);
  if (glow) {
    ctx.fillStyle = '#3a9a14'; ctx.fillRect(X0, vy(0.62), W, vy(0.6) - vy(0.62));
    ctx.fillStyle = '#0f5a98'; ctx.fillRect(X0, vy(0.655), W, vy(0.635) - vy(0.655));
    return;
  }
  // Intake: grey metal.
  ctx.fillStyle = '#8b9199';
  ctx.fillRect(X0, vy(NACELLE_V.intake[1]), W, vy(0) - vy(NACELLE_V.intake[1]));
  // Lip: hazard stripes, 28 round the circumference.
  const [l0, l1] = NACELLE_V.lip;
  const y0 = vy(l1), y1 = vy(l0);
  ctx.fillStyle = COLORS.yellow; ctx.fillRect(X0, y0, W, y1 - y0);
  stripes(ctx, X0, y0, W, y1 - y0, W / 28, COLORS.black, 0.6);
  // Green and blue rings behind the lip.
  ctx.fillStyle = COLORS.lime; ctx.fillRect(X0, vy(0.62), W, vy(0.6) - vy(0.62));
  ctx.fillStyle = COLORS.blue; ctx.fillRect(X0, vy(0.655), W, vy(0.635) - vy(0.655));
}

// Builds the colour and emissive atlases. fuseTop(x) is the fuselage's top line (body z);
// windows, the cockpit windows' outlines (cockpit-windows.js).
export function createLiveryTextures(fuseTop, windows = []) {
  const make = (glow) => {
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS;
    const ctx = c.getContext('2d');
    paintFuselage(ctx, glow, windows);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintFin(ctx, glow, fuseTop);
    paintNacelle(ctx, glow);
    ctx.fillStyle = glow ? '#000' : '#ffffff';
    ctx.fillRect(1024, 1536, 1024, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: make(false), emissiveMap: make(true) };
}

// Alpha map for the cockpit shell: white (solid) with the six windows cut out (black).
// Its own mapping, for resolution: u = (x − x0) / (x1 − x0) over the nose, v = θ / 180° over
// the upper half, where the windows are (the texture clamps, so the lower half is solid).
// windows: the left-side outlines from cockpit-windows.js.
export const COCKPIT_ALPHA_X = [16.6, 21.0];
export const cockpitAlphaV = (thetaDeg) => thetaDeg / 180;
export function createCockpitAlpha(windows) {
  const [x0, x1] = COCKPIT_ALPHA_X;
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 2048;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  for (const mirror of [false, true]) for (const w of windows) {
    ctx.beginPath();
    w.forEach(([x, th], i) => {
      const t = mirror ? 180 - th : th;
      const px = ((x - x0) / (x1 - x0)) * c.width, py = (1 - cockpitAlphaV(t)) * c.height;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.closePath(); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

export { DEG };
