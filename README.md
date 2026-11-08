# Flight Sim

Airliners over South Korea (the A321neo, the Boeing 787-9 and the 777-300ER), flown between Incheon, Gimpo and Jeju, over real coastline and elevation with procedural fine detail. It has:

- realistic physics with each maker's fly-by-wire: Airbus's protections on the A321neo, Boeing's speed-stable law and manual trim on the 787 and 777;
- a holds-only autopilot with up to 16× time compression;
- a path map that lets you jump ahead along the predicted path, change the route in flight, and skip to a 15 nm final;
- gate starts with pushback and a taxi route drawn on the ground;
- parked aircraft and ground vehicles at the airports;
- synthesised engine sound built from each engine's real tones (LEAP-1A, GEnx-1B, GE90-115B: the fan's blade-passing tone, the buzz-saw, the core's whine, the jet's roar), muffled but clearly there in the cockpit, warning sounds, the radio-altitude callouts (RETARD included), a landing score and a logbook.

`Updates.md` lists what each version added; the game shows its version in the pause menu.

## Running it

Serve GameDump's root and open the game:

```sh
cd GameDump
python3 -m http.server 8001
# http://localhost:8001/games/flight-sim/
```

It also runs from the hub's player (`play.html?game=flight-sim`). There's no build step: these are plain ES modules, three.js r186 is in `vendor/`, and the baked world is in `data/`. Chrome on a Mac is the target.

The game opens on the main menu, over a still rendered from the game: Continue (the newest scenario), New scenario, Load scenario, Logbook, Settings, Controls, and Exit to Game Dump.

