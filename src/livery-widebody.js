// The Nuclear Airlines livery on a widebody: the A321's design (src/livery.js) fitted to a spec's
// shape: a white fuselage, the navy belly and tail, the lime and blue cheatline that sweeps up into
// the tail, hazard stripes on the fin's base and the intake lips, the atom on the fin, the titles.
// The atlas has livery.js's layout and its UV regions, so Builder's plain texel stays valid. Its own
// file so that the A321's textures can't change.
//
//   finBoxFor(spec)  → { x0, x1, z0, z1 }: the fin's projection onto its atlas region
//   fuseUVFor(spec)  → (x, θ°) → [u, v]
//   createWidebodyLivery(spec, shape, windows, registration?) → { map, emissiveMap }

import * as THREE from '../vendor/three.module.js';
import { COLORS, ATLAS, UV, atom, paintNacelle } from './livery.js';

const DEG = Math.PI / 180;

export function finBoxFor(spec) {
  const F = spec.geo.FIN, pad = spec.fin.box.pad;
  const xs = spec.fin.filletLe.map((p) => p[1]);
  return { x0: F.topTeX - pad, x1: Math.max(...xs) + pad, z0: spec.fin.box.z0 ?? 1.3, z1: F.topZ + pad };
}

export function fuseUVFor(spec) {
  const G = spec.geo;
  return (x, th) => [(x - G.TAIL_X) / G.LENGTH, UV.fuselage.v0 + (UV.fuselage.v1 - UV.fuselage.v0) * ((th + 90) / 360)];
}

