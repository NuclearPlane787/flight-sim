# Flight Sim: status log

The newest entry goes at the bottom. Each checkpoint has:

- the time from `date`;
- what was done;
- how it was verified (commands and results, screenshot names);
- what's next.

Decisions made without Shane go in the last section, each with its reason.

## 2026-10-31, 02:30 KST: planned, nothing built (Cowork session)

- **The plan is settled,** and `PLAN.md` holds every decision. Shane's last answers (2026-10-31):
  - Real elevation: "Elevation isn't procedural but the rest are. I think as a rule of thumb, have macro-scale details be determined, and finer details are procedural."
  - Views: a first-person view from the nose and a third-person orbit view, as well as the two seats.
  - The livery: "a mix of green and blue with hazard stripes".
  - Flaps on 6, 7, 8, 9 and 0.
- **CPU rules** (Shane): "have a count cap and a time cap for 100% CPU core scripts". They're built as `tools/cpu-guard.py`: 2 heavy commands at once, 20 minutes each, stopped together with everything they started.
  - Tested in the cloud container (Linux, Python 3): exit codes passed through, the time cap stopped a busy loop with its children, leftovers were stopped after a normal exit, a third job waited for a slot, a slot left by a killed guard was reclaimed (its orphan stopped), SIGTERM to the guard was handled, and `--status` and `--sweep` worked.
  - Not yet run on macOS: the first check tonight is in `AGENTS.md`.
- **In the folder:** `AGENTS.md`, `PLAN.md`, `STATUS.md`, `ROADMAP.md`, `.gitignore` and `tools/cpu-guard.py`. No game code yet.
- **Data:** Shane may or may not have run the download commands; check `reference/raw/`.
- **Next:** the overnight Claude Code run (see `AGENTS.md`), with a deadline of 11:00 KST.

## Interfaces agreed

Written 03:27 KST by the lead agent, before the subagents started. Changes go through the lead.

### Frames and units

- **Map frame** (`src/world/frame.js`, done): Lambert conformal conic on WGS84, origin 36°N 127.5°E, standard parallels 33° and 38°. Map metres, `x` east, `y` north; `z` or `h` is metres above MSL. Functions: `toMap(lat, lon) → [x, y]`, `toGeo(x, y) → [lat, lon]`, `scaleFactor`, `convergence(lon)` (grid azimuth = true − convergence), `magVar(lat, lon)` (deg, east +), `gridToTrue / trueToGrid / trueToMag / magToTrue / gridToMag / magToGrid (hdg, x, y)` in radians, `greatCircle`, `curvatureDrop(d)`, `toScene(x, y, z, origin)`, `MAP_EXTENT` (±400 km square). Checked: Gimpo–Jeju is 449.5 km on the map against 450.8 km great-circle (0.3%).
- **Units:** SI inside everything (m, m/s, kg, N, rad, s). Aviation units only when drawn on screen.
- **Headings:** in the sim, `hdg` is the **grid** heading (clockwise from map +y). Screens convert to magnetic with `gridToMag`.
- **Scene frame (three.js):** `X` = map x, `Y` = altitude MSL, `Z` = −map y. Everything is drawn relative to a moving origin `{x, y}` (map metres) that main.js sets to the camera's map position each frame: scene position = `toScene(x, y, z, origin)`. Curvature: things far from the origin drop by `curvatureDrop(distance)`; the terrain shader does this per vertex.
- **Body frame** (`src/geometry.js`, done): origin at the reference point (fuselage centreline, wing 25% MAC), `+x` forward, `+y` left, `+z` up. Gear contact points, engines, eye points, the tail strike point and the wing are there. On the ground at static compression, the centreline is 3.9 m above the runway.
- **Model frame (three.js local):** the aircraft model is built with forward = −Z, up = +Y, right = +X, origin at the body reference point. Body → model: `X = −y_body, Y = z_body, Z = −x_body`. main.js sets the group's rotation as `Euler(pitch, −hdgGrid, −roll, 'YXZ')`.

### The sim (`src/sim/`, owned by the sim job)

`import { createSim } from './sim/sim.js'`. `createSim({ ground })`, where `ground(x, y) → { h, kind }` (`kind`: `'runway' | 'ground' | 'water'`; default: flat runway at h = 0).

- `sim.controls` (mutable, written by input.js; already ramped):
  - `pitch, roll, yaw`: −1…1 (`pitch` + is nose up, `roll` + right, `yaw` + right; `yaw` steers the nosewheel on the ground);
  - `thrust`: thrust lever, −1…1. 0 = IDLE, 25/45 = CL, 35/45 = FLX/MCT, 1 = TOGA (TLA/45°); below 0 is reverse (max reverse −1), used only on the ground with the levers at idle first;
  - `brakeL, brakeR`: 0…1; `parkingBrake`: bool; `gearDown`: bool; `flapLever`: 0…4 (0, 1, 2, 3, FULL); `speedbrake`: 0…1; `spoilersArmed`: bool; `law`: `'normal' | 'alternate'`.
- `sim.ap` (mutable targets, the FCU writes them): `{ ap, athr, spdKt, hdgDeg (magnetic), altFt, vsFpm, lateral: 'HDG', vertical: 'ALT' | 'ALT*' | 'V/S' | 'OP CLB' | 'OP DES', thrustMode: 'SPEED' | 'THR CLB' | 'THR IDLE' | 'TOGA LK' | … }` plus methods `engageAp()`, `disconnectAp(reason)`, `toggleAthr()`, `setAlt(ft)`, `setHdg(deg)`, `setSpd(kt)`, `setVs(fpm)` (V/S mode), `levelChange()` (OP CLB/OP DES to the FCU altitude).
- `sim.step(dt)`: one fixed step (1/120 s in play, 1/30 s in prediction). Deterministic.
- `sim.reset(ic)`: `ic = { x, y, hdg (grid, rad), onGround, z?, iasMs?, flapLever, gearDown, fuelKg, payloadKg, ap? }`. Airborne starts are trimmed (steady flight at that speed).
- `sim.snapshot()` → a plain structured-cloneable object; `sim.restore(snap)`. Used for rewind, prediction and jumps.
- `sim.events`: an array the consumer drains: `{ type: 'touchdown', vsMs, g, x, y, bank, pitch }`, `'liftoff'`, `'apDisconnect'`, `'crash' (reason)`, `'tailstrike'`, `'bounce'`.
- `sim.state` (read-only to everyone else, updated every step):
  - `t`; `pos {x, y, z}` (CG, map metres, MSL); `vel {x, y, z}` (map frame m/s); `hdg, pitch, roll` (rad, grid heading); `quat {x, y, z, w}` (body → map ENU);
  - `p, q, r` (body rates, rad/s: roll right +, pitch up +, yaw right +); `alpha, beta`; `ias, cas, tas, gs, mach, vs` (m/s); `nz` (g); `agl` (main-gear height above ground, m); `groundH`;
  - `onGround`, `wow {nose, left, right}`; `mass, fuelKg, fuel {left, right, center}`, `cgMac`;
  - `engines[2] { n1 (%), n1Target, ffKgS, thrustN, rev (0…1 deployed) }`; `thrustLever`; `detent` (`'IDLE' | 'CL' | 'FLX/MCT' | 'TOGA' | 'REV' | ''`);
  - `flapLever`, `config` (`'0' | '1' | '1+F' | '2' | '3' | 'FULL'`), `slatDeg, flapDeg` (actual), `gearPos` (0 up … 1 down and locked), `gearDoors` (0…1), `gearCompression {nose, left, right}` (m), `steerAngle` (rad), `wheelRate {nose, main}` (rad/s);
  - `surfaces { elevator, stab, aileronL, aileronR, rudder, spoilersL[5], spoilersR[5] }` (rad; spoilers 0…1), `speedbrake, groundSpoilers` (0…1);
  - `brakes {left, right}`, `parkingBrake`; `law`; `vls, vmax, vfeNext, vsw, valphaProt, valphaMax` (m/s IAS, for the speed tape);
  - `warnings { stall, overspeed, apDisc, sinkRate, pullUp, tooLowGear, master }` (bools); `crashed` (null or a reason string).
- `src/sim/a321neo.js`: every number with its source and page. `src/sim/atmosphere.js`: `isa(h) → { T, p, rho, a }`, `iasFromTas`, `tasFromIas`, `mach`.
- **Prediction:** `src/sim/predict.js` `createPredictor() → { request(snap, opts), cancel(), onresult }`, running `src/sim/predict-worker.js` (module worker, one job at a time, a new request cancels the old). Result: `{ samples: [{ t, x, y, z, snap }] }` every 5 s of sim time, up to 90 min or fuel out or off the map, at dt = 1/30 s, within ~2 s CPU. A **jump** is `sim.restore(sample.snap)`, so the aircraft lands exactly on the line.

### World data (`data/`, made by the bake job; read by the world job)

All binaries are little-endian, gzipped (`.gz`), and fetched with `DecompressionStream('gzip')`. Grids are **cell-centred**, row 0 is the **south** row: value `(i, j)` covers `x ∈ [x0 + i·cell, x0 + (i+1)·cell)`, `y` likewise, index `j·nx + i`. A texture made from it has uv = `((x − x0)/(nx·cell), (y − y0)/(ny·cell))`.

