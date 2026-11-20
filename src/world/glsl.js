// Shared GPU pieces for the world: the data textures, the uniforms every world shader
// reads, and the GLSL that samples heights exactly like heightfield.js does on the CPU.
//
// Every world material gets the same `uniforms` object (the values are shared), plus its
// own. The terrain, trees, buildings and runways all call terrainHeight() in their vertex
// shaders, so everything sits on the same ground.

import * as THREE from '../../vendor/three.module.js';
import { PATCH_BLEND, FLAT_MARGIN_U, FLAT_MARGIN_V, FLAT_BLEND, PAVE_BLEND_M } from './heightfield.js';
import { RUNWAY_SHOULDER_M } from './runways.js';
import { EARTH_RADIUS } from './frame.js';
import { HAZE_SIGMA0, HAZE_HEIGHT } from './sky.js';
import { createClipWindow } from './clipwindow.js';

export const MAX_PATCHES = 4;
export const MAX_RUNWAYS = 12;

// v0.6.0 (briefs/V0-6-0.md Part 1 step 3): the 250 m textures as a toroidal clip window over the tiles
// (clipwindow.js) instead of one Korea-sized texture assembled from them. Off: the textures are
// tiles.assemble(), as since checkpoint 1.
export const CLIP_WINDOW = true;

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// ------------------------------------------------------------------ textures

function dataTex(data, w, h, format, type, opts = {}) {
  const t = new THREE.DataTexture(data, w, h, format, type);
  if (opts.internal) t.internalFormat = opts.internal;
  t.minFilter = opts.mip ? THREE.LinearMipmapLinearFilter : (opts.linear ? THREE.LinearFilter : THREE.NearestFilter);
  t.magFilter = opts.linear || opts.mip ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = !!opts.mip;
  t.wrapS = t.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.unpackAlignment = 1;
  if (opts.aniso) t.anisotropy = opts.aniso;
  t.needsUpdate = true;
  return t;
}

// Normals (map ENU x, y packed as RG8 around 128) from a height grid, by central differences.
export function normalsRG(h, nx, ny, cell, scale, out = new Uint8Array(nx * ny * 2), rowOff = 0) {
  const k = scale / (2 * cell);
  for (let j = 0; j < ny; j++) {
    const jm = j > 0 ? j - 1 : 0, jp = j < ny - 1 ? j + 1 : ny - 1;
    for (let i = 0; i < nx; i++) {
      const im = i > 0 ? i - 1 : 0, ip = i < nx - 1 ? i + 1 : nx - 1;
      let a = h[j * nx + im], b = h[j * nx + ip], c = h[jm * nx + i], d = h[jp * nx + i];
      if (a < 0) a = 0; if (b < 0) b = 0; if (c < 0) c = 0; if (d < 0) d = 0;
      const gx = (b - a) * k, gy = (d - c) * k;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const o = ((j + rowOff) * nx + i) * 2;
      out[o] = Math.round(128 - 127 * gx * inv);
      out[o + 1] = Math.round(128 - 127 * gy * inv);
    }
  }
  return out;
}

// Stack grids vertically in one atlas (2 spare rows between them). Returns rows and size.
function atlasLayout(grids) {
  let w = 1, rows = 0;
  const offs = [];
  for (const g of grids) { w = Math.max(w, g.nx); offs.push(rows); rows += g.ny + 2; }
  return { w, h: Math.max(1, rows), offs };
}

