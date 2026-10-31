// Runway rendering: the pavement with ICAO markings drawn procedurally in the fragment
// shader (crisp at any distance), and the lights as size-attenuated sprites that keep a
// minimum size in pixels, so they stay visible from miles out.
//
// Markings (ICAO Annex 14): threshold stripes (count by width), designators (numbers and
// L/R/C from a small canvas glyph atlas), centreline dashes, touchdown zone bars, aiming
// points, edge lines, displaced-threshold arrows and bar.
// Lights: edge (yellow in the last 600 m), centreline (red/white, then red, in the last
// 900/300 m), threshold green / end red, touchdown zone, approach lights by type
// (ALSF-II, SSALF, SALS) with sequenced flashers, and PAPIs (red/white by the viewer's
// elevation angle: two white, two red on the 3° path).
//
// The runway sits exactly at its end elevations (the terrain is flattened to the same
// values) and is pulled a little towards the camera along the view ray, so it never
// fights the terrain under it.

import * as THREE from '../../vendor/three.module.js';
import { pavementEnd } from './runways.js';

const SHOULDER = 7.5;     // m of paved shoulder each side, beyond the edge lines
const SEG = 40;           // m per segment along the runway (for the Earth's curvature)

// ------------------------------------------------------------------ glyph atlas

const GLYPHS = '0123456789LRC';

