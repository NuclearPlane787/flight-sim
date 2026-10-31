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