- `data/manifest.json`: `{ national: { x0: -400000, y0: -400000, cell: 250, nx: 3200, ny: 3200, height: "terrain/height.i16.gz", water: "terrain/water.rg8.gz", cover: "terrain/cover.rgba8.gz" }, patches: [{ id, x0, y0, cell: 30, nx, ny, height }], coastPatches: [{ id, x0, y0, cell: 10, nx, ny, coast }], airports: ["airports/RKSS.json", "airports/RKPC.json", "airports/RKSI.json"], heightScale: 0.25 }`.
- **Height** (`.i16`): int16 in units of 0.25 m above MSL (Copernicus' EGM2008 heights). Built-up areas local-minimum filtered, airfields flattened to their published elevation. The sea is pushed below 0 (about −5 m at the shore down to −40 m offshore) so a sea plane at 0 cuts the shoreline.
- **Water** (`.rg8`): R = signed distance to the sea coastline, G = signed distance to inland water (big rivers, lakes, reservoirs); both encoded `128 + d/20` (d in metres, + on land, clamped), so 128 is the shoreline and the range is ±2.5 km.
- **Cover** (`.rgba8`): R = forest, G = farmland (farmland, meadow, orchard; paddies are left to the shader), B = built-up (residential, commercial, industrial, retail), A = reserved (0). Each 0…255 as a fraction of the cell.
- **Patches:** 30 m height patches around Incheon + Gimpo and around Jeju (same `.i16` encoding); 10 m coast patches (`.u8`, `128 + d/2`, ±256 m) around each airport.
- **Coastline for the map and ND** (`data/coast.json`): `{ land: [[[x, y], …], …], water: [[[x, y], …], …] }`: closed rings in map metres, simplified to ~100 m. `land` is the sea coastline of Korea and its islands plus the neighbours from Natural Earth; `water` is the big rivers and lakes as polygons.
- **Airports** (`data/airports/<ICAO>.json`): `{ icao, name, lat, lon, elevM, origin: [x, y] (map), magVarDeg, runways: [{ id: "14R/32L", widthM, lengthM, surface, ends: [{ ident, lat, lon, x, y (map metres), elevM, displacedM, hdgTrueDeg, hdgGridDeg, papi: "left"|"right"|null, approachLights: "ALSF-II"|"SALS"|null }, …] }], taxiways: [{ ref, widthM, points: [[x, y], …] }], aprons: [{ points }], stands: [{ ref, x, y, hdgGridDeg, gate: bool }], holdingPositions: [{ ref, x, y }], buildings: [{ kind, heightM, points }], serviceRoads: [{ points }] }`. All coordinates are **map metres** (not local), so everything shares one frame.

### Pure world helpers (`src/world/`, the world job; no DOM, worker-safe)

- `src/world/heightfield.js`: `loadHeightfield(baseUrl) → { heightAt(x, y), waterAt(x, y) (bool: sea or inland water), coverAt(x, y) → { forest, farm, urban } }` from the same data (patches where they exist).
- `src/world/runways.js`: `loadAirports(baseUrl) → { airports, findRunwayEnd(icao, ident), onRunway(x, y) → runway | null, groundKind(x, y) }`.
- main.js builds `ground(x, y)` for the sim from these.

### Rendering (three.js r186 in `vendor/`, imported as `../vendor/three.module.js`)

- World job: `createWorld({ renderer, scene, baseUrl, heightfield, airports }) → Promise<world>`; `world.update({ camera, origin, state, dt })`; `world.sun` (direction); the world adds its own lights, sky and `scene.fog`. Budget, all of it: ≤ ~1 M triangles, ≤ ~300 draw calls.
- Aircraft job: `createAircraft() → { object, update(state, dt), setCockpitView(bool) }` (hides what would block the view from the seats) and `createCockpit() → { object, update(state) }`, both in the model frame.

### Screens (`src/ui/`, the screens job; DOM and Canvas 2D)

- `createHud(root, { airports }) → { update(view), resize() }` draws the PFD (left), the ND and engine panel (right) and the FCU (top). `view = { state, ap, dest: runwayEnd, timeScale, timeScaleActual, paused }`. The FCU calls `ap` methods directly.
- `createMap(root, { airports, coast }) → { open(), close(), toggle(), isOpen, update(view), setPrediction(samples), onjump(sample), onskipfinal() }`.
- `createSetup(root, { airports }) → { show(defaults) → Promise<plan> }`, `plan = { origin, depRunway, dest, arrRunway, start: 'runway' | 'final' | 'gate', pax, cargoKg, fuelKg, waypoints: [[x, y]] }`.

### The lead's files

`index.html`, `style.css`, `src/main.js`, `src/input.js`, `src/camera.js`, `src/store.js`, `src/score.js`, `src/audio/callouts.js`, the rewind buffer, and the end-to-end test `tests/browser-e2e.mjs`.

### Shared tooling

- Python: `/tmp/flight-sim/venv` (numpy, tifffile, imagecodecs, osmium, shapely, pypdf, scipy).
- Playwright: `/tmp/flight-sim/pw/node_modules/playwright`, with `channel: 'chrome'`. The server on 8004 was already running before tonight (left alone).
- Every heavy command goes through `python3 games/flight-sim/tools/cpu-guard.py -- …`.

## Checkpoints

### 03:21 KST: start

- `date`: Sat Oct 31 03:21:02 KST 2026. Node v24.15.0, Python 3.12.5. Port 8004 already had a Python server (PID 38404) before tonight; it's reused and left running.
- **CPU guard on macOS:** `python3 games/flight-sim/tools/cpu-guard.py --minutes 0.05 -- python3 -c "while 1: pass"` printed `cpu-guard: the 0.05 min time cap is up; stopping: python3 -c while 1: pass` and exited 124 after 3.26 s. It works on this Mac.
- **Data:** `reference/raw/` didn't exist. Downloaded with PLAN.md's commands: OurAirports, Natural Earth, both PDFs, 37 GLO-90 tiles (the rest are sea), both GLO-30 tiles, and the OSM extract (133 MB).
- three.js r186 (`REVISION = '186'`) copied into `vendor/` from Satisfactory.
- `src/world/frame.js` and `src/geometry.js` written; the interfaces above are agreed.

### 03:30 KST: five jobs started

- Common brief for every job: `/tmp/flight-sim/brief-common.md` (the hard rules, the CPU guard, tooling, report format). Jobs: **bake** (`tools/bake_*.py`, `data/`), **sim** (`src/sim/`, its tests), **screens** (`src/ui/`), **aircraft** (`src/aircraft.js`, `src/cockpit.js`, `thumb.svg`), **world** (`src/world/` except `frame.js`). Each writes a progress note in `/tmp/flight-sim/<job>/progress.md`.
- Python venv `/tmp/flight-sim/venv` (numpy, tifffile, imagecodecs, osmium, shapely, pypdf, scipy) and Playwright in `/tmp/flight-sim/pw` installed.
- `cpu-guard.py --sweep`: clean.
- Next: the lead writes `index.html`, `src/main.js`, `input.js`, `camera.js`, `store.js`, `score.js`, `audio/callouts.js`.

### 03:40 KST: the lead's files written; sound job done

- **The lead's files:** `index.html`, `style.css`, `src/main.js` (boot, the fixed-step loop with the 60 fps cap and the physics budget, time compression, rewind, pause, the map, prediction, jumps, skip to final, events, the score and logbook, the perf overlay, test hooks on `window.__fs`), `src/input.js`, `src/camera.js`, `src/store.js`, `src/score.js` and `src/audio/callouts.js`. `node --check` passes on all of them.
- **Tests:** `tests/browser-e2e.mjs` (the scripted Gimpo to Jeju flight) and `tests/e2e-controller.js` (the test-only take-off and landing controller), plus `tests/browser-shots.mjs` (screenshots with fps, triangles and draw calls). They can't run until the sim, world and aircraft modules exist.
- **Sound job** (03:35–03:38): `src/audio/synth.js` and `tests/dev-audio.html`. `node --check` passes, and a fake-AudioContext smoke test built 67 nodes once and none per update. Not listened to yet. main.js starts it on the first gesture and updates it every frame.
- **Bake** (progress note): national height done, and the water distance fields and `coast.json` are written.
- `cpu-guard.py --sweep`: clean.

### 03:43 KST: M2 taxi groundwork done

- `src/ground/taxi.js` builds the taxi graph, routes from a stand to the runway holding point and back to a free stand, and flags runway crossings. `src/ground/pushback.js` is the pushback state machine (straight back, then a 25 m-radius turn at 1.5 m/s, with Q/E bias). Neither is wired into the game yet; that's M2.
- `python3 tools/cpu-guard.py -- node --test tests/taxi.test.mjs`: 6 pass, 0 fail, and 2 skipped because `data/airports/*.json` didn't exist yet. Rerun once the airports are baked.

### 03:47 KST: the server is on 8001; research notes in

- **Port:** Shane, at about 03:50: "Game Dump moved to localhost 8001 a while back." Port 8004 (PID 38404) serves his Profile site (`-d .local` in `ClaudeProjects/Profile`), so the world job's first browser check got 404s there. GameDump is served on 8001 (PID 52374, already running before tonight; it's reused and left alone). The common brief, `tests/browser-e2e.mjs`, `tests/browser-shots.mjs` and every running job were switched to 8001. AGENTS.md still says 8004; that's Shane's file, so it's left for him.
- **Notes:** `reference/notes/airports.md` (Korean eAIP AMDT 11/26: per-end ALS, PAPI, ILS, TCH, widths; Gimpo has no displaced thresholds, Jeju 31 has 411 m, variation is 9° W at Gimpo and 8° W at Jeju) went to the bake job. `reference/notes/airbus-fbw-ap.md` (Normal and Alternate law, protections, AP/A-THR modes; each figure tagged by how well it's sourced) went to the sim job.

### 03:49 KST: memory incident; the guard has a memory cap

- **What happened (Shane):** "A Python process from this run reached 18.7 GB of RAM on this 24 GB Mac and kernel_task went to 200% swapping. It was most likely tools/bake_osm_extract.py: it keeps every coast, water and land-cover geometry for the whole country in Python lists, on top of an in-memory node index for the full extract." He added a 6 GB memory cap to `tools/cpu-guard.py` (exit 123) and the memory rules to `AGENTS.md`.
- **Checked on this Mac (03:49):**
  - `cpu-guard.py --minutes 0.05 -- python3 -c "while 1: pass"` printed the time-cap message, exit 124.
  - `cpu-guard.py --mem-gb 0.3 -- python3 -c "…8 × 100 MB…"` printed `cpu-guard: the 0.3 GB memory cap is passed (0.8 GB in use); stopping: …`, exit 123.
- **Right after:** nothing over 0.5 GB was running except `bake_cover.py` (1.9 GB, under the guard; its runs peaked at 3.57 and 2.87 GB). `--status` showed no slots in use.
- **Passed to the bake job:** `bake_osm_extract.py` isn't to be rerun as it is. Cut the input first (osmium-tool `tags-filter` on natural, waterway, landuse and aeroway; `osmium extract` with a small box per airport, into `/tmp/flight-sim/bake/`), then stream: rasterise each polygon into the 250 m grids as it arrives and keep nothing per feature. Every bake script goes through the guard, with peaks aimed at ≤ ~3 GB.
- **Lesson for the lead:** the brief asked for the guard on heavy commands, but it didn't cap memory, and the bake brief invited one big pass over the extract. Bake briefs now say "stream, tile, and keep peaks small".

### 03:51 KST: first integrated load

- **All the modules are on disk,** except `src/sim/predict.js` (main.js falls back to a no-op predictor until it exists). The bake has every layer, including the 30 m and 10 m patches. The screens are done against real data. The world has terrain, sea and sky; its runways and cities are still stubs.
- `python3 tools/cpu-guard.py --minutes 3 -- node tests/browser-shots.mjs gimpo-14R-orbit gimpo-14R-nose`: both load at 60 fps, with 635k triangles in 21 draw calls. The one console error is a 404 for `thumb.svg` (the aircraft job draws it). Screenshots `lead-gimpo-14R-orbit.png` and `lead-gimpo-14R-nose.png`, looked at: the A321 on the ground in the orbit view, with the PFD, ND (coastline, magenta line to RKPC 07, 244 nm), engine panel (N1 20.5 idle, FOB 7,500, 1+F, three greens) and FCU all drawn. The heading tape reads 144. No runway is drawn yet, and the terrain is plain green with no detail yet.
- **Fixes by the lead:**
  - `TAIL_STRIKE_POINT.z` moved from −1.6 to −1.1 (the sim job found tail strikes at 8°; it's now about 9.7° compressed);
  - runway end x/y is the landing threshold in the baked JSON (`pavementEnd` is the physical end), so runway starts use `pavementEnd` and the score's aiming point uses the LDA;
  - the HUD law switch and `coast.json` are wired in.
- `cpu-guard.py --sweep`: clean.

### 04:05 KST: bake, world, aircraft and screens jobs done

- **Bake** (03:57): every layer is in `data/` (13 MB). Scripts are `tools/bake_*.py` and `tools/bake_all.sh` (one guarded command per step). After the memory incident it was rerun streaming: osmium-tool `tags-filter` plus a box per airport, features streamed to disk, rasters built in batches. Peaks in `/tmp/flight-sim/cpu.log`: osm-nat 2.22 GB, osm-bld 2.00, water 2.46, cover 2.20, patches 1.03. The bake job thinks the 18.7 GB process was its first `bake_water` run (a 4 km vector buffer around the whole coast). Spot heights: Gimpo 18.0, Jeju 36.0, Incheon 7.0, Hallasan 1,845 m (250 m grid) and 1,923 m (30 m patch), Han at Mapo 5.7, the sea off Incheon −40. Runway true headings match the eAIP to 0.1°. Quick-look PNGs `bake-*.png`, looked at by the bake job.
- **World** (03:59): terrain clipmap (13 rings), water shading, sky and haze, GPU trees, field plots, instanced cities, and runways for Gimpo, Jeju and Incheon with ICAO markings, lights, approach lights and PAPIs. `node --test tests/world-helpers.test.mjs`: 9 pass. Shots `world-*.png`: Gimpo 14R has 27 calls and 770k triangles, Seoul 23 / 669k, FL350 8 / 161k. `createWorld` now accepts the airports as an array (main.js passes it that way).
- **Aircraft** (03:57): one skinned mesh with 42 bones, 23.2k triangles and 3 draw calls; livery atlases in `src/livery.js`; the cockpit with its six windows cut out, 8 meshes and ~6k triangles; `thumb.svg`. 21 shots `aircraft-*.png`.
- **Screens** (03:52): every screen built against the real data. `tests/browser-ui.mjs` passes every check; `node --test tests/ui.test.mjs`: 6 pass. Shots `ui-*.png`.
- **End-to-end, runs 1 and 2:**
  - Run 1: a tail strike, because the controller pitched to 12.5° on the wheels.
  - Run 2, after the fix (rotate at about 2.5°/s, hold 9.5° until the wheels are off): 5/6 checks. TOGA by keyboard, lift-off, the AP climbing through 3,750 ft and 8× compression (8.0× reached) all passed. It stopped at the map because `predict.js` didn't exist yet. The sim job says lift-off in node is at 154 kt; my log's 166 kt was measured from the `liftoff` event, which fires 0.5 s after the wheels leave the ground.
- Only the **sim** job is still running (AP checks, predictor, tests).
- `cpu-guard.py --sweep`: clean.

### 04:17 KST: the end-to-end flight passes; all 85 unit tests pass

- **Sim job done** (04:15): flight model, FBW Normal and Alternate law, AP and A/THR, the predictor (worker plus `predict-core.js`). 62 sim tests. Against the published numbers:
  - take-off to 35 ft ×1.15 is 100% of the AC chart at 80 t and 88% at 93.5 t;
  - VS1g FULL is 106.2 kt against 106.5 derived from Vapp 136 kt (AC p.197);
  - FL330 M0.76 at 67 t burns 2,100 kg/h against 2,200 published;
  - landing from 50 ft is 1,016 m against 948 m (0.6 × the 1,580 m LFL);
  - approach pitch on a 3° path at VLS+5 is +2.5 to +3° (a test added at the lead's request);
  - AP captures overshoot by under 3 ft.
  One step costs 0.8–1.7 µs, and a 90-minute prediction about 0.19 s of CPU.
- **End-to-end, run 4:** `python3 games/flight-sim/tools/cpu-guard.py --minutes 15 -- node games/flight-sim/tests/browser-e2e.mjs` gave **11/11 checks passed**:
  - TOGA by keyboard (R held through the detents); rotate at 145 kt, lift-off 157 kt at 6.5°;
  - AP engaged and climbing (HDG towards Jeju, OP CLB to FL240);
  - 8× compression, 8.0× reached;
  - a map jump to the sample about 60 nm from Jeju, landing exactly on it: 0.00 m horizontal and vertical, after taking back 0.83 s of flight; 625 samples;
  - skip to final at 4,913 ft and 180 kt;
  - a hand-flown 3° approach by the test-only controller, landing on Jeju 07, scored **D 59**: 361 ft/min, 2.04 g, 76 m past the aiming point, 1.3 m off the centreline, 3.7° pitch, 0 bounces;
  - no crash, the callouts heard, no console errors.
  Screenshots `e2e-1` to `e2e-10-*.png`.
- **The test controller's history:**
  - run 1: a tail strike (it pitched to 12.5° on the wheels);
  - run 3: ditched short of Jeju, because ALT hold kept it at 4,800 ft until 6 nm, so it was far above the path;
  - fixes: hand-fly the 3° path from 15 nm, a gentler flare, Vapp = VLS+5. These were tuned in a node harness (`/tmp/flight-sim/lead/approach.mjs`: the real sim plus the same controller, on flat ground at Jeju 07's elevation).
- **Bugs found by the e2e and fixed:**
  - RETARD fired over and over on the take-off roll. It's now armed only by descending in the air, and disarmed at idle, below 40 kt on the ground, or in a go-around.
  - The jump check didn't account for the 0.8 s the sim flew on after the jump.
- **Unit tests:** `python3 tools/cpu-guard.py --minutes 5 -- bash -c 'node --test tests/*.test.mjs'` gave **85 pass, 0 fail, 0 skipped**. One honest change to `tests/taxi.test.mjs` (M2 code, not wired in): Jeju's secondary runway 13/31 is a logged known gap. Its OSM taxiways form two small pieces that join the main network only across runway pavement (diagnosed with `/tmp/flight-sim/lead/taxidiag.mjs`). Every other runway end at Gimpo and Jeju must route. Fixing this is M2.
- `cpu-guard.py --sweep`: clean.

### 04:20 KST: screenshots, performance and the CPU-at-runtime check

- **Screenshots and performance at 1440×900 in Chrome on the M5:** `python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-shots.mjs`. Every scene holds the **60 fps cap**. Triangles and draw calls from the performance overlay:

  | Scene (`lead-*.png`) | fps | Triangles | Calls | What I saw |
  |---|---|---|---|---|
  | `gimpo-14R-nose` (on the ground at Gimpo) | 60 | 793k | 30 | Runway 14R ahead: centreline, touchdown zone and aiming-point marks, edge and centreline lights, city skyline |
  | `gimpo-14R-orbit` | 60 | 793k | 30 | The A321neo in Nuclear Airlines colours on the threshold piano keys, green threshold lights |
  | `gimpo-14R-captain`, `gimpo-14R-fo` | 60 | 799k | 32 | The cockpit's window posts, glare shield and dark screens; the runway through the windscreen |
  | `seoul-3000ft` (3,000 ft over Seoul), `seoul-3000ft-orbit` | 60 | 692k | 26 | A dense field of apartment slabs, the Han winding north-east, the AP holding ALT/HDG/SPEED |
  | `jeju-07-3nm` | 60 | 742k | 23 | Runway 07 straight ahead on a 3 nm final, ILS diamonds centred, Jeju city on the left, CONF FULL, three greens |
  | `hallasan` | 60 | 692k | 21 | Hallasan's broad forested shield off the right side, 10 nm out on the approach to 07 |
  | `map`, `jeju-final-*` | 60 | 475k | 17 | |

  All within the "about 1 M triangles and 300 draw calls" aim. The map with the bright predicted path is `e2e-5-map-predicted-path.png`: a lime path with time ticks every 5 min, the airports, the magenta line to RKPC 07, the 15 nm final mark, and the info box.
- **CPU at runtime:** `python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-cpu.mjs` gave **6/6**:
  - running: sim time 3.00 s in 3 s, 60 fps rendered, main-thread CPU 8%;
  - paused: 0 rAF/s, sim 0 s, CPU 0.0%;
  - resumed: 1.50 s in 1.5 s;
  - hidden tab (emulated with `document.hidden` plus visibilitychange, because Playwright opens a second page in its own window): 0 rAF/s, sim 0 s, CPU 0.0%, and the pause menu is waiting on return;
  - a predicted path: one job, 30 ms of CPU, 194 samples (stopped at the map's edge); the superseded request was dropped.
- A reviewer subagent is checking the build against PLAN.md's M1 list (deadline 05:00).
- `cpu-guard.py --sweep`: clean.

### 04:43 KST: M1 done

**The M1 reviewer** (a subagent, 04:23; it read every M1 file against PLAN.md's M1 list and confirmed suspicions in Chrome) found 2 correctness bugs and 8 minor ones. Fixed by the lead:

1. **Correctness:** rewind and jumps didn't restore the keyboard's thrust lever, so A/THR dropped out after a rewind. Every jump now goes through `afterJump()` in main.js, which syncs the lever. Proven by `tests/browser-rewind.mjs`: before the rewind `{athr:false, lever:0}`, after it `{lever:0.556, athr:true}`.
2. **Correctness:** the predicted path outlived the AP, and jumping to it re-engaged the AP. The path now clears on AP disconnect, on rewind, on skip to final and on jumps. `browser-rewind.mjs` shows `prediction=null` after the disconnect.
3. The rewind buffer now records again right after a rewind.
4. Behind the map, the 3D scene renders at 6 fps instead of 60.
5. After a crash, the loop renders once and stops.
6. A pinch over any panel no longer zooms the page.
7. The callouts re-arm on jumps; skip to final resets the score's runway.
8. The predictor is cancelled when the map closes.
9. Prediction over terrain was logged in ROADMAP.md for later.
10. T (rewind) now works only from the pause menu or after a crash; it's listed in the pause menu and the README.

One regression from fix 1 was caught by the end-to-end flight and fixed: on skip to final, `afterJump` copied the sim's idle lever into the keyboard lever, A/THR dropped out and the controller dived. `placeOnFinal` now sets both levers to CL.

**Definition of done for M1, with evidence:**

- [x] **Unit tests:** `node --test games/flight-sim/tests/*.test.mjs` (guarded) gave 103 pass, 0 fail at 04:37, and 113 pass after the M2 ground job's tests landed (04:40). They include the flight model against the published numbers (see the 04:17 entry).
- [x] **Loads with no console errors:**
  - `tests/browser-boot.mjs` gives **6/6**: the setup screen on load, Fly starts a runway flight, keys reach the game, Esc pauses, no console errors, and the game loads inside `play.html?game=flight-sim`.
  - Screenshots `boot-1-setup.png`, `boot-2-pause.png` and `boot-3-hub-player.png` (the hub's "click to start" cover over the game).
  - The game URL is `http://localhost:8001/games/flight-sim/`. Port 8001, not 8004 (see 03:47).
- [x] **60 fps at 1440×900:** on the ground at Gimpo (793k triangles, 30 calls) and at 3,000 ft over Seoul (692k, 26), plus all the other scenes (04:20 entry).
- [x] **Scripted end-to-end flight:** `tests/browser-e2e.mjs`, rerun after the review fixes, gave **11/11**:
  - lift-off 167 kt;
  - AP climb; 8× compression, 8.0× reached;
  - jump miss 0.00 m;
  - skip to final at 4,913 ft and 180 kt;
  - landed on Jeju 07, scored **D 51**: 392 ft/min, 2.16 g, 60 m past the aiming point, 1.5 m off the centreline, 4.8° pitch, 0 bounces;
  - not crashed; callouts "twenty five hundred … twenty, retard, ten"; no console errors.

  Screenshots `e2e-1` to `e2e-10`.
- [x] **Screenshots, looked at:**
  - all four views: `lead-gimpo-14R-nose`, `-orbit`, `-captain`, `-fo`;
  - the map with the bright path: `e2e-5-map-predicted-path`;
  - the PFD, ND, engine panel and FCU in every shot, plus the screens job's `ui-*.png`;
  - Gimpo's runway with markings, lights and PAPIs: `lead-gimpo-14R-*`, `world-gimpo-14r-markings`, `world-gimpo-papi-zoom`;
  - Jeju's: `lead-jeju-07-3nm`, `world-jeju-07-zoom`, `e2e-8`;
  - Seoul and the Han: `lead-seoul-3000ft`, `-orbit`;
  - Hallasan: `lead-hallasan`.
- [x] **Reviewer subagent:** done; every correctness finding is fixed (above).
- [x] **CPU at runtime:** `tests/browser-cpu.mjs` gave **6/6** after the fixes: 0 frames and 0 sim time while paused or hidden, the 60 fps cap holding, and a prediction at 32 ms of CPU.
- [x] **Nothing left running** at this point: `--status` shows no slots in use and `--sweep` is clean. The final check is in the wrap-up.
- [x] **README, registry entry and ROADMAP:**
  - `README.md` written (03:41, kept current).
  - The registry entry was added to `data/games.js` before `coming-soon-slot` by a read-modify-write script (`/tmp/flight-sim/lead/registry.py`; it adds 530 characters and nothing else).
  - ROADMAP.md marks M1 Done.

**Row for Shane to add to GameDump's root AGENTS.md "Current games" table** (his file, so not edited):

```
| `flight-sim` | `games/flight-sim/` | `gamedump:flight-sim:settings`, `…:logbook`, `…:lastflight` | `Claude outputs/flight-sim/` | `claude/flight-sim-prototype.md` |
```

**Next:** M2. Its parts are done as modules: aprons, ground ops and traffic (still running). The lead integrates them behind M1's tests, so a broken M2 part can't break M1.

### 05:08 KST: M2 integrated; M3 jobs started

- **M2 modules, all done before 04:50:**
  - **aprons:** `src/world/apron.js` and `apron-geom.js`. Taxiways, aprons, hold-short markings, stand lead-ins, numbers and stop bars, jet bridges, extruded terminals and hangars. 3 draw calls per airport; Incheon 146k triangles; 9 node tests.
  - **traffic:** `src/world/traffic*.js` and `liveries-other.js`. 70% of stands filled with instanced narrowbodies and widebodies in Nuclear Airlines and three made-up airlines (Hanbit Air, Jeju Breeze, Gyeongin Express), plus 25–33 drivers per airport on the service roads. 8 calls and 272k triangles near Incheon; the update costs about 0.03 ms; 13 node tests.
  - **ground ops:** `src/ground/gate-flow.js`, `taxi.js`, `pushback.js` and `src/world/taxiroute.js`, plus `sim.setGroundPose` and the gate option in setup. Jeju 13/31 now routes, so `KNOWN_GAPS` is gone; 18 ground-flow tests.
- **Integrated by the lead:**
  - **world.js:** aprons and traffic. Each is optional: if one fails to build, it logs a warning and the M1 world keeps working.
  - **`src/world/airport-mask.js`:** clears forest and built-up cover inside each airport's boundary before the cover texture is made, so no trees or city blocks grow on aprons. The GPU and `coverAt` agree.
  - **runways.js:** `groundKind` treats taxiways, aprons and stands as paved, through a 50 m hash index (0.13 µs per call, built in 6 ms), so taxiing faster than 29 kt doesn't crash as "ran off the runway".
  - **main.js:**
    - Gimpo's stand headings are corrected once at load with the traffic job's `standHeading`, because the baked ones are often 90° off where OSM has no lead-in line, so markings, parked aircraft and gate starts agree.
    - The gate flow: a gate start, P for pushback, the route drawn, the taxi-in route after landing to a stand with no parked aircraft (`occupied` passed in), `traffic.setPlayerStand`, and `gate.clear()` on jumps, rewinds and skips.
- **Checks after integration:**
  - `node --test tests/*.test.mjs`: 126 pass, 0 fail;
  - `browser-e2e.mjs` 11/11 and `browser-boot.mjs` 6/6;
  - `browser-ground.mjs` PASS: pushback 83 s, ending 21 m from the route start, 60 fps, no console errors.
  - `browser-gate.mjs` (new; main.js's own flow at Gimpo stand 3): P starts the pushback (1.5 m/s), the pushback completes onto the taxi line, and a test-only pure-pursuit taxi controller follows the route at about 15 kt. Run 1 reached the last route point 194 m from the 14R threshold with no crash, then circled, because the controller's 25 m arrival radius was tighter than the turning circle. It's widened to 45 m and being rerun.
  - Screenshots, looked at:
    - `lead-gimpo-gate-orbit.png`: nose-in at stand 3, with lead-ins, jet bridges, terminal glass and parked aircraft in made-up liveries;
    - `lead-gimpo-gate-captain.png`: the bridge and terminal from the seat;
    - `lead-incheon-1500ft.png`: Incheon's aprons and runways in the distance.
  - All at 60 fps. Gimpo at the gate is 951k triangles and 40 calls; Incheon from 1,500 ft is **1.14 M** and 38 calls, a little over the "about 1 M" aim.
- **M3 started:** audio (offline-rendered measurements of `synth.js`, since nobody can listen tonight), logbook and score panel (`src/ui/logbook.js`, `score-panel.js`), and world polish (beach dashes, pale land from cruise, city façades, river edges, the edge of the tree area, with before/after shots).
- `cpu-guard.py --sweep`: clean.

### 05:37 KST: M3 parts done; world polish

- **Audio** (05:16): `src/audio/synth.js` was tuned against offline-rendered measurements: `python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/audio-render.mjs` gave **30/30** (18/24 before), and `node --test tests/audio-synth.test.mjs` 3/3. Clipping is fixed (peak with everything on was 1.218, now 0.63, with a limiter). The cavalry charge sits +11.4 dB over TOGA inside (+4.7 before). Inside is 8 dB under outside at TOGA and duller. Paused renders at −125 dB. Added: brake rumble and squeal, reverser door and gear-lock clunks, cockpit air-conditioning hiss. A noise-loop seam click is fixed. `update` costs 0.006 ms. **Not listened to by anyone yet**: these are measurements only.
- **Logbook and score card** (05:13): `src/ui/logbook.js` (opened from the pause menu: totals, flights newest first, a row opens its breakdown, clearing asks first inside the panel) and `src/ui/score-panel.js` (a big grade, a verdict, a runway diagram with the touchdown point against the aiming point). 7 node tests; `tests/browser-logbook.mjs` 17 checks. Shots `logbook-*.png` and `score-a.png` / `score-d.png`. **Integrated by the lead** in index.html and main.js; the logbook entry now records the gate.
- **World polish** (05:29), in `glsl.js`, `terrain.js`, `sky.js`, `detail.js` and `cities.js`:
  - the beach dashes are gone (the sea-distance field is continuous at the patch edges);
  - FL350 shows a green and brown patchwork under blue-grey haze (`polish-fix2-fl350.png`, looked at);
  - Seoul's slabs vary in colour, with balcony stripes, roofs and about 8% towers, at the same triangle count (`polish-fix4-seoul-3000ft.png`, looked at);
  - river and lake edges are smooth (Catmull-Rom on the water field);
  - the tree area's edge fades out.
  Triangles and draw calls are identical before and after. Its own run of `browser-e2e.mjs` gave 12/12, and `node --test` 136/136.
- **Runway lights:** the polish job's proposal is applied in `airports.js`. Close-range lights are smaller and less bright by day; distant ones keep their 2 px minimum.
- **Triangles at Incheon:** **1.14 M** from 1,500 ft, still at 60 fps. The parked aircraft (252 × ~1k triangles) are switched per airport, so trimming the draw range doesn't help, and a terrain LOD change wasn't worth the risk tonight. That's 14% over the "about 1 M" aim; left as it is.
- **The gate-to-holding-point test** (`browser-gate.mjs`): pushback passes. The test-only taxi controller went round in circles at the last route point, about 85 m out at 10.5 kt, because it only braked above 11 kt and the nosewheel skids with full tiller at that speed. It now brakes down to 4 kt for sharp turns; rerunning.
- `cpu-guard.py --sweep`: clean.

### 05:58 KST: M2 gate-to-runway passes; score card in the game; touchdown g

- **`tests/browser-gate.mjs` gives 5/5** (guarded, `--minutes 15`): a gate start at Gimpo stand 3; P starts the pushback at 1.5 m/s; the pushback completes onto the taxi line; the test-only taxi controller follows the drawn route to the holding point for 14R, 150 m from its threshold, with no crash, in 7.8 sim minutes; no console errors.
  - Earlier failures were the test's own: the taxi took longer than its 8-minute window. A node harness (`/tmp/flight-sim/lead/taxi.mjs`: the real sim, gate flow and Gimpo's paved index) showed the controller arriving at t = 593 s with no orbit.
  - The taxi now runs at 20 kt on straights and slows to 4 kt for sharp turns.
- **`browser-e2e.mjs` gives 12/12**, with the new check that, after landing on Jeju 07, a taxi-in route appears ("Taxi to stand 15 via P3, P, crossing 07/25, 13/31"). The score card in the game (`e2e-10-landing-score.png`, looked at): a big D, 50/100, the verdict, the runway diagram with the touchdown 59 m past the aiming point and 1.6 m left of the centreline, and the penalty bars.
- **Touchdown g was too harsh:** 2.18 g at 395 ft/min.
  - Gear sweeps in the node harness (`approach.mjs`) didn't help: lower compression damping made it worse (2.58 g), and higher damping or a softer spring with a longer stroke bottomed out around 1.84–1.95 g.
  - Energy says a firm 380 ft/min touchdown can't come in under about 1.6 g with this stroke, so the sim isn't far off.
  - Changes:
    - `sim.js` now measures touchdown g as an accelerometer would: a 0.1 s first-order filter, since flight-data recorders sample at about 8–16 Hz. That gave 1.94 g.
    - The gear data is unchanged: restored from backup, since the sim's tests are calibrated on it.
    - The score's g penalty now starts at 1.6 g instead of 1.4.
    - The card's "inspection" verdict needs ≥ 2.3 g or ≥ 600 ft/min (Airbus inspects at 2.6 g); the logbook test was updated to match.
- **The taxi route line** was a saturated 1 m green carpet under the nose camera (`e2e-10`). It's now 0.6 m wide, 70% opaque and less bright, with the 2.5 px minimum width kept for viewing from above.
- `node --test tests/*.test.mjs`: **136 pass, 0 fail**.
- `cpu-guard.py --sweep`: clean.

### 06:19 KST: second review fixed; M2 and M3 done

**The second reviewer** (a subagent, 06:10; it read the M2 and M3 integration and confirmed findings in Chrome and node) found 4 correctness bugs and 7 minor ones. Fixed by the lead:

1. **Correctness:** sound kept running while paused or hidden; only the gain went to 0. `setPaused` now calls `synth.stop()`, which suspends the AudioContext, and `synth.start()` on resume, only if audio had already started.
   - `browser-rewind.mjs`: `{running:true}` → paused → stopped → resumed → `{running:true}`. Traced in `/tmp/flight-sim/lead/audiodbg.mjs`: suspended about 300 ms after Esc.
   - The first check failed only because the map was open, and Esc closes the map first.
2. **Correctness:** a parked aircraft could overlap the player at a gate start. `blockedByPlayer` assumed the player's reference point sat on the stand, but the gate flow puts the nose there. The footprint is now on the stand itself. The reviewer's `overlap.mjs` reports 0 at all three airports with this convention (before: 7 Gimpo, 8 Jeju and 6 Incheon stands).
3. **Correctness:** the taxi-in stand could be one a neighbour's aircraft overlapped. main.js now calls `traffic.setPlayerStand` for the arrival stand as soon as the route appears.
4. **Correctness:** a rewind ended the gate flow for good. `gate-flow.js` has a new `afterRestore()`: after a rewind on the ground, the outbound flow carries on with a fresh taxi route from where the aircraft is, and the inbound one with a route to its stand. Jumps and skips still clear it.
   - `browser-rewind.mjs`: rewinding mid-pushback gives `{phase:'taxi', 73 route points, "Rewound. Taxi to holding point for 14R …"}`.
5. **Stored XSS** in the score card's penalty field: it's now `Number(p.penalty) || 0` everywhere (7 places).
6. A failed taxi-in search is retried only after the aircraft has moved 50 m (it had cost about 3.3 ms per frame at Incheon).
7. The paved index now covers each stand as a 60 m capsule back along its corrected heading, plus the lead-ins. `rw.rebuildPaved()` runs after main.js corrects the stand headings, so pushback end points count as paved.
8. Corrected stands are marked `hdgFixed`, so `standHeading` doesn't re-derive them (Gimpo 214 had come out 80° different).
11. The taxi route disposes its old geometry before uploading a new one.

Left for later (in ROADMAP.md): 9, duplicate stand refs; 10, Gimpo stand 7 has no route to 14L/32R.

**Full verification after the fixes** (all guarded):

- `node --test tests/*.test.mjs`: **136 pass, 0 fail**.
- `browser-e2e.mjs`: **12/12**:
  - lift-off 167 kt; AP climb; 8× (8.1× reached); a jump with a 0.00 m miss; skip to final;
  - landed on Jeju 07, scored **C 70**: 388 ft/min, 1.91 g, 69 m past the aiming point, 1.6 m off the centreline;
  - the taxi-in route to stand 15; callouts with RETARD; no console errors.
- `browser-gate.mjs`: **5/5** (gate → pushback → taxi to the 14R holding point, 150 m from the threshold).
- `browser-cpu.mjs`: **6/6** (paused or hidden: 0 rAF/s and CPU 0.0%; prediction 26 ms).
- `browser-boot.mjs`: **6/6**, including the hub player.
- `browser-rewind.mjs`: **5/5**.
- Gate starts at Jeju stand 11 and Incheon stand 38: `lead-jeju-gate-orbit.png` (35 calls, 891k triangles) and `lead-incheon-gate-orbit.png` (42 calls, **1.21 M** triangles), both 60 fps. Looked at: the terminal, bridges, painted stand numbers and parked aircraft in the made-up liveries.

**ROADMAP.md:** M2 and M3 marked Done, with the leftovers listed under "Found in M1–M3 and left for later". README.md describes M2 and M3: gate starts, pushback, the logbook, sound, and the test scripts.

`cpu-guard.py --status`: no slots in use. `--sweep`: clean.

### 06:21 KST: after M3: small fixes; three more jobs

- **Duplicate stand refs fixed (lead):** OSM repeats refs for distinct stands (73 at Incheon, 46 m to 4 km apart; "18" at Gimpo). main.js makes each unique at load ("511-2"), so the setup list, gate starts, occupancy and the logbook address the right stand. Removed from ROADMAP's leftovers in the final pass.
- **The taxi route on the ND (lead):** drawn in the ground line's colour (`view.taxiRoute = gate.points`, added to the ND's redraw signature by length). Visible at the 10 nm range; too small at 40 nm (`lead-gimpo-gate-captain.png`).
- **Jobs started at 06:20:**
  - a **playtester** (plays through real keyboard and mouse events, read-only, reports bugs and feel);
  - **terrain-aware prediction** (`src/sim/predict*.js`: the path ends at terrain, with no jump targets inside it);
  - a **triangle budget** job (Incheon to ≤ ~1 M with no visible loss, before/after screenshots).
- `cpu-guard.py --sweep`: clean.

### 06:38 KST: the predicted path follows the terrain

- **Prediction-terrain job** (06:35):
  - The worker loads the national height grid and the 30 m patches once (about 33 MB, no water, cover or coast layers). The first request waits at most 1.5 s for them, else falls back to flat ground.
  - The predicted flight runs over the real ground. On land contact the run ends with `reason: 'terrain'`. Samples with less than 150 m of clearance, and those in the last 15 s before impact, are dropped, so no jump target is in or just before the terrain. The last sample carries `terrain: true` and `impact`.
  - CPU: 94 ms for 90 minutes over land, against 88 ms flat.
  - `tests/sim-predict-terrain.test.mjs`: 4 tests. Heading north at 4,000 ft into Hallasan, the last sample is 5.0 km south of the summit at 354 m above the ground. Over the sea the path is identical to flat ground. Jumps land exactly on the path.
  - Its own runs: `node --test` 140/140, e2e 12/12, browser-cpu 6/6.
- **Lead:** applied its map.js patch (a red cross at the impact, dashed from the last sample) and added a toast in main.js when a prediction ends at the terrain.
  - `browser-predict-terrain.mjs`: 4/4.
  - `prediction-terrain-hallasan.png`, looked at: the lime path from the south coast stops at the red cross short of the island's centre, while the magenta line runs on to RKSS.

### 06:44 KST: every scene under 1 M triangles

- **Triangle-budget job** (06:44):
  - Parked aircraft beyond 2 km use a 216-triangle far model, reassigned only after 200 m of camera movement, never per frame.
  - Cities submit only 400 m blocks that have built-up cover, so the picture is identical.
  - The terrain skips clipmap rings entirely beyond the horizon, which drops only ring 12, below about 470 m altitude.

  | Scene | Triangles before → after | Calls |
  |---|---|---|
  | incheon-1500ft | 1,135,682 → **696,056** | 38 → 38 |
  | incheon-gate-orbit | 1,211,134 → **908,656** | 42 → 43 |
  | gimpo-gate-orbit | 950,886 → 886,956 | 40 → 39 |
  | gimpo-14R-nose | 950,572 → 820,000 | 39 → 39 |
  | seoul-3000ft | 850,252 → 732,958 | 35 → 35 |
  | jeju-07-3nm | 840,295 → 552,073 | 32 → 31 |
  | hallasan | 712,063 → 515,263 | 24 → 24 |

  All at 60 fps. Before/after pairs compared by eye and by pixel diff (differences are only in the distant far models); nothing was reverted. Its own runs: e2e 12/12, gate 5/5, cpu 6/6, `node --test` 140/140.
- **Lead:**
  - Added the far-model budget test it proposed (`tests/traffic.test.mjs`: ≤ 300 triangles per type).
  - `node --test tests/*.test.mjs`: **141 pass, 0 fail**.
  - Looked at the new `lead-incheon-gate-orbit.png` (909k triangles): the same as before.
- `cpu-guard.py --sweep`: clean.

### 07:31 KST: playtest fixes

**The playtester** (a subagent, 07:15) played the game through real keyboard and mouse events from the setup screen, with 10 runs and no page or console errors. Its findings, fixed by the lead:

1. **Breaks play: every mouse interaction was dead after Fly.** `#setup-root` (and `#map-root`) relied on `:empty` to stop catching the pointer, but their hidden panels stay in the DOM, so a full-window layer covered the FCU, the map, the LAW switch and every camera gesture.
   - Fix (`style.css`): the roots are always `pointer-events: none`, and only their shown children take the pointer.
   - **`browser-boot.mjs` now has real-mouse checks after Fly:** `elementFromPoint` in the middle is `#view`; the mouse wheel over the HDG window changes the heading; a two-finger swipe over the view moves the camera; the map's buttons get the pointer. **10/10.**
   - My earlier browser tests started flights through test hooks and keys, never with the mouse after Fly, so they missed this.
2. **Breaks play: holding S at VR struck the tail.** Ground mode was direct, and a keyboard is at full stick within 0.3 s, so rotation reached 10–15°/s.
   - Fix (`fbw.js`): ground mode now has 0.75 of the nose-up authority and pitch-rate damping (elevator − 4·q).
   - Node harness (`/tmp/flight-sim/lead/rotate.mjs`): S held 3 s from VR now rotates at 5.2°/s and lifts off 2.3 s later at 155 kt and 7.9°, with no tail strike (before: 15.4°/s and a tail strike). A 1 s hold lifts off at 5.7°.
   - The take-off test's pilot model was tuned for the undamped elevator, and with the damping it couldn't reach its stated ~3°/s rotation (111% of TOFL). Its gain went from 0.15 to 0.3, so it rotates at 4.3°/s, and both weights pass again.
3. The FCU heading started at 000, so Z turned the aircraft toward north. It now starts at the aircraft's own magnetic heading on runway and gate starts.
4. (Not changed) A fast second `=` after the first: rates step one per key press, and the rate-reached figure shows only while it differs from the rate.
5. Callouts repeated over Jeju's terrain ("one thousand" ×3). Each call now fires once on the way down and re-arms only after climbing 10% (at least 10 ft) back above its height.
7. Dark irregular shapes on Gimpo's apron. Found by hiding layers in turn: not the traffic; they're in the apron mesh. Its triangulation is fine (0 bad of 42 aprons, `/tmp/flight-sim/lead/aproncov.mjs`); the terrain was poking through the pavement by a few centimetres.
   - Fix: larger depth pulls, constant and per-distance (`apron.js`: taxi 0.06 + 0.0006·d, apron 0.10 + 0.0010·d, paint 0.13 + 0.0013·d), and the runways above them (`airports.js`: 0.16 + 0.0016·d), so the order is terrain < taxiway < apron < paint < runway at every distance.
   - `lead-specks-all.png`: clean, apart from one fleck at the far edge. `lead-gimpo-14R-orbit.png`: the runway still wins over the taxiway, and the wheels sit on the runway.

**Feel notes, not changed tonight** (in ROADMAP.md): the keyboard flare is touchy, approaches at 140–150 kt fly at about −1° pitch (VLS+5 is about 133 kt, where the sim flies +2.5–3°), the stick feel differs between the ground, Normal and flare laws, pushback is slow (about 100 s), and a lever left between detents gives manual thrust (that's how the real aircraft works).

### 07:33 KST: the whole suite green after the playtest fixes; landing feel job

- All guarded, after the playtest fixes:
  - `node --test tests/*.test.mjs`: **141 pass, 0 fail**;
  - `browser-e2e.mjs`: **12/12** (landed **C 67**: 393 ft/min, 1.94 g, 65 m past the aiming point, 1.6 m off the centreline);
  - `browser-gate.mjs` **5/5**, `browser-cpu.mjs` **6/6**, `browser-boot.mjs` **10/10**, `browser-rewind.mjs` **5/5**.
- **Landing feel job started** (deadline 09:15): make keyboard hand-landings flyable through the flare law and input shaping, judged by a node keyboard-pilot harness and a real-key browser landing. It must keep every test passing, or revert. The known-good `fbw.js` and `input.js` are backed up in `/tmp/flight-sim/lead/good-0732/`.

### 08:00 KST: keyboard landings are flyable

- **Landing feel job** (07:59), changes in `src/sim/fbw.js` only (`input.js` unchanged):
  - **The flare law:** the stick now commands a pitch rate (up to 8°/s nose-up, 3°/s nose-down) on the memorised attitude, capped at 7.5° and never more than 2° ahead of the actual pitch, with the pitch rate limited to ±3.5°/s. From 30 ft the nose still drops by 0.5°/s toward −2°, so hands off you still have to flare, as on the Airbus.
  - **A landing-configuration path law:** only in Normal law with the AP off, gear down and CONF 3 or FULL. The stick commands a flight-path rate (3.5°/s at full stick) around a path held hands off. Load-factor limits, α protection and pitch limits still apply after it. Everywhere else stick → load factor is unchanged.
- **Keyboard-pilot harness, before → after (70 t):**

  | Style | Before | After |
  |---|---|---|
  | hold S 1 s from 30 ft | −879 fpm, −0.3° | −255 fpm, +5.0° |
  | hold S 2.5 s | nose gear collapsed | −193 fpm, +5.7° |
  | hold S to touchdown | tail strike | −202 fpm, +7.5° |
  | four 180 ms taps | −807 fpm | −276 fpm, +4.9° |

  No style now goes above 7.6° pitch. Still firm: a late flare from 15 ft (about −740 fpm), and doing nothing (the law needs a flare). Full back stick in CONF 3/FULL now gives about 1.2–1.35 g instead of 2 g, though α protection still allows α max.
- **New:** `tests/sim-flare.test.mjs` (13 tests, keyboard ramp with human timing; 12 of them fail against the old law) and `tests/browser-keyboard-landing.mjs` (lands with real key events only).
- **Verified by the lead** (guarded):
  - `node --test tests/*.test.mjs`: **154 pass, 0 fail**;
  - `browser-e2e.mjs`: **12/12**, with the controller now landing **A 99** (203 ft/min, 1.34 g, 7.3°);
  - `browser-keyboard-landing.mjs`: **A 95** (222 ft/min, 1.39 g, 6.2° pitch, 60 m before the aiming point, 3.9 m off the centreline, no bounce).
- ROADMAP's "keyboard landing feel" item is resolved.

### 08:18 KST: final review fixed

**The final reviewer** (a subagent, 08:20; it reviewed everything since 06:19 and confirmed findings in node and Chrome) found 2 correctness problems and 6 minor ones. Fixed by the lead:

1. **Correctness:** the flare stayed on after touchdown, so a touch-and-go lifted off in the flare law (pitch held at 7.5° until 60 ft). Now `X.flare` clears whenever the aircraft is on its wheels (`flt` ≤ 0). The reviewer's `fbw-scen.mjs` touch-and-go: `flare false` throughout, climbing at 25° by 5 s.
2. **Correctness:** a go-around inside the flare was capped at 7.5° until 60 ft (15 s to 400 ft from 30 ft). Now, with the levers at TOGA, the flare law is left and can't re-engage, and the landing path law is skipped, so full back stick gets the plain load-factor pull.
   - Go-arounds to 400 ft: from 50 ft in 9.8 s (14.1 s before this fix; 10.6 s with the original law), from 30 ft in 10.0 s, from 100 ft in 8.9 s. The flare ends within 0.01 s.
   - A go-around from 15 ft while sinking still touches down at 610 ft/min (the original law: 557), with no crash.
3. Fixed by 2: the go-around pull in CONF FULL is back to about 1.6 g.
4. Callouts after a reset (a rewind, jump or skip that lands inside a call's re-arm band) now arm every height below the current one on the first update.
5. The terrain toast now fires once per autopilot setting, not at every 20 s re-run.
6. `predict-worker.js` catches a throw in the prediction loop and posts `type: 'error'`, so the caller is never left busy.
7. Renamed duplicate stand refs can't collide with a real one: it keeps counting until the ref is free, e.g. past Gimpo's "908-2".
8. Fixed the stale pull comment in `apron.js`.

Left as they were: the ND redraws a new route of the same length within about 50 m of movement; the Alternate-law go-around and stall still crash with full back stick held, the same as the original law, since Alternate law has no protections.

Checked OK by the reviewer:
- the pointer in every state: a 5×5 `elementFromPoint` grid with setup, the map, pause, logbook, crash and score showing;
- stall protection in CONF FULL (α 16.6°, alpha floor brings TOGA);
- Alternate law identical to the old law;
- AP engage and disengage in CONF FULL (0.86–1.11 g);
- the depth order and wheels on the apron and runway (`review3-*.png`);
- the worker terrain load's fallbacks and memory (about 33 MB);
- FCU heading 144 on 14R;
- the triangle cuts are conservative.

`node --test tests/*.test.mjs` after the fixes: **154 pass, 0 fail**. The full browser suite is rerunning.

## Final entry: 08:37 KST, Saturday 31 October 2026

**M1, M2 and M3 are all done and verified.** The wrap-up was done early (08:35–08:37), because the build was final and fully verified. There were no new features after 08:35.

### What works

- **Flight:**
  - The A321neo flight model with published numbers and their sources (`src/sim/a321neo.js`);
  - fly-by-wire Normal and Alternate law, with a keyboard-friendly flare law and landing path law;
  - LEAP-1A engines, reversers, gear, brakes and steering;
  - the holds-only AP and A/THR;
  - time compression to 16×;
  - the predicted path in a worker over the real terrain, map jumps, and skip to 15 nm final;
  - rewind, which keeps the gate flow going.
- **World:**
  - the real coastline and elevation for all of Korea, from Copernicus and OpenStreetMap;
  - land cover, procedural trees, fields and Korean apartment-slab cities, the sea and inland water;
  - Gimpo, Jeju and Incheon with runways, markings, lights and PAPIs, taxiways, aprons, numbered stands, jet bridges, terminals, parked aircraft in made-up liveries, and moving ground vehicles.
- **Ground ops:** gate starts, pushback (P), the taxi route drawn on the ground and on the ND, and taxi-in to a free stand after landing.
- **Screens:** the PFD, ND, engine panel and FCU; the map; flight setup; the landing score card and the logbook.
- **Sound:** synthesised engines, wind, gear, flaps, brakes, reversers and warnings, and the speech callouts with RETARD.
- **CPU and views:** a 60 fps cap; nothing runs while paused or hidden (audio suspended); the four views and the touchpad camera.

### What doesn't, or is weak

- **Nobody has listened to the sound.** It's measured offline (30/30 checks), but its timbre needs Shane's ears.
- **Gimpo stand 7** has no taxi route to 14L/32R.
- **Pushback is slow:** 1.5 m/s, about 100 s.
- **A late keyboard flare** (from 15 ft) is still firm, at about 740 fpm.
- **Alternate law has no protections,** by design, so full back stick held there stalls or strikes the tail.
- **The predicted path is a straight line** on the selected heading, because route following is on the roadmap.
- **AGENTS.md says the server is on 8004,** but GameDump is served on 8001 (Shane, 03:50). AGENTS.md is Shane's file, so it was left as it is.

### Verification (final, on the final code, all guarded, 08:18–08:36)

- `node --test tests/*.test.mjs`: **154 pass, 0 fail**.
- **`tests/browser-e2e.mjs`: 12/12.**
  - TOGA by keyboard; lift-off at 170 kt; the AP climb;
  - 8× compression (8.1× reached);
  - a map jump with a **0.00 m** miss;
  - skip to final;
  - a landing on Jeju 07 scored **A 99** (203 fpm, 1.33 g, 7.3°);
  - the taxi-in route to stand 15;
  - the callouts 2500 … 20, RETARD, 10;
  - no console errors.
- `tests/browser-keyboard-landing.mjs` (real keys only): **A 97** (224 fpm, 1.39 g, 6.4°).
- `tests/browser-gate.mjs` **5/5**: Gimpo gate → pushback → taxi to the 14R holding point.
- `tests/browser-cpu.mjs` **6/6**: 60 fps cap; 0 rAF and CPU 0.0% while paused or hidden; a prediction at about 30 ms.
- `tests/browser-boot.mjs` **10/10**: setup, Fly, keys, real-mouse FCU, camera and map after Fly, pause, and the hub player.
- `tests/browser-rewind.mjs` **5/5** and `tests/browser-predict-terrain.mjs` **4/4**.
- `tests/audio-render.mjs` **30/30** (05:16).
- **Screenshots** (final pass, 08:35, 1440×900 on the M5): **all 16 scenes at 60 fps**, 270k–909k triangles and 17–43 draw calls. All looked at. The labelled overview is **`Claude outputs/flight-sim/flight-sim-overview.jpg`**: the four views, Seoul and the Han, Hallasan, Jeju 07 on final, the map's predicted path, a Gimpo gate start, Incheon's gates with parked traffic, the landing score card, and the path ending at the terrain. Every shot is in `Claude outputs/flight-sim/`: `lead-*`, `e2e-*`, `world-*`, `aircraft-*`, `ui-*`, `bake-*`, `apron-*`, `traffic-*`, `polish-*`, `logbook-*`, `score-*`, `playtest-*`, `review3-*`.
- **Reviews:** three reviewer subagents (M1 at 04:23, M2/M3 at 06:10, late changes at 08:20) and one playtester (07:15). Every correctness finding is fixed; the details are in the checkpoints above.
- **Nothing left running:** `cpu-guard.py --status` shows no slots in use, and `--sweep` is clean. No browsers, node or bake processes remain. No servers were started tonight. The three Python servers on 8001, 8004 and one other port are days old and Shane's, so they were left alone.

### Registry and docs

- The `data/games.js` entry was added at 04:43, before `coming-soon-slot`, by a read-modify-write script. The hub player loads the game (`boot-3-hub-player.png`).
- README.md is final: how to run it (port 8001), the controls, flying tips, known issues, the code map, the test commands and the data credits.
- ROADMAP.md marks M1, M2 and M3 as Done. Its leftovers: Gimpo stand 7, pushback speed, and a real listen to the sound.
- The row for GameDump's root AGENTS.md "Current games" table is in the 04:43 entry.
- The Games project doc `claude/flight-sim-prototype.md` can't be reached from Claude Code. A Cowork session copies this log into it.

### What's next

1. **Shane flies it and listens.** The sound's timbre and the handling feel (rotation rate, flare, path law in CONF 3/FULL) are the main things to tune by hand.
2. **Roadmap items Shane named:** autopilot route following, then planned climb and descent and ILS capture (which make the predicted path bend along the route), and weather.
3. **Small:** a faster pushback, Gimpo stand 7's route, and AGENTS.md's port (8004 → 8001), which is Shane's file.

## Decisions made overnight

- **Magnetic variation** is a plane fitted to WMM2025 values at Seoul (−9.1°), Busan (−8.0°), Jeju (−7.6°) and Gangneung (−8.9°), in `frame.js`. It's within about 0.3° and needs no model file.
- **Map frame:** standard parallels 33° and 38°, origin 36° N 127.5° E, so the scale error stays under 0.1% across the map.
- **National grids at 250 m** for height, water and cover alike (PLAN.md says about 200 m for the coast and 100–200 m for the cover). One grid keeps the textures and the bake simple, and the 10 m coast patches cover the airports, where precision matters.
- **Grids are cell-centred and gzipped**, decoded in the browser with `DecompressionStream`, because Python's server can't send Content-Encoding.
- **The jump restores the worker's snapshot** at the chosen sample. That is the same integration the prediction ran, so the aircraft lands exactly on the line.
- **No questions to Shane:** he invited questions before he went to sleep, but PLAN.md answered everything, so none were asked.
- **A sixth, short job past the cap of 5 (03:35):** Shane said at about 03:34: "Subagent quota is completely lifted until 4:10am since that's when 5h limit resets." So a short **sound** job (`src/audio/synth.js`, the M3 engine and environment sound) started with a hard deadline of 04:08, so that from 04:10 at most 5 run again. It doesn't take anything from M1.
- **Four more short jobs before the reset (03:42–04:08):** Shane at about 03:41: "Any big token-intensive subagent jobs I recommend getting through before 4:10am." So four jobs, each with a hard 04:08 deadline and its own files, outside the M1 code: research notes `reference/notes/a321neo-performance.md`, `reference/notes/airports.md` and `reference/notes/airbus-fbw-ap.md` (they feed the sim, bake and world jobs), and the M2 groundwork `src/ground/taxi.js`, `src/ground/pushback.js` and `tests/taxi.test.mjs` (pure logic, not wired into the game).
- **Touchdown g** is measured as an accelerometer would (a 0.1 s filter), and the score's g penalty starts at 1.6 g. This sim's gear gives about 1.9 g at a firm 380–400 ft/min, which energy says is plausible for the stroke. The gear data is unchanged, because the sim's tests are calibrated on it.
- **The stand point is the nose** for gate starts, parked aircraft and the paved index alike. Gimpo's baked stand headings are corrected once at load, from the taxi lines at each stand.
- **Taxiways, aprons and stands count as `runway` (paved)** in `groundKind`, so the sim allows taxi speeds there.
- **Rewinds keep the gate flow going** with a fresh route. Jumps and skips clear it.
- **Sound stops entirely** (the AudioContext is suspended) while paused or hidden, to keep to the CPU rules.
- **Triangles near Incheon:** they were 1.14–1.21 M after M2. At 06:44 a distance tier for parked aircraft, culling empty city blocks and skipping clipmap rings beyond the horizon brought every scene under 1.0 M, with no visible change.
- **The two A321 PDFs are git-ignored** (`reference/docs/*.pdf`, 11 MB of Airbus and EASA documents). They can be downloaded again with PLAN.md's commands, and the numbers taken from them are in `src/sim/a321neo.js` with page references. `reference/notes/` (the research notes, 52 KB) stays tracked.

## 2026-10-31, morning: the build checked, and v0.1.0 prepared (Cowork session)

- **Checked against the M1 definition of done:**
  - `node --test tests/*.test.mjs`, rerun through the guard on the Mac's Linux VM (Node 22): 154 pass, 0 fail, both before and after the changes below.
  - Looked at `flight-sim-overview.jpg`, `aircraft-threeQuarter.png` and `aircraft-tail.png`. The four views, Seoul and the Han, Hallasan, the Jeju final, the map path, the gate start, Incheon's traffic and the score card are all there, and the livery is as Shane asked.
  - The registry entry is in `data/games.js`.
  - The end-to-end flight, the performance numbers, the reviews and the CPU checks rest on this log.
- **Shane's first flight:** Gimpo to Incheon, "mostly good (other than the 0/100 landing)".
  - In the code, `landingEndFor()` returns null when the touchdown point isn't on a runway. The scorer then keeps the runway picked in setup (Jeju 07 by default).
  - The centreline penalty, `(|cross| − 2) × 2.5`, has no cap.
  - That's a real flaw. Whether it caused this 0/100 is not confirmed: the score card's lines will tell.
- **v0.1.0 prepared:**
  - `Updates.md` (Satisfactory's system);
  - `src/version.js` (`Flight Sim v0.1.0 · CL#261031`), shown on the loading screen and in the pause menu;
  - `tools/push.sh`: the commit is titled with the version, then pushed, and the first run sets up the repository;
  - `.gitignore`: the repository note, plus `__pycache__/`;
  - `AGENTS.md`: the overnight-run section became State, plus Versions, Updates.md and pushing, and the port is 8001;
  - README: the version line, the code map row and the data licences;
  - ROADMAP: v0.1.0 in the Done column, plus the score issue;
  - "(M2)" taken off pushback in the pause menu and README.
- **For the public repository:** the absolute `/Users/<name>/…` paths in `tools/bake_common.py` and six `tests/browser-*.mjs` are now built from `__file__` and `import.meta.url`. All four checked resolve to `Claude outputs/flight-sim`.
- **In the browser pane on Shane's Mac** (`localhost:8001`): the game loads to Flight setup with no console errors, and both version labels read `Flight Sim v0.1.0 · CL#261031`.
- **Next:** Shane pushes v0.1.0 (`sh tools/push.sh v0.1.0`), then whatever he picks for v0.1.1. The score fix is a candidate.

## 2026-10-31, afternoon: v0.1.1 (Cowork session)

Shane, after pushing v0.1.0: "Let's work on some subupdates. I saw some taxiways at Incheon airport that were z-pinching the hell out of each other. Also, the cockpit windows of the A321 look strange ... let's try to fix that." He also asked for a main menu like Satisfactory's and scenarios. Those went to v0.2.0 (see ROADMAP), with two questions open.

- **Incheon's taxiways** (`src/world/apron.js`, `src/world/apron-geom.js`):
  - **The cause:** the pavement mesh drew concrete taxilanes and asphalt taxiways at the same height (the ground is flat at 7.0 m there) and with the same pull towards the camera (`PULL.taxi`). So where they overlap, the depth test picked a different one per pixel, in jagged wedges. RKSI has 55 taxilane ends outside aprons that sit on a taxiway.
  - **The fix:**
    - The pavement doesn't write depth any more, and draws after the terrain and the runways (`renderOrder = 1`).
    - Its triangles go in a fixed order, each drawn over the last: taxilanes, taxiways, then aprons and stand pads.
    - Nothing drawn later needs the pavement's depth: paint, shadows, the taxi route and lights are all transparent and sit on top.
  - **Also fixed:** `strokeTriangles()` skipped the join wedge for bends under about 2°. That left a gap on the outside of each slight bend, up to 35 cm at the edge of a 23 m taxiway, which showed as hairlines across taxiways.
    - Now every bend gets its wedge.
    - New test in `tests/apron.test.mjs`; it fails with the old threshold (checked).
  - **Seen in the browser pane** at RKSI (−93333, 162373):
    - before: `v011-taxiway-before.jpg`, `v011-taxiway-before-close.jpg`, `v011-taxiway-bend-gaps-before.jpg`;
    - after: `v011-taxiway-after.jpg`, `v011-taxiway-after-close.jpg`, `v011-taxiway-after-zoom.jpg`.
  - Also looked at: an apron with a jet bridge, a parked aircraft with its shadow, and Jeju's runways. Nothing else changed.
- **The cockpit windows** (new `src/cockpit-windows.js`; `src/aircraft.js`, `src/livery.js`, `src/cockpit.js`):
  - **The cause:** the six windows were polygons with straight edges in the fuselage's (x, θ) parameters, so the edges came out curved on the nose. The windshield was also narrow at the top. From the Captain's seat, its side post ran from about 15° left at the bottom to straight ahead at the top, across the view.
  - **The new design:**
    - Each window is designed from the Captain's eye: its corners are directions (azimuth, elevation), and each edge is where the plane through the eye and its two corners cuts the nose. So every frame is straight from the seat; the right side mirrors it for the First Officer.
    - The windshield's inboard corners sit on the centre post (body y = ±0.05 m), joined along the crown.
    - Angles from the Captain's eye: the windshield runs from the centre post to 40–44° left, the sliding window 48–90°, and the rear window 95–124°, narrower at the top. Sills are 17–24° below the eye, tops 12–20° above.
  - **Outside:**
    - The glass is geometry on the nose bone (`windowGlass()`): triangulated, split to 12 cm and set 6 mm proud of the skin. Its edges are crisp at any distance; the 2048-px atlas gave about 46 px per metre along the fuselage.
    - The atlas still paints the window dark (so the glass and the skin can't flicker against each other far away) with a 3 px dark frame.
    - The glass hides with the nose in the seat views.
  - **The cockpit shell's alpha map** covers only the upper half (v = θ / 180°, clamped), so the cut-out edges have twice the resolution.
  - **Screenshots:**
    - `v011-windows-three-quarter.jpg`, `v011-windows-front.jpg` and `v011-windows-side.jpg` (outside);
    - `v011-windows-captain.jpg`, `v011-windows-captain-left.jpg` and `v011-windows-fo.jpg` (the seats);
    - the old ones for comparison: `aircraft-nose.png`, `aircraft-captain.png`.
- **The landing score** (`src/score.js`, `src/main.js`, `src/ui/score-panel.js`):
  - **Which runway:** `landingRunway()` picks the runway of the touchdown, whichever it is, not the planned one. That's the runway whose pavement holds the touchdown point (with 2 m of grace), or failing that one within 60 m of it, lined up within 45°; at a crossing, the better lined-up one.
  - **Off a runway** (a taxiway or an apron; grass at speed is already a crash): points 0, grade F, the part "On a runway: no", and the verdict "That wasn't a runway." The logbook entry stores `offRunway`.
  - **Ceilings on every part** (`PENALTY` in `score.js`):
    - vertical speed 50: nothing from 60 to 250 ft/min, 30 at 600, 50 at 900;
    - peak g 15: from 1.9 g up to 2.6 g;
    - the touchdown point 35: ±150 m from the aiming point is free, long costs up to 20 (at 650 m), short up to 20, and short of the threshold 15 more;
    - the centreline 20: from 3 m to 16.3 m;
    - bank 15: from 3° to 8°;
    - pitch 15;
    - bounces 25, at 10 each.
  - **Peak g** is now the worst touchdown g: the sim's filtered value at the first arrival and at any bounce. It used to include the raw load factor every frame through the whole rollout.
  - **The score card and the logbook** use the touchdown's runway. They used to use the one under the aircraft when the rollout ended.
  - **The overnight test landings, rescored:**
    - 361 ft/min at 2.04 g: D 59 → B 87;
    - 392 ft/min at 2.16 g: D 51 → B 82;
    - a firm, long keyboard landing (740 ft/min, 2.5 g, 500 m long): 0 → F 29.
  - **Shane's 0/100:** most likely the old uncapped penalties adding up (a firm, long touchdown loses about 45 + 36–56 + 20–30). The wrong-runway fallback is the other candidate. Both are fixed.
  - New `tests/score.test.mjs` (6 tests): runway picking, crossings and margins, ceilings, peak g, bounces, off-runway.
- **Checks:**
  - `node --test tests/*.test.mjs` through the guard (VM, Node 22): **161 pass** (154 + 1 apron + 6 score). `--status` shows no slots in use; `--sweep` is clean.
  - `node --check` passes on every file in `src/`, `src/world/` and `src/ui/`.
  - A full landing in the browser pane on the Mac: `?test&…&start=final`, Jeju 07, with `tests/e2e-controller.js`. The pane was hidden, so this ran in an iframe whose `requestAnimationFrame` was driven by timers.
    - It scored **A 100, "Butter."**: 207 ft/min, 1.34 g, 161 m past the aiming point, 1.7 m left of the centreline, RWY 07.
    - The card, the taxi-in route and the logbook entry (RKSS–RKPC, 07, 100) came out, with no errors. Screenshot `v011-score-jeju07-A100.jpg`.
  - The game loads with no console errors, and both labels read `Flight Sim v0.1.1 · CL#261031`.
- **Found, not fixed:** Jeju's runways 07/25 and 13/31 are each drawn at their own end elevations (`uE0`/`uE1` in `airports.js`). Where they cross, 07/25 is at 23.86 m and 13/31 at 24.81 m, so each cuts through the other along a diagonal seam (`v011-jeju-crossing-seam.jpg`). The heightfield there follows 07/25. The fix would take one height for both at the crossing, from the heightfield, and draw the longer runway last. It's in ROADMAP and README.
- **Note for testing in Chrome:** Python's `http.server` sends no Cache-Control, so Chrome can keep serving old modules for a while after an update. A hard reload (Cmd+Shift+R) loads them all fresh.
- **v0.1.1 written up:**
  - `src/version.js` is `Flight Sim v0.1.1 · CL#261031`;
  - `Updates.md` has the v0.1.1 entry;
  - ROADMAP: the score item fixed, a "Found after v0.1.0" list, and the menu and scenarios row for v0.2.0;
  - README: the code map row and the Jeju seam under known issues;
  - AGENTS.md: State.
- **Next:** Shane pushes (`sh tools/push.sh v0.1.1`), then v0.2.0 (the main menu and scenarios) once he answers its two questions.

## 2026-10-31, evening: v0.1.2 (Cowork session)

Shane, after v0.1.1, with a screenshot of the nose from the front: "What I meant by the strange cockpit windows is that from the outside, the middle cockpit windows are much taller than they have to be, and it looks a little strange. From that reference photo, it should be thinner than the side windows. Also, the engine is all the way up to the wing like a 737 max, when it should be clearly below it. Also, I see that touching down on the grass just before the runway immediately crashes. In general, if you hit surface light enough with landing gear, it shouldn't trigger a crash. Package these into v0.1.2."

- **The windshield** (`src/aircraft.js`, `src/cockpit-windows.js`, `src/cockpit.js`, `src/livery.js`):
  - **The cause:** the nose's crown came down from x 16 m to the tip in one even slope of about 40°, so it was still high just ahead of the eye. For the pilots to see about 20° down over the nose (Airbus's visibility figure), the windshield had to reach a long way down that slope, so from outside it was taller than the side windows.
  - **The new nose** follows the A320 family's profile: the crown drops steeply over the windshield (x 17.6–19.35 m), then runs gently down the radome to the tip (`fuseTop`).
    - Each section is now two half-ellipses that meet at the old centre line (`fuseMid`, worked out from the crown before the cut): the upper one up to the crown, the lower one down to the keel. So only the top of the nose changed.
    - `fuseSection(x)` gives the centre line, the two half-heights and the half-width. `fusePoint()`, the window design, the glass and the cockpit shell all use it.
  - **The windows, redesigned on the new nose** with v0.1.1's method (corners as directions from the Captain's eye, in `WINDOW_DESIGN`):
    - the windshield: from the centre post to 40–44° left; its sill 17–22° below the eye, its top 14–16° above;
    - the sliding window: 48–90°; 24–26° below, 16–18° above;
    - the rear window: 95–117°; 20–24° below, 13–16° above, narrower at the top.
    - **From outside,** the windshield is now a band 0.62 m tall on the skin, against 0.83 m for the sliding window and 0.80 m for the rear one.
  - **The livery** keeps each window's dark backing 2 px inside the glass's outline, so it stays under the glass. On the steep nose the atlas is too coarse for v0.1.1's painted 3 px frame.
  - **The cockpit,** to stay inside the new skin: the instrument panel moved 0.24 m aft (`PANEL_X` = 19.14), the glare shield and the FCU moved back with it (the glare shield narrower and lower), and the overhead panel moved and tilted. A one-off check puts every corner of the interior boxes inside the inner skin (5 cm in from the outer); the closest is at 0.993 of the way.
  - **New `tests/aircraft-shape.test.mjs`** (3 tests):
    - the windshield's height on the skin is at least 0.1 m less than each side window's;
    - the Captain sees at least 17° down over the nose, and the windshield's bottom is at least 0.3 m below the eye;
    - the nacelles (below).
- **The engines** (`src/geometry.js`, `src/aircraft.js`, `src/sim/sim.js`, `src/world/traffic-models.js`):
  - **The cause:** the nacelles were drawn at the sim's thrust points (`ENGINES`, 1.75 m below the centre line), so their tops sat in the wing, like a 737 MAX's.
  - **Airbus's A321 AC** (Aircraft Characteristics):
    - The LEAP-1A nacelle's low point is 0.45 m above the ground at the maximum ramp weight (2-3-0, Ground Clearances; 0.465–0.532 m at lighter weights or other CG positions).
    - The heights of the flap-track fairings (2.61–3.38 m) and the sharklet's foot (4.08 m) put the wing about 0.3 m higher than v0.1.0 drew it.
  - **Now:**
    - The nacelles hang at `NACELLES` (`geometry.js`): low point 0.45 m above the ground, centre 2.25 m below the fuselage's centre line.
    - The wing's chord line at the fuselage side went from −1.35 m to −1.05 m (`WING_Z0`).
    - A new pylon runs from the top of the nacelle up to the wing's leading edge and back under the wing.
    - The main gear legs hang from inside the wing (pivot at z −0.9 m, braces up to −0.98 m).
    - The wingtip lights and strobes moved up with the wing (z 0.12 → 0.42 m).
    - Engine strikes (`CRASH_POINTS` in `sim.js`) are checked at the nacelles' new low points.
    - The thrust still acts at `ENGINES`, so the sim's pitch from thrust, and its calibration, are unchanged.
    - The parked aircraft (`traffic-models.js`): narrow-bodies' wings at −1.05 m with their engines 1.57 m above the ground, wide-bodies' at −1.8 m and 2.3 m.
  - New test: the nacelles' low point is 0.45 m above the ground, and their tops are at least 3 cm below the wing's lower surface.
- **Grass** (`src/sim/sim.js`, `src/sim/gear.js`, `src/sim/a321neo.js`, `src/score.js`, `src/ui/score-panel.js`):
  - **The cause:** any wheel touching anything but a runway above 15 m/s crashed the aircraft at once ("ran off the runway"), however gently it touched.
  - **Now:**
    - Off the pavement, a touchdown is judged as on a runway: only a hard one breaks the gear (`GEAR_BREAK_VS`, about 900 ft/min).
    - On grass the wheels roll heavier (rolling resistance 0.06), brake less (0.30) and grip less sideways (0.6 of the runway's). All [EST].
    - More than 450 m (`GRASS_RUN_M`) on the grass faster than 29 kt (`GRASS_SAFE_GS`, 15 m/s) still ends the flight ("ran off the runway"). Slower, the grass can't hurt the gear. Water still ditches at once.
    - The touchdown event records what the first main wheel landed on (`surface`).
  - **The score:**
    - `landingRunway()` tries, in order: the pavement (with 2 m of grace), within 60 m of it, then up to 400 m short of a threshold and within 15 m of the runway's sides, lined up within 45°.
    - "On the grass: yes" costs 25 points (`PENALTY.grass`).
    - A landing off the side onto the grass gets the verdict "Off the side, onto the grass." A short one keeps "Short of the threshold. Far too close."
  - **Tests:**
    - `tests/sim-ground.test.mjs`: "a light touchdown on the grass short of the runway is fine; a run across the grass is not".
    - `tests/score.test.mjs`: "main wheels on the grass: short of the threshold, or off the side", and new cases in the runway picking: 300 m short counts (from either end), but not 300 m short and 100 m off to the side, 500 m short, or 300 m past the far end.
  - **Through the game** (`main.js`, in headless Chromium in the cloud container): `?test&origin=RKSS&dep=14R&dest=RKSI&arr=33L&start=final`, flown by `tests/e2e-controller.js` with its aim moved short of the threshold:
    - aimed 150 m short: it floated to 8 m short of the threshold, on the pavement there. C 68, "Short of the threshold. Far too close."
    - aimed 300 m short: touched down on the grass **157 m short** at 233 ft/min and 1.45 g, rolled onto the runway, no crash. **F 40** (the touchdown point −35, on the grass −25), "Short of the threshold. Far too close."
    - aimed 450 m short: on the grass **311 m short** at 236 ft/min, no crash, F 40. With `GRASS_RUN_M` at 300 m, a run like this one ended on the grass ("ran off the runway"), so it went to 450 m.
    - Each run takes about 2.5 minutes: `requestAnimationFrame` is faked so that each frame is 0.1 s of sim, and nothing is drawn until the score card.
- **Checks:**
  - `node --test tests/*.test.mjs` through the guard (VM, Node 22.23.4): **166 pass** (161 + 1 sim-ground + 1 score + 3 aircraft-shape). `--status` shows no slots in use; `--sweep` is clean.
  - `node --check` passes on all 101 `.js` and `.mjs` files in `src/` and `tests/`.
  - **Renders:** the browser pane on the Mac doesn't draw while it's hidden, so the stills came from the cloud container: headless Chromium with SwiftShader WebGL, the game served with no-store headers, the camera placed by script, and each frame read back from the canvas. All from the final code, with no console errors:
    - outside: `v012-front-above.jpg` (Shane's angle), `v012-front-level.jpg`, `v012-front-three-quarter.jpg`, `v012-side.jpg`, `v012-windows-side.jpg`, `v012-whole.jpg`;
    - the engines: `v012-engine-front.jpg`, `v012-engine-side.jpg`, `v012-engine-under.jpg`;
    - the seats: `v012-windows-captain.jpg`, `v012-windows-captain-left.jpg`, `v012-windows-fo.jpg`.
  - **Not done:** a look in Chrome on the Mac's GPU. Worth one after the push (with a hard reload).
- **A slip:** to compare with v0.1.1's cockpit, I ran `git show HEAD:src/cockpit.js` in this folder. It only reads, and nothing changed, but the house rule allows no git here beyond `GIT_OPTIONAL_LOCKS=0 git log`.
- **Written up:**
  - `src/version.js` is `Flight Sim v0.1.2 · CL#261031`;
  - `Updates.md` has the v0.1.2 entry;
  - ROADMAP: the three items under "Found after v0.1.0", fixed;
  - AGENTS.md: State.
- **Next:** Shane pushes (`sh tools/push.sh v0.1.2`), then v0.2.0 (the main menu and scenarios) once he answers its two questions.

## 2026-10-31, night: v0.1.3 (Cowork session)

Shane: "One thing about the landing score, though. It is too lenient in a way? I got 100/100 for a landing that was ok but had obvious flaws. Use my recent recent as a baseline and give that a 80/100 score. Make it so that it is nearly impossible to get 100/100, and similarly for 0/100. Also, in the paused menu, add a master volume control bar. Also, Satisfactory has a text bar on the top that tells you a bunch of performance stats like triangle count, ms per frame, all that. Can you put something similar for flight sim? Call this 0.1.3."

His answers to the v0.2.0 questions: "1. Yes, the saved state including the plane's location, speed, roll, everything, so that when you reload a scenario after doing a another, it is exactly where it was before. 2. I'd say stick with a still picture. Don't make these two changes until its time for v0.2.0 though."

The baseline landing's numbers are in his Chrome's logbook, so I asked for them: "the landing was like 2m left of the centerline, 150m past the touchdown zone, with an approach that was ... questionable. My altitude was like 150 feet like a kilometer from the runway so I had to 'bob' in the air. The touchdown rate was 190 feet/min though." I took "150m past the touchdown zone" as 150 m past the aiming point (what the card shows). Under v0.1.2, 150 m long was free, while 650 m past it would have cost points.

- **The landing score** (`src/score.js`, `src/ui/score-panel.js`, `src/ui/logbook.css`, `src/main.js`):
  - **Why it was lenient:** v0.1.1's penalties all had free bands (60–250 ft/min, ±150 m from the aiming point, 3 m from the centreline, 3° of bank, up to 1.9 g). His landing (190 ft/min, 150 m long, 2 m off) lost nothing, and the approach wasn't scored at all.
  - **Now:** points = round(100 × e^(−C)), where C is the sum of the parts' costs (`COST`). Each cost is 0 only at its ideal and grows smoothly away from it (quadratic, or quadratic then linear):
    - vertical speed (ideal 130 ft/min), peak g, the touchdown point against the aiming point (short costs more, and short of the threshold 0.3 more), the centreline, and bank;
    - pitch: a shallow bowl around 5.5°, steep below 2.5° and above 8°;
    - bounces 0.2 each, grass 0.35, off a runway 2.3.
  - **The approach** (`approachStats()`), from a track the scorer now keeps: a sample every 0.25 s in the air, for the last 5 minutes. A rewind trims it; a lift-off or a go-around clears it.
    - Between 1,000 and 100 ft (the wheels above the threshold), lined up within 10°: the RMS deviation in dots from the PFD's glideslope (3° from 300 m past the threshold, 1 dot = 0.4°) and localizer (from the far end, 1 dot = 0.8°), each clamped at 5 dots.
    - Between 1,000 and 50 ft: the sink rate's swing, the standard deviation of (sink rate − groundspeed × tan 3°).
    - With less than 20 s of the window flown, there are no approach parts.
  - **The card:**
    - Each part's points lost are the total loss shared out in proportion to the costs (largest remainders first), so they add up.
    - Below 90 points, the verdict names the biggest flaw if it cost 3 points or more. Otherwise it gives the band text; "Firm but fine." became "Fine, with a few things to tidy."
    - The value column is wider, for "1.2 dots low" and "±90 ft/min".
    - The grades are unchanged. New logbook entries record the game's version.
  - **The calibration:** his landing, rebuilt in `tests/score.test.mjs`.
    - The profile: on the PFD's path until 3.1 km out, then down more steeply to 150 ft 1 km out, level until back on the path, then down it, smoothed over ±1.5 s. That's 0.81 dots RMS (low) and 200 ft/min of swings.
    - With 190 ft/min, 150 m long and 2 m left, plus 1.3 g, 0.5° of bank and 6° of pitch (these three assumed), it scores **80 (B)**: "Off the path on final (low)."
    - The costs: approach path 0.078, swings 0.049, the touchdown point 0.050, the centreline 0.030, the rest 0.018.
    - The same touchdown after an on-path approach scores 91 (A).
  - **Other anchors** (unit tests):
    - perfect: 100;
    - very good everywhere (160 ft/min, 1.15 g, 30 m long, 0.5 m off, 0.5° of bank): 97–99;
    - firm and long (740 ft/min, 2.5 g, 500 m long, 6 m off): F, 10–30;
    - each single worst-plausible part (900 ft/min, 2.6 g, 1 km long, 20 m off, 7° of bank, 9.5° of pitch, 3 dots all the way): 20 or more;
    - everything bad at once: 2 or less;
    - a perfect touchdown on a taxiway: 10.
  - **Through the game:** `main.js` in headless Chromium in the cloud container, flown by `tests/e2e-controller.js`, RKSS to RKSI 33L from `start=final`.
    - Its normal approach: **B 89**. That's 237 ft/min, 1.47 g, 140 m long, 0.4 m off, the approach 0.4 dots high (the controller aims at 400 m, above the PFD's path from 300 m), and swings of 0.
    - Aimed short so it was 134–149 ft up 1 km out, then put back on its normal aim: **C 73** and **C 65** in two runs. That's 1.2–1.3 dots low, 90 ft/min of swings, and touchdowns 166–208 m before the aiming point, with the verdict "Off the path on final (low)."
    - The controller recaptures the path smoothly, so it doesn't bob as Shane did. The rebuilt profile in the test is the yardstick.
    - Screenshot: `v013-score-card-low-approach.jpg`.
- **Master volume** (`index.html`, `style.css`, `src/main.js`, `src/audio/synth.js`, `src/audio/callouts.js`):
  - A slider in the pause menu, 0–100% in 5% steps, saved as `settings.volume`.
  - It scales the synth's master gain (`FULL_VOLUME`, 0.8 at 100%, the old level) and the callouts' voice (0.9 × the volume; silent at 0).
  - The audio stops while paused (the CPU rules). So on release, the slider plays 0.6 s of sound and a short tone (`synth.blip()`) at the new level, then stops it again.
  - Checked in the container: a click at 40% gives 40%, a master gain of 0.32 and the callouts at 0.4, all saved, and they come back after a reload. Screenshots: `v013-pause-menu.jpg`, `v013-pause-menu-volume-40.jpg`.
  - Not done: listening to it.
- **Performance readout** (`index.html`, `style.css`, `src/main.js`, `src/ui/hud.js`):
  - **Before:** Satisfactory's is one line at the top (fps, ms/frame, draws, tris, items, sim ms/tick, buildings, belts), off by default, on F3 or a setting. Flight Sim's was a small two-line box under the FCU.
  - **Now:** a 22 px bar across the top. F3, ` or the pause menu's "Performance readout" button toggles it; it's saved as `settings.showPerf` and refreshed every 0.5 s.
  - It shows: paused · fps · ms/frame (sim, draw) · physics steps · draws · tris · the GPU's geometries, textures and shaders · terrain rings · buildings · lights · the canvas size · the JS heap (Chrome only) · time compression.
  - While it shows, the HUD moves down (`hud.setTopInset(22)` moves the FCU's top and the panels), and so does the map's top bar.
  - Checked in the container: the bar's text; the FCU's top at 30 px with the bar and 8 px without; the PFD 21 px lower; the menu's toggle; and the setting saved across a reload. Screenshot: `v013-perf-bar.jpg`.
- **Jeju 31's glideslope** (`src/ui/common.js`):
  - **The bug:** `thresholdOf()` added an end's `displacedM` to its x, y, but the airport data already puts x, y at the landing threshold (`pavementEnd` is the physical end).
  - **The effect:** only RKPC 31 has a displaced threshold (411 m). Its PFD glideslope and localizer, and the route's end on the ND, the map and the setup screen, were 411 m too far down the runway. On the real path 3 km out, the PFD showed 0.83 dots low.
  - **The fix:** it now returns x, y.
  - New test in `tests/ui.test.mjs`. The old function puts that end's threshold 411 m off (checked with a script), so the test fails with it.
- **How the screenshots were taken:**
  - In the container, headless captures hang once the game is up. SwiftShader WebGL keeps the GPU process busy, and even a static page in the same browser times out.
  - So each picture is a snapshot: frames throttled to 2.5 a second, the page cloned with each canvas swapped for its image, then opened in a second page without scripts and captured there.
- **Checks:**
  - `node --test tests/*.test.mjs` through the guard: **171 pass**. That's 166 − 7 old score tests + 11 new ones + 1 ui test; the logbook's verdict test gained cases.
  - `node --check` passes on all 101 files. `--status` shows no slots in use; `--sweep` is clean.
  - Not done: a flight in Chrome on the Mac.
- **v0.2.0:** both questions are answered (above), and ROADMAP and AGENTS.md now have them. Not started, as Shane asked.
- **Written up:**
  - `src/version.js` is `Flight Sim v0.1.3 · CL#261031`;
  - `Updates.md` has the v0.1.3 entry;
  - ROADMAP: two items under "Found after v0.1.0", and the v0.2.0 decisions;
  - README: the controls row, the score and the volume;
  - AGENTS.md: State.
- **Next:** Shane pushes (`sh tools/push.sh v0.1.3`), then v0.2.0.

## 2026-10-31, 23:15 KST: the handoff (Cowork session)

Shane: "Leave the appropriate handoff documents in the folder. This chat has gone for quite a long time."

- **New `HANDOFF.md`:** where things stand (versions, what's pushed, what no agent has checked yet), v0.2.0 (his decisions word for word, what a save has to hold beyond `sim.snapshot()`, what's still to settle), the other open items, how the recent changes work, how to work from a Cowork session, the pitfalls hit, working with Shane, and a first message for a new chat.
- **`AGENTS.md`** points to it at the top and in its files table. **README** has a row for `tests/cloud/`.
- **New `tests/cloud/`:** this session's container tools, cleaned up so they run from their new place:
  - `serve.py`, a static server with no caching;
  - `snap.cjs`, pictures of the live page;
  - `stills.cjs`, free-camera and seat stills;
  - `land.cjs`, landings through `main.js` in the modes normal, low and short;
  - `ui-shots.cjs`, the performance bar, the pause menu and the volume.
- **Checked from their new place,** in the container, with its copy hashed identical to the Mac's (66 files):
  - `stills.cjs` made a still in 36 s;
  - `land.cjs short RKSI 33L 300` touched down on the grass 156 m short of the threshold, with no crash. It scored **F 21** under v0.1.3's score; the same kind of undershoot scored F 40 under v0.1.2's;
  - `ui-shots.cjs` passed every check: the bar's text, the FCU at 30 px, the volume at 40% (master gain 0.32, callouts 0.4), the menu's toggle, and the settings after a reload.
- **The project doc** lists `HANDOFF.md` among the working copies.
- **Pushed:** Shane pushed v0.1.3 at 23:01 KST (`7bd1a6c`), before these handoff files were written. They go in with the next push.
- **Next:** v0.2.0, when he says so.

## 2026-11-01, 00:35 KST: picked up; Shane's 11 roadmap additions (Cowork session, the second agent)

A new Cowork chat picked the game up from `HANDOFF.md`. Shane: "You are the second agent on the Flight Sim project in GameDump. Take a look at the handoff document there."

- **Checked at pickup** (2026-10-31, 23:21 KST):
  - `GIT_OPTIONAL_LOCKS=0 git log --oneline -5`: `7bd1a6c v0.1.3` on top, so nothing has been pushed since the handoff;
  - `node --test tests/*.test.mjs` through the guard: **171 pass**, 3 s, peak 0.42 GB;
  - `node --check` on all 101 `.js` and `.mjs` files: clean;
  - the guard: `--status` shows no slots in use, and `--sweep` is clean;
  - the project doc already had the handoff entry.
- **Saves stay in the browser.** Shane asked whether Satisfactory's saves really live in the browser (yes: Chrome's localStorage at the page's address, not the folder). I offered to also copy each Flight Sim scenario into `games/flight-sim/saves/` through Chrome's File System Access API. Shane: "Nah its fine. Keep it browser." Recorded in ROADMAP's v0.2.0 row and in HANDOFF's decisions.
- **Shane's 11 future additions** ("Add these to the roadmap."), in a new ROADMAP table in his words, with notes:
  1. a parts "warehouse" (GE90s on an A321);
  2. leaving the seat on autopilot, and walking the cabin;
  3. the A330, B737, B747, B777 and B787, with their variants;
  4. terminals with windows and faint insides, maybe walkable;
  5. UI fixes, and a new font;
  6. changing the route in flight;
  7. other aircraft and ATC, without collisions;
  8. the terminals' lounges;
  9. engine shutdown, gear-up landings and every emergency;
  10. every kind of weather, and a night sky like Satisfactory's;
  11. crash physics.

  Where they overlap the older rows (more aircraft types, ATC, other traffic, weather), each points to the other. Night and aircraft systems were candidates, so they left that list; autobrake stays on it.
- **Two bugs in item 5**, listed as open under "Found after v0.1.0" and not reproduced yet:
  - "I can't change the autopilot's heading from 066": the HDG knob turns only by scrolling over its window (`src/ui/fcu.js`).
  - "I can't select a point on the path we are given": a jump is offered only for a click within 9 px of a predicted-path sample (`hitSample()` in `src/ui/map.js`), and the samples are 5 s of flight apart.
  - Why the checks missed them: `tests/browser-ui.mjs` scrolled the FCU and confirmed a jump on the mock page `tests/dev-ui.html`, with mouse-wheel notches of 100, and the e2e flight set its heading and jumped through test hooks (`setHdg`, `jumpTo`). Nothing went through the game itself with a trackpad's small scroll steps.
- **Who builds a version** (Shane: "if a job is very big, it is probably better to hand it to a Claude Code agent. ... This is for when you increment the second decimal. For the third decimal, doing it directly from cowork is fine."): recorded in `AGENTS.md` → Versions and in HANDOFF. So v0.1.4 can be done in Cowork, and v0.2.0 goes to a Claude Code agent.
- **Next:** Shane chooses v0.2.0's scope, and whether v0.1.4 (the heading, the path click and the small leftovers) comes first.

## 2026-11-01, 02:08 KST: v0.1.4 (Cowork session, the second agent)

Shane: "Do the heading, path click, and the leftovers, and the font for 0.1.4 right now. That will be fine to do here on cowork. 0.2.0 can run overnight after that, with the whole game changes."

Asked while building, with no answer by the end: how he had tried to change the heading (scroll or click), and whether the autopilot was on when he clicked the map. The fixes below cover every case.

- **The FCU heading** (`src/ui/fcu.js`, rewritten; `src/ui/ui.css`):
  - **Reproduced** in the game in headless Chromium at DPR 2 (`?start=final`, RKSS to RKPC 07): the FCU heading starts at 066, Jeju 07's course. Scrolling over HDG did turn it: +2 for 100 px of 4 px trackpad steps, +1 per wheel notch. But nothing on screen said a window scrolls, and a click only pushed the knob.
  - **Now:**
    - A click opens the window for typing: digits, then Enter or a second click sets the value and pushes the knob. ALT starts a level change and V/S engages V/S; Enter alone pushes, as a click did.
    - ALT under 1,000 is a flight level; V/S of 60 or less is in hundreds.
    - Esc, a click elsewhere or any flying key closes it unchanged, and the key goes on to the game. ↑ ↓ step it (Shift: big steps).
    - A capturing keydown takes the digits first, so 6–0 don't move the flaps.
    - Scrolling is 12 px a step (was 25), with big steps when more than 6 steps come in 0.3 s (10°, 10 kt, 1,000 ft, 500 ft/min).
    - Tooltips on the windows; a row in the pause menu's keys.
  - **Checked in the game** (`fcu-map.cjs`, scratch):
    - fonts loaded;
    - 60 px of slow scrolling: 66 to 71;
    - a flick: 71 to 240;
    - a click opens the window;
    - typed 250 + Enter: HDG 250, and the flap lever unmoved (0 is FULL);
    - ALT typed 120: 12,000 ft, OP CLB;
    - V/S typed −15: −1,500, V/S;
    - Esc: unchanged, not paused;
    - G: closes the window and still moves the gear lever;
    - ↑ then Shift+↑: 250 to 261.
    - With the clock faked (`recheck.cjs`), 8 s after typing 250 the AP is banking 25° left towards it.
- **The path pick** (`src/ui/map.js`):
  - **Reproduced:** a click on one of the path's dots offered the jump. At the default zoom the dots are 0.6 px apart, so clicks hit. Zoomed in they're tens of px apart, and the 9 px rule missed between them. The magenta line never jumps.
  - **Now:** `hitSample()` measures to the line between samples (12 px) and takes the nearer sample. `hint()` says why a click on the magenta line doesn't jump (AP off: no bright path; AP on: turn the HDG towards the line).
  - **Checked:**
    - samples 83 px apart, a click halfway (42 px from each): "Jump to +3 min, 4900 ft?";
    - Jump moved the sim 125 s ahead and closed the map;
    - AP off, a click on the magenta line: "Turn the autopilot on (Z): its bright path is where you can jump to."
- **Gimpo stand 7** (`src/ground/taxi.js`):
  - **Survey:** a gate start from every stand to every runway end at the three airports, 3,888 in all. Only RKSS 7 failed, and to all four ends, not just 14L/32R.
  - **The cause:** the boot takes stand 7's heading from the taxi lines (136° to 46°, no lead-in). Its pushback then ends on a 7-node piece of taxi line whose bend, not an end, passes 14.3 m from the network, so neither the crossings nor the end joins linked it.
  - **The fix:** `bridgeIslands()` links any piece within 30 m to the nearest point of the network. A link onto a runway centreline is a join (pw 0.5), and a link across a runway is marked as a crossing. `graph.bridges`: RKSS 2 (stand 7's piece and a 17-node D1 piece by a runway), RKPC 1, RKSI 0.
  - **Checked:** unit tests (a synthetic island 14 m off is bridged, one 40 m off isn't; stand 7 with its boot heading routes to all four ends). `gate7.cjs`: "Stand 7. Pushback: P to start", a route of 2,768 m via R P P5 P G2.
- **Pushback** (`src/main.js`, `src/ground/gate-flow.js`):
  - **Measured** (all 612 stands): a median of 60–70 s per airport, p90 84–148 s, max 160–174 s (up to 256 m pushed).
  - **Now:** = speeds a pushback up to 4× (`PUSH_MAX_RATE`). The tug moves by the sim time actually stepped, and the rate drops to 1× when the pushback ends or is held. The status line says "= speeds it up".
  - **Checked** (`gate7.cjs`, clock faked): = twice gives 4×, and a third is refused ("Pushback: up to 4×"). The pushback took 39 s of sim in 98 frames of 0.1 s (4.0×), then 1× and "Pushback complete…".
- **Jeju's crossing** (`src/world/runways.js`, `heightfield.js`, `glsl.js`, `airports.js`):
  - **Measured on v0.1.3** (scratch `seam.mjs`):
    - the centrelines cross 2,636 m along 07/25 (of 3,174) and 591 m along 13/31 (of 1,884), at 67°;
    - there the two straight profiles differ by only 0.10 m (23.86 against 23.76), but the slopes differ (−0.10% and +0.64%);
    - `heightAt` took the last rect's profile wherever both flat zones overlap, so along 07/25's centreline the ground was up to 0.69 m under its drawn surface, at 2,430 m.
  - **Now:**
    - `runwayCrossings()` ranks an airport's runways by length. The shorter of a crossing pair gets two knots, at the longer one's drawn edges (half width + shoulder) and at its height there, and a `cutBy`.
    - `profileAt()`/`rectElev()` give the surface. `heightAt` and the GLSL `flattenRunways` share one rule: on a runway's pavement (shoulders included), that runway's surface, the longer one's where two cross; off the pavements, a blend weighted by exp(−distance/8 m). For a lone runway nothing changes.
    - The runway mesh takes the knots (`uKnots`), and the shorter runway's fragments on the longer one's pavement are discarded (`uCutA`/`uCutB`), along with its lights there.
  - **Checked:**
    - `tests/runways.test.mjs`: the ground on every runway at the three airports is within 5 mm of its surface, the knots sit on 07/25's drawn edge at its height, and the ends keep their published elevations.
    - Stills `v014-jeju-crossing-above/on-07/on-13`: 07/25 whole through the crossing, no seam.
    - Landings with `land.cjs normal`:
      - RKPC 07: B 88 (217 ft/min, 1.37 g, 161 m long);
      - RKPC 25: B 88 (254 ft/min, 1.56 g; the touchdown 524 m past the threshold, at the crossing, no bounce);
      - RKSI 33L: B 89 with v0.1.3's exact figures (237 ft/min, 1.47 g, 140 m long, 0.4 m off).
- **Fonts** (`vendor/fonts/`, `style.css`, `src/ui/ui.css`, `src/ui/logbook.css`, `src/ui/common.js`, `src/main.js`, `src/ui/pfd.js`):
  - **The choice:** a sheet of three options was sent to Shane (`v014-fonts-options.jpg`), and I went with B as no answer had come: B612 on the screens and FCU, Barlow in the menus. Switching is `--font` in style.css and `FONT` in common.js.
  - **Vendored:** 8 woff2 files from @fontsource 5 (OFL-1.1): B612 400/700, B612 Mono 400/700, Barlow 400/500/600/700, and the three licence texts. Credited in the README.
  - **Loading:** `main.js` loads them before the HUD is made (at most 3 s).
  - **The PFD:** with B612 the altitude tape's three-digit labels hit the ticks, the hundreds at FL350 stuck out of their box and the drum's digits were cut. `fitSize()` sizes them to their windows; checked at FL350 and on final on `tests/dev-ui.html`, which now links `style.css` and loads the fonts.
  - **Buttons:** darker, and Resume is primary. The two new key rows were shortened so nothing wraps.
- **Checks:**
  - `node --test tests/*.test.mjs` through the guard: **175 pass** (171 and 4 new);
  - `node --check`: 106 files (`.js`, `.mjs`, `.cjs`);
  - the guard: `--status` shows no slots in use, `--sweep` is clean;
  - the container's copy hashes the same as the Mac's (76 files, `6426422c…`).
- **Screenshots** in `Claude outputs/flight-sim/`: `v014-fonts-options`, `v014-fcu-typing`, `v014-hud`, `v014-map-jump`, `v014-map-ap-off`, `v014-pause-menu`, `v014-screens-fl350`, `v014-screens-approach`, `v014-setup`, `v014-jeju-crossing-above`, `v014-jeju-crossing-on-07`, `v014-jeju-crossing-on-13`.
- **Not done:** a flight in Chrome on the Mac; listening to the sound.
- **Written up:** `src/version.js` (`Flight Sim v0.1.4 · CL#261101`), `Updates.md`, `ROADMAP.md`, `README.md`, `AGENTS.md` (State), `HANDOFF.md` (status, open items, how the changes work, two pitfalls).
- **Next:** Shane pushes (`sh tools/push.sh v0.1.4`), then the overnight Claude Code run for v0.2.0.

## 2026-11-01, 02:10 KST: the brief for the overnight v0.2.0 run (Cowork session, the second agent)

- **New `V020.md`:** the brief for a Claude Code run, per Shane's rule (a second-decimal version goes to Claude Code). It holds:
  - his decisions, in his words: the menu like Satisfactory's, a scenario as a save slot with the whole state, a still backdrop, saves in the browser, and "the menu screen with all the scenarios saved, with general controls and all that";
  - Claude's four defaults, which he hasn't changed;
  - the Must list: the main menu, the scenarios (state, store, autosave, names, Load, New scenario, migration), one tagged logbook, Settings and Controls, the pause menu, the version;
  - the stretch: changing the route in flight, row 6, not confirmed by Shane;
  - the definition of done, with the round-trip test (positions within 1e-6 m after both sims step on) and a scripted Chrome check;
  - the run's rules, and where things are;
  - the starting prompt and `/goal`, with a deadline of 11:00 KST today, Sunday 1 November, which Shane can change.
- **`AGENTS.md` and `HANDOFF.md`** point to it.
- **Next:** Shane pushes v0.1.4, then starts the run from the GameDump folder.

## 2026-11-01, 04:06 KST: night added to the v0.2.0 brief (Cowork session, the second agent)

- **Shane:** "Should we add the adding the Satisfactory-like night thing to the list as well, with the city gaining point-source lights like looking out from a plane window, with runways appropriate lit up?" Of the menu and scenarios alone, he said: "I don't think that will take anywhere near 7 hours."
- **His answers:**
  - **the sky:** Earth's, in Satisfactory's look: real stars, the Milky Way and one Moon with its phases (not Satisfactory's gas giant, cracked planet and dwarf star);
  - **the clock:** "Satisfactory has an adjustable clock that can be opened via Cmd+L. Maybe have an adjustable thing similar to that?"
- **`V020.md`** now has two parts. Part 2 starts once Part 1 (the menu and scenarios) is done and verified, and the game stays pushable if it isn't finished. Part 2, in order:
  1. a clock in KST with a date, running with the sim, and a Sky window like Satisfactory's (its sky view, a 24-hour track, play and pause, speed, jumps, the date). It opens on L and on Cmd/Ctrl+L;
  2. Earth's night sky;
  3. city lights from the urban cover;
  4. the airports at night;
  5. the A321's lights by phase of flight;
  6. the cockpit at night.
- **Decided here:**
  - **Cmd/Ctrl+L** is the one exception to PLAN.md's no-Ctrl rule, which is about Ctrl+W closing the tab. If a browser keeps the shortcut, its address bar just takes the focus. L alone works too. The overnight agent notes the exception in PLAN.md.
  - **A new flight starts at Now** (the real time in Korea, as in MSFS) unless another time is picked. A migrated Scenario 1 starts in the afternoon.
  - **The done list:**
    - sunrise, sunset and noon elevation in Seoul on 21 June and 21 December 2026, and the Moon full on 24 November and new on 9 November, all computed with PyEphem for the brief;
    - night screenshots;
    - 60 fps at night over Seoul, within the game's budget of about 1 M triangles and 300 draw calls.
- **Removed from the brief:** the stretch, changing the route in flight. It stays as ROADMAP row 6.
- **Updated:**
  - the starting prompt and `/goal` for both parts (the deadline is still 11:00 KST);
  - ROADMAP: row 10 and the open decisions;
  - AGENTS.md (the files table and Next);
  - HANDOFF.md: night as decision 4, the clock in the save, and the four defaults marked settled instead of "still to settle".

## 2026-11-01, 04:10 KST: v0.2.0 run started (Claude Code, overnight)

- **Read:** root `AGENTS.md`, `AGENTS.md`, `HANDOFF.md`, `V020.md`, the newest STATUS entries, `ROADMAP.md`. Deadline 11:00 KST; wrap-up from 10:30.
- **Baseline:** `python3 tools/cpu-guard.py --minutes 10 -- bash -c 'node --test tests/*.test.mjs'`: 175 pass, 0 fail. Guard `--status`: no slots in use; `--sweep`: clean.
- **Servers:** Shane's `http.server` on 8001 (pid 52374, not mine, left alone). Mine: `tests/cloud/serve.py` on 8014 (pid 42575, in `/tmp/flight-sim/pids`).

## v0.2.0 interfaces (the contract between tonight's jobs)

**Scenario store** (`src/scenarios.js`, job "store"):
- `NAME_MIN = 3, NAME_MAX = 40`, `cleanName(s)`, `nameOk(s)` (as Satisfactory's).
- `INDEX_KEY = 'gamedump:flight-sim:scenarios'` → `[{ id, name, created, savedAt, summary: { route, where }, legacy? }]`; `SCEN_PREFIX = 'gamedump:flight-sim:scenario:'` + id → `{ v: 1, id, name, savedAt, state }`.
- `new ScenarioStore(storage)` (a Storage-like object: getItem/setItem/removeItem; a Map wrapper in tests):
  - `list()` newest `savedAt` first; `get(id)` → the record or null; `newest()`;
  - `create(name, state, summary)` → `{ ok, id, entry, error }`; `write(id, state, summary)` → `{ ok, error }` (refused write: `ok: false, error: 'quota'`, nothing in the index changes); `rename(id, name)` → `{ ok, error }`; `remove(id)` → bool;
  - `defaultName()` → "Scenario N", the lowest N not taken;
  - `migrate()`: no index yet and a `lastflight` → "Scenario 1" with `legacy: true` and `state = { v: 1, fresh: true, plan: lastflight, clock: afternoon }`; returns the entry or null. Never deletes or rewrites `lastflight`, `logbook`, `settings`.
- `whereText({ onGround, altFt, distNm, destIcao, phase, icao, stand, crashed })` → "FL350, 120 nm to RKPC" / "4,500 ft, 30 nm to RKPC" / "Parked at RKPC stand 12" / "Taxiing at RKSS" / "On the runway at RKSS".
- `savedText(ms, now)` → "just now", "5 min ago", "Sun 1 Nov 14:05".

**A scenario's state** (`state`, built and applied by `main.js`): `{ v: 1, plan, sim: sim.snapshot(), gate: gate.serialize(), flight: { landed, arrivalStand, liftoffT, fuelAtStart, lever, crashed: false }, scorer: scorer.serialize(), camera: rig.serialize(), clock: clock.serialize() }`. Not saved: time compression, the rewind ring, the callouts' armed state.

**Serializers** (job "state"):
- `scorer.serialize()` → plain object (the runway ends by ident and airport icao, the touchdown, peak g, bounces, airborneSince, the track rounded); `scorer.load(obj, resolveEnd)` where `resolveEnd(icao, ident)` → `{ end, other }`.
- `gate.serialize()` → `{ phase, icao, stand, depIdent, wasAirborne, pb: { phase, running, x, y, hdgGrid, v, pushedM } | null, route (points rounded to 0.01 m) | null }`; `gate.deserialize(obj, plan)`: called **before** `sim.restore()` (it may call `sim.reset()` via `start(plan)`); `gate.afterLoad()` called after `sim.restore()` (re-shows the route line).
- `pushback.setState(s)` restores `{ phase, running, x, y, hdgGrid, v, pushedM }`.
- `rig.serialize()` → `{ viewId, looks }`; `rig.load(obj)`.

**Menu and pages** (`src/ui/menu.js`, `src/ui/menu.css`, job "menu"):
- `createMenu(root, { version, backdrops, scenarios, onContinue(id), onNew(), onLoad(id), onLogbook(), onSettings(), onControls() })` → `{ show(), hide(), refresh(), isOpen }`. `scenarios` is the store (list/rename/remove). Load scenario is a page inside it (rename, delete with an in-panel confirm).
- `createSettingsPage(root, { get(), onVolume(v), onCallouts(on), onPerf(on), onSky? })` and `createControlsPage(root)` → `{ open(), close(), isOpen, onclose }`, usable over the main menu and over the pause menu.
- `setup.show(defaults, { title, name, nameField: true, cancel: true })` → plan with `name`, or `null` on Cancel.

**Logbook** (`src/ui/logbook.js`, job "logbook"): entries gain `scenarioId`, `scenarioName`. `logbook.open({ scenarioId?, scenarios: [{ id, name }], legacyId })`: with `scenarioId`, that scenario's flights only; without, all with a filter select. Untagged entries count as `legacyId`'s (Scenario 1).

**Clock and astronomy** (job "astro", Part 2 groundwork, not wired in until Part 1 is verified): `src/astro.js` (sun, Moon, sidereal time; pure), `src/clock.js` (`createClock({ ms?, running?, speed? })` → `{ ms, running, speed, step(dtSimS), set(ms), serialize(), load(o) }`, KST helpers).

### Checkpoint 04:16 KST: jobs dispatched; the store done

- **Five subagents** started at 04:13: store (`src/scenarios.js`), state (serializers in score/gate-flow/pushback/camera + round-trip tests), menu (`src/ui/menu.js`, `menu.css`, setup's name field), logbook (tagging and filter), astro (`src/astro.js`, `src/clock.js`, stars; Part 2 groundwork, kept out of the game until Part 1 is verified).
- **Store: done.** `node --test tests/scenarios.test.mjs` 16/16 (also with TZ=America/New_York); whole suite through the guard 191/191. Refused writes leave the index and the old record as they were; migration runs once (the index key then exists) and never writes `lastflight`, `logbook` or `settings`.
- **main.js (mine), written against the interfaces, not yet run:** boots into the main menu (no render loop behind it), `captureState()`/`applyState()`, `saveNow()` (timed, never a crashed state) on autosave every 60 s in the frame loop, on pause, on hide, on `pagehide`, on Exit to menu and on Save; New scenario / Load / Continue; New flight inside a scenario (from an arrival stand when parked); log entries tagged with the scenario; the pause menu's new buttons; Settings and Controls pages. `index.html`: the new pause menu, Exit to menu on the crash panel, `#menu-root`, `#pages-root`.

### Checkpoint 04:38 KST: Part 1 integrated and verified in Chrome

- **The jobs' reports** (all done by 04:30):
  - **state:** `scorer.serialize(identify)`/`load(o, resolve)` with `runwayEndRefs(airports)` (score.js), `gate.serialize/deserialize/afterLoad` (gate-flow.js), `pb.setState` (pushback.js), `rig.serialize/load` (camera.js). `tests/scenario-state.test.mjs` 9/9: an AP flight mid-turn and mid-climb through JSON into a fresh sim, both flown 120 s: identical snapshots (deepEqual, within 1e-6); a take-off roll saved and flown through lift-off: identical; on final at Jeju 07 both scorers give 93 (A) with the approach parts; a pushback saved after 25 s ends 77 s later at the same pose (<1e-6 m) with identical taxi routes (save 4.4 KB); held pushback, taxi, taxi-in and arrived at RKPC all come back. **The sim needed no change: it is deterministic across JSON.**
  - **menu:** `src/ui/menu.js` (main menu, Load, Settings, Controls), `menu.css`, setup's Name field and Cancel; `tests/browser-menu.mjs` 72 checks ok on `tests/dev-menu.html`, screenshots `v020-menu-dev-*.png`.
  - **logbook:** scenario tags, the filter, "Clear these flights"; `tests/logbook.test.mjs` 11/11; `tests/browser-logbook-filter.mjs` 26 checks ok; `v020-logbook-dev-*.png`.
  - **astro:** `src/astro.js`, `src/clock.js`, `data/stars.json` (BSC5, 8,404 stars, 188 KB); 20 tests. Not wired in yet.
- **The stills:** `tests/render-stills.mjs` on the Mac's GPU (Chrome, 1600×1000, JPEG q80): `assets/menu/gimpo-gate.jpg` (114 KB), `jeju-final.jpg` (130 KB), `seoul.jpg` (229 KB). Looked at: the A321 at Gimpo stand 3 with parked traffic and the city behind; on final to Jeju over the coast; over Seoul by the Han.
- **Fix found by looking:** the logbook opened from the main menu sat under it (z-index 40 against 50); `#logbook-root .fslb` now 70 (style.css).
- **The Chrome check** (`python3 tools/cpu-guard.py --minutes 15 -- node tests/browser-scenarios.mjs`, Chrome on the GPU, a fresh Playwright context): **23/23 pass**:
  1. menu with a still (`assets/menu/*.jpg`), **0 frames rendered in 3 s** behind it (the renderer's frame counter stays at 1), no console errors;
  2. "Test A" from RKSS 14R: take-off, AP climb, Exit to menu saved it (**0.30 ms** for the save);
  3. "Test B" at Jeju stand 12: pushback 6.2 m in when saved;
  4. Load "Test A": **Δt 0.0000 s, position 0 m off**, AP HDG 200 ALT 10000, fuel 3801.08 → 3801.08; flew on 3 s; skip to final, saved at 1,800 ft and loaded again: the approach track 622 → 622 samples; landed **B 88** with Approach path and Sink rate swings among the parts; the logbook entry tagged `Test A`;
  5. Load "Test B": pushback 6.23 → 6.23 m, then on to 12.2 m;
  6. Continue = Test B (newest); rename to "Test B renamed" and delete Test A (asked first); a reload keeps both; Continue loads Test B renamed; the main menu's logbook offers "Test A (deleted) (1)";
  7. only v0.1.4's keys (lastflight RKSS 32L → RKSI 33L, two log entries, settings): "Scenario 1" appears, the logbook key is byte-identical, its flights show as "Scenario 1 (2)", and Continue starts it on RKSS 32L.
- **Screenshots looked at:** `v020-main-menu.png`, `v020-main-menu-empty.png`, `v020-load.png`, `v020-load-rename.png`, `v020-load-delete-confirm.png`, `v020-settings.png` (over the pause menu), `v020-controls.png`, `v020-pause-menu.png`, `v020-logbook-filtered.png`, `v020-test-a-landed.png`.
- **Unit tests:** `python3 tools/cpu-guard.py --minutes 10 -- bash -c 'node --test tests/*.test.mjs'`: **224 pass, 0 fail**. `node --check` on every `.js`/`.mjs` in src, tests, tools: clean. Guard `--status`: no slots in use; `--sweep`: clean.
- **Version:** `src/version.js` is v0.2.0 · CL#261101.
- **Part 1 is done and verified**, apart from the reviewer, which runs now alongside Part 2.

### Decisions made overnight (v0.2.0)

- **Part 2's pure groundwork ran beside Part 1.** The astro job wrote only new files (`src/astro.js`, `src/clock.js`, stars), and nothing of it reached the game until Part 1 was verified at 04:38. That keeps V020.md's order for the game itself while using the time.
- **A loaded scenario resumes at once** (as Satisfactory's Load does), not paused.
- **The scorer's approach track is saved as arrays** `[t, x, y, z, vs, gs]`, at 0.01 m: a full 5-minute track is about 70 KB, under 2% of the origin's ~5 MB.
- **Test starts (`?test&origin=…`) are not scenarios:** no autosave, Save says so. The old browser checks keep working.
- **The pause menu's volume, callouts and readout moved to Settings**, and its keys table to Controls (V020 item 5 lists the pause menu's buttons without them). The volume blip now plays 250 ms after the slider stops.
- **Duplicate scenario names are allowed** (as in Satisfactory); a name under 3 characters is refused.
- **The migrated Scenario 1** keeps its flights even if deleted (the logbook shows "Scenario 1 (deleted)"), and the migration never runs twice.

## v0.2.0 Part 2 interfaces (night), 04:45 KST

Shared, written by the lead (in `src/world/glsl.js`, read-only for the jobs):
- **`uNight`** (float): 0 by day, 1 at full night. The sky job sets it from the sun's elevation; every night light fades in with it.
- **`uLandPos`, `uLandDir`** (vec3, scene frame), **`uLandOn`, `uTaxiOn`** (0..1): the aircraft's landing and taxi lamps. The lead sets them each frame from the aircraft. **`AIRCRAFT_LIGHTS_GLSL`** (`chunks.AIRCRAFT_LIGHTS_GLSL`): `vec3 aircraftLights(vec3 scenePos, vec3 normal)`, the light to add (× albedo) on ground surfaces.
- Scene frame: X east, Y up, Z south (−map y); the camera is the scene origin horizontally. `uSunColor`, `uSkyAmb`, `uSunDir` already light every world shader, so darkening comes through them.

Jobs:
- **sky** (`src/world/sky.js`, plus `tests/sky.test.mjs`): `sky.setTime(ms, latDeg, lonDeg)` (cheap; the lead calls it every frame) uses `src/astro.js` and sets `uSunDir`, `uSunColor`, `uSkyAmb`, `uNight`, the DirectionalLight, HemisphereLight and fog, and the sky's own stars, Milky Way, Moon and twilight; `sky.state` → `{ sunAltDeg, sunAzDeg, moonAltDeg, moonAzDeg, moonIllum, night, exposure }`; pure `lightingAt(sunAltDeg, moonAltDeg, moonIllum)` for the tests. With the sun at 230°/35° the day looks as v0.1.4.
- **skywin** (`src/ui/sky-window.js`, `src/ui/sky-window.css`, setup.js's start time): `createSkyWindow(root, { clock, place: () => ({ lat, lon }) })` → `{ open(), close(), toggle(), isOpen, update() }`; setup returns `plan.time = { mode: 'now' | 'set', ms }`.
- **citylights** (new `src/world/citylights.js`, `src/world/cities.js` for lit windows): `createCityLights(scene, uniforms, chunks, { heightfield, airports })` → `{ update({ camMap, origin, camScene, agl }) → { drawCalls, tris, lights } }`.
- **airportlights** (`src/world/airports.js` light shaders, new `src/world/taxilights.js`, `src/world/apron.js` floods and terminal windows, `tests/taxilights.test.mjs`): `createTaxiLights(scene, uniforms, chunks, airports, hf)` → `{ update({ camMap, origin, camScene }) → { drawCalls, tris, lights } }`; pure `taxiLightLayout(airport)` → `[{ x, y, z?, color: 'green'|'blue'|'red'|'amber', kind: 'centre'|'edge'|'stopbar' }]`. The runway and apron shaders also add `aircraftLights()`.
- **aclights** (`src/aircraft.js`, new `src/aircraft-lights.js`, `src/cockpit.js`, `src/world/terrain.js` for the light pools, `tests/aircraft-lights.test.mjs`): pure `lightsFor(...)` by phase → `{ nav, beacon, strobe, landing, taxi, logo }`; `aircraft.setLights(lights)`, `aircraft.setNight(n)`, `aircraft.lampPose()` (landing lamp position and beam, body frame) for the lead's uniforms; `cockpit.setNight(n)`; terrain adds `aircraftLights()`.
- **The lead:** `main.js` (the clock from `src/clock.js`, `sky.setTime`, L and Cmd/Ctrl+L, setup's time, the lamp uniforms), `world.js` (creating the city and taxi lights), `input.js`, `index.html`, `style.css`.

### Checkpoint 04:53 KST: Part 2 under way; the Sky window and the city lights in

- **Lead wiring (main.js, world.js, glsl.js, index.html):** `uNight`, `uLandPos/uLandDir/uLandOn/uTaxiOn` and `AIRCRAFT_LIGHTS_GLSL` in glsl.js; the clock is `createClock()` (src/clock.js), set at each new flight from `plan.time` (Now by default), stepped by the sim time stepped (`clock.step(done * STEP)`), saved and loaded with the scenario; `world.sky.setTime(clock.ms, lat, lon)` each rendered frame with the exposure; L and Cmd/Ctrl+L (a capture keydown that ignores text fields and the menu) toggle the Sky window; "Time of day (L)" in the pause menu and Settings; the city and taxi lights created in world.js (dynamic imports, optional); the aircraft lights from `lightsFor()` each frame with the lamp uniforms. Every Part 2 piece is optional, so a missing one leaves the game working.
- **skywin: done.** `src/ui/sky-window.js`/`.css`, setup's Time (Now / Set, KST). `tests/sky-window.test.mjs` 8/8; `tests/browser-sky-window.mjs` all ok (track click and drag, the jumps on 21 Dec 2026: sunset 17:17, sunrise 07:42, noon 12:29; play/pause, ±; W/A/S/D/R/F/Space still reach the game; Esc closes it first). Looked at: `v020-night-skywin-game.png` (bottom-left over the real HUD at 17:40 dusk, clear of the PFD and engine panel), `-day`, `-night`, `-dusk`, `-720`, `-setup-time`.
- **citylights: done.** `src/world/citylights.js` (5 instanced Points draws, ~690k slots placed on the GPU from the urban cover, off water and runways, ≥2 px, sodium/LED by district, whiter cores, a slight twinkle) and lit windows in `cities.js`. `tests/citylights.test.mjs` 4/4. At night over Seoul at 3,000 ft: 38 draws, 748k triangles, 59.7 fps (capped), p95 10.6 ms. Looked at: `v020-night-city-3000ft.png` (dense grids, the Han dark, warm windows, stars and the Milky Way above), `-fl100`, `-windows`, `-day` (unchanged).
- **Found:** `traffic.js` declares `uPxScale` twice (a compile error in the game since the aclights job's edit); sent back to that job.
- **Reviewer for Part 1** started at 04:52. Sweep: only pid 52229, macOS's Virtualization VM (521 CPU-min, older than this run, probably the Cowork VM): not mine, left alone. Running: sky, airportlights, aclights.

### Checkpoint 05:00 KST: all of Part 2 in; the night checks

- **sky: done.** `src/world/sky.js`: `setTime` (astronomy rerun when the clock moves 250 ms or the place 0.01°; **0.70 µs per frame at 1×** in Chrome, 3.6 µs at 600×), `lightingAt()` tables by sun altitude (uNight = 1 − smoothstep(−10°, 4°)), twilight (glow, the Earth's shadow, the Belt of Venus), the Moon by phase with a glow, the Milky Way with the rift, 8,404 BSC5 stars in one Points draw turned by `j2000ToEnuMatrix`. Exposure 1 + 0.45 × night. `tests/sky.test.mjs` 7/7 (35° gives v0.1.4's colours exactly; monotonic darkening +10° → −18°; the moonless ambient 2–5% of the day's; a full Moon high is brighter than none; Betelgeuse and Dubhe within 1e-6 rad of astro.js). Its `v020-night-sky-*.png` looked at (Orion rising in the east at 23:00 KST on 9 Nov, the summer Milky Way setting in the west, the Moon by the Pleiades on 24 Nov, dusk, dawn, 14:00 as v0.1.4).
- **aclights: done.** `src/aircraft-lights.js` (`lightsFor` by phase, flashing), 11 lamps on the A321 with glows in one Points draw, the logo light, a faint night fill; the cockpit's warm flood and its screens lit; terrain pools; the parked aircraft's nav lights (`traffic.js`, and its duplicate `uPxScale` declaration fixed). `tests/aircraft-lights.test.mjs` 12/12. **Its two findings fixed in main.js:** `onRunway` now uses `rw.onRunway()` (`groundKind()` says 'runway' for any pavement, which lit the landing lights at the gate), and the lamp pools are scaled by `uNight` (they showed by day on the runway). Looked at: `v020-night-aircraft-runway.png` (red left, green right, landing pool), `-air`, `-gate`, `-cockpit`, `-landing-pool`, `-day-runway`.
- **airportlights: done.** Night halos and minimum sizes in `airports.js`'s light shader (by day unchanged), the rabbit's glow, centreline lights only where the data has them, the rabbit at Gimpo 32L's ALSF-I; `src/world/taxilights.js` (green centrelines every 30/15 m, blue edges, red stop bars at the painted holds plus each departure hold; Incheon 11,176 lights, Gimpo 2,588, Jeju 1,141; one draw per airport within 30 km, at night only); apron floodlight pools from a baked light texture and lit terminal windows (`apron.js`). `tests/taxilights.test.mjs` 7/7. Looked at: `v020-night-airport-jeju07-2nm-zoom.png` (far-end red, yellow edges, red centreline end, touchdown zone, green threshold, the approach lights with their crossbars and the rabbit, the PAPI two white two red, stop bars), `-jeju07-15nm-zoom`, `-gimpo14R-4nm`, `-incheon-taxi` (green centrelines, a red stop bar ahead, blue edges), `-incheon-apron`, and the day ones unchanged.
- **Fixed:** `newId()` in `src/scenarios.js` had 4 random base-36 characters: 500 ids in one millisecond collided ~7% of the time (the store test failed now and then). Now 6.
- **The night checks** (`python3 tools/cpu-guard.py --minutes 15 -- node tests/browser-night.mjs`, Chrome on the GPU, the clock set and stopped): **3/3 pass**:
  - **60 fps at night over Seoul at 3,000 ft** (captain's seat, AP, 23:00 KST on a new Moon, 10 one-second samples after 5 s): **avg 60.0, min 59.9 fps**; **max 45 draw calls, 0.75 M triangles** (the readout: "60 fps · 0.5 ms/frame (sim 0.0, draw 0.3) · 45 draws · 747k tris · … 1440×900"); 675,468 city light slots;
  - no console errors.
  - Screenshots looked at: `v020-night-seoul-fl100.png` (Seoul a sea of points from the captain's seat, the Han dark, stars), `v020-night-seoul-3000ft.png`, `v020-night-final-gimpo-14r.png` (full Moon), `v020-night-final-jeju-07-far.png`, `v020-night-a321-outside.png`, `v020-night-dusk.png` (sun −3.2°: violet sky, the city coming on, the A321's nav lights), `v020-night-dawn.png` (−3.7°), `v020-night-sky-up.png` (August 22:00: the Milky Way overhead), `v020-night-sky-moon.png`, `v020-night-sky-window.png`, `v020-night-fps-seoul-3000ft.png`. My own close-final-Jeju and Incheon-taxi shots were poor (my setup put the aircraft on a runway), so I deleted them; the airport job's are the evidence for those two.
- **A night still for the menu:** `assets/menu/seoul-night.jpg` (252 KB; 23:00 KST, the A321 over lit Seoul), now one of four in `MENU_STILLS`. The day stills are re-rendered at a fixed 15:00 KST (the clock now runs, so "Now" would have put them at 05:00).
- **Unit tests:** 262 pass, 0 fail (through the guard).
- **Docs written:** README (the menu, scenarios, night, the Sky window's keys, storage keys, the star credit, the new test scripts), Updates.md (v0.2.0), ROADMAP (both rows done), PLAN.md (the Cmd/Ctrl+L exception).
- **Reviewers:** Part 1's still running; Part 2's started.

### Checkpoint 05:29 KST: both reviews in, every correctness finding fixed and checked

- **Part 1 reviewer** (262/262 unit tests; its own Chrome probe): no blocking bug. Fixed:
  1. *(medium)* a crash, then New flight → Cancel, left a frozen flight with no crash panel: the `setup` button no longer clears `crashed`, and Cancel after a crash shows the crash panel again; Save after a crash says "Crashed: the last good save is kept".
  2. *(low–medium)* a landing could be scored and logged twice if the game crashed or the tab died before the next autosave: `saveNow('landed')` right after the logbook entry.
  3. *(low)* a fresh scenario record carried the clock from before `startFlight`: the record has no clock now, and a fresh load takes the stored clock only for the migrated Scenario 1 (no `plan.time`).
  4. *(low)* flights flown without a scenario (storage off, a refused create, test starts) counted as Scenario 1's: they're tagged `unsaved` / "Unsaved flights" (not shown as deleted).
  5. *(low)* storage-off messages: "Browser storage is off: flying without saving".
  6. *(low)* the stand: the origin stand stays reserved after a load until the flight lands (as in live play), and `gate.stand.ref` is used for the summary.
  - Not changed: an autosave just before a crash (item 7, a design note); a rewind after a scored landing can score again (v0.1.x behaviour).
- **Part 2 reviewer** (262/262; 18 programs compiled at all three airports by day and at night; draw calls by day back to the day count: RKSS 38 → 47 → 38, RKSI 41 → 50, RKPC 33 → 41; exposure 1.0/1.45; 0 frames behind the menu). Fixed:
  1. *(medium)* the Sky window's changes while paused didn't reach the 3D view: `skyWin.onchange` (from set, play, ±) renders once when paused.
  2. *(medium)* a Sky window left open behind the main menu swallowed the menu's Esc: `showMenu()` and `newFlight()` close it, and its Esc handler ignores `body.in-menu`.
  3. *(low)* the fresh record's clock (same as Part 1's 3).
  4. *(low)* the lamp pools were faded by uNight twice on the terrain: dropped in `terrain.js`.
  5. *(low)* Restart the flight now keeps the clock (`startFlight(plan, { keepClock: true })`), and a rewind takes the clock back (each rewind snapshot holds `clockMs`).
  6. *(low)* the pause menu's and Settings' "Time of day" buttons open the window instead of toggling it.
- **Found while fixing:** an edit of mine broke an `if … else` in main.js, and `node --check src/main.js` didn't catch it (a .js file is checked as a script); a page-error probe did. **Every .js/.mjs in src and tests is now checked as a module** (copied to .mjs): clean.
- **Checks after the fixes (Chrome on the GPU, through the guard):**
  - `tests/browser-review-fixes.mjs` (new): **7/7**: Restart keeps the clock; Noon in the Sky window while paused takes uNight 1.00 → 0.00 in one frame; the window closes on Exit to menu and one Esc leaves Load; crash → New flight → Cancel shows the crash panel; a rewind takes the clock back (weak: the clock was stopped, so 0 s); a landing is saved at once (`reason: 'landed'`, 0.5 ms); no console errors.
  - `tests/browser-scenarios.mjs`: **23/23** again (a save 0.20 ms; Test A loads with 0 m position error).
  - `tests/browser-night.mjs fps`: **3/3**: 59.9 avg, 59.5 min fps; 45 draws, 0.75 M triangles.
  - `tests/browser-e2e.mjs` (v0.1's Gimpo → Jeju flight, `E2E_URL` on 8014): **12/12**, B 88, taxi-in to stand 15, callouts incl. RETARD, no console errors.
  - `tests/browser-cpu.mjs`: **6/6**: paused 0 rAF/s and 0% main-thread CPU, hidden tab the same, prediction 43 ms CPU.
  - Unit tests: **262/262**.

## Final entry: 05:31 KST, Sunday 1 November 2026 (the v0.2.0 run)

**v0.2.0 is done and verified, both parts,** against V020.md's definition of done, by 05:30 (the deadline was 11:00). The game is pushable: `sh tools/push.sh v0.2.0`, then a hard reload (Cmd+Shift+R).

### Done, with the evidence (details in the checkpoints above)

**Part 1, the main menu and scenarios:**
- [x] **Unit tests:** 262 pass, 0 fail (`python3 tools/cpu-guard.py --minutes 10 -- bash -c 'node --test tests/*.test.mjs'`), including:
  - the store (`tests/scenarios.test.mjs`: create, write, list, rename, delete, a refused write, the migration from v0.1.4's `lastflight` and logbook, the logbook byte-identical);
  - the round trip (`tests/scenario-state.test.mjs`: an AP flight through JSON into a fresh sim, both flown 120 s, within 1e-6 m and identical snapshots);
  - on final (the approach track survives; both score 93 with the approach parts);
  - at the gate (a pushback saved mid-way ends at the same pose within 1e-6 m).
- [x] **In Chrome on the GPU** (`tests/browser-scenarios.mjs`, a fresh Playwright profile, never Shane's): 23/23, all seven scripted steps. The menu with a still and 0 frames rendered behind it; Test A from RKSS 14R loaded 0 m off, landed B 88 with the approach parts and tagged "Test A"; Test B's pushback carries on; Continue, rename, delete and reload; Scenario 1 from v0.1.4's keys.
- [x] **Screenshots looked at:** `v020-main-menu`, `-load`, `-load-rename`, `-load-delete-confirm`, `-settings`, `-controls`, `-pause-menu`, `-logbook-filtered`, `-test-a-landed`, plus the jobs' `v020-menu-dev-*` and `v020-logbook-dev-*`.

**Part 2, night:**
- [x] **Unit tests:**
  - the sun in Seoul: 21 Jun 05:10:59 / 19:56 / 75.87°; 21 Dec 07:42:57 / 17:17 / 29.00° (all within 2 min and 0.3° of PyEphem);
  - the Moon: 0.998 lit at the full Moon of 24 Nov 23:53 KST, 0.002 at the new Moon of 9 Nov 16:02;
  - the clock: stop, set, speed, time compression, save and restore;
  - the taxiway lights: colours, and stop bars at every runway's holds at the three airports;
  - the sky's light: 35° gives v0.1.4's colours exactly, and the night is never black.
- [x] **Screenshots on the GPU, looked at:**
  - `v020-night-seoul-fl100`, `-seoul-3000ft`;
  - `-final-gimpo-14r`;
  - Jeju 07 at night: `v020-night-airport-jeju07-2nm-zoom` (approach lights, the rabbit, the PAPI), `-jeju07-8nm`, `-jeju07-15nm-zoom`, `v020-night-final-jeju-07-far`;
  - taxiing at Incheon: `v020-night-airport-incheon-taxi`, `-incheon-apron`;
  - the A321 outside: `v020-night-a321-outside`, `v020-night-aircraft-*`;
  - `v020-night-dusk`, `-dawn` (and the sky job's `v020-night-sky-dusk-*`, `-dawn-east`);
  - the sky looking up: `v020-night-sky-up`, `-sky-moon`, `v020-night-sky-newmoon-*`;
  - the Sky window: `v020-night-sky-window`, `v020-night-skywin-*`.
- [x] **Frame rate** (`tests/browser-night.mjs fps`): 60 fps at night over Seoul at 3,000 ft (avg 59.9–60.0, min 59.5–59.9 over two runs), at most 45 draw calls and 0.75 M triangles.

**Both:**
- [x] **CPU at runtime:**
  - 0 frames behind the menu;
  - an autosave takes 0.20–0.5 ms (measured in the game);
  - `tests/browser-cpu.mjs` 6/6 (paused or hidden: 0 rAF/s, 0% main-thread CPU);
  - setTime 0.7 µs per frame;
  - the Sky window redraws only on a new minute.
- [x] **Reviewers:** one for Part 1, one for Part 2. Every correctness finding is fixed, and `tests/browser-review-fixes.mjs` checks them (7/7). See the 05:29 checkpoint.
- [x] **Regression:** v0.1's `tests/browser-e2e.mjs` 12/12 (Gimpo → Jeju, B 88, taxi-in, callouts).
- [x] **Nothing left running:**
  - my no-cache server on 8014 (pid 42575) is stopped;
  - guard `--status`: no slots in use; `--sweep`: clean.
  - Not mine, left alone: Shane's `http.server` on 8001; macOS's Virtualization VM; and, at 05:30, a Playwright Chrome (pid 944) started by another game's agent (`/tmp/anemoia/ride2/bench.mjs`).
- [x] **Written:**
  - `src/version.js` v0.2.0 · CL#261101;
  - `Updates.md`, `ROADMAP.md` (both rows done), `README.md` (menu, scenarios, night, keys, storage, star credit, test scripts);
  - `PLAN.md` (the Cmd/Ctrl+L exception), `HANDOFF.md`, `AGENTS.md` (State, storage keys).

### Not done, or weak

- **Not done:** nobody has listened to the sound (as before). No agent has flown a whole evening from the menu with the clock running through dusk: the checks set the clock and stop it.
- **Weak, by the jobs' own judgement and mine:**
  - the cockpit at night is plain (no panel backlighting);
  - terminal windows look a little like a checkerboard close up;
  - distant taxiway lights merge green and blue into cyan;
  - stop bars are always lit;
  - a moonless night away from the cities is very dark from cruise;
  - the Moon is drawn 2.4× its size;
  - city streets don't line up with the terrain's road texture, and there are no lights on bridges;
  - an autosave can catch a moment just before a crash, though never the crash itself;
  - the rewind-clock check ran with the clock stopped, so it shows nothing.
- `tests/browser-boot.mjs` (v0.1) expects the setup screen on load and fails now by design; `browser-scenarios.mjs` replaces it.

### Decisions made overnight

These are in addition to the list under "Decisions made overnight (v0.2.0)" in the 04:38 checkpoint.

- **New flights start at the real time in Korea** (Now), as the brief says. So Shane's first flight after the push shows the real time of day. The menu's stills are fixed at 15:00 KST, plus one at night.
- **Restart the flight keeps the clock** (a night the player set stays night), and a rewind takes the clock back with the aircraft. New flight takes the setup's time (Now by default).
- **The Sky window opens from the pause menu by resuming the flight**, since V020 says the flight goes on beside it.
- **The light, city, taxi and aircraft lights are all optional modules:** a missing or failing one leaves the game running by day.
- **Flights flown without a scenario** (storage off, test starts) are logged as "Unsaved flights", not as Scenario 1's.
- **Star data:** BSC5 from NASA HEASARC, judged public domain (`data/STARS-CREDIT.md`); 8,404 stars to V 6.5, 188 KB.

### How Shane can check it

1. `sh tools/push.sh v0.2.0` (or play first), then open `http://localhost:8001/games/flight-sim/` with a hard reload (Cmd+Shift+R): the main menu.
2. Continue loads "Scenario 1", made from his last v0.1.4 flight. It starts at its route's start in the afternoon, and his logbook is under it (Logbook → the filter).
3. New scenario: a name and the setup (Time: Now or Set). Fly, Esc → Exit to menu, then Load: it's exactly where it was.
4. In flight, L (or Cmd+L) for the Sky window. Sunset, then Midnight, shows the night: the city lights, the stars and the airport lights.

**Row for GameDump's root `AGENTS.md` "Current games" table** (his file; not edited):
`| flight-sim | games/flight-sim/ | gamedump:flight-sim:settings, …:logbook, …:lastflight, …:scenarios, …:scenario:<id> | Claude outputs/flight-sim/ | claude/flight-sim-prototype.md |`

### Addendum 05:33 KST: the night screenshots retaken on the final build

Several night shots predated the last fixes: Gimpo 14R had been taken before the airport lights landed. So all of them were retaken on the final build, through the guard, with the no-cache server on 8014 (pid in `/tmp/flight-sim/pids`, stopped afterwards).

- **`tests/browser-night.mjs`** (all shots and fps): **3/3**. 59.9 avg / 59.5 min fps at night over Seoul at 3,000 ft; max 45 draws, 0.75 M triangles; no console errors.
- **`tests/dev-airportlights.mjs`**: all 12 shots retaken.
  - Night calls 23–54 and triangles 0.27–0.92 M.
  - Taxi lights at night only near their airport: Incheon 11,176, Gimpo 2,588, Jeju 1,141.
  - By day the taxi lights are off and exposure is 1.00.
- **Looked at again:**
  - `v020-night-final-gimpo-14r.png` and `v020-night-airport-gimpo14R-4nm.png` (4 nm out, full Moon): 14R's runway and approach lights bright ahead in the sea of Seoul's lights, lit apartment blocks below, stars above;
  - `v020-night-sky-window.png`: the window at 21:30 KST on 24 Nov, "Full moon · 100%", NIGHT, sunrise 07:21 and sunset 17:17, on the runway at night with its edge and centreline lights;
  - `v020-night-dawn.png` (sun −3.7°): a violet-blue dawn sky over lit Seoul, the A321's nav lights, landing lights and logo light;
  - `v020-night-sky-up.png`: stars and the Milky Way overhead;
  - `v020-night-airport-incheon-taxi.png`: green centrelines, blue edges, a red stop bar ahead, lit terminals;
  - the rest re-rendered with no visible change.
- **Guard:** `--status` shows no slots in use; `--sweep` is clean.

## 2026-11-03, 15:10 KST: v0.2.1 (Cowork session, the second agent)

Shane (after v0.2.0 was pushed, `73b7776`): "These are the fixes: 1. Some taxiways at Jeju airport still clip strangely with the runway. 2. Be able to change the route during a flight. 3. Have an easy way to transfer between a cockpit view, a nose view, and a third person view, maybe a switch somewhere."

**1. Taxiways and runways** (`src/world/apron-geom.js`, `apron.js`):

- **Reproduced** in the cloud container (stills at Jeju 07/25 by taxiway P10, from the cockpit on the runway and from a low orbit): the taxiway's asphalt was drawn over the runway in jagged patches, hiding its edge line and half its width from the cockpit.
- **The cause:**
  - OSM's taxiway lines end on the runway centreline, so every taxiway ran half across the runway it joins (35 overlaps at Jeju, 35 at Gimpo, 120 at Incheon).
  - The pavement lies 8 cm over the ground; the runway lies on it, and its bigger pull towards the camera (0.16 + 0.0016 d against 0.06 + 0.0006 d) outweighs 8 cm only when seen from high enough. Along a ray at grazing angle θ the gap is 0.08 / sin θ, so from the cockpit (4 m up) the taxiway won beyond about 5 m.
- **The fix:**
  - The pavement (taxiways, taxilanes, aprons, stand pads) is cut away inside each runway as drawn, 5 cm under its edge (`drawnRunwayRects()`, `clipSoupOutside()`).
  - The taxiway centrelines are split at the runway's edge (`splitPolyline()`). On the runway they're its lead-on and lead-off lines: on the runway's own surface (the heightfield there, points every 4 m) with a pull just over the runway's (`PULL.lead`, the `lay` attribute), so they show from any angle. The taxiway edge lines stop at the runway.
- **Also found and fixed:** long flat taxiway triangles dipped under the ground where it curves: down to −0.58 m on Jeju's parallel taxiway P, where the flattening around the runway fades into the terrain, −0.33 m at Gimpo (D1, G1, B1), −0.11 m at Incheon. The terrain showed through there. `refineSoup()` and `refineLine()` split the pavement and the paint only where they'd stray more than 2 cm (pavement) or 3 cm (paint) from the ground. Taxiway triangles: Jeju 4,916 → 7,075, Gimpo 20,039 → 20,495, Incheon 50,473 → 48,598 (fewer: the parts on the runways are gone).

**2. Changing the route in flight** (`src/ui/map.js`, `src/main.js`):

- **A bug behind it, since v0.1.0:** a waypoint dragged onto the magenta line on the map was kept in the map's list but never drawn or counted, because the map, the ND and the distance read `plan.waypoints` (the setup's). In flight the path couldn't be changed at all. Reproduced in the container (`map.waypoints` 1, `plan.waypoints` 0, the line still straight). Now `view.waypoints` is the map's own list.
- **Change route:** a button on the map's bar, or a click on an airport's label (or, below the paths, its runway), opens a panel: the airport, its runway ends (the one you'd fly straight in to picked first), the distance and magnetic bearing direct from the aircraft, and the fuel on board against the setup's estimate for the trip. **Fly there** calls `changeRoute()` in main.js: `plan.dest`/`arrRunway` and `dest`, the waypoints cleared, the scorer's planned runway moved, a toast, and a save. It refuses after landing ("You've landed. A new flight (Esc → New flight) starts from here."). The departure can't change.

**3. The view switch** (`src/ui/hud.js`, `src/main.js`, `src/input.js`, `src/camera.js`): Cockpit, Nose, 3rd person, at the top right in a box like the FCU's. In a seat, Cockpit shows CPT or F/O, and clicking it again swaps seats; 1, 2 and 3 do the same as the buttons; V still steps through all four. It goes compact (no key caps), then to the bottom centre, if it would touch the FCU; it re-checks when the FCU's width changes or a font arrives. The views' names: Nose, 3rd person, "Cockpit: captain's seat", "Cockpit: first officer's seat".

**Checks:**

- **Unit tests: 274 pass**, 0 fail (262 and 12 new), in the cloud container and on the Mac through the guard (`cpu-guard.py --minutes 3 -- node --test tests/*.test.mjs`: 7 s; then `--status`: no slots in use, `--sweep`: clean).
  - `tests/apron.test.mjs`: clipping a taxiway that joins or crosses a runway (exactly the part on it goes), splitting a centreline there, real data with no pavement left on a runway, `refineSoup()` and `refineLine()`.
  - New `tests/apron-ground.test.mjs`: `buildPavement()` and `buildPaint()` themselves on the real terrain (the heightfield read from `data/`), at all three airports. No pavement on a runway; the pavement at least 3 cm over the ground everywhere (the lowest is 3.8 cm, at Jeju; v0.2.0 went down to −0.58 m); the paint at least 4 cm over it; every lead line on a runway's surface within 1 cm.
- **Every changed `.js`/`.mjs`** checked as a module (copied to `.mjs`, `node --check`).
- **In the cloud container** (headless Chromium, SwiftShader, through the real game loop):
  - **`tests/cloud/route-views.cjs`** (new; 15 minutes): **all pass**.
    - The switch is level with the FCU and clear of it. Clicks and keys pick the views; Cockpit again swaps the seat; the lit button follows V.
    - A dragged waypoint counts: 10 → 168 nm.
    - Change route opens on RKPC 07, lists RKSI's eight runway ends, and Fly there to RKSI 33L: the plan, `dest`, the waypoints cleared, the toast, `captureState()`.
    - A click on RKPC's label (under the lines) and on RKSS's offers them; Cancel leaves the route.
    - Skip to final puts the aircraft 15.7 nm from RKSI, for 33L. The controller landed there: B 88 with the approach parts, logbook "RKSS–RKSI 33L". Change route is refused after landing.
  - **The switch at four window sizes** (fonts loaded, every view): never overlapping the FCU. 1512×860: full. 1440×900 and 1280×800: full, compact in the cockpit (its seat label). 1100×700: compact. 960×640: at the bottom centre.
  - **Stills looked at:**
    - Jeju 07/25 at P10, from the cockpit and a low orbit, before and after;
    - Jeju's taxiway P by the 25 end, before (grass through the junction) and after;
    - Jeju's 13/31 crossing;
    - Gimpo 14R/32L at E1, from the cockpit and an orbit (a lead line onto the centreline).
  - **The ground, measured** (`dip3.mjs`-style sampling in scratch): taxiway samples under the ground went 304 → 0 at Jeju, 88 → 0 at Gimpo, 23 → 0 at Incheon.
- **Not done:** flying it in Chrome on the Mac's GPU; the lead lines at night; listening to the sound (as before).
- **Screenshots** in `Claude outputs/flight-sim/`:
  - `v021-jeju-taxiways-before-after`, `v021-jeju-taxiway-grass-before-after`;
  - `v021-view-switch-cockpit`, `-nose`, `-orbit` (1440×900: full in the nose and 3rd person views, compact in the cockpit), `v021-hud-new-route`;
  - `v021-map-waypoint`, `v021-map-change-route`, `v021-map-new-route`.
- **Written up:**
  - `src/version.js` (`Flight Sim v0.2.1 · CL#261103`) and `Updates.md`;
  - `ROADMAP.md`: row 6 done, and a "Found after v0.2.0" list;
  - `README.md` and `PLAN.md` (the keys, the map); the Controls page (`ui/menu.js`);
  - `HANDOFF.md`: the version table, how the changes work, two pitfalls, the Cowork tools;
  - `AGENTS.md`: State.
- **Next:** Shane pushes: `sh tools/push.sh v0.2.1`, then a hard reload (Cmd+Shift+R).

## 2026-11-03, 16:00 KST: v0.2.1, two more (Cowork session, the second agent)

Shane, before v0.2.1 was pushed: "Group these in with 0.2.1: 1. For steering the camera, I have to use two finders, but I am not used to that, so change it to clicking and dragging with one finger. 2. Add some more stars to the night sky." Still v0.2.1 (`CL#261103`).

**4. One-finger drag** (`src/camera.js`, `style.css`):

- Press on the 3D view and drag: from the nose or a seat it looks around, in 3rd person it goes round the aircraft. The view follows the finger, the same way round as the two-finger swipe (natural scrolling), which stays, as do pinch to zoom and double-click to recentre.
- Pointer events on the canvas, captured from the press, so a drag carries on over the HUD. Nothing turns until the pointer has moved 4 px, so a click stays a click. Speeds per screen height: 2.5 × the field of view when looking (about 150° at 60°; finer when zoomed in), 3.2 rad (183°) in 3rd person.
- A double-click whose second press dragged doesn't recentre. Presses on the panels and the map never reach the canvas. The cursor over the view is a hand (grabbing while dragging).
- The tooltip on 3rd person, the Controls page, README and PLAN say "drag".

**5. More stars** (`src/world/sky.js`):

- **Why it looked sparse:** the fill of stars past the catalogue's 6.5 lit a tenth of its cells, but at 0.005–0.03 (linear), which ACES at the night's exposure (1.45) crushes to almost nothing (the first try at a brighter fill, up to 0.04, still had none standing 40/255 over the sky). The catalogue's faint end was dim too (magnitude 6.5 at 0.037).
- **Now:**
  - The catalogue's brightness rule is `starBrightness()`, `STAR_GAMMA` 0.55 (was 0.72): magnitude 4 is 1.6 times as bright, 5 twice, 6.5 2.4 times; first magnitude is unchanged.
  - The fill gives each lit cell a magnitude from 6.5 to `FILL_FAINT` (8.0), three times as many for each magnitude fainter, and the same brightness rule, so it carries on from the catalogue. Lit: 7% of the cells at the galactic poles, 12% at its plane, up to 30% in the Milky Way's band. They twinkle ±12% (±2% at cruise).
  - **Moonlight** (`uMoonGlow.r × 100`, 0..1) fades the fill by (1 − m)², gone at full Moon, and the catalogue's stars fainter than about magnitude 5.5 (the vertex shader), as a bright Moon does outside.
- **Tuned on counts** (`countstars.py` in scratch: local maxima at least T/255 over the median of their 9×9 neighbourhood) and by eye, against Satisfactory's sky (`Claude outputs/satisfactory/sky-10-midnight-south.jpg`, about 150–200 clear stars in a 400×300 crop). Eleven variants of the fill's brightness, faintest magnitude, density and the brightness rule were rendered in one session (temporary uniforms, removed). Stars counted in the sky part of stills at 1200×750, 60° of view, at Jeju, 2026-11-10 00:00 KST (new Moon):

  | View | ≥ 20 before → after | ≥ 40 | ≥ 80 | ≥ 160 |
  |---|---|---|---|---|
  | west, 30° up (the Milky Way) | 564 → 8,449 | 237 → 1,889 | 59 → 210 | 10 → 20 |
  | south, 50° up | 521 → 6,446 | 242 → 2,015 | 76 → 202 | 16 → 23 |
  | the zenith | 766 → 9,134 | 326 → 2,930 | 101 → 278 | 25 → 40 |
  | FL350, ESE 8° up | 1,398 → 7,149 | 517 → 5,007 | 184 → 699 | 64 → 103 |

  Under a full Moon high in the south (2026-11-25 00:00 KST), south 45° up: ≥ 40 213 → 228, ≥ 80 72 → 124; the faint dust is gone (≥ 20 514 → 348), as it should be.
- **Also looked at:** dusk (sun −8.7°: a few stars, the fill held back by the bright sky), the full Moon both ways, the captain's seat at night (the stars through the windows), and a 3rd person view from below the aircraft.
- No new objects or draw calls: the same dome shader and Points draw. The fill costs a dot product, a `log` and a `pow` more on the lit cells only.

**Checks:**

- **Unit tests: 275 pass** (one new in `tests/sky.test.mjs`: the faint end brighter, first magnitude unchanged, `starGeometry()` using `starBrightness()`), in the cloud container and on the Mac through the guard (below).
- **New `tests/cloud/camera-drag.cjs`** (2 minutes, the real mouse through Playwright): **23/23**. In the nose, the captain's seat and 3rd person, a 200 px drag right turns exactly the speed above (37.5°, 38.8°, 45.8° at 800 px high) and down raises the pitch; the cursor is a hand, grabbing while dragging; the nose stops at 170° and 80°; a click and a 2 px wobble change nothing; a double-click recentres; a click then a press-and-drag (Chrome fires `dblclick` for it) keeps the drag; a drag across the PFD carries on; a drag that starts on the ND, and one on the map, leave the camera alone; the view switch still clicks; the swipe and the pinch still work; no page errors.
- `tests/browser-boot.mjs` (the Mac's Chrome, not run here) has a drag check next to its swipe check.
- **Not done:** dragging on the Mac's own trackpad; how fast the drag feels is a guess (the speeds above are easy to change: `DRAG_LOOK`, `DRAG_ORBIT`).
- **Screenshots** in `Claude outputs/flight-sim/`: `v021-night-stars-before-after` (the west and FL350 views), `v021-night-stars-orbit`.
- **Written up:** `Updates.md` (the v0.2.1 entry and its title), `README.md`, `PLAN.md`, `ROADMAP.md` (found after v0.2.0), `HANDOFF.md` (the table, how it works, the cloud tools), `AGENTS.md` (State), the Controls page and the 3rd person tooltip.
- **Next:** Shane pushes: `sh tools/push.sh v0.2.1`, then a hard reload (Cmd+Shift+R).
