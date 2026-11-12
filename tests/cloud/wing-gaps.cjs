// No light through the wings (v0.4.1): each type's model, built in headless Chromium, its skinned
// triangles looked through along lines across both wings, every 2 cm of span.
//   - stowed (slats and flaps in): vertical lines and lines 20 to 65° fore and aft of vertical, across
//     the whole chord, find no hole (the 777's was 1.6 m of span in front of the aileron, and the slots
//     between the slats and between the trailing-edge surfaces were 2 to 10 cm);
//   - landing (slats and flaps out): the same lines across the front 45% of the chord find no slot
//     between the drooped slats and the wing (Shane: "close it up").
// The flaps' own slots, behind, are real and not looked at with the flaps out.
// v0.4.3: and the Boeings' wing bend comes after the skinning in the compiled vertex shader (Shane saw the
// 787's outer slats stand off the bent wing on final; the lines here use the unbent wing).
//   node wing-gaps.cjs            (about a minute with SwiftShader; FS_BASE as in stills.cjs)
const { chromium } = require('playwright');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const TYPES = [
  { id: 'a321neo', land: { slatDeg: 27, flapDeg: 34 }, tipStop: 16.85 },
  { id: 'b787-9', land: { slatDeg: 30, flapDeg: 30 } },
  { id: 'b777-300er', land: { slatDeg: 30, flapDeg: 30 } },
];
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + 'tests/dev-widebody.html?type=b787-9');
  await page.waitForFunction(() => window.dev && window.dev.ready, null, { timeout: 120000 });
  for (const T of TYPES) {
    const r = await page.evaluate(async ({ T }) => {
      const at = (p) => new URL(p, location.href).href;
      // The model, and its wing's planform: the leading and trailing edges' x by span.
      let model, ys, tipY, xLE, xTE;
      if (T.id === 'a321neo') {
        const { createAircraft, wingSec } = await import(at('../src/aircraft.js'));
        const G = await import(at('../src/geometry.js'));
        model = createAircraft(); ys = G.FUSELAGE_WIDTH / 2; tipY = T.tipStop;
        xLE = (y) => wingSec(y, 1).le.x; xTE = (y) => wingSec(y, 1).le.x - wingSec(y, 1).chord;
      } else {
        const { createWidebody } = await import(at('../src/widebody.js'));
        const { curve } = await import(at('../src/widebody-shape.js'));
        const SPECS = await import(at('../src/widebody-specs.js'));
        const spec = Object.values(SPECS).find((s) => s && s.id === T.id);
        model = createWidebody(spec); ys = spec.geo.FUSELAGE_WIDTH / 2; tipY = spec.geo.SPAN / 2 - 0.15;
        xLE = curve(spec.wing.le); xTE = curve(spec.wing.te);
      }
      const m = model.mesh, idx = m.geometry.index.array, n = m.geometry.attributes.position.count;
      const V = new m.position.constructor();
      // Skinned positions in the body frame (the model's X = −y, Y = z, Z = −x).
      const skinned = (state) => {
        model.update({ gearPos: 0, gearDoors: 0, ...state }, 0);
        model.object.updateMatrixWorld(true);
        const P = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) { m.getVertexPosition(i, V); P[3 * i] = -V.z; P[3 * i + 1] = -V.x; P[3 * i + 2] = V.y; }
        return P;
      };
      // The model's cross-section at span y (one side): the segments where its triangles cut the plane.
      const BIN = 0.25;
      const binned = (P, side) => {
        const bins = new Map();
        for (let t = 0; t < idx.length; t += 3) {
          const q = [idx[t], idx[t + 1], idx[t + 2]];
          const yv = q.map((k) => side * P[3 * k + 1]);
          const lo = Math.min(...yv), hi = Math.max(...yv);
          if (hi < ys + 0.1) continue;
          const tri = { x: q.map((k) => P[3 * k]), y: yv, z: q.map((k) => P[3 * k + 2]), lo, hi };
          for (let b = Math.floor(lo / BIN); b <= Math.floor(hi / BIN); b++) { if (!bins.has(b)) bins.set(b, []); bins.get(b).push(tri); }
        }
        return (y) => {
          const segs = [];
          for (const T3 of bins.get(Math.floor(y / BIN)) || []) {
            if (y < T3.lo || y > T3.hi || T3.hi - T3.lo < 1e-9) continue;
            const pts = [];
            for (let e = 0; e < 3; e++) {
              const i = e, j = (e + 1) % 3, ya = T3.y[i], yb = T3.y[j];
              if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
              const s = (y - ya) / (yb - ya);
              pts.push([T3.x[i] + s * (T3.x[j] - T3.x[i]), T3.z[i] + s * (T3.z[j] - T3.z[i])]);
            }
            if (pts.length >= 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
          }
          return segs;
        };
      };
      // Is the line through (x, z) at angle a from vertical (in the x-z plane) cut by a segment? u = x cos a − z sin a.
      const covered = (segs, a) => {
        const c = Math.cos(a), s = Math.sin(a);
        const iv = segs.map(([x1, z1, x2, z2]) => { const u1 = x1 * c - z1 * s, u2 = x2 * c - z2 * s; return u1 < u2 ? [u1, u2] : [u2, u1]; }).sort((p, q) => p[0] - q[0]);
        const merged = [];
        for (const [p, q] of iv) { const L = merged[merged.length - 1]; if (L && p <= L[1] + 1e-6) L[1] = Math.max(L[1], q); else merged.push([p, q]); }
        return (x, z) => { const u = x * c - z * s; let lo = 0, hi = merged.length - 1;
          while (lo <= hi) { const mid = (lo + hi) >> 1; if (merged[mid][1] < u) lo = mid + 1; else if (merged[mid][0] > u) hi = mid - 1; else return true; }
          return false; };
      };
      const DY = 0.02, DX = 0.1, A = [0, 20, -20, 35, -35, 50, -50, 65, -65].map((d) => (d * Math.PI) / 180);
      const P0 = skinned({ slatDeg: 0, flapDeg: 0 }), P1 = skinned(T.land);
      const out = { holes: { stowed: [], landing: [] }, rows: 0, lines: 0 };
      for (const side of [1, -1]) {
        const cut0 = binned(P0, side), cut1 = binned(P1, side);
        for (let y = ys + 1.2; y <= tipY; y += DY) {
          const xHi = xLE(y), xLo = xTE(y), chord = xHi - xLo;
          // The wing's part of the cross-section (not the tailplane, aft of it).
          const s0 = cut0(y).filter((g) => Math.max(g[0], g[2]) > xLo - 2);
          const s1 = cut1(y).filter((g) => Math.max(g[0], g[2]) > xLo - 2);
          out.rows++;
          for (const [cfg, segs] of [['stowed', s0], ['landing', s1]]) {
            const lines = A.map((a) => [a, covered(segs, a)]);
            const note = (a, f) => { const L = out.holes[cfg]; if (L.length < 20000) L.push([side, +y.toFixed(2), +f.toFixed(3), Math.round(a * 180 / Math.PI)]); };
            // Vertical lines every DX inside the planform (not its very edges); with the flaps out only
            // across the front 45% (the flaps' slots are real). A vertical line that meets nothing is
            // a hole; one that meets the wing gives a point inside it, between the topmost hit and the
            // next one below, for the slanted lines through it.
            const x0 = cfg === 'landing' ? xHi - 0.45 * chord : xLo + 0.3;
            for (let x = Math.ceil(x0 / DX) * DX; x <= xHi - 0.3; x += DX) {
              const h = [];
              for (const [x1, z1, x2, z2] of segs) if ((x1 - x) * (x2 - x) <= 0 && x1 !== x2) h.push(z1 + ((x - x1) / (x2 - x1)) * (z2 - z1));
              const f = (xHi - x) / chord;
              out.lines++;
              if (!h.length) { note(0, f); continue; }
              if (h.length < 2) continue;
              h.sort((p, q) => q - p);
              const zm = (h[0] + h[1]) / 2;
              for (const [a, has] of lines.slice(1)) { out.lines++; if (!has(x, zm)) note(a, f); }
            }
          }
        }
      }
      return out;
    }, { T });
    // Group the misses by span, so a slot shows once.
    const groups = (list) => {
      const g = [];
      for (const [side, y, f, a] of list) {
        const last = g[g.length - 1];
        if (last && last.side === side && y - last.y1 <= 0.041) { last.y1 = y; last.n++; last.f.add(f); last.a.add(a); } else g.push({ side, y0: y, y1: y, n: 1, f: new Set([f]), a: new Set([a]) });
      }
      return g.map((q) => `${q.side > 0 ? 'L' : 'R'} y ${q.y0}–${q.y1} m, chord ${Math.min(...q.f)}–${Math.max(...q.f)}, lines ${[...q.a].join('/')}° (${q.n})`);
    };
    console.log(`${T.id}: ${r.rows} rows, ${r.lines} lines`);
    for (const cfg of ['stowed', 'landing']) {
      const g = groups(r.holes[cfg]);
      ok(g.length === 0, `${T.id} ${cfg}: no light through the wing${g.length ? ': ' + g.slice(0, 8).join('; ') : ''}`);
    }
  }
  // v0.4.3: the Boeings' wing bend goes on after the skinning, so the drooped slats and the flaps rise with
  // the wing (before, the bend went on first and each surface's own rotation turned it into a gap: half a
  // metre at a 787's outer slats on final). The model's vertex shader, as compiled, has to show that order.
  for (const id of ['b787-9', 'b777-300er']) {
    const r = await page.evaluate(async (id) => {
      const at = (p) => new URL(p, location.href).href;
      const THREE = await import(at('../vendor/three.module.js'));
      const { createWidebody } = await import(at('../src/widebody.js'));
      const SPECS = await import(at('../src/widebody-specs.js'));
      const model = createWidebody(Object.values(SPECS).find((s) => s && s.id === id));
      const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      model.mesh.material.onBeforeCompile(sh, null);
      const v = sh.vertexShader, skin = v.indexOf('#include <skinning_vertex>'), bend = v.indexOf('uFlex * s * s');
      return { skin, bend, uniform: !!sh.uniforms.uFlex };
    }, id);
    ok(r.uniform && r.skin >= 0 && r.bend > r.skin, `${id}: the wing bend is applied after the skinning (skinning at ${r.skin}, bend at ${r.bend})`);
  }
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
