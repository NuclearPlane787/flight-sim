// The prediction worker (module worker). One job at a time: a new request replaces the
// old one, which is dropped at its next chunk boundary. Between jobs it does nothing (it
// only wakes on a message). Each job is capped at ~2 s of CPU.
//
// The terrain: the first request starts loading the heights (national grid + the 30 m
// patches + the runway flattening; no water or cover layers, ~33 MB in all) and waits for
// them at most WAIT_MS (they usually take a few hundred ms). Until they're in, or if they
// fail, the path runs over flat sea level; when they arrive while the latest result was
// computed flat, that request is run again (a second result for the same id).

import { createPredictionRun, tilesForChunk, tilesForSnap } from './predict-core.js';
import { createHeightfield, createTiledHeightfield, fetchGz, fetchJson } from '../world/heightfield.js';
import { loadLocalRules, setGeoRules, geoRules } from '../world/region.js';

const CHUNK = 3000;          // steps between checks for a newer request (~15–30 ms)
const BUDGET_MS = 2000;
const WAIT_MS = 1500;        // the longest a request waits for the terrain to load
const DATA = new URL('../../data/', import.meta.url).href;
let current = 0;
let hf = null;               // the heightfield once loaded
let loading = null;          // its load promise (started once)
let loaded = false;          // the load has finished (with or without the terrain)
let last = null;             // the latest request: { id, snap, opts, flat }
// v0.6.0: the local rules (magVar's WMM, the country), as the page installs them: with the region
// on, no run starts before they are in (a run on the plane would put jumps off the live path);
// with it off this is null and nothing waits.
let rules = loadLocalRules(DATA);
let mine;                    // the rules this worker loaded (null: none), kept to put back

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'cancel') { current = m.id; return; }
  if (m.type !== 'request') return;
  current = m.id;
  if (!loading) loading = loadTerrain().finally(() => { loaded = true; });
  if (!loaded) {
    await Promise.race([loading, new Promise((r) => setTimeout(r, WAIT_MS))]);
    if (current !== m.id) return; // superseded while waiting
  }
  last = { id: m.id, snap: m.snap, opts: m.opts || {}, flat: !hf, rules: m.rules };
  runJob(last);
};

// Heights only (the predictor needs h, and 'water' is h = 0): the same layers and the same
// sampling as the page's heightfield, without its 60 MB of water and cover grids.
async function loadTerrain() {
  try {
    const url = (rel) => new URL(rel, DATA).href;
    const man = await fetchJson(url('manifest.json'));
    // v0.6.0: the heights from the tiles (the same doubles as the national grid's), every tile
    // in the extent for now; the region's loader will fetch the tiles each chunk reaches.
    if (man && man.tiles) {
      // The tiles come as the runs reach them (tilesForChunk); the patches and runways at once.
      hf = await createTiledHeightfield(man, DATA, { layers: ['h'], coasts: false, maxTiles: 48 });
      if (last && last.flat && current === last.id) { last.flat = false; runJob(last); }
      return;
    }
    const nat = man && man.national;
    if (!nat || !nat.height) return;
    const [hb, airports, ...pb] = await Promise.all([
      fetchGz(url(nat.height)),
      Promise.all((man.airports || []).map((f) => fetchJson(url(f)))),
      ...(man.patches || []).map((p) => fetchGz(url(p.height))),
    ]);
    if (!hb || hb.byteLength !== nat.nx * nat.ny * 2) return;
    const patches = [];
    (man.patches || []).forEach((p, k) => {
      const b = pb[k];
      if (b && b.byteLength === p.nx * p.ny * 2) patches.push({ id: p.id, x0: p.x0, y0: p.y0, cell: p.cell, nx: p.nx, ny: p.ny, height: new Int16Array(b) });
    });
    patches.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    hf = createHeightfield({
      heightScale: man.heightScale || 0.25,
      national: { x0: nat.x0, y0: nat.y0, cell: nat.cell, nx: nat.nx, ny: nat.ny, height: new Int16Array(hb), water: null, cover: null },
      patches, coastPatches: [],
    }, { airports: airports.filter(Boolean) });
  } catch (e) {
    hf = null; // stay on flat ground
    return;
  }
  // The latest path was computed flat: redo it over the terrain (same id, so it replaces it).
  if (last && last.flat && current === last.id) { last.flat = false; runJob(last); }
}

async function runJob(job) {
  const { id, snap, opts } = job;
  const ground = hf;
  if (rules) { await rules; rules = null; if (current !== id) return; }
  // v0.6.0: the same rules as the page (its message says whether it has them). The page without
  // them: this run on the plane and Korea's rules too. The page with them and this worker
  // without: load them again, and with no luck no path at all (a path on other rules would put
  // a jump off the live flight).
  if (job.rules !== undefined) {
    if (mine === undefined) mine = geoRules();
    if (job.rules && !mine) {
      mine = (await loadLocalRules(DATA)) || null;
      if (current !== id) return;
      if (!mine) { self.postMessage({ type: 'error', id, message: 'the local rules did not load in the prediction worker' }); return; }
    }
    const want = job.rules ? mine : null;
    if (geoRules() !== want) setGeoRules(want);
  }
  const first = tilesForSnap(snap, ground);   // v0.6.0: the start's tiles (not the run's CPU)
  if (first) { await first; if (current !== id) return; }
  let run;
  try { run = createPredictionRun(snap, opts, ground); }
  catch (e) { self.postMessage({ type: 'error', id, message: String(e) }); return; }
  let cpu = 0;
  while (true) {
    // v0.6.0: wait (outside the CPU budget) for the tiles this chunk can reach.
    const wait = ground && tilesForChunk(run, ground, CHUNK);
    if (wait) { await wait; if (current !== id) return; }
    const t0 = performance.now();
    let done;
    try { done = run.advance(CHUNK); }
    catch (e) { self.postMessage({ type: 'error', id, message: String(e) }); return; } // never leave the caller busy
    cpu += performance.now() - t0;
    if (done) break;
    if (cpu > BUDGET_MS) { run.reason = 'budget'; break; }
    // Let a newer request or a cancel in (a macrotask, not a busy wait).
    await new Promise((r) => setTimeout(r, 0));
    if (current !== id) return;
    if (ground !== hf && !ground) return; // the terrain arrived: the rerun replaces this one
  }
  if (current !== id) return;
  self.postMessage({ type: 'result', id, samples: run.samples, reason: run.reason, cpuMs: Math.round(cpu), terrain: !!ground });
}