**Scenarios** are save slots holding the whole state: the aircraft's position, speed and attitude, the autopilot and FCU, fuel, the gate flow (a pushback under way and the taxi route), the landing score's approach track, the camera and the clock. A loaded scenario is exactly where it was and flies on. They autosave every 60 s in flight, on pause, when the tab hides or closes, and on Exit to menu, and the pause menu has Save. A crash never overwrites the last good save. Load scenario lists them newest first, with rename, duplicate and delete: a copy is the same moment, aircraft and load, so you can fly on from one point again and again (the pause menu's Save a copy makes one of the present moment, and you fly on in the original). v0.1.x's last flight becomes "Scenario 1", with its logbook.

New scenario opens the flight setup with a name: the origin, destination, runways, load and fuel, the start (lined up on the runway, on a 15 nm final, or at a gate), and the time (Now, the real time in Korea, or a date and time picked in KST). New flight in the pause menu replaces the scenario's flight, starting from the stand when parked after arriving. During a flight, the L window's Weight tab (or Weight and fuel in the pause menu) changes the passengers, cargo and fuel, in the air or on the ground, with the setup's checks; Restart the flight goes back to the setup's load.

**Night:** the time of day runs in KST with the sim (time compression speeds it up), and the sun, the Moon (with its phase), the 8,400 brightest real stars (with fainter ones past them, washed out by a bright Moon) and the Milky Way are where they really are. The light runs through golden hour and twilight to a moonlit or starlit night, with the cities lit (streetlights, commercial cores, apartment windows), the runways, approach lights, PAPIs, taxiways and aprons lit, and the A321's own lights set by phase as pilots use them. The Sky window (L) sets the time and date, the clock's speed and jumps to sunrise, noon, sunset, midnight or now.

From a gate:

1. Press P to push back. Q/E steer the turn, and P again holds the push.
2. Release the parking brake (B).
3. Follow the green-yellow line to the holding point.

After landing, a new line leads from the runway to a free stand. Every landing is scored, approach included, and logged with its scenario: the pause menu's Logbook shows this scenario's flights, the main menu's all of them with a filter. The score is strict: 100 takes a landing that's perfect in every part.

Sound starts with the first click or key, because browsers don't play audio before then. Settings has the master volume, the callouts and the performance readout.

## Controls

| Key | Action |
|---|---|
| W / S | pitch down / up |
| A / D | roll left / right |
| Q / E | yaw left / right (steering on the ground) |
| R / F | thrust levers forward / back; on the ground at idle, keep holding F for reverse |
| Space (hold) | wheel brakes |
| B | parking brake |
| G | gear lever |
| 6 / 7 / 8 / 9 / 0 | flap lever: A321neo 0, 1, 2, 3, FULL; Boeings UP, 5, 15, 20, 30 |
| [ / ] | flap lever one detent up / down (every type) |
| H / Y (hold) | Boeings: pitch trim nose up / nose down (it moves the speed the aircraft holds) |
| O | Boeings: TO/GA (take-off thrust on the ground, a go-around in the air) |
| C | speed brakes in / out |
| Shift+C | arm ground spoilers |
| Z | autopilot on / off |
| X | autothrust on / off |
| = / − | time compression faster / slower: with the AP on and 2,000 ft up, or in a pushback (up to 4×) |
| M | map (predicted path, jumps, waypoints, Change route, skip to final) |
| 1 / 2 / 3 | cockpit (the captain's seat; 1 again swaps to the first officer's and back), nose, 3rd person view, as the switch at the top right does |
| V | next view (Nose, 3rd person, Captain, First Officer) |
| P | pushback start / stop |
| Esc | pause menu (Resume, Save, Save a copy, Logbook, Rewind 30 s, Restart, New flight, Settings, Controls, Time of day, Weight and fuel, Exit to menu) |
| L, or Cmd/Ctrl+L | the Sky window: the time of day, the date, the clock's speed (the one Ctrl binding, as in Satisfactory); its Weight tab: the passengers, cargo and fuel. L opens the tab last shown |
| F3 or \` | performance readout: a line across the top with fps, ms per frame, physics steps, draw calls, triangles, GPU memory, the world's counts and the heap (also in the pause menu) |
| T | rewind 30 s (from the pause menu or after a crash) |
| drag on the view (one finger) / pinch / double-click | look around, or orbit in 3rd person / zoom / recentre; a two-finger swipe also looks or orbits |

The FCU strip at the top sets SPD, HDG, ALT and V/S. Scroll over a window to turn it (a quick flick turns it in big steps), or click it, type a value and press Enter, which also pushes the knob: ALT starts a level change, V/S engages V/S. An ALT under 1,000 is a flight level (350 = FL350); a V/S of 60 or less is in hundreds (−15 = −1,500 ft/min). Esc, a click elsewhere or a flying key closes it unchanged. The strip also has the AP1 and A/THR buttons and the Normal/Alternate law switch.

On the Boeings an MCP takes its place, with the same typing and scrolling: A/T, IAS/MACH (it shows Mach above FL260, and it's blank in VNAV), LNAV, VNAV, FLCH, HDG (HDG SEL, HDG HOLD), V/S, ALT (ALT HOLD), LOC, APP, A/P and TO/GA. Pressing Enter on a window pushes it: HDG to HDG SEL, ALT to FLCH, V/S to V/S.

## Flying tips

- **Take-off:**
  1. Hold R through the detents to TOGA (it pauses at CL and FLX/MCT).
  2. At about 145 kt, hold S. The aircraft rotates at about 4–5°/s and lifts off near 8°.
  3. G for gear up; 6 for flaps 0 at about 210 kt.
  4. Pull the levers back to CL (F) for the autothrust.
- **Autopilot:** set HDG and ALT on the FCU (scroll, or click and type; Enter on ALT starts the level change, OP CLB/OP DES), then Z (AP) and X (A/THR). The FCU heading starts at your heading. Time compression (=) needs the AP on and 2,000 ft above the ground.
- **Autothrust:** while A/THR is on it moves the thrust levers, and the blue ring on the N1 dials with them ("A/THR" between the dials). R or F takes the levers from where it left them and turns A/THR off; X turns it back on.
- **The map (M):** with the AP on, the bright line is where the aircraft will go. Click a point on it to jump there. The magenta line is the route to your destination and doesn't jump: point the HDG along it first. A red cross means the path meets the terrain. "Skip to 15 nm final" puts you on the 3° path to the destination runway.
  - **Waypoints:** drag the magenta line to add one; double-click a waypoint to remove it.
  - **Change route** (or a click on an airport) picks a new destination and runway in flight, with the distance, bearing and fuel needed direct from where you are. The line then goes direct from where you are.
- **Landing:**
  1. Gear down; flaps 2, 3, FULL; Shift+C to arm the ground spoilers.
  2. Disconnect the AP with Z.
  3. With flaps 3 or FULL, W/S nudge the flight path, and it holds where you leave it.
  4. From about 30 ft, hold S for a second or two to flare. The nose sinks by itself if you don't.
  5. Pull the levers to idle when you hear RETARD.
  6. On the ground, hold F for reverse and Space for the brakes.
- **Levers at TOGA** start a go-around at any point.
- **On a Boeing:** trim to the speed you want before you let go (H nose up, Y nose down). Pull the flare yourself from about 30 ft, and there's no RETARD call. With APP armed and the autopilot on it lands itself, and hands back below 30 kt: you brake (there's no autobrake).

## Known issues

- No agent has listened to the sound: the levels and the engines' frequencies are measured (`tests/audio-render.mjs`), not judged by ear. `tests/audio-clips.mjs` renders flight phases to listen to. v0.3.1 raised the engines in the cockpit by about 7 dB, by measurement.
- On the A321neo the predicted path is a straight line on the selected heading, because its autopilot has holds only (route following is on the roadmap). A Boeing's follows LNAV and its ILS.

## Types

| | A321neo | 787-9 | 777-300ER |
|---|---|---|---|
| Engines | CFM LEAP-1A | GE GEnx-1B | GE GE90-115B |
| Control law | Airbus: load-factor demand, auto-trim, hard protections | Boeing: speed-stable about the trim, soft protections | the same as the 787 |
| Flap detents | 0, 1, 1+F, 2, 3, FULL | UP, 1, 5, 10, 15, 17, 18, 20, 25, 30 | UP, 1, 5, 15, 20, 25, 30 |
| Numbers | `src/sim/a321neo.js`, `reference/notes/a321neo-performance.md` | `src/sim/b787-9.js`, `reference/notes/b787-9-performance.md` | `src/sim/b777-300er.js`, `reference/notes/b777-300er-performance.md` |
| Sources | EASA TCDS A.064, Airbus AC | EASA TCDS IM.A.115, Boeing D6-58333, EASA TCDS IM.E.102 | EASA TCDS IM.A.003, Boeing D6-58329-2, EASA TCDS IM.E.002 |

**Flying a Boeing:** trim for the speed you want (H, Y), and it holds that speed hands off. Thrust moves the nose, and flaps and gear slow you only if you trim down too. Flare with back pressure; nothing does it for you.

## Code map

| Path | What |
|---|---|
| `src/sim/types.js` | the type registry: each type's data, geometry and what the screens say (`typeById`, `kitFor`, `TYPE_LIST`) |
| `src/type-assets.js` | each type's model and cockpit builders (the page only) |
| `src/sim/b787-9.js`, `src/sim/b777-300er.js`, `src/geometry-b787-9.js`, `src/geometry-b777-300er.js` | the Boeings' numbers and geometry |
| `src/sim/fbw-boeing.js`, `src/sim/autopilot-boeing.js` | Boeing's C*U law, the trim and soft protections; the autothrottle and the MCP's modes, LOC, G/S, autoland (`reference/notes/boeing-fbw-ap.md`) |
| `src/widebody.js`, `src/widebody-shape.js`, `src/widebody-specs.js`, `src/livery-widebody.js` | the widebodies' exterior and livery, from one spec per type |
| `src/cockpit-boeing.js`, `src/cockpit-windows-boeing.js` | the widebodies' cockpit and windows |
| `src/ui/boeing/`, `src/ui/knobs.js` | Boeing's PFD, ND, EICAS and MCP; the knobs the MCP and FCU share |
| `src/audio/engine-sounds.js` | the GEnx-1B's and GE90-115B's numbers for the synth |
| `index.html`, `style.css` | the page, the pause, crash and score panels |
| `src/main.js` | boot, the frame loop (fixed 1/120 s physics, 60 fps cap, physics budget), time compression, rewind, jumps, skip to final, test hooks |
| `src/version.js` | the version the game shows, bumped with every update (see `Updates.md`; commits are titled with the version, `sh tools/push.sh v0.1.1`) |
| `src/input.js` | keyboard: ramped stick axes, the thrust lever with detents and reverse, actions |
| `src/camera.js` | the four views and the touchpad camera |
| `src/geometry.js` | A321neo body-frame geometry shared by the sim, the model and the cameras |
| `src/sim/` | atmosphere, A321neo data (with sources), flight model, engines, gear, fly-by-wire, autopilot, prediction worker |
| `src/world/frame.js` | the map frame: Lambert conformal conic, magnetic variation, headings |
| `src/world/` | terrain clipmap, sea, sky, surface detail, cities, runways; `heightfield.js` and `runways.js` are the pure data helpers |
| `src/aircraft.js`, `src/livery.js`, `src/cockpit.js`, `src/cockpit-windows.js` | the procedural A321neo in Nuclear Airlines colours, the simple cockpit, and the six cockpit windows (shared by the outside, the livery and the cockpit) |
| `src/ui/` | PFD, ND, engine panel, FCU, map, flight setup, logbook, landing score card |
| `src/audio/` | `synth.js` (WebAudio engine, wind and warnings), `callouts.js` (radio-altitude callouts and RETARD) |
| `src/scenarios.js` | the scenario store (save slots over localStorage), names, the migration from v0.1.x, the menu's texts |
| `src/ui/menu.js`, `src/ui/menu.css`, `assets/menu/` | the main menu, Load scenario, Settings and Controls pages; the stills (rendered from the game by `tests/render-stills.mjs`) |
| `src/clock.js`, `src/astro.js` | the KST clock; the sun, the Moon and its phase, sidereal time and the stars (Meeus's low-precision formulas) |
| `src/ui/sky-window.js` | the Sky window |
| `src/ui/load-window.js` | the Weight window, the Sky window's second tab (v0.3.2) |
| `src/world/sky.js` | the sky by day, twilight and night (stars, Milky Way, Moon), and the light, haze and fog following the sun |
| `src/world/citylights.js`, `src/world/taxilights.js`, `src/aircraft-lights.js` | the city lights, the taxiway lights and stop bars, the A321's lights by phase |
| `src/score.js`, `src/store.js` | the landing score (100 × e^(−cost), the approach included); localStorage under `gamedump:flight-sim:` |
| `src/ground/` | the taxi graph and routing, pushback, the gate flow (gate starts, routes out and in) |
| `src/world/apron*.js`, `src/world/traffic*.js`, `src/world/liveries-other.js` | taxiways, aprons, stands, jet bridges and terminals; parked aircraft (made-up airlines) and ground vehicles |
| `src/world/taxiroute.js`, `src/world/airport-mask.js` | the taxi route line; no trees or city blocks inside the airports |
| `data/` | baked terrain, water and land-cover grids, coastline, airports |
| `tools/bake_*.py` | the bake scripts (read `reference/raw/`, write `data/`) |
| `tools/cpu-guard.py` | the CPU guard every heavy dev command runs through |
| `tests/*.test.mjs` | unit tests: `node --test games/flight-sim/tests/*.test.mjs` |
| `tests/browser-*.mjs` | Chrome checks with Playwright. `browser-e2e.mjs` is the Gimpo-to-Jeju flight: take-off, AP, time compression, a jump, skip to final, a landing, the score and the taxi-in route. `browser-gate.mjs` is a gate start, pushback and taxi to the holding point. Also: `browser-cpu.mjs` (nothing runs while paused or hidden), `browser-boot.mjs` (setup, keys, the hub player), `browser-rewind.mjs`, `browser-shots.mjs` (screenshots with fps, triangles and draw calls) and `audio-render.mjs` (the synth rendered offline and measured) |
| `tests/e2e-controller.js` | the test-only take-off and landing controller the end-to-end flight uses |
| `tests/cloud/` | headless checks for a cloud container without a GPU (SwiftShader): stills of the 3D view, landings with the score's parts, the HUD and the pause menu (`HANDOFF.md` says how) |

Every heavy dev command runs through the guard, for example:

```sh
python3 games/flight-sim/tools/cpu-guard.py --minutes 15 -- node games/flight-sim/tests/browser-e2e.mjs
python3 games/flight-sim/tools/cpu-guard.py --minutes 5 -- bash -c 'node --test games/flight-sim/tests/*.test.mjs'
```

The browser scripts expect Playwright in `/tmp/flight-sim/pw` (`npm i playwright` there) and the GameDump server on port 8001 (v0.2.0's on a no-cache server on 8014: `python3 games/flight-sim/tests/cloud/serve.py <GameDump> 8014`). v0.2.0 added `browser-scenarios.mjs` (the menu and scenarios, end to end), `browser-night.mjs` (the night screenshots and the frame rate at night), `render-stills.mjs` (the menu's stills), `browser-menu.mjs`, `browser-sky-window.mjs` and `browser-logbook-filter.mjs`. `browser-boot.mjs` predates the main menu and expects the setup on load.

## Storage

All in localStorage, under `gamedump:flight-sim:`:

- `scenarios`: the scenario index (id, name, created, savedAt, a summary); `scenario:<id>`: each scenario's whole state (a few KB, up to about 70 KB with a long approach track);
- `logbook`: every flight, tagged with its scenario's id and name (v0.1.x's untagged flights count as Scenario 1's);
- `settings` (volume, callouts, the readout, the setup's last plan) and `lastflight` (the last flight's plan).

## Data credits

- © OpenStreetMap contributors, under the ODbL: the coastline, inland water, land cover and airports.
- Copernicus DEM GLO-90 and GLO-30, © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA: the elevation.
- Natural Earth (public domain): the neighbouring coastlines.
- OurAirports (public domain): the runway cross-check.

The baked files in `data/` keep those licences: the OpenStreetMap-derived ones (coast, water, land cover, airports) are under the ODbL, and the elevation is under the Copernicus DEM licence.
- The A321neo's numbers come from Airbus (the A321 Aircraft Characteristics document and the A321neo page) and EASA (TCDS EASA.A.064). Sources and pages are in `src/sim/a321neo.js`.
- The 787-9's come from EASA (TCDS IM.A.115, IM.E.102) and Boeing (D6-58333), the 777-300ER's from EASA (TCDS IM.A.003, IM.E.002) and Boeing (D6-58329-2), with sources and pages in `src/sim/b787-9.js` and `src/sim/b777-300er.js`. What those don't give is marked as an estimate or a weaker source there. Those PDFs aren't in the repository.
- The stars: the Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991), from NASA's HEASARC, public domain (`data/STARS-CREDIT.md`). The sun and Moon follow Jean Meeus, *Astronomical Algorithms*.
- three.js r186 (MIT), in `vendor/`.
- B612 and B612 Mono (© The B612 Project Authors) and Barlow (© The Barlow Project Authors), under the SIL Open Font Licence 1.1, in `vendor/fonts/` with their licence texts.

Nuclear Airlines is made up. No real airline's branding is used.