// Runway designator glyphs: tall, narrow, plain strokes (white on black), one per cell.
function glyphAtlas(renderer) {
  const cw = 64, ch = 160;
  const c = document.createElement('canvas');
  c.width = cw * GLYPHS.length; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < GLYPHS.length; i++) {
    g.save();
    g.translate(i * cw + cw / 2, ch / 2);
    g.scale(1, 1.75);
    g.font = 'bold 80px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(GLYPHS[i], 0, 4);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

// Designator -> glyph indices: [digit, digit, letter or -1].
function designator(ident) {
  const m = String(ident).match(/^(\d{1,2})([LRC]?)$/i);
  if (!m) return [-1, -1, -1];
  const n = m[1].padStart(2, '0');
  return [GLYPHS.indexOf(n[0]), GLYPHS.indexOf(n[1]), m[2] ? GLYPHS.indexOf(m[2].toUpperCase()) : -1];
}

// Threshold stripe count by runway width (ICAO Annex 14, 5.2.4).
export function thresholdStripes(w) {
  if (w >= 59) return 16;
  if (w >= 44) return 12;
  if (w >= 29) return 8;
  if (w >= 22) return 6;
  return 4;
}

// ------------------------------------------------------------------ pavement

const RUNWAY_VERT = /* glsl */ `
  uniform vec2 uRelC;       // runway centre minus the scene origin (map metres, computed in double)
  uniform vec2 uDir;        // unit vector end 0 -> end 1 (map)
  uniform float uLen, uWid, uE0, uE1;
  attribute vec2 rw;        // (u from end 0's pavement end, v to the left of uDir)
  varying vec2 vRw;
  varying vec3 vRel;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec2 perp = vec2(-uDir.y, uDir.x);
    vec2 rel = uRelC + uDir * (rw.x - 0.5 * uLen) + perp * rw.y;
    float h = mix(uE0, uE1, clamp(rw.x / uLen, 0.0, 1.0));
    vec3 wp = vec3(rel.x, h, -rel.y);
    vec3 r = wp - uCamPos;
    wp.y -= curveDrop(r.xz);
    vRel = wp - uCamPos;
    vRw = rw;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float d = length(mv.xyz);
    mv.xyz *= 1.0 - min((0.16 + d * 0.0016) / max(d, 1e-3), 0.5);   // pull towards the camera (above the aprons' layers)
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;

const RUNWAY_FRAG = /* glsl */ `
  uniform float uLen, uWid;
  uniform vec4 uEnd0, uEnd1;      // per end: displaced m, glyph0, glyph1, letter (-1 = none)
  uniform float uStripes;
  uniform sampler2D uGlyphs;
  varying vec2 vRw;
  varying vec3 vRel;
  #include <logdepthbuf_pars_fragment>

  // Antialiased coverage of the box lo..hi at p.
  float box(vec2 p, vec2 lo, vec2 hi, vec2 aa) {
    vec2 a = smoothstep(lo - aa, lo + aa, p) * (1.0 - smoothstep(hi - aa, hi + aa, p));
    return a.x * a.y;
  }

  float glyph(float idx, vec2 p, vec2 lo, vec2 size) {
    if (idx < 0.0) return 0.0;
    vec2 q = (p - lo) / size;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 0.0;
    return texture(uGlyphs, vec2((idx + 0.06 + 0.88 * q.x) / ${GLYPHS.length.toFixed(1)}, 0.03 + 0.94 * q.y)).r;
  }

  // Paint for one end: t = distance past its threshold, s = lateral (m, + to the pilot's right).
  float endPaint(float t, float s, vec4 e, vec2 aa) {
    float disp = e.x, a = abs(s), hw = 0.5 * uWid;
    float p = 0.0;
    if (t < 0.0) {
      // Displaced threshold: arrows down the centreline and the threshold bar.
      if (t > -disp + 10.0) {
        float k = mod(-t, 40.0);
        p = max(p, box(vec2(a, k), vec2(0.0, 6.0), vec2(0.45, 30.0), aa));
        float head = box(vec2(a, k), vec2(0.0, 0.0), vec2(3.0, 6.0), aa) * step(a, (k) * 0.5);
        p = max(p, head);
      }
      return p;
    }
    if (disp > 0.0) p = max(p, box(vec2(a, t), vec2(0.0, 0.0), vec2(hw - 1.0, 1.8), aa));
    // Threshold stripes, 30 m long from 6 m past the threshold.
    float n = 0.5 * uStripes, o = min(hw - 3.0, 27.0), s0 = 1.8;
    float w = (o - s0) / (2.0 * n - 1.0);
    if (t > 5.0 && t < 37.0 && a > s0 - 1.0 && a < o + 1.0) {
      float k = floor((a - s0) / (2.0 * w));
      float x0 = s0 + 2.0 * w * k;
      p = max(p, box(vec2(a, t), vec2(x0, 6.0), vec2(x0 + w, 36.0), aa) * step(k, n - 1.0));
    }
    // Designator: the letter nearest the threshold, the number beyond it; 9 m tall.
    if (t > 46.0 && t < 80.0) {
      float y = e.w >= 0.0 ? 63.0 : 48.0;
      p = max(p, glyph(e.y, vec2(s, t), vec2(-3.9, y), vec2(3.4, 9.0)));
      p = max(p, glyph(e.z, vec2(s, t), vec2(0.5, y), vec2(3.4, 9.0)));
      p = max(p, glyph(e.w, vec2(s, t), vec2(-1.7, 48.0), vec2(3.4, 9.0)));
    }
    // Touchdown zone bars (22.5 m x 3 m) and the aiming point (60 m x 10 m at 400 m).
    float lda = uLen - disp;
    if (lda > 1200.0 && t > 140.0 && t < 940.0) {
      float in0 = 9.0;
      p = max(p, box(vec2(a, t), vec2(in0, 400.0), vec2(in0 + 10.0, 460.0), aa));
      for (int i = 0; i < 5; i++) {
        float at = i == 0 ? 150.0 : i == 1 ? 300.0 : i == 2 ? 600.0 : i == 3 ? 750.0 : 900.0;
        float bars = i < 2 ? 3.0 : i < 4 ? 2.0 : 1.0;
        if (at > lda * 0.5 - 100.0) break;
        if (t > at - 1.0 && t < at + 23.5) {
          for (int b = 0; b < 3; b++) {
            if (float(b) >= bars) break;
            float x0 = in0 + 4.5 * float(b);
            p = max(p, box(vec2(a, t), vec2(x0, at), vec2(x0 + 3.0, at + 22.5), aa));
          }
        }
      }
    }
    return p;
  }

  void main() {
    #include <logdepthbuf_fragment>
    float u = vRw.x, v = vRw.y, hw = 0.5 * uWid;
    vec2 aa = max(fwidth(vRw) * 0.7, vec2(0.02));
    float dist = length(vRel);
    // Asphalt, with a subtle grain and rubber in the touchdown zones.
    float g = vnoise(vRw * vec2(0.5, 2.0)) * 0.5 + vnoise(vRw * 3.1) * 0.3 + vnoise(vRw * vec2(0.02, 0.15)) * 0.4;
    vec3 col = vec3(0.040, 0.040, 0.042) * (0.8 + 0.35 * g);
    float t0 = u - uEnd0.x, t1 = (uLen - u) - uEnd1.x;
    float rubber = (smoothstep(150.0, 300.0, t0) * (1.0 - smoothstep(700.0, 1100.0, t0)) +
                    smoothstep(150.0, 300.0, t1) * (1.0 - smoothstep(700.0, 1100.0, t1))) *
                   (1.0 - smoothstep(4.0, 9.0, abs(v))) * (0.6 + 0.4 * vnoise(vRw * vec2(0.05, 1.5)));
    col *= 1.0 - 0.45 * rubber;
    // Shoulders: lighter, older pavement.
    col = mix(col, vec3(0.075, 0.072, 0.066) * (0.85 + 0.3 * g), step(hw, abs(v)));
    // Paint.
    float p = 0.0;
    p = max(p, endPaint(t0, -v, uEnd0, aa));      // end 0: pilot's right = -v
    p = max(p, endPaint(t1, v, uEnd1, aa));
    // Centreline: 30 m dashes, 20 m gaps, 0.9 m wide, between the designators.
    if (t0 > 85.0 && t1 > 85.0) {
      float k = mod(t0 - 85.0, 50.0);
      p = max(p, box(vec2(abs(v), k), vec2(0.0, 0.0), vec2(0.45, 30.0), aa));
    }
    // Edge lines.
    p = max(p, box(vec2(abs(v), u), vec2(hw - 0.9, 0.0), vec2(hw, uLen), aa));
    // Paint fades into the asphalt colour far away (it's sub-pixel, and the mip of it is grey).
    // Once a metre of runway is more than ~a pixel, paint averages out to its share of the area.
    float fp = max(fwidth(vRw.x), fwidth(vRw.y) * 4.0);
    p = mix(p, 0.05, smoothstep(2.0, 12.0, fp));
    col = mix(col, vec3(0.50, 0.50, 0.48) * (0.85 + 0.2 * g), p * (1.0 - 0.6 * rubber));
    vec3 n = vec3(0.0, 1.0, 0.0);
    vec3 light = uSunColor * max(uSunDir.y, 0.0) * 2.4 + uSkyAmb * 1.1;
    vec3 c = col * light;
    // A little sheen at grazing angles towards the sun.
    vec3 vd = vRel / max(dist, 1e-3);
    c += uSunColor * 0.08 * pow(max(dot(reflect(vd, n), uSunDir), 0.0), 12.0);
    gl_FragColor = vec4(applyHaze(c, vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function runwayGeometry(len, wid) {
  const n = Math.max(2, Math.ceil(len / SEG));
  const hw = wid / 2 + SHOULDER;
  const rw = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * len;
    rw.push(u, hw, u, -hw);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(rw);
  g.setAttribute('rw', new THREE.BufferAttribute(arr, 2));
  // three wants a position attribute for bounds; we draw with frustum culling off.
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ lights

// Light kinds for the shader.
const OMNI = 0, DIR = 1, PAPI = 2, FLASH = 3;
const WHITE = [1.0, 0.95, 0.85], YELLOW = [1.0, 0.72, 0.18], RED = [1.0, 0.08, 0.04], GREEN = [0.15, 1.0, 0.35], NONE = [0, 0, 0];

function lightLayout(airport, hf) {
  const L = [];   // { x, y (map), h, colA, colB, dir: [dx, dy], kind, size, param }
  const groundAt = (x, y, e) => Math.max(e, hf ? hf.heightAt(x, y) : e) + 0.4;
  for (const r of airport.runways) {
    const p0 = pavementEnd(r.ends[0]), p1 = pavementEnd(r.ends[1]);
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
    const hw = r.widthM / 2;
    const e0 = r.ends[0].elevM, e1 = r.ends[1].elevM;
    // Point at u along from end 0 and v to the left; on the runway's surface.
    const at = (u, v) => [p0.x + ux * u - uy * v, p0.y + uy * u + ux * v, e0 + (e1 - e0) * Math.min(Math.max(u / len, 0), 1) + 0.15];
    // Edge lights, every 60 m: white; yellow in the last 600 m towards the far end.
    const ne = Math.round(len / 60);
    for (let i = 0; i <= ne; i++) {
      const u = (i / ne) * len;
      for (const side of [-1, 1]) {
        const [x, y, h] = at(u, side * (hw + 1.5));
        // A: seen from beyond (larger u, rolling towards end 0); B: rolling towards end 1.
        L.push({ x, y, h: h + 0.2, colA: u < 600 ? YELLOW : WHITE, colB: len - u < 600 ? YELLOW : WHITE, dir: [ux, uy], kind: OMNI, size: 0.7 });
      }
    }
    // Centreline lights every 15 m: red/white alternate 900-300 m from the end you're heading to, red in the last 300.
    const nc = Math.floor(len / 15);
    for (let i = 1; i < nc; i++) {
      const u = i * 15;
      const [x, y, h] = at(u, 0.6);
      const toward = (d, k) => (d < 300 ? RED : d < 900 ? (k % 2 ? RED : WHITE) : WHITE);
      L.push({ x, y, h, colA: toward(u, i), colB: toward(len - u, i), dir: [ux, uy], kind: DIR, size: 0.45 });
    }
    for (let k = 0; k < 2; k++) {
      const e = r.ends[k];
      const sgn = k === 0 ? 1 : -1;
      const uOf = (t) => (k === 0 ? t : len - t);                 // t from this end's pavement end
      const disp = Math.hypot(e.x - (k === 0 ? p0 : p1).x, e.y - (k === 0 ? p0 : p1).y);
      const ex = sgn * ux, ey = sgn * uy;                          // unit vector down the runway from this end
      const out = [-ex, -ey];                                      // towards the approach
      const right = (t, s) => at(uOf(t), -sgn * s);                // s + to the landing pilot's right
      // Threshold (green to the approach) and runway end (red to the runway).
      for (let s = -hw; s <= hw + 0.01; s += 3) {
        if (disp < 1) {
          const [x, y, h] = right(0, s);
          L.push({ x, y, h, colA: GREEN, colB: RED, dir: out, kind: DIR, size: 0.8 });
        } else {
          const [x, y, h] = right(disp, s);
          if (Math.abs(s) > hw - 8) L.push({ x, y, h, colA: GREEN, colB: NONE, dir: out, kind: DIR, size: 0.8 });
          const [x2, y2, h2] = right(0, s);
          L.push({ x: x2, y: y2, h: h2, colA: NONE, colB: RED, dir: out, kind: DIR, size: 0.8 });
        }
      }
      const type = e.approachLights || null;
      // Touchdown zone lights (CAT II/III runways): barrettes every 30 m to 900 m.
      if (type === 'ALSF-II') {
        for (let t = 60; t <= 900; t += 30) for (const s of [-12, -10.5, -9, 9, 10.5, 12]) {
          const [x, y, h] = right(disp + t, s);
          L.push({ x, y, h, colA: WHITE, colB: NONE, dir: out, kind: DIR, size: 0.45 });
        }
      }
      // Approach lights, out from the threshold.
      if (type) {
        const thr = disp;   // approach lights start at the landing threshold
        const reach = type === 'ALSF-II' ? 900 : 420;
        const step = type === 'ALSF-II' ? 30 : 60;
        const ground = (t, s) => { const [x, y] = right(thr - t, s); return [x, y, groundAt(x, y, e.elevM) + 0.6]; };
        for (let t = step; t <= reach + 0.1; t += step) {
          for (const s of [-2, -1, 0, 1, 2]) { const [x, y, h] = ground(t, s); L.push({ x, y, h, colA: WHITE, colB: NONE, dir: out, kind: DIR, size: 0.9 }); }
          // Sequenced flashers (the rabbit), running towards the runway.
          const flashFrom = type === 'ALSF-II' ? 300 : type === 'SSALF' ? 240 : 1e9;
          if (t > flashFrom) { const [x, y, h] = ground(t, 0); L.push({ x, y, h: h + 0.8, colA: [1, 1, 1], colB: NONE, dir: out, kind: FLASH, size: 2.0, param: t / reach }); }
        }
        // The 300 m (1,000 ft) crossbar.
        for (let s = -15; s <= 15; s += 1.5) {
          if (Math.abs(s) < 3) continue;
          const [x, y, h] = ground(300, s);
          L.push({ x, y, h, colA: WHITE, colB: NONE, dir: out, kind: DIR, size: 0.9 });
        }
        // ALSF-II: red side-row barrettes in the inner 300 m, and a 150 m bar.
        if (type === 'ALSF-II') {
          for (let t = 30; t <= 270; t += 30) for (const s of [-11, -10, -9, 9, 10, 11]) {
            const [x, y, h] = ground(t, s);
            L.push({ x, y, h, colA: RED, colB: NONE, dir: out, kind: DIR, size: 0.8 });
          }
          for (const s of [-6, -5, -4, 4, 5, 6]) { const [x, y, h] = ground(150, s); L.push({ x, y, h, colA: WHITE, colB: NONE, dir: out, kind: DIR, size: 0.9 }); }
        }
      }
      // PAPI: four units 15 m outside the edge, 9 m apart, ~330 m past the threshold.
      // Inner unit 3°30', then 3°10', 2°50', 2°30': on the 3° path two white, two red.
      const papiSides = e.papi === 'both' ? [-1, 1] : e.papi === 'right' ? [1] : e.papi === 'left' ? [-1] : [];
      for (const side of papiSides) {
        [3.5, 3 + 10 / 60, 2 + 50 / 60, 2.5].forEach((ang, i) => {
          const [x, y, h] = right(disp + 330, side * (hw + 15 + 9 * i));
          L.push({ x, y, h: h + 0.6, colA: WHITE, colB: NONE, dir: out, kind: PAPI, size: 1.6, param: ang });
        });
      }
    }
  }
  return L;
}

const LIGHT_VERT = /* glsl */ `
  uniform vec2 uRelA;       // airport origin minus the scene origin (map metres)
  attribute vec4 colA, colB;   // rgb + kind (in colA.a), colB.a = size (m)
  attribute vec3 dirParam;     // map direction of side A (x, y), param
  varying vec3 vCol;
  varying float vAlpha;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec2 rel = uRelA + position.xy;            // position: (map dx, map dy, height)
    vec3 wp = vec3(rel.x, position.z, -rel.y);
    vec3 r = wp - uCamPos;
    wp.y -= curveDrop(r.xz);
    r = wp - uCamPos;
    float dist = length(r);
    vec2 toCam = -vec2(r.x, -r.z) / max(length(r.xz), 1e-3);   // map direction light -> camera
    float kind = colA.a, size = colB.a;
    float side = dot(toCam, dirParam.xy);
    vec3 c = side > 0.0 ? colA.rgb : colB.rgb;
    float I = 1.0;
    if (kind > 0.5) I *= smoothstep(0.0, 0.25, abs(side));    // directional: a beam, not all round
    if (kind > 1.5 && kind < 2.5) {
      // PAPI: white above the unit's angle, red below.
      float elev = degrees(atan(-r.y, length(r.xz)));
      c = mix(vec3(1.0, 0.06, 0.03), vec3(1.0, 0.95, 0.88), smoothstep(dirParam.z - 0.04, dirParam.z + 0.04, elev));
      I *= smoothstep(0.0, 0.5, side);
    }
    if (kind > 2.5) {
      // Sequenced flasher: twice a second, from the outer light in.
      float ph = fract(uTime * 2.0) - (1.0 - dirParam.z) * 0.6;
      I *= exp(-ph * ph * 900.0) * 3.0;
    }
    // Haze dims the light (no in-scatter: it's an emitter).
    float od = 2.6e-5 * dist * exp(-max(min(uCamAlt, wp.y + 0.5 * r.y), 0.0) / 1500.0);
    I *= exp(-od);
    float px = size * uPxScale / max(dist, 1.0);
    float minPx = kind > 1.5 && kind < 2.5 ? 3.0 : 2.0;
    float sz = px > minPx ? minPx + (px - minPx) * 0.4 : minPx; // small daytime fixtures up close
    // Below the minimum size the light gets dimmer rather than smaller.
    I *= clamp(px / minPx, 0.06, 1.0);
    gl_PointSize = min(sz, 12.0) * step(0.001, I);
    vCol = c * I;
    vAlpha = I;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float d = length(mv.xyz);
    mv.xyz *= 1.0 - min((0.3 + d * 0.0015) / max(d, 1e-3), 0.5);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;

const LIGHT_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vAlpha;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 6.0), halo = exp(-r2 * 2.0) * 0.35;
    gl_FragColor = vec4(vCol * (core * 1.4 + halo * 0.5), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// ------------------------------------------------------------------ public

export function createRunways(scene, uniforms, chunks, airports, renderer, hf = null) {
  const group = new THREE.Group();
  group.name = 'runways';
  const glyphs = typeof document !== 'undefined' ? glyphAtlas(renderer) : null;
  const items = [];   // { mesh, cx, cy, u }
  const lightSets = [];
  let lightCount = 0, tris = 0;

  for (const a of airports || []) {
    for (const r of a.runways || []) {
      const p0 = pavementEnd(r.ends[0]), p1 = pavementEnd(r.ends[1]);
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const geo = runwayGeometry(len, r.widthM);
      const endU = (k) => {
        const e = r.ends[k], p = k === 0 ? p0 : p1;
        const d = designator(e.ident);
        return new THREE.Vector4(Math.hypot(e.x - p.x, e.y - p.y), d[0], d[1], d[2]);
      };
      const u = Object.assign({}, uniforms, {
        uRelC: { value: new THREE.Vector2() },
        uDir: { value: new THREE.Vector2((p1.x - p0.x) / len, (p1.y - p0.y) / len) },
        uLen: { value: len }, uWid: { value: r.widthM },
        uE0: { value: r.ends[0].elevM }, uE1: { value: r.ends[1].elevM },
        uEnd0: { value: endU(0) }, uEnd1: { value: endU(1) },
        uStripes: { value: thresholdStripes(r.widthM) },
        uGlyphs: { value: glyphs },
      });
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: `${chunks.UNIFORMS_GLSL}\n${chunks.HEIGHT_GLSL}\n${RUNWAY_VERT}`,
        fragmentShader: `${chunks.UNIFORMS_GLSL}\n${chunks.NOISE_GLSL}\n${chunks.ATMOS_GLSL}\n${RUNWAY_FRAG}`,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = `runway-${a.icao}-${r.id}`;
      group.add(mesh);
      items.push({ mesh, cx: (p0.x + p1.x) / 2, cy: (p0.y + p1.y) / 2, u, icao: a.icao });
      tris += geo.index.count / 3;
    }
    // Lights for this airport, relative to its origin.
    const L = lightLayout(a, hf);
    if (!L.length) continue;
    const ox = a.origin ? a.origin[0] : L[0].x, oy = a.origin ? a.origin[1] : L[0].y;
    const pos = new Float32Array(L.length * 3), cA = new Float32Array(L.length * 4), cB = new Float32Array(L.length * 4), dp = new Float32Array(L.length * 3);
    L.forEach((l, i) => {
      pos.set([l.x - ox, l.y - oy, l.h], i * 3);
      cA.set([...l.colA, l.kind], i * 4);
      cB.set([...l.colB, l.size], i * 4);
      dp.set([l.dir[0], l.dir[1], l.param || 0], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('colA', new THREE.BufferAttribute(cA, 4));
    g.setAttribute('colB', new THREE.BufferAttribute(cB, 4));
    g.setAttribute('dirParam', new THREE.BufferAttribute(dp, 3));
    const u = Object.assign({}, uniforms, { uRelA: { value: new THREE.Vector2() } });
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: `${chunks.UNIFORMS_GLSL}\n${chunks.HEIGHT_GLSL}\n${LIGHT_VERT}`,
      fragmentShader: LIGHT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    pts.name = `lights-${a.icao}`;
    group.add(pts);
    lightSets.push({ pts, ox, oy, u, count: L.length });
    lightCount += L.length;
  }
  scene.add(group);

  return {
    group,
    update(camMap, origin) {
      let calls = 0;
      for (const it of items) {
        // Hide runways beyond the haze (~80 km).
        const far = Math.hypot(it.cx - camMap.x, it.cy - camMap.y) > 80000;
        it.mesh.visible = !far;
        if (far) continue;
        it.u.uRelC.value.set(it.cx - origin.x, it.cy - origin.y);
        calls++;
      }
      let lights = 0;
      for (const s of lightSets) {
        const far = Math.hypot(s.ox - camMap.x, s.oy - camMap.y) > 60000;
        s.pts.visible = !far;
        if (far) continue;
        s.u.uRelA.value.set(s.ox - origin.x, s.oy - origin.y);
        calls++;
        lights += s.count;
      }
      return { lights, tris, drawCalls: calls };
    },
  };
}