export function createWidebodyLivery(spec, shape, windows = [], registration = spec.registration) {
  const G = spec.geo, L = spec.livery, CAB = spec.cabin, N = G.NOSE_X;
  const fin = finBoxFor(spec);
  const fusePx = (x, th) => [((x - G.TAIL_X) / G.LENGTH) * ATLAS, (1 - (th + 90) / 360) * 1024];
  const hhNom = (G.FUSELAGE_WIDTH + G.FUSELAGE_HEIGHT) / 4;

  // The belly/cheatline boundary at body x: level along the cabin, then up over the tail cone.
  const bellyTheta = (x) => {
    const d = N - x, base = -24;
    // Forward of the doors it dives under the chin, so the navy tapers out below the radome (a band
    // kept level would have to pinch into a cusp at the nose's tip).
    if (d < L.chinStartD) {
      const c = Math.min(1, (L.chinStartD - d) / (L.chinStartD - L.chinEndD));
      return base - c * c * (3 - 2 * c) * 64;
    }
    if (d < L.bellyStartD) return base;
    const t = Math.min(1, (d - L.bellyStartD) / (L.bellyEndD - L.bellyStartD));
    return base + t * t * (3 - 2 * t) * 120;
  };
  // Drawing in centimetres that reads correctly from outside, on one side. side +1 = left, −1 = right.
  const sideTransform = (ctx, side, x, th) => {
    const [px, py] = fusePx(x, side > 0 ? th : 180 - th);
    const sx = ATLAS / G.LENGTH / 100, sy = 1024 / (2 * Math.PI * hhNom) / 100;
    if (side > 0) ctx.setTransform(-sx, 0, 0, sy, px, py);
    else ctx.setTransform(sx, 0, 0, -sy, px, py);
  };
  // θ of height z on the section at x.
  const thetaAt = (x, z) => {
    const s = shape.fuseSection(x);
    return Math.asin(Math.max(-1, Math.min(1, (z - s.zc) / (z >= s.zc ? s.up : s.down)))) / DEG;
  };

  function paintFuselage(ctx, glow) {
    const W = ATLAS, H = 1024;
    ctx.fillStyle = glow ? '#000' : COLORS.white;
    ctx.fillRect(0, 0, W, H);
    for (let px = 0; px < W; px++) {
      const x = G.TAIL_X + (px + 0.5) / W * G.LENGTH;
      const tb = bellyTheta(x), underChin = N - x < L.chinEndD;
      if (underChin) continue;      // the radome stays white
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
        band(tb, tb + 3.2, COLORS.lime);
        band(tb + 4.2, tb + 8.6, COLORS.blue);
      } else {
        band(tb, tb + 3.2, '#3a9a14');
        band(tb + 4.2, tb + 8.6, '#0f5a98');
      }
    }
    if (glow) return;

    const win = CAB.window;
    const doorClear = (d) => CAB.doors.every((dd) => Math.abs(d - dd) > CAB.doorW / 2 + win.w);
    for (const side of [1, -1]) {
      // Dark backing for the cabin windows (the crisp glass is geometry, as the cockpit's).
      for (let d = win.first; d < win.last; d += win.pitch) {
        if (!doorClear(d)) continue;
        const x = N - d;
        sideTransform(ctx, side, x, thetaAt(x, win.z));
        ctx.fillStyle = COLORS.glass;
        ctx.beginPath(); ctx.roundRect(-win.w * 50, -win.h * 50, win.w * 100, win.h * 100, win.w * 40); ctx.fill();
      }
      // Doors.
      for (const d of CAB.doors) {
        const x = N - d;
        sideTransform(ctx, side, x, thetaAt(x, CAB.doorZ));
        ctx.strokeStyle = '#7f8791'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.roundRect(-CAB.doorW * 50, -CAB.doorH * 50, CAB.doorW * 100, CAB.doorH * 100, 22); ctx.stroke();
        ctx.fillStyle = COLORS.glass;
        ctx.beginPath(); ctx.roundRect(-14, -46, 28, 42, 11); ctx.fill();
      }
      // Titles: NUCLEAR, between doors 1 and 2, above the windows.
      const k = L.titleFontCm / 118;
      sideTransform(ctx, side, N - L.titleD, L.titleTheta);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${L.titleFontCm}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = COLORS.navy;
      ctx.fillText('NUCLEAR', 0, 0);
      const tw = ctx.measureText('NUCLEAR').width;
      ctx.fillStyle = COLORS.lime;
      ctx.fillRect(-tw / 2, 58 * k, tw * 0.62, 8 * k);
      ctx.fillStyle = COLORS.blue;
      ctx.fillRect(-tw / 2 + tw * 0.65, 58 * k, tw * 0.35, 8 * k);
      ctx.font = `700 ${28 * k}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = COLORS.blue;
      ctx.fillText('A I R L I N E S', tw * 0.32, 84 * k);
      atom(ctx, -tw / 2 - 75 * k, 0, 52 * k, 1, false);
      // Registration on the rear fuselage.
      sideTransform(ctx, side, N - L.regD, L.regTheta);
      ctx.font = `700 ${L.regFontCm}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = COLORS.navy;
      ctx.fillText(registration, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Cargo doors, faint: the two big ones on the right, the bulk door on the left.
    const outline = (side, d, w, h, z) => {
      const x = N - d;
      sideTransform(ctx, side, x, thetaAt(x, z));
      ctx.strokeStyle = 'rgba(190,198,208,0.55)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(-w * 50, -h * 50, w * 100, h * 100, 14); ctx.stroke();
    };
    for (const d of CAB.cargoRight) outline(-1, d, CAB.cargoW, CAB.cargoH, CAB.cargoZ);
    outline(CAB.bulkSide ?? 1, CAB.bulkLeft, CAB.bulkW, CAB.bulkH, CAB.bulkZ);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The radome's seam.
    const seam = fusePx(N - (L.radomeSeamD ?? 1.28), 0)[0];
    ctx.fillStyle = 'rgba(150,158,168,0.8)';
    ctx.fillRect(seam, 0, 1.4, H);
    // Cockpit windows: dark backing a little inside the glass, as on the A321.
    for (const mirror of [false, true]) {
      for (const w of windows) {
        ctx.beginPath();
        w.forEach(([x, th], i) => {
          const [px, py] = fusePx(x, mirror ? 180 - th : th);
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = COLORS.glass; ctx.fill();
      }
    }
  }

  function paintFin(ctx, glow) {
    const X0 = 0, Y0 = 1024, S = 1024;
    const fx = (x) => X0 + (x - fin.x0) / (fin.x1 - fin.x0) * S;
    const fy = (z) => Y0 + (1 - (z - fin.z0) / (fin.z1 - fin.z0)) * S;
    ctx.fillStyle = glow ? '#000' : COLORS.navy;
    ctx.fillRect(X0, Y0, S, S);
    const BAND = 0.72, STRIPE = 0.62;
    for (let px = 0; px < S; px++) {
      const x = fin.x0 + (px + 0.5) / S * (fin.x1 - fin.x0);
      const z0 = shape.fuseTop(x) - 0.05, z1 = z0 + BAND;
      if (!glow) {
        const ya = fy(z1), yb = fy(z0);
        ctx.fillStyle = COLORS.yellow;
        ctx.fillRect(X0 + px, ya, 1, yb - ya);
        ctx.fillStyle = COLORS.black;
        for (let y = Math.floor(ya); y < yb; y++) {
          const z = fin.z0 + (1 - (y + 0.5 - Y0) / S) * (fin.z1 - fin.z0);
          const ph = ((x + (z - z0) * 0.9) / STRIPE) % 1;
          if ((ph + 1) % 1 < 0.5) ctx.fillRect(X0 + px, y, 1, 1);
        }
        ctx.fillStyle = COLORS.lime;
        ctx.fillRect(X0 + px, fy(z1 + 0.1), 1, fy(z1) - fy(z1 + 0.1));
      } else {
        ctx.fillStyle = '#2d7a10';
        ctx.fillRect(X0 + px, fy(z1 + 0.1), 1, fy(z1) - fy(z1 + 0.1));
      }
    }
    // Cherenkov-blue sweep along the leading edge, just behind it.
    const le = spec.fin.leTable, a = le[1], b = le[spec.fin.sweepTo ?? 2], back = 0.55;
    ctx.save();
    ctx.beginPath(); ctx.rect(X0, Y0, S, S); ctx.clip();
    ctx.strokeStyle = glow ? '#0d4f88' : COLORS.blue;
    ctx.lineWidth = 0.22 / (fin.x1 - fin.x0) * S;
    ctx.beginPath();
    ctx.moveTo(fx(a[1] - back), fy(a[0] + 0.9)); ctx.lineTo(fx(b[1] - back), fy(b[0] + 0.25));
    ctx.stroke();
    ctx.restore();
    const r = spec.livery.atomR / (fin.z1 - fin.z0) * S;
    const sx = (fin.z1 - fin.z0) / (fin.x1 - fin.x0); // undo the projection's stretch
    atom(ctx, fx(N - spec.livery.atomCentreD), fy(spec.livery.atomZ), r, sx, glow);
  }

  const make = (glow) => {
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS;
    const ctx = c.getContext('2d');
    paintFuselage(ctx, glow);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintFin(ctx, glow);
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