// Build every texture and uniform from a heightfield (heightfield.js). Missing layers get
// 1x1 stand-ins that mean "sea level, sea, no cover".
export function createWorldUniforms(hf) {
  const L = hf.layers || {};
  const scale = L.heightScale || 0.25;
  // v0.6.0: over the tiles, the textures are the extent assembled from them (Korea's grid,
  // cell for cell) until the clip window replaces them.
  const has = hf.info || {};
  // With the clip window (clipwindow.js): over Korea, which fits, the extent itself, fixed, with
  // ClampToEdge (the national texture to the bit); else a toroidal N² window (global cell g at
  // texel g & (N − 1), the texture coordinate (m − lattice origin) / (N · cell), RepeatWrapping).
  const cw = CLIP_WINDOW && !L.national && L.tiles && has.height ? createClipWindow(L.tiles, { heightScale: scale, lean: true }) : null;
  const nat = cw
    ? { x0: cw.win.x0 + cw.win.bi * cw.win.cell, y0: cw.win.y0 + cw.win.bj * cw.win.cell, cell: cw.win.cell, nx: cw.nx, ny: cw.ny, height: cw.h, normal: cw.n, water: cw.w, cover: cw.c }
    : L.national || (L.tiles ? L.tiles.assemble() : null) || { x0: -400000, y0: -400000, cell: 250, nx: 3200, ny: 3200 };
  const rep = !!cw && !cw.fit;

  // A lean window (the region) keeps no CPU copy of its heights, normals and water: those
  // textures are storage only, filled a block at a time (attachClip).
  const lean = !!cw && cw.lean;
  const bare = (t) => { t.source.dataReady = false; return t; };
  const heightTex = lean ? bare(dataTex(null, nat.nx, nat.ny, THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I', repeat: rep })) : has.height
    ? dataTex(nat.height, nat.nx, nat.ny, THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I', repeat: rep })
    : dataTex(new Int16Array([-80]), 1, 1, THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I' });
  const normalTex = lean ? bare(dataTex(null, nat.nx, nat.ny, THREE.RGFormat, THREE.UnsignedByteType, { mip: true, aniso: 8, repeat: rep })) : has.height
    ? dataTex(nat.normal || normalsRG(nat.height, nat.nx, nat.ny, nat.cell, scale), nat.nx, nat.ny, THREE.RGFormat, THREE.UnsignedByteType, { mip: true, aniso: 8, repeat: rep })
    : dataTex(new Uint8Array([128, 128]), 1, 1, THREE.RGFormat, THREE.UnsignedByteType, { linear: true });
  const waterTex = lean && has.water ? bare(dataTex(null, nat.nx, nat.ny, THREE.RGFormat, THREE.UnsignedByteType, { mip: true, aniso: 8, repeat: rep })) : has.water
    ? dataTex(nat.water, nat.nx, nat.ny, THREE.RGFormat, THREE.UnsignedByteType, { mip: true, aniso: 8, repeat: rep })
    : dataTex(new Uint8Array([0, 255]), 1, 1, THREE.RGFormat, THREE.UnsignedByteType, { linear: true });
  const coverTex = has.cover
    ? dataTex(nat.cover, nat.nx, nat.ny, THREE.RGBAFormat, THREE.UnsignedByteType, { mip: true, aniso: 8, repeat: rep })
    : dataTex(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType, { linear: true });

  // 30 m height patches (one R16I atlas plus a normal atlas) and 10 m coast patches (one R8
  // atlas), and the runway flattening rects: v0.6.0, the nearest MAX_PATCHES / MAX_RUNWAYS to
  // the camera (refreshed by nearUpdate() below; heightAt on the CPU keeps them all). With no
  // more than the cap, every one in its own order, as before.
  const allPatches = L.patches || [], allCoast = L.coastPatches || [], allRects = hf.runwayRects || [];
  // With more patches than the cap (the region), the atlases have MAX_PATCHES fixed slots and a
  // patch that comes into the nearest set is uploaded into a free one (slotAtlas below): nothing
  // is rebuilt, so no frame pays for an atlas (the first version rebuilt it: up to 41 ms).
  const dynP = allPatches.length > MAX_PATCHES, dynC = allCoast.length > MAX_PATCHES;
  const patchSel = dynP ? [] : nearest(allPatches, MAX_PATCHES, null, rectDist);
  const coastSel = dynC ? [] : nearest(allCoast, MAX_PATCHES, null, rectDist);
  const rectSel = nearest(allRects, MAX_RUNWAYS, null, rwyDist);
  const slotsP = dynP ? slotAtlas(allPatches, [['h', THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I' }], ['n', THREE.RGFormat, THREE.UnsignedByteType, { linear: true }]]) : null;
  const slotsC = dynC ? slotAtlas(allCoast, [['c', THREE.RedFormat, THREE.UnsignedByteType, { linear: true }]]) : null;
  const P = dynP ? { hTex: slotsP.tex.h, nTex: slotsP.tex.n, ...emptyRects() } : buildPatchAtlas(patchSel, scale);
  const C = dynC ? { tex: slotsC.tex.c, ...emptyRects() } : buildCoastAtlas(coastSel);
  const patchRect = P.rect, patchDim = P.dim, coastRect = C.rect, coastDim = C.dim;
  const patches = patchSel, coast = coastSel, rects = rectSel;
  const patchHTex = P.hTex, patchNTex = P.nTex, coastTex = C.tex;
  const rwyA = [], rwyB = [], rwyC = [];
  for (let k = 0; k < MAX_RUNWAYS; k++) { rwyA.push(new THREE.Vector4()); rwyB.push(new THREE.Vector4()); rwyC.push(new THREE.Vector4()); }
  fillRunways(rects, rwyA, rwyB, rwyC);

  const out = {
    // data
    uHeight: { value: heightTex },
    uNormal: { value: normalTex },
    uWater: { value: waterTex },
    uCover: { value: coverTex },
    uNat: { value: new THREE.Vector4(nat.x0, nat.y0, nat.cell, 0) },
    uNatSize: { value: new THREE.Vector2(has.height ? nat.nx : 1, has.height ? nat.ny : 1) },
    uNatSizeM: { value: new THREE.Vector2(nat.nx * nat.cell, nat.ny * nat.cell) },
    uHasHeight: { value: has.height ? 1 : 0 },
    uHasWater: { value: has.water ? 1 : 0 },
    uHasCover: { value: has.cover ? 1 : 0 },
    uPatchH: { value: patchHTex },
    uPatchN: { value: patchNTex },
    uPatchRect: { value: patchRect },
    uPatchDim: { value: patchDim },
    uPatchCount: { value: patches.length },
    uCoast: { value: coastTex },
    uCoastRect: { value: coastRect },
    uCoastDim: { value: coastDim },
    uCoastCount: { value: coast.length },
    uRwyA: { value: rwyA },
    uRwyB: { value: rwyB },
    uRwyC: { value: rwyC },
    uRwyCount: { value: rects.length },
    // per frame
    uOrigin: { value: new THREE.Vector2() },   // map x, y of the scene origin
    uCamPos: { value: new THREE.Vector3() },   // camera, scene frame
    uCamAlt: { value: 0 },                     // camera altitude MSL (m)
    uCamAgl: { value: 0 },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyAmb: { value: new THREE.Color(0.3, 0.4, 0.5) },
    uPxScale: { value: 1000 },                 // pixels per radian (viewport height / fov)
    // v0.2.0, night: 0 by day, 1 at full night (the sky sets it from the sun's elevation).
    uNight: { value: 0 },
    // The aircraft's landing and taxi lights, for the ground's own shaders (three's lights
    // don't reach them): the lamps' position and beam direction (scene frame), and their
    // strengths (0 off … 1 on). aircraftLights() below turns them into light on a surface.
    uLandPos: { value: new THREE.Vector3() },
    uLandDir: { value: new THREE.Vector3(0, 0, -1) },
    uLandOn: { value: 0 },
    uTaxiOn: { value: 0 },
    // v0.4.0, the weather (sky.setWeather writes these; the defaults are v0.3.2's air, exactly).
    uHazeSigma0: { value: HAZE_SIGMA0 }, uHazeH: { value: HAZE_HEIGHT },   // the haze, sea-level extinction and scale height
    uFogSigma: { value: 0 }, uFogBase: { value: 0 }, uFogTop: { value: 0 },   // a slab of fog or cloud (extinction, base and top m MSL)
    uFogMix: { value: 0 }, uFogColor: { value: new THREE.Vector3() },       // how far the haze's colour goes to the fog's, neutral grey
    uLightCarry: { value: 1 }, uFogLights: { value: 0 },                     // lights carry further than objects; halos in fog
    uSunVis: { value: 1 },                                                   // how much of the disc shows through the cloud
    uWet: { value: 0 }, uSnow: { value: 0 }, uRwySnow: { value: 0 },         // the ground: wet, snow on the land, snow on the runways
  };
  if (cw) attachClip(out, cw, [heightTex, normalTex, waterTex, coverTex]);
  // The nearest patches and runways to the camera: terrain.js calls update() every frame and
  // flush() from a mesh's onBeforeRender (where the renderer is). Only when a list is longer than
  // its cap does anything ever change.
  const sel = { p: patchSel, c: coastSel, r: rectSel, x: NaN, y: NaN };
  const writeSlots = (S, list, rect, dim, count) => {
    for (let k = 0; k < MAX_PATCHES; k++) {
      const p = list[k];
      if (p) { rect[k].set(p.x0, p.y0, p.cell, S.offs[S.slotOf.get(p)]); dim[k].set(p.nx, p.ny, S.w, S.h); }
      else { rect[k].set(1e9, 1e9, 1, 0); dim[k].set(1, 1, 1, 1); }
    }
    count.value = list.length;
  };
  // A slot atlas follows the wanted set: the ones that left are dropped from the uniforms at
  // once; a newcomer gets a free slot, its normals are made a slice a frame (all at once when the
  // camera is nearly on it: a new flight, a jump), its rows are uploaded, and only then is it
  // listed. `all` gives the CPU's order, which the uniforms keep.
  function follow(S, all, want, rect, dim, count, camMap, key) {
    let changed = false;
    const active = sel[key];
    const keep = active.filter((p) => want.includes(p));
    if (keep.length !== active.length) {
      for (const p of active) if (!want.includes(p)) S.free(p);
      sel[key] = keep; changed = true;
      writeSlots(S, keep, rect, dim, count);
    }
    S.pending = S.pending.filter((q) => { if (want.includes(q.p)) return true; S.free(q.p); return false; });
    for (const p of want) {
      if (sel[key].includes(p) || S.pending.some((q) => q.p === p)) continue;
      if (!S.take(p)) {
        // No free slot tall enough (the slots are the tallest patches' sizes, so a fresh
        // assignment always fits): start again with the wanted set, tallest first.
        for (const q of sel[key]) S.free(q);
        for (const q of S.pending) S.free(q.p);
        sel[key] = []; S.pending = []; changed = true;
        writeSlots(S, [], rect, dim, count);
        for (const q of want.slice().sort((a, b) => b.ny - a.ny)) { S.take(q); S.pending.push({ p: q, row: 0, up: 0 }); }
        break;
      }
      S.pending.push({ p, row: 0, up: 0 });
    }
    // The normals of the first one waiting (the 30 m patches only), in slices.
    const q = S.pending[0];
    if (q && S.tex.n && q.row < q.p.ny) {
      const p = q.p, near = rectDist(p, camMap) < 30000;
      if (!p._normal) p._normal = new Uint8Array(p.nx * p.ny * 2);
      const j1 = near ? p.ny : Math.min(p.ny, q.row + Math.max(8, Math.floor(130000 / p.nx)));
      normalsRows(p.height, p.nx, p.ny, p.cell, scale, p._normal, q.row, j1);
      q.row = j1;
    }
    return changed;
  }
  // Upload the first waiting patch's layers (one layer a frame; all of them when it is near),
  // then list it. Returns true when the uniforms changed.
  function upload(S, all, rect, dim, count, key, renderer, camMap) {
    const q = S.pending[0];
    if (!q || (S.tex.n && q.row < q.p.ny)) return false;
    const p = q.p, layers = Object.keys(S.tex), near = camMap && rectDist(p, camMap) < 30000;
    do {
      const name = layers[q.up], t = S.tex[name];
      const data = name === 'h' ? p.height : name === 'n' ? p._normal : p.coast;
      const src = new THREE.DataTexture(data, p.nx, p.ny, t.format, t.type);
      src.unpackAlignment = 1;
      renderer.copyTextureToTexture(src, t, null, _at.set(0, S.offs[S.slotOf.get(p)]));
      src.dispose();
      q.up++;
    } while (near && q.up < layers.length);
    if (q.up < layers.length) return false;
    S.pending.shift();
    sel[key] = all.filter((e) => e === p || sel[key].includes(e));
    writeSlots(S, sel[key], rect, dim, count);
    return true;
  }
  const near = {
    update(camMap) {
      // The slot atlases' waiting work goes on every frame; the wanted sets after 2 km.
      const moved = !(Math.abs(camMap.x - sel.x) < 2000 && Math.abs(camMap.y - sel.y) < 2000);
      let changed = false;
      if (dynP && (moved || slotsP.pending.length)) changed = follow(slotsP, allPatches, moved ? (slotsP.want = nearest(allPatches, MAX_PATCHES, camMap, rectDist)) : slotsP.want, patchRect, patchDim, out.uPatchCount, camMap, 'p') || changed;
      if (dynC && (moved || slotsC.pending.length)) changed = follow(slotsC, allCoast, moved ? (slotsC.want = nearest(allCoast, MAX_PATCHES, camMap, rectDist)) : slotsC.want, coastRect, coastDim, out.uCoastCount, camMap, 'c') || changed;
      near.cam = camMap;
      if (!moved) return changed;
      sel.x = camMap.x; sel.y = camMap.y;
      if (allRects.length > MAX_RUNWAYS) {
        const s2 = nearest(allRects, MAX_RUNWAYS, camMap, rwyDist);
        if (!sameList(s2, sel.r)) { sel.r = s2; changed = true; fillRunways(s2, rwyA, rwyB, rwyC); out.uRwyCount.value = s2.length; }
      }
      return changed;
    },
    flush(renderer) {
      let changed = false;
      if (dynP) changed = upload(slotsP, allPatches, patchRect, patchDim, out.uPatchCount, 'p', renderer, near.cam) || changed;
      if (dynC) changed = upload(slotsC, allCoast, coastRect, coastDim, out.uCoastCount, 'c', renderer, near.cam) || changed;
      return changed;
    },
    get pending() { return (dynP ? slotsP.pending.length : 0) + (dynC ? slotsC.pending.length : 0); },
    get selection() { return { patches: sel.p, coast: sel.c, runways: sel.r }; },
  };
  Object.defineProperty(out, '__near', { value: near, enumerable: false });
  // The highest ground in the data the GPU holds (m), for the clipmap's horizon cull (PEAK).
  const patchPeak = highest(null, allPatches, scale);
  Object.defineProperty(out, '__peak', { value: { m: Math.max(patchPeak, lean ? -Infinity : highest(nat.height, [], scale)), patches: patchPeak, scale }, enumerable: false });
  return out;
}

// Up to n of list nearest to cam (by dist), in the list's own order (the CPU's order: the
// patches blend and the runways rank in it). With no more than n, or no camera, the first n.
export function nearest(list, n, cam, dist) {
  if (list.length <= n || !cam) return list.slice(0, n);
  const idx = list.map((e, i) => [dist(e, cam), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, n).map((e) => e[1]).sort((a, b) => a - b);
  return idx.map((i) => list[i]);
}
const sameList = (a, b) => a.length === b.length && a.every((e, i) => e === b[i]);
// Distance (m) from cam to a patch's rectangle, and to a runway's flattening rect.
function rectDist(p, cam) {
  const dx = Math.max(p.x0 - cam.x, 0, cam.x - (p.x0 + p.nx * p.cell)), dy = Math.max(p.y0 - cam.y, 0, cam.y - (p.y0 + p.ny * p.cell));
  return Math.hypot(dx, dy);
}
function rwyDist(r, cam) {
  const dx = cam.x - r.cx, dy = cam.y - r.cy, u = dx * r.dx + dy * r.dy, v = -dx * r.dy + dy * r.dx;
  return Math.hypot(Math.max(Math.abs(u) - r.halfLen, 0), Math.max(Math.abs(v) - r.halfWid, 0));
}
function highest(h, patches, scale) {
  let m = -Infinity;
  if (!h && !patches.length) return -Infinity;
  if (h) for (let k = 0; k < h.length; k++) if (h[k] > m) m = h[k];
  for (const p of patches) if (p.height) for (let k = 0; k < p.height.length; k++) if (p.height[k] > m) m = p.height[k];
  return m === -Infinity ? -Infinity : m * scale;
}

const _at = new THREE.Vector2();
const emptyRects = () => {
  const rect = [], dim = [];
  for (let k = 0; k < MAX_PATCHES; k++) { rect.push(new THREE.Vector4(1e9, 1e9, 1, 0)); dim.push(new THREE.Vector4(1, 1, 1, 1)); }
  return { rect, dim };
};

// An atlas of MAX_PATCHES fixed slots, stacked like atlasLayout()'s rows: the slots are as wide
// as the widest grid of the list and as tall as its MAX_PATCHES tallest, so any set of that many
// fits (the k-th tallest of a set is never taller than the k-th tallest of all). The textures
// are allocated without data (zeroed by WebGL) and filled a patch at a time by
// renderer.copyTextureToTexture from the patch's own arrays: no CPU copy of the atlas.
function slotAtlas(all, layers) {
  const cap = all.map((p) => p.ny).sort((a, b) => b - a).slice(0, MAX_PATCHES);
  const w = Math.max(...all.map((p) => p.nx));
  const offs = [];
  let rows = 0;
  for (const c of cap) { offs.push(rows); rows += c + 2; }
  const tex = {};
  for (const [name, format, type, opts] of layers) {
    const t = dataTex(null, w, rows, format, type, opts);
    t.source.dataReady = false;          // storage only: the slots come by copyTextureToTexture
    tex[name] = t;
  }
  const used = cap.map(() => null), slotOf = new Map();
  return {
    w, h: rows, offs, cap, tex, used, slotOf, pending: [], want: [],
    // The smallest free slot that holds p; false when none does.
    take(p) {
      let best = -1;
      for (let k = 0; k < cap.length; k++) if (!used[k] && cap[k] >= p.ny && (best < 0 || cap[k] < cap[best])) best = k;
      if (best < 0) return false;
      used[best] = p; slotOf.set(p, best);
      return true;
    },
    free(p) { const k = slotOf.get(p); if (k !== undefined) { used[k] = null; slotOf.delete(p); } },
  };
}

// normalsRG() for rows [j0, j1) of a grid (the same arithmetic), into out at the grid's own rows.
export function normalsRows(h, nx, ny, cell, scale, out, j0, j1) {
  const k = scale / (2 * cell);
  for (let j = j0; j < j1; j++) {
    const jm = j > 0 ? j - 1 : 0, jp = j < ny - 1 ? j + 1 : ny - 1;
    for (let i = 0; i < nx; i++) {
      const im = i > 0 ? i - 1 : 0, ip = i < nx - 1 ? i + 1 : nx - 1;
      let a = h[j * nx + im], b = h[j * nx + ip], c = h[jm * nx + i], d = h[jp * nx + i];
      if (a < 0) a = 0; if (b < 0) b = 0; if (c < 0) c = 0; if (d < 0) d = 0;
      const gx = (b - a) * k, gy = (d - c) * k;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const o = (j * nx + i) * 2;
      out[o] = Math.round(128 - 127 * gx * inv);
      out[o + 1] = Math.round(128 - 127 * gy * inv);
    }
  }
  return out;
}

function buildPatchAtlas(patches, scale) {
  const pl = atlasLayout(patches);
  const pH = new Int16Array(pl.w * pl.h), pN = new Uint8Array(pl.w * pl.h * 2).fill(128);
  const rect = [], dim = [];
  patches.forEach((p, k) => {
    for (let j = 0; j < p.ny; j++) pH.set(p.height.subarray(j * p.nx, (j + 1) * p.nx), (pl.offs[k] + j) * pl.w);
    const n = normalsRG(p.height, p.nx, p.ny, p.cell, scale);
    for (let j = 0; j < p.ny; j++) pN.set(n.subarray(j * p.nx * 2, (j + 1) * p.nx * 2), (pl.offs[k] + j) * pl.w * 2);
    rect.push(new THREE.Vector4(p.x0, p.y0, p.cell, pl.offs[k]));
    dim.push(new THREE.Vector4(p.nx, p.ny, pl.w, pl.h));
  });
  while (rect.length < MAX_PATCHES) { rect.push(new THREE.Vector4(1e9, 1e9, 1, 0)); dim.push(new THREE.Vector4(1, 1, 1, 1)); }
  const hTex = dataTex(pH, pl.w, pl.h, THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I' });
  const nTex = dataTex(pN, pl.w, pl.h, THREE.RGFormat, THREE.UnsignedByteType, { linear: true });
  return { hTex, nTex, rect, dim };
}

function buildCoastAtlas(coast) {
  const cl = atlasLayout(coast);
  const cA = new Uint8Array(cl.w * cl.h).fill(255);
  const rect = [], dim = [];
  coast.forEach((p, k) => {
    for (let j = 0; j < p.ny; j++) cA.set(p.coast.subarray(j * p.nx, (j + 1) * p.nx), (cl.offs[k] + j) * cl.w);
    rect.push(new THREE.Vector4(p.x0, p.y0, p.cell, cl.offs[k]));
    dim.push(new THREE.Vector4(p.nx, p.ny, cl.w, cl.h));
  });
  while (rect.length < MAX_PATCHES) { rect.push(new THREE.Vector4(1e9, 1e9, 1, 0)); dim.push(new THREE.Vector4(1, 1, 1, 1)); }
  const tex = dataTex(cA, cl.w, cl.h, THREE.RedFormat, THREE.UnsignedByteType, { linear: true });
  return { tex, rect, dim };
}

// Runway flattening rects (the same list heightAt uses, in rank order, as heightAt runs them).
// rwyC: a runway's two bends where it meets a longer one. Writes the uniforms' vectors in place.
function fillRunways(rects, rwyA, rwyB, rwyC) {
  for (let k = 0; k < MAX_RUNWAYS; k++) {
    const r = rects[k];
    if (!r) { rwyA[k].set(1e9, 1e9, 1, 0); rwyB[k].set(0, 0, 0, 0); rwyC[k].set(1e9, 0, 1e9, 0); continue; }
    rwyA[k].set(r.cx, r.cy, r.dx, r.dy);
    rwyB[k].set(r.halfLen, r.halfWid, r.e0, r.e1);
    const kn = r.knots || [], k1 = kn[kn.length > 1 ? 1 : 0];
    if (kn.length) rwyC[k].set(kn[0][0], kn[0][1], k1[0], k1[1]); else rwyC[k].set(1e9, 0, 1e9, 0);
  }
}

// The clip window's uniforms and its refill (terrain.js calls update() every frame and flush()
// from the fill mesh's onBeforeRender, where it has the renderer). uNatExt: the window ∩ the
// extent in cells from uNat's origin (lo.xy, hi.xy inclusive), where the heights clamp;
// uNatExtUv: the same in natUv() units (its cells' outer edges), outside which the ground is
// open sea, as natUv() outside 0..1 was (over Korea exactly 0 and 1); uNatMask: the texel
// index mask (−1 when the window is the extent, N − 1 when toroidal). Korea fits, so they are
// fixed and nothing refills.
function attachClip(u, cw, texs) {
  const ext = { lo: null };
  const W = cw.win;
  const setExt = (v) => {
    u.uNatExt.value.set(v[0] - W.bi, v[1] - W.bj, v[2] - 1 - W.bi, v[3] - 1 - W.bj);
    u.uNatExtUv.value.set((v[0] - W.bi) / cw.nx, (v[1] - W.bj) / cw.ny, (v[2] - W.bi) / cw.nx, (v[3] - W.bj) / cw.ny);
  };
  u.uNatExt = { value: new THREE.Vector4() };
  u.uNatExtUv = { value: new THREE.Vector4() };
  u.uNatMask = { value: W.mask };
  setExt(cw.valid());
  // Staging textures over the CPU mirrors: never uploaded themselves, copyTextureToTexture
  // texSubImages a rectangle of them (UNPACK_ROW_LENGTH N) and regenerates the mips.
  // A lean window: the heights, normals and water come from its one-block scratch instead.
  const scratch = cw.lean ? [cw.h, cw.n, cw.w, null] : null;
  const staging = texs.map((t, k) => {
    const s = scratch && scratch[k] ? new THREE.DataTexture(scratch[k], cw.tile, cw.tile, t.format, t.type) : new THREE.DataTexture(t.image.data, cw.nx, cw.ny, t.format, t.type);
    s.unpackAlignment = 1;
    return s;
  });
  const box = new THREE.Box2(), at = new THREE.Vector2();
  const clip = {
    window: cw, renderer: null,
    uploadsDone: 0,
    // Camera's map position: move the window if it must, and fill at most one block (a tile's
    // cells); while nothing round the camera is valid yet (a new flight, a jump), up to nine.
    update(camMap) {
      if (cw.fit) return;
      cw.moveTo(camMap.x, camMap.y);
      let v = cw.valid();
      const catching = v[2] - v[0] <= 0 || v[3] - v[1] <= 0;
      // (Lean: a block must be on the GPU before the next is filled, so several a frame only
      // once the renderer is known, each flushed as it comes.)
      if (cw.lean && cw.uploads.length) { if (!clip.renderer) return; clip.flush(clip.renderer); }
      let n = catching && (!cw.lean || clip.renderer) ? 9 : 1, did = false;
      // (A 1 km block comes in strips, a strip a step: one step a frame in flight; whole blocks,
      // however many strips, only while catching up.)
      for (let r, guard = 0; n > 0 && guard < 80 && (r = cw.step()); guard++) { did = true; if (r.length || !catching) n--; if (cw.lean && r.length && n > 0) clip.flush(clip.renderer); }
      if (did) v = cw.valid();
      if (!ext.lo || v[0] !== ext.lo[0] || v[1] !== ext.lo[1] || v[2] !== ext.lo[2] || v[3] !== ext.lo[3]) {
        setExt(v); ext.lo = v;
        const pk = u.__peak, top = cw.peak();
        if (pk) pk.m = Math.max(pk.patches, top);
      }
    },
    flush(renderer) {
      clip.renderer = renderer;
      if (!cw.uploads.length) return;
      for (const r of cw.uploads) {
        box.min.set(r.x, r.y); box.max.set(r.x + r.w, r.y + r.h); at.set(r.x, r.y);
        for (let k = 0; k < texs.length; k++) {
          if (texs[k].image.width !== cw.nx) continue;
          if (scratch && scratch[k]) renderer.copyTextureToTexture(staging[k], texs[k], null, at);   // the block's scratch, whole
          else renderer.copyTextureToTexture(staging[k], texs[k], box, at);
        }
        clip.uploadsDone++;
      }
      cw.uploads.length = 0;
    },
  };
  ext.lo = cw.valid();
  Object.defineProperty(u, '__clip', { value: clip, enumerable: false });
}

// ------------------------------------------------------------------ GLSL

// Uniform declarations shared by every world shader.
export const UNIFORMS_GLSL = /* glsl */ `
uniform highp isampler2D uHeight;
uniform sampler2D uNormal, uWater, uCover, uPatchN, uCoast;
uniform highp isampler2D uPatchH;
uniform vec4 uNat;
uniform vec2 uNatSize, uNatSizeM;
${CLIP_WINDOW ? 'uniform vec4 uNatExt, uNatExtUv;\nuniform int uNatMask;' : ''}
uniform float uHasHeight, uHasWater, uHasCover;
uniform vec4 uPatchRect[${MAX_PATCHES}], uPatchDim[${MAX_PATCHES}];
uniform int uPatchCount;
uniform vec4 uCoastRect[${MAX_PATCHES}], uCoastDim[${MAX_PATCHES}];
uniform int uCoastCount;
uniform vec4 uRwyA[${MAX_RUNWAYS}], uRwyB[${MAX_RUNWAYS}], uRwyC[${MAX_RUNWAYS}];
uniform int uRwyCount;
uniform vec2 uOrigin;
uniform vec3 uCamPos;
uniform float uCamAlt, uCamAgl, uTime, uPxScale;
uniform vec3 uSunDir, uSunColor, uSkyAmb;
uniform float uNight;
uniform vec3 uLandPos, uLandDir;
uniform float uLandOn, uTaxiOn;
uniform float uHazeSigma0, uHazeH, uFogSigma, uFogBase, uFogTop, uFogMix, uLightCarry, uFogLights, uSunVis, uWet, uSnow, uRwySnow;
uniform vec3 uFogColor;

// The fog or cloud slab's optical depth along the ray from the camera to rel (0 with no slab: one branch in clear air).
float fogDepth(vec3 rel, float dist) {
  if (uFogSigma <= 0.0) return 0.0;
  float h0 = uCamAlt, h1 = h0 + rel.y, lo = min(h0, h1), hi = max(h0, h1);
  float inside = hi - lo < 0.5 ? step(uFogBase, lo) * step(lo, uFogTop)
                               : clamp((min(hi, uFogTop) - max(lo, uFogBase)) / (hi - lo), 0.0, 1.0);
  return uFogSigma * dist * inside;
}
`;

// The aircraft's landing and taxi lights on a surface at scene position p with normal n: the
// light to add (multiply by the albedo). Landing lights: a narrow beam (about ±10°) reaching
// ~600 m; taxi light: a wide beam (about ±30°) reaching ~150 m. Needs UNIFORMS_GLSL.
export const AIRCRAFT_LIGHTS_GLSL = /* glsl */ `
vec3 aircraftLights(vec3 p, vec3 n) {
  if (uLandOn + uTaxiOn < 0.001) return vec3(0.0);
  vec3 d = p - uLandPos;
  float r = length(d);
  if (r > 900.0 || r < 0.5) return vec3(0.0);
  vec3 l = d / r;
  float cosA = dot(l, uLandDir);
  float facing = max(dot(-l, n), 0.0);
  float land = uLandOn * smoothstep(0.975, 0.995, cosA) * 2.2e5 / (r * r + 400.0);
  float taxi = uTaxiOn * smoothstep(0.82, 0.93, cosA) * 2.5e4 / (r * r + 100.0);
  return vec3(1.0, 0.95, 0.86) * min(land + taxi, 6.0) * facing;
}
`;

// Hashes and value noise (deterministic: the same everywhere, every run).
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// Integer-lattice hashes: exact for cells far from the map origin.
float ihash(ivec2 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h & 0xffffffu) / 16777216.0;
}
float ihash(ivec2 c, uint s) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + s * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h & 0xffffffu) / 16777216.0;
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) {
  return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 17.1) + 0.2 * vnoise(p * 4.11 + 41.7);
}
`;

// Heights, exactly as heightfield.js computes them (bilinear, patches, runway flattening).
export const HEIGHT_GLSL = /* glsl */ `
const float H_SCALE = 0.25;
const float EARTH_R = ${f(EARTH_RADIUS)};

float bilinI(highp isampler2D t, vec2 fxy, vec2 lo, vec2 hi) {
  fxy = clamp(fxy, lo, hi);
  vec2 i = min(floor(fxy), hi - 1.0);
  i = max(i, lo);
  vec2 tt = fxy - i;
  ivec2 p = ivec2(i);
  float a = float(texelFetch(t, p, 0).r), b = float(texelFetch(t, p + ivec2(1, 0), 0).r);
  float c = float(texelFetch(t, p + ivec2(0, 1), 0).r), d = float(texelFetch(t, p + ivec2(1, 1), 0).r);
  float ab = a + (b - a) * tt.x;
  return ab + ((c + (d - c) * tt.x) - ab) * tt.y;
}

${CLIP_WINDOW ? `
// The clip window's heights: bilinI's arithmetic, each cell at its texel (& uNatMask: wrapped when toroidal).
float bilinWin(vec2 fxy, vec2 lo, vec2 hi) {
  fxy = clamp(fxy, lo, hi);
  vec2 i = min(floor(fxy), hi - 1.0);
  i = max(i, lo);
  vec2 tt = fxy - i;
  ivec2 p = ivec2(i), M = ivec2(uNatMask);
  float a = float(texelFetch(uHeight, p & M, 0).r), b = float(texelFetch(uHeight, (p + ivec2(1, 0)) & M, 0).r);
  float c = float(texelFetch(uHeight, (p + ivec2(0, 1)) & M, 0).r), d = float(texelFetch(uHeight, (p + ivec2(1, 1)) & M, 0).r);
  float ab = a + (b - a) * tt.x;
  return ab + ((c + (d - c) * tt.x) - ab) * tt.y;
}
` : ''}
float patchWeight(vec4 r, vec4 dim, vec2 m) {
  vec2 lo = m - r.xy, hi = r.xy + dim.xy * r.z - m;
  float e = min(min(lo.x, hi.x), min(lo.y, hi.y)) - r.z;
  return smoothstep(0.0, ${f(PATCH_BLEND)}, e);
}

// Raw data height (m, may be negative over the sea) and the patch weight it used.
float rawHeight(vec2 m, out float pw) {
  float h = 0.0;
  pw = 0.0;
  if (uHasHeight > 0.5) {
    vec2 fxy = (m - uNat.xy) / uNat.z - 0.5;
    h = ${CLIP_WINDOW ? 'bilinWin(fxy, uNatExt.xy, uNatExt.zw)' : 'bilinI(uHeight, fxy, vec2(0.0), uNatSize - 1.0)'} * H_SCALE;
  } else {
    h = -20.0;
  }
  for (int k = 0; k < ${MAX_PATCHES}; k++) {
    if (k >= uPatchCount) break;
    vec4 r = uPatchRect[k], dim = uPatchDim[k];
    float w = patchWeight(r, dim, m);
    if (w <= 0.0) continue;
    vec2 fxy = (m - r.xy) / r.z - 0.5;
    fxy.y += r.w;
    float hp = bilinI(uPatchH, fxy, vec2(0.0, r.w), vec2(dim.x - 1.0, r.w + dim.y - 1.0)) * H_SCALE;
    h += (hp - h) * w;
    pw = max(pw, w);
  }
  return h;
}

// A runway's surface height at u metres along from its centre: straight between its ends, or
// through two bends (kn: u, h, u, h; u >= 1e8 when it has none) where it meets a longer runway.
float rwyElev(float u, vec4 b, vec4 kn) {
  if (kn.x > 1e8) return mix(b.z, b.w, clamp((u + b.x) / (2.0 * b.x), 0.0, 1.0));
  if (u < kn.x) return mix(b.z, kn.y, clamp((u + b.x) / max(kn.x + b.x, 1e-3), 0.0, 1.0));
  if (u < kn.z) return mix(kn.y, kn.w, (u - kn.x) / max(kn.z - kn.x, 1e-3));
  return mix(kn.w, b.w, clamp((u - kn.z) / max(b.x - kn.z, 1e-3), 0.0, 1.0));
}

// Runway flattening, as heightAt in heightfield.js: on a runway's pavement the ground is that
// runway's surface (the longer one's where two cross: the uniforms run by rank); off the
// pavements the nearby runways' surfaces blend by distance. zone: how much of the point is in
// a runway's flat zone (0..1).
float flattenRunways(vec2 m, float h, out float zone) {
  zone = 0.0;
  float num = 0.0, den = 0.0, pav = 0.0, onPav = 0.0;
  for (int k = 0; k < ${MAX_RUNWAYS}; k++) {
    if (k >= uRwyCount) break;
    vec4 a = uRwyA[k], b = uRwyB[k];
    vec2 d = m - a.xy;
    float u = dot(d, a.zw), v = -d.x * a.w + d.y * a.z;
    float du = abs(u) - (b.x + ${f(FLAT_MARGIN_U)}), dv = abs(v) - (b.y + ${f(FLAT_MARGIN_V)});
    float w = 1.0 - smoothstep(0.0, ${f(FLAT_BLEND)}, max(du, dv));
    // smoothstep(0,B,x) on CPU is 1-t*t*(3-2t) with t=1-x/B; the same curve.
    if (w <= 0.0) continue;
    float e = rwyElev(u, b, uRwyC[k]);
    float c = length(max(vec2(abs(u) - b.x, abs(v) - b.y - ${f(RUNWAY_SHOULDER_M)}), 0.0));
    if (c <= 0.0) { onPav = 1.0; pav = e; }
    float kk = w * exp(-c / ${f(PAVE_BLEND_M)});
    num += kk * e; den += kk;
    zone = max(zone, w);
  }
  if (den > 0.0) h += ((onPav > 0.5 ? pav : num / den) - h) * zone;
  return h;
}

float terrainHeight(vec2 m) {
  float pw, zone;
  float h = flattenRunways(m, rawHeight(m, pw), zone);
  return max(h, 0.0);
}

vec2 natUv(vec2 m) { return (m - uNat.xy) / uNatSizeM; }
// Outside the baked data (open sea): beyond the national texture's 0..1, or with the clip
// window beyond the extent ∩ the window.
bool natOutside(vec2 m) {
${CLIP_WINDOW ? '  vec2 uv = natUv(m);\n  return any(lessThan(uv, uNatExtUv.xy)) || any(greaterThan(uv, uNatExtUv.zw));'
  : '  vec2 uv = natUv(m);\n  return any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));'}
}

// Signed distance to the sea coast (m, + on land): 10 m patches near the airports win.
// The field must stay continuous: the shaders antialias the coast and the beach with
// fwidth(), so any jump (the patch's edge, or where its 8-bit range saturates at ±254 m)
// would draw a thin dashed line. So the patch fades into the national field over its
// outer 300 m, and where it saturates it hands over smoothly (keeping its own sign).
// The national water distances (R: sea, G: inland, m), sampled with Catmull-Rom (9 bilinear
// taps) instead of plain bilinear, so the shorelines and river banks drawn from the 250 m
// grid curve smoothly instead of running in straight, kinked segments. Catmull-Rom passes
// through the data values, so one-cell lakes keep their size.
vec2 waterField(vec2 m) {
  vec2 sz = uNatSize;
  vec2 sp = natUv(m) * sz;
  vec2 p1 = floor(sp - 0.5) + 0.5, f = sp - p1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (p1 - 1.0) / sz, t3 = (p1 + 2.0) / sz, t12 = (p1 + w2 / w12) / sz;
  vec2 v = (texture(uWater, vec2(t0.x, t0.y)).rg * w0.x + texture(uWater, vec2(t12.x, t0.y)).rg * w12.x + texture(uWater, vec2(t3.x, t0.y)).rg * w3.x) * w0.y
         + (texture(uWater, vec2(t0.x, t12.y)).rg * w0.x + texture(uWater, vec2(t12.x, t12.y)).rg * w12.x + texture(uWater, vec2(t3.x, t12.y)).rg * w3.x) * w12.y
         + (texture(uWater, vec2(t0.x, t3.y)).rg * w0.x + texture(uWater, vec2(t12.x, t3.y)).rg * w12.x + texture(uWater, vec2(t3.x, t3.y)).rg * w3.x) * w3.y;
  return (v * 255.0 - 128.0) * 20.0;
}

float seaDistance(vec2 m, float rawH) {
  float dn = uHasWater > 0.5 ? waterField(m).r : rawH * 20.0;
  for (int k = 0; k < ${MAX_PATCHES}; k++) {
    if (k >= uCoastCount) break;
    vec4 r = uCoastRect[k], dim = uCoastDim[k];
    vec2 fxy = (m - r.xy) / r.z;
    float e = min(min(fxy.x, fxy.y), min(dim.x - fxy.x, dim.y - fxy.y)) - 1.0;   // cells to the edge
    if (e <= 0.0) continue;
    vec2 uv = vec2(fxy.x, fxy.y + r.w) / dim.zw;
    float dp = (texture(uCoast, uv).r * 255.0 - 128.0) * 2.0;
    float sg = dp < 0.0 ? -1.0 : 1.0;
    float far = sg * max(abs(dp), sg * dn);          // the national value, on the patch's side
    float d = mix(dp, far, smoothstep(190.0, 250.0, abs(dp)));
    return mix(dn, d, smoothstep(0.0, 30.0, e));
  }
  return dn;
}
float inlandDistance(vec2 m) {
  if (uHasWater < 0.5) return 2560.0;
  return waterField(m).g;
}

// Earth's curvature: how far a point at horizontal offset rel (from the camera) drops.
float curveDrop(vec2 rel) { return dot(rel, rel) / (2.0 * EARTH_R); }

// Map position of a scene position.
vec2 sceneToMap(vec3 p) { return uOrigin + vec2(p.x, -p.z); }
`;
