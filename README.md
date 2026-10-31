# Flight Sim

An A321neo over South Korea, flown between Incheon, Gimpo and Jeju, over real coastline and elevation with procedural fine detail. It has:

- realistic physics with fly-by-wire;
- a holds-only autopilot with up to 16× time compression;
- a path map that lets you jump ahead along the predicted path, and a "skip to 15 nm final" button;
- gate starts with pushback and a taxi route drawn on the ground;
- parked aircraft and ground vehicles at the airports;
- synthesised engine and warning sounds, the radio-altitude callouts (RETARD included), a landing score and a logbook.

`Updates.md` lists what each version added; the game shows its version in the pause menu.

## Running it

Serve GameDump's root and open the game:

```sh
cd GameDump
python3 -m http.server 8001
# http://localhost:8001/games/flight-sim/
```

It also runs from the hub's player (`play.html?game=flight-sim`). There's no build step: these are plain ES modules, three.js r186 is in `vendor/`, and the baked world is in `data/`. Chrome on a Mac is the target.

The flight setup screen picks the origin, destination, runways, load and fuel, and the start: lined up on the runway, on a 15 nm final, or at a gate.

From a gate:

1. Press P to push back. Q/E steer the turn, and P again holds the push.
2. Release the parking brake (B).
3. Follow the green-yellow line to the holding point.

After landing, a new line leads from the runway to a free stand. Every landing is scored, approach included, and the pause menu opens the logbook. The score is strict: 100 takes a landing that's perfect in every part.

Sound starts with the first click or key, because browsers don't play audio before then. The pause menu has a master volume slider.

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
| 6 / 7 / 8 / 9 / 0 | flap lever 0, 1, 2, 3, FULL |
| C | speed brakes in / out |
| Shift+C | arm ground spoilers |
| Z | autopilot on / off |
| X | autothrust on / off |
| = / − | time compression faster / slower: with the AP on and 2,000 ft up, or in a pushback (up to 4×) |
| M | map (predicted path, jumps, skip to final) |
| V | next view (1st person, 3rd person, Captain, First Officer) |
| P | pushback start / stop |
| Esc | pause menu |
| F3 or \` | performance readout: a line across the top with fps, ms per frame, physics steps, draw calls, triangles, GPU memory, the world's counts and the heap (also in the pause menu) |
| T | rewind 30 s (from the pause menu or after a crash) |
| two-finger swipe / pinch / double-click | look or orbit / zoom / recentre |

The FCU strip at the top sets SPD, HDG, ALT and V/S. Scroll over a window to turn it (a quick flick turns it in big steps), or click it, type a value and press Enter, which also pushes the knob: ALT starts a level change, V/S engages V/S. An ALT under 1,000 is a flight level (350 = FL350); a V/S of 60 or less is in hundreds (−15 = −1,500 ft/min). Esc, a click elsewhere or a flying key closes it unchanged. The strip also has the AP1 and A/THR buttons and the Normal/Alternate law switch.

## Flying tips

- **Take-off:**
  1. Hold R through the detents to TOGA (it pauses at CL and FLX/MCT).
  2. At about 145 kt, hold S. The aircraft rotates at about 4–5°/s and lifts off near 8°.
  3. G for gear up; 6 for flaps 0 at about 210 kt.
  4. Pull the levers back to CL (F) for the autothrust.
- **Autopilot:** set HDG and ALT on the FCU (scroll, or click and type; Enter on ALT starts the level change, OP CLB/OP DES), then Z (AP) and X (A/THR). The FCU heading starts at your heading. Time compression (=) needs the AP on and 2,000 ft above the ground.
- **The map (M):** with the AP on, the bright line is where the aircraft will go. Click a point on it to jump there. The magenta line is the route to your destination and doesn't jump: point the HDG along it first. A red cross means the path meets the terrain. "Skip to 15 nm final" puts you on the 3° path to the destination runway.
- **Landing:**
  1. Gear down; flaps 2, 3, FULL; Shift+C to arm the ground spoilers.
  2. Disconnect the AP with Z.
  3. With flaps 3 or FULL, W/S nudge the flight path, and it holds where you leave it.
  4. From about 30 ft, hold S for a second or two to flare. The nose sinks by itself if you don't.
  5. Pull the levers to idle when you hear RETARD.
  6. On the ground, hold F for reverse and Space for the brakes.
- **Levers at TOGA** start a go-around at any point.

## Known issues

- Nobody has listened to the sound yet: the levels are measured (`tests/audio-render.mjs`), not judged by ear.
- The predicted path is a straight line on the selected heading, because the autopilot has holds only (route following is on the roadmap).

## Code map

| Path | What |
|---|---|
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

The browser scripts expect Playwright in `/tmp/flight-sim/pw` (`npm i playwright` there) and the GameDump server on port 8001.

## Storage

`gamedump:flight-sim:settings`, `gamedump:flight-sim:logbook` and `gamedump:flight-sim:lastflight`, all in localStorage.

## Data credits

- © OpenStreetMap contributors, under the ODbL: the coastline, inland water, land cover and airports.
- Copernicus DEM GLO-90 and GLO-30, © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA: the elevation.
- Natural Earth (public domain): the neighbouring coastlines.
- OurAirports (public domain): the runway cross-check.

The baked files in `data/` keep those licences: the OpenStreetMap-derived ones (coast, water, land cover, airports) are under the ODbL, and the elevation is under the Copernicus DEM licence.
- The A321neo's numbers come from Airbus (the A321 Aircraft Characteristics document and the A321neo page) and EASA (TCDS EASA.A.064). Sources and pages are in `src/sim/a321neo.js`.
- three.js r186 (MIT), in `vendor/`.
- B612 and B612 Mono (© The B612 Project Authors) and Barlow (© The Barlow Project Authors), under the SIL Open Font Licence 1.1, in `vendor/fonts/` with their licence texts.

Nuclear Airlines is made up. No real airline's branding is used.
