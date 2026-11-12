# Flight Sim: handoff

Read this first if you're picking the game up. Its first section is the job in hand; the rest is how the game is built and how to work on it. Then read `AGENTS.md` (the rules), `ROADMAP.md`'s "The long term" (where the game is going) and the newest entries in `STATUS.md` (what was done, with the evidence).

It was first written on 2026-10-31 by the Cowork session that made v0.1.1 to v0.1.3, and every session and run since has kept it up: the Cowork sessions that made v0.1.4, v0.2.1 and v0.2.2, the Claude Code runs that made v0.2.0, v0.3.0 and v0.4.0, the Cowork session that made v0.3.1 and v0.3.2 and set the long-term plan with Shane on 2026-11-10, and the Cowork session that settled v0.4.0's scope, briefed its run, reviewed it, and then made v0.4.1 (Shane's fixes after flying it), v0.4.2 (the list of what was already known) and v0.4.3 (Shane's findings from testing v0.4). That last session wrote this first section for the next one.

## The next session: v0.5.0, the parts model and a first warehouse, from start to finish

Shane, 2026-11-10: "I would rather a new session work completely from end to end of an update." That's you:

- settle the scope with Shane;
- get it built (most likely a Claude Code run you brief, as v0.3.0 and v0.4.0 were);
- check it;
- write it up;
- hand it to him to push.

Your last job is to rewrite this section for the session after you (v0.6.0 in the plan: East Asia).

### Where you start

- **v0.4.2 is pushed** (`8381dfa`). **v0.4.3, Shane's findings from testing v0.4, was written up and ready to push** when this was last updated (2026-11-13). Check with `GIT_OPTIONAL_LOCKS=0 git log --oneline -3`, the only git command allowed here. If the top line isn't the last version written up, ask Shane to push it first (`sh tools/push.sh vX.Y.Z`): a run starts only from a pushed version.
- **Passing at v0.4.3:**
  - 674 unit tests (`node --test tests/*.test.mjs`, about 15 s on the Mac through the guard);
  - in the cloud container, `tests/cloud/wing-gaps.cjs`, `weather-final.cjs` 20/20, `weight-copy.cjs`, `athr-lever.cjs` and `route-views.cjs` all pass;
  - at v0.4.0, on the Mac's GPU (the run): 60 fps in heavy rain at night, a thunderstorm and fog. v0.4.1's signs add a draw call an airport (four, from three); v0.4.2's wiper adds one in a seat in the rain, and the spray one on a wet runway. Not measured on the Mac since.
- **Two settings change how a test flight behaves** (v0.4.1, in Settings, saved under `gamedump:flight-sim:settings`): Indestructible (no crash ends a flight) and Boeing auto-trim (since v0.4.2 with a flare law below 50 ft). A browser check that expects a crash, or Boeing's speed-stable law, must start with them off (a fresh profile has them off).
- **The direction:** `ROADMAP.md` → "The long term". The parts model is the foundation of the KSP and Besiege halves: the warehouse (row 1), failures (v0.8.0), crash physics (v0.12.0) and the new aircraft (v0.9.0 on) all stand on it.

### What Shane has said, in his words

- **2026-11-01** (ROADMAP row 1): "Airplane customisation beyond normal; Similar to MSFS, have a 'warehouse' where you can swap out elements like engines for other planes' parts. So, you can attach GE90 engines to an A321, for example."
- **2026-11-10:** "a sort of 'warehouse' where I can take base models like the B777-300ER and make changes, whether it be adding more engines for fun, making them more powerful, or any sandbox like changes, then run scenarios on them."
- **The long term (2026-11-10):** "a mix of MSFS (for the visuals and groundwork) + Kerbal Space Program (for the sandbox) + Besiege (for the physical realism)"; their ideas, never their assets.
- **Sturdier than Besiege (2026-11-10):** "I think we can make our planes a little more durable than that." ROADMAP has Claude's limits from CS-25 (the gear to 10 ft/s unharmed; the wings to their limit load, broken only past 1.5 times it).
- **His controls:** the Mac's keyboard and touchpad, or a mouse at most.

### Proposed, not confirmed: ask him first

ROADMAP's v0.5.0 row is Claude's proposal: "the three types rebuilt from parts and flying exactly as now (golden flights, as v0.3.0 did); the warehouse changes engine count and placement, thrust, weight and fuel, and saves designs that show in the aircraft picker. Off-centre thrust yaws, more engines burn more fuel, and too much thrust for a pylon breaks it. Changing the wing (aerodynamics from its shape) comes later." Settle these before you write the brief. Each has a default, so he can answer by picking options (v0.4.0's eight went in two AskUserQuestion calls).

1. **What the first warehouse changes.** Default: the engines (how many: 2, 3, 4 or 6; where along each wing; which of the three: LEAP-1A, GEnx-1B, GE90-115B; a thrust scale), the empty weight and the fuel capacity. Not the wing, the fuselage or the tail.
2. **Where it lives.** Default: Warehouse on the main menu. The aircraft stands in 3D (orbit and drag, as in 3rd person), with the parts beside it and the numbers that follow (thrust to weight, MTOW, range, each engine's ground clearance). Designs are saved in the browser and picked in New scenario beside the three types.
3. **A design's base.** Default: always one of the three types. A design changes parts on it, and its name and registration are yours.
4. **What breaks.** Default: a pylon holds about 1.5 times its base engine's thrust (CS-25's ultimate factor). Past it the warehouse warns, and in flight the engine comes off at full thrust: it stops and disappears (the debris and the crash physics come in v0.12.0). An engine that touches the ground at rotation strikes it, as today.
5. **The ground clearance.** Default: a GE90 on an A321 scrapes, as it would in reality; the warehouse can lengthen the gear to clear it, and the tail-strike angle follows.
6. **More engines on the screens and in the sound.** Default: the engine panel and the EICAS draw as many as there are, and each engine gets its own voice in the synth, up to six.
7. **Who builds it.** Default: a Claude Code run. The three types' golden flights must come out the same from parts, and the model's checks want the M5's GPU.

### The brief: `V050.md`

Model it on `V040.md`, and on `V030.md` for rebuilding the types without changing them. Its parts, in order:

1. **Golden flights for the 787-9 and the 777-300ER,** recorded from v0.4.0's untouched code, as v0.3.0 recorded the A321's (`tests/golden-a321-flight.mjs`).
2. **The parts model in the sim:** the types as parts (the engines with their position, thrust, weight, fuel burn and sound; the gear; the tanks), with all three golden flights unchanged to 1e-9 and every old assertion unchanged.
3. **Engines by count:** the sim's core (two engines by name today), the A/THR, the engine panel and the EICAS, the synth; a save from before v0.5.0 loads as it was.
4. **The warehouse:** its page and 3D view, designs saved and in the picker, scenarios keeping their design.
5. **A design's physics:** off-centre thrust, the pylon's limit, the clearance and the taller gear.

A definition of done to start from: the three golden flights to 1e-9; a four-engine 777 and a GE90 A321 take off, climb and land with the test pilot; asymmetric thrust yaws by the sum of the moments; a scenario with a design round-trips through a reload; 60 fps with six engines; a reviewer subagent.

### Where the parts model plugs in

From a read of the code on 2026-11-10. Check the line numbers, which drift.

| Where | What to know |
|---|---|
| `src/sim/types.js`, `kitFor()` | The registry; each type's data and geometry modules; the sim's factories, made once per type. A design would be a type made from a base and its changes. |
| `src/sim/a321neo.js`, `b787-9.js`, `b777-300er.js` | Every number with its source. The engines' (`T_IDLE`, `N1_TOGA`, the TSFC) are for one engine of two. Every name `a321neo.js` exports must exist (the data tests check). |
| `src/geometry*.js` | `ENGINES` (where the thrust acts: the sim's calibration), `NACELLES` (where they're drawn and strike the ground), `GEAR`, `GROUND_Z`, `CRASH_POINTS` (since v0.4.1 also Indestructible's skids: engines moved or added need their points). |
| `src/sim/sim.js` | Two engines by name in the core (`n1L`, `n1R`, `revL`, `revR`, `thrL`, `thrR`, `ffL`, `ffR`, `n1tL`, `n1tR`), stepped as `eng[0]` and `eng[1]` (about lines 374–382) and reported in `state.engines` (about 669). The thrust's moments already loop over `ENGINES` (about 434). `trimAirborne()` splits the thrust by two at `ENGINES[0].z`. The tanks are `fuelL`, `fuelR` and `fuelC`. The core is the snapshot, so older saves need a migration. |
| `src/sim/engines.js`, `autopilot.js`, `autopilot-boeing.js` | One engine's model; the A/THR reads both engines. |
| `src/ui/engines-panel.js`, `src/ui/boeing/eicas.js` | Two engines drawn. |
| `src/audio/synth.js`, `src/audio/engine-sounds.js` | Two engines' voices (`SPLIT` makes their beat); each engine type's tones. |
| `src/aircraft.js`, `src/widebody.js`, `src/widebody-specs.js`, `src/type-assets.js` | The models: nacelles and pylons at `NACELLES`; which model each type uses. |
| `src/ui/setup.js`, `src/scenarios.js`, `src/ui/menu.js` | The picker (`TYPE_LIST`), a scenario's `type`, the main menu. |
| `tests/golden-a321.test.mjs`, `tests/types.test.mjs` | The golden flight and the types' round trips. |

### After the run

1. **Read the run's `STATUS.md` entries,** and go through the definition of done item by item against the evidence.
2. **Check it yourself:** the unit tests on the Mac through the guard; the cloud checks (`route-views`, `weight-copy`, `athr-lever`, `weather-final`, `audio-render`, and new stills of designs); and, for anything that should be unchanged, a comparison with the pushed version (see "Working from a Cowork session"). Look at every picture, and make clips for Shane.
3. **Fix what's wrong:** in the session if it's small, as a v0.5.1 patch if it isn't.
4. **Write it up:** `src/version.js`, `Updates.md`, `README.md`, `PLAN.md`, `ROADMAP.md` (row 1 and the plan), `AGENTS.md` (State), `STATUS.md`, and the Games project doc.
5. **Hand it to Shane:** `sh tools/push.sh v0.5.0`, then Empty Cache and Hard Reload.
6. **Rewrite this section** for v0.6.0's session.

## Where things stand

| Version | What | Pushed |
|---|---|---|
| v0.1.0 | The overnight build: M1–M3 from `PLAN.md` | yes (`cc22094`) |
| v0.1.1 | Incheon's flickering taxiways, new cockpit windows, a fairer landing score | yes (`a4df7a4`) |
| v0.1.2 | A lower windshield, the engines under the wing, gentle touchdowns on grass | yes (`7d6edc4`) |
| v0.1.3 | A stricter landing score that counts the approach, a master volume slider, a performance readout bar, Jeju 31's glideslope fix | yes (`7bd1a6c`, 23:01 KST) |
| v0.1.4 | Typing into the FCU, jumps picked anywhere on the bright path, Gimpo stand 7's routes, pushbacks at up to 4×, Jeju's crossing as one surface, the B612 and Barlow fonts | yes (`f4482a4`) |
| v0.2.0 | The main menu, scenarios (save slots with the whole state), one logbook tagged by scenario, Settings and Controls; night: the KST clock and the Sky window, Earth's sky with real stars and the Moon, the light following the sun, city, airport, taxiway and aircraft lights | yes (`73b7776`) |
| v0.2.1 | Taxiways that stop at the runways' edges (no more clipping), changing the route in flight from the map, dragged waypoints that show, the view switch (Cockpit, Nose, 3rd person; 1, 2, 3), one-finger drag to look around or orbit, more stars | yes (`0c22ce4`) |
| v0.2.2 | The engine sound rebuilt from the LEAP-1A's real tones; the A/THR moving the thrust lever (and the N1 ring), R/F taking it over smoothly; Cockpit (1) no longer swaps seats | yes (`7d9a20d`) |
| v0.3.0 | Aircraft types, the Boeing 787-9 and 777-300ER, with Boeing's law, trim, autothrottle, MCP and screens, code E stands, the picker | yes (`12921f2`) |
| v0.3.1 | The main gear carried by the wing with the flaps out (and the A321's wing where Airbus draws it), no gaps at the slats and flaps, the seat swap back on Cockpit (1), louder engines in the cockpit, gear doors with an inside | yes (`1530e48`) |
| v0.3.2 | The Boeings' ALT window to 45,000 ft, past their 43,100 ft ceiling; Duplicate a scenario (and the pause menu's Save a copy); the Weight tab: passengers, cargo and fuel changed in flight | yes (`45e495f`) |
| v0.4.0 | The weather: the Weather tab and its presets, the wind by height, gusts, turbulence, shear and microbursts, a real altimeter (K, the BARO boxes), the Boeings flying the track and decrabbing, windshear warnings, the wind on the card and in the logbook, wet, snowy and icy runways, fog, cloud layers, rain, snow, lightning, and their sound | yes (`c4aac7c`) |
| v0.4.1 | The 777's wingtip hole and the slats' air gap closed (no light through any wing); Indestructible and Boeing auto-trim in Settings; storms in three strengths, microbursts rare, gusty winds that hold their direction; taxiway and runway signs, and the names painted on the taxiways | yes (`029ba0b`) |
| v0.4.2 | The known list: the crash screen's Rewind with Indestructible on; Boeing auto-trim's flare and H/Y; Indestructible's belly skids, hard stop and gear-up card; the Boeing autoland nearer the centreline in a crosswind; runway exit and distance remaining signs; predictive windshear; hydroplaning; wipers; spray; snow over the taxiway paint | yes (`8381dfa`) |
| v0.4.3 | Shane's findings: the slats and flaps stay on the bent wing in flight; solid engines with centred fans; the 777 settles after a pitch input as the 787; auroras on every clear night | not yet when this was written: `sh tools/push.sh v0.4.3` |

- **Check first:** `GIT_OPTIONAL_LOCKS=0 git log --oneline -3` (the only git command allowed here), to see what Shane has pushed since.
- **Passing at v0.3.0's hand-off:** 501 unit tests; `browser-boeing-flight.mjs` and `browser-types.mjs` on both Boeings; `browser-e2e.mjs` 12/12, `browser-scenarios.mjs` 23/23. `audio-render.mjs` 30/30 on each Boeing, six runs in a row; on the A321 its reverser door clunk can still fail now and then (it's too quiet there by the check's measure, and the A321's sound stays as it is). Not played by hand or listened to.
- **v0.3.0's evidence** is in `STATUS.md` (from "2026-11-04, 04:36 KST"), its final entry says what's weak, and ROADMAP has the leftovers.
- **v0.3.1's** is in its `STATUS.md` entry ("2026-11-08, 03:40 KST"): 506 unit tests, `route-views.cjs`, `audio-render.mjs` 30/30 on each type, and before/after close-ups of every type's wing, gear and doors (`tests/cloud/models.cjs`).
- **v0.3.2's** is in its two `STATUS.md` entries ("2026-11-08, 15:05 KST" and the one after): 521 unit tests, `tests/cloud/weight-copy.cjs` (new) and `route-views.cjs`.
- **v0.4.1's** is in its `STATUS.md` entry ("2026-11-11, 00:20 KST"): 646 unit tests, the cloud checks, and before/after pictures of the wings, the signs and the card.
- **v0.4.3's** is in its `STATUS.md` entry ("2026-11-13, 01:35 KST"): 674 unit tests, the cloud checks, before/after pictures of the bent wings, the engines and the fan, the aurora, and the pitch measurements (`tests/boeing-pitch-settle.test.mjs`).
- **v0.4.2's** is in its `STATUS.md` entry ("2026-11-12, 23:05 KST"): 668 unit tests, the cloud checks, and pictures of the runway signs, the snow over the paint, both PFDs' windshear warning, the wiper, the spray and the crash screen (`tests/cloud/v042-shots.cjs`). It also says why broken cloud far off and the 777's yaw were left as they were.
- **v0.4.0's** is in its `STATUS.md` entries: the run's (from "2026-11-10, 10:38 KST") and the review's ("2026-11-10, 17:05 KST"): 626 unit tests, the run's Chrome checks on the Mac (60 fps in rain at night, a thunderstorm and fog; the crosswind landings), and the review's cloud checks (`weather-final.cjs`, new; `weight-copy.cjs`, `route-views.cjs`, `athr-lever.cjs`, `audio-render.mjs`; clear weather against v0.3.2).
- **The long-term plan** (2026-11-10) is in `ROADMAP.md` → "The long term", and its two `STATUS.md` entries say how it was reached.
- **Passing at v0.2.0's hand-off** (all on the Mac, Chrome on its GPU, through the guard; `STATUS.md` has the commands and numbers; v0.2.1's and v0.2.2's checks are in their STATUS entries):
  - 262 unit tests in 34 files (`node --test tests/*.test.mjs`);
  - every `.js`/`.mjs` in `src/` and `tests/` checked **as a module** (copy to `.mjs`, then `node --check`; a plain `node --check file.js` checks it as a script and missed a broken `if … else` once);
  - `tests/browser-scenarios.mjs` 23/23, `browser-night.mjs` 3/3 (60 fps at night over Seoul, 45 draws, 0.75 M triangles), `browser-review-fixes.mjs` 7/7, `browser-e2e.mjs` 12/12, `browser-cpu.mjs` 6/6.
- **No agent has yet:**
  - listened to the synth, or to the volume slider's preview (v0.2.2's engines were built from the LEAP-1A's numbers and checked by measurement; `tests/audio-clips.mjs` renders clips for Shane to judge);
  - played v0.2.0 the way Shane will: a whole evening flight from the menu with the clock running through dusk (the checks set the clock and stop it).

## v0.2.0: the menu, scenarios and night

`V020.md` was the brief; `STATUS.md` (from "2026-11-01, 04:10 KST: v0.2.0 run started") has the log, the decisions made overnight and the evidence. In short:

- **The main menu** (`src/ui/menu.js`): shown on load over one of four stills from the game (`assets/menu/`, rendered by `tests/render-stills.mjs`); nothing renders behind it.
- **Scenarios** (`src/scenarios.js`, `captureState()`/`applyState()` in `main.js`): `gamedump:flight-sim:scenarios` (the index) and `…:scenario:<id>`. A save holds `sim.snapshot()`, the plan (with the map's waypoints), `gate.serialize()`, the flight's flags, `scorer.serialize()` (the approach track as arrays), `rig.serialize()` and `clock.serialize()`. Autosave every 60 s in flight, on pause, hide, `pagehide`, Exit to menu, after a landing, and Save; never a crashed state. v0.1.x's `lastflight` became "Scenario 1" (`legacy: true`); its keys are untouched.
- **The logbook** tags each flight with `scenarioId`/`scenarioName` (`unsaved` for flights without a scenario); untagged v0.1 flights count as the legacy Scenario 1's.
- **Night:** `src/clock.js` (KST, stepped by the sim time stepped), `src/astro.js` (Meeus), `src/world/sky.js` (`setTime`, `lightingAt`, stars from `data/stars.json`, BSC5), `uNight` and the lamp uniforms in `glsl.js`, `citylights.js`, `taxilights.js`, the light shaders in `airports.js`, floods and windows in `apron.js`, `aircraft-lights.js` (`lightsFor` by phase), the cockpit's `setNight`, and the Sky window (`src/ui/sky-window.js`, L or Cmd/Ctrl+L, the one Ctrl binding).

## Other open items

- **From `ROADMAP.md`:**
  - nobody has listened to the synth;
  - v0.4.0's weak points are under "Found while building v0.4.0": the autoland's alignment, broken layers from far off, the approach lights' missing reflections, the Nices not built, the weaker sources.
- **From v0.2.0** (STATUS's final entry lists them all):
  - the cockpit at night is plain (a warm flood and lit screens, no panel backlighting); the terminal windows read a little like a checkerboard close up; distant taxiway lights merge green and blue into cyan; stop bars are always lit;
  - a moonless night away from the cities is very dark, especially from cruise (the ambient is at the top of the brief's 2–5% of day);
  - the Moon is drawn 2.4× its size so it reads on screen;
  - an autosave can catch a moment just before a crash (it never saves the crash itself);
  - the old `tests/browser-boot.mjs` expects the setup screen on load; the main menu replaced that, and `browser-scenarios.mjs` covers the boot now.
  - (Jeju's runway seam, Gimpo stand 7's routes, the slow pushback, and Shane's FCU heading and path-pick bugs of 2026-11-01 were all fixed in v0.1.4.)
- **His future additions** are in ROADMAP: the 2026-11-01 table (rows 1–11), the additions of 2026-11-10 (rows 12–15: special aircraft, the airports in East Asia and three regions beyond, replays and a flight recorder, challenges), and "The long term" with the version plan.
- **The score's calibration:**
  - It rests on a rebuilt profile of Shane's described landing (`tests/score.test.mjs`), with his g, bank and pitch assumed.
  - If his next landings score far from what he expects, retune `COST` in `src/score.js` and the anchors in the test, and log why.
- **The test-only e2e controller** aims its centre at 400 m past the threshold. So the score reads it about 0.4 dots high against the PFD's glideslope, which starts 300 m past it. That's fine for a test pilot. Don't "fix" the score for it.

## How the recent changes work

| Where | What |
|---|---|
| `src/score.js` | Points = round(100 × e^(−total cost)), with a cost for each part in `COST`. `approachStats()` measures the approach from the scorer's track (from 1,000 to 100 ft: RMS dots off the PFD's glideslope, 3° from 300 m, and the localizer; from 1,000 to 50 ft: the sink rate's swing). `sharePoints()` splits the points lost. `landingRunway()` finds the runway (the pavement plus 2 m, 60 m, or up to 400 m short and lined up). |
| `src/ui/score-panel.js` | The card, and the verdict (the biggest flaw when one costs 3 points or more). |
| `src/cockpit-windows.js`, `src/aircraft.js` | The windows are designed from the Captain's eye. The fuselage's sections are two half-ellipses meeting at `fuseMid` (`fuseSection()`, `fusePoint()`), and the crown is cut down over the windshield (`fuseTop` against `crownBeforeCut`). |
| `src/geometry.js` | `ENGINES` is where the thrust acts (the sim's calibration), `NACELLES` is where they're drawn and where engine strikes are checked. The wing's height is `WING_Z0` in `aircraft.js`. |
| `src/sim/sim.js`, `gear.js`, `a321neo.js` | Grass: `GRASS_RUN_M`, `GRASS_SAFE_GS`, and the grip and rolling figures. |
| `src/world/apron.js` | The pavement's layering: no depth writes, drawn in a fixed order. |
| `src/main.js`, `src/ui/hud.js` | Settings (`settings`, `saveSetting()`), the volume (`setVolume()`), the readout (`perfLine()`, `setPerf()`, `hud.setTopInset()`). |
| `src/ui/common.js` | `thresholdOf()`: an end's x, y already is the landing threshold. |
| `src/ui/fcu.js` | v0.1.4: a click opens a window for typing (`openEdit`/`closeEdit`; a capturing keydown takes the digits before the game), Enter sets and pushes; scrolling 12 px a step, big steps when fast (`turn()`). |
| `src/ui/map.js` | v0.1.4: `hitSample()` hits the line between the path's samples (12 px); `hint()` says why a click on the magenta line doesn't jump. |
| `src/ground/taxi.js` | v0.1.4: `bridgeIslands()` links a piece of taxi line within 30 m of the network to it (`graph.bridges` counts them: RKSS 2, RKPC 1, RKSI 0). |
| `src/main.js` | v0.1.4: `pushing()`: time compression in a pushback, up to `PUSH_MAX_RATE` (4); the tug moves by the sim time stepped. The fonts are loaded before the screens first draw. |
| `src/world/runways.js`, `heightfield.js`, `glsl.js`, `airports.js` | v0.1.4: `runwayCrossings()` ranks an airport's runways by length; a shorter one that crosses a longer one gets two `knots` (it meets the longer one's surface at its drawn edges) and a `cutBy` (its mesh, markings and lights are cut away there). `profileAt()`/`rectElev()` give a runway's surface height. `heightAt` and the GLSL `flattenRunways` follow one rule: on a runway's pavement, that runway's surface (the longer one's where two cross); off it, the nearby surfaces blend by distance. |
| `style.css`, `src/ui/*.css`, `src/ui/common.js`, `src/ui/pfd.js` | v0.1.4: `--font` (Barlow) for the menus, `--font-screen` (B612) and `--font-mono` (B612 Mono) for the screens; `FONT` for the canvases; `fitSize()` sizes the PFD's altitude text to its windows. |
| `src/world/apron-geom.js`, `apron.js` | v0.2.1: `drawnRunwayRects()` (each runway as drawn: pavement end to pavement end, width plus shoulders); `clipSoupOutside()` cuts the pavement away inside them (5 cm under the edge, `RUNWAY_OVERLAP`); `splitPolyline()` splits the paint there: taxiway centrelines on a runway become lead lines on its own surface (the `lay` attribute, pulled by `PULL.lead`, more than the runway), and edge lines stop. `refineSoup()`/`refineLine()` split pavement and paint where they'd stray more than 2–3 cm from the ground. `buildPavement`/`buildPaint` are exported for `tests/apron-ground.test.mjs`, which checks them on the real terrain. |
| `src/ui/map.js`, `src/main.js` | v0.2.1: Change route. The map's panel (`openRoute()`, `fillRoute()`; `straightIn()` picks the end you'd fly straight in to; `hitAirport()` for a click on a runway or a label) calls `map.onroute`, which is `changeRoute()` in main.js: it sets `plan.dest`/`arrRunway` and `dest`, clears the waypoints, moves the scorer's planned runway, and saves. It refuses after landing. `view.waypoints` is the map's own list (`map.waypoints`, common.js `route`). |
| `src/ui/hud.js`, `src/main.js`, `src/input.js`, `src/camera.js` | v0.2.1: the view switch (`VIEW_BUTTONS`, `showView()`, placed in `resize()` to match the FCU's box: compact, then at the bottom centre, if it would touch the FCU). `hud.onview` → `selectView()` in main.js (Cockpit takes the last seat, and swaps seats when in one); Digit1–3 → `viewCockpit`/`viewNose`/`viewOrbit`. |
| `src/camera.js`, `style.css` | v0.2.1: one-finger drag. Pointer events on the canvas (`onDown`/`onMove`/`onUp`, captured from the press, so a drag carries on over the HUD); it turns after `DRAG_PX` (4 px), so clicks stay clicks. The view follows the finger, as the swipe does (`turn()`, shared with the wheel): per screen height, `DRAG_LOOK` (2.5) × the field of view, or `DRAG_ORBIT` (3.2 rad) in 3rd person. A double-click whose second press dragged doesn't recentre. `#view` has `cursor: grab` (`.drag`: grabbing). `tests/cloud/camera-drag.cjs` checks it all. |
| `src/world/sky.js` | v0.2.1: more stars. `starBrightness()` (`STAR_GAMMA` 0.55, was 0.72) for the catalogue; `fillStars()` gives each lit cell a magnitude from 6.5 to `FILL_FAINT` (8.0), three times as many per magnitude, with the same brightness, on about one cell in ten (7% at the galactic poles, 12% at its plane, up to 30% in the Milky Way's band). Moonlight (`uMoonGlow.r × 100`) fades the fill (gone at full Moon) and the catalogue's stars fainter than about 5.5. The counts and stills are in STATUS. |
| `src/sim/autopilot.js` (`athrStep`), `src/sim/sim.js`, `src/sim/engines.js`, `src/input.js`, `src/ui/engines-panel.js` | v0.2.2: the A/THR moves the thrust lever. While active (in flight, the lever at CL or below when it took over) it sets `X.athrLever = leverForPhi(phi)` and `X.athrDriving`; sim.js writes it to `controls.thrust` each step, and `state.athrActive`/`state.leverN1` (the N1 the lever asks for here and now: the panel's ring) go out. A `controls.thrust` that differs from what it wrote is the pilot's: A/THR disconnects (event `athrDisconnect`, reason `idle` or `lever`; main.js toasts `lever`). The keyboard (`input.update(…, athrDriving)`) follows the lever while it drives; a fresh R/F press takes it over; a press that began before (pulling back to CL after take-off) is ignored until released. Alpha floor drives the lever to TOGA and can't be overridden while it's triggered. Its limit is climb thrust (`A.RATING.CL`), as with the lever in CL before. |
| `src/audio/synth.js` | v0.2.2: the engines, per engine: `fanOsc` and `buzzOsc` (custom `PeriodicWave`s at the N1 shaft's frequency: `fanAmps()`, the blade-passing order 18 and its harmonics with sidebands; `buzzAmps()`, every order, uneven), wavering through `wanderBuffer()` (±4 cents, ±15/20 % level); `whineOsc` from N2 (≈ 60 + 0.4 N1); white noise round 1.4 × the BPF (`fanNoise`), pink noise low-passed 160–860 Hz (`jet`), brown noise (`core`). `ENG` holds each voice's gain, `MIX` the cockpit/outside balance; `SPLIT`/`TONE2` the second engine's offset (the beat). `opts.aft`/`opts.dist` (main.js: the nose is −1; 3rd person `cos(yaw)·cos(pitch)` and its orbit distance) weight fan and buzz-saw ahead, jet behind, and lower and dull the sound beyond 75 m. `set()` skips unchanged targets. |
| `src/main.js`, `src/ui/hud.js`, `src/ui/menu.js` | v0.2.2: `selectView('cockpit')` kept the seat you were in. **v0.3.1 reversed it**: in a seat it swaps to the other one; from outside it's the captain's. (v0.2.2 had misread Shane's request.) |

### v0.3.0: the types

| Where | What |
|---|---|
| `src/sim/types.js`, `src/type-assets.js`, `useType()` in `src/main.js` | The registry (no DOM, the worker reads it), the models, and the one place everything is told the type. `sim.setType()` keeps `sim.ap`, `sim.state` and `sim.controls` as the same objects and starts a fresh core: reset or restore next. |
| `src/sim/fbw-boeing.js` | C*U: hands off, an energy loop flies the path that returns to `X.vRef`; the stick's g goes on top; `controls.trim` moves `vRef` at 10 kt/s, stopped at `vmm` and VMO/MMO. No flare law. Its `hooks` are all `sim.js` knows of a Boeing. |
| `src/sim/autopilot-boeing.js` | The modes run with the AP off too, as the flight director's. A hand on the levers is an override that ends 1 s after release. `ils` and `route` are in `AP_FIELDS`, so they're in every snapshot and the prediction flies them. |
| `syncNav()` in `src/main.js` | `sim.reset()` clears a Boeing's ILS and route: it sets them after every reset and when the route changes. |
| `tests/browser-boeing-flight.mjs <id> [flight1 flight2 views fps]`, `tests/browser-types.mjs <id>`, `tests/e2e-controller.js` | The two flights, views, frame rate, saves. The controller has a Boeing branch (trim, flap detents, a firmer flare from 70 ft). |

### v0.3.1: the wing's moving parts, the cockpit's sound

| Where | What |
|---|---|
| `foilPiece()` in `src/aircraft.js` | `f0`/`f1` may be arrays, one chord fraction per section (a flap whose leading edge isn't at one fraction); `nose` rounds the front face into a half-ellipse (flap noses; the fixed leading edge behind the slats); `lift` sets a plate's height over the surface (`SHROUD_LIFT`: the fixed shroud under the spoilers). `slab()` makes a panel with an inside and rims (the doors). |
| `src/aircraft.js` (A321), `src/widebody.js` (Boeings) | Each inboard flap's leading edge is a straight line behind the main gear's leg: `FLAP_IN_LE_X` (the 0.75-chord point at the flap's outboard end) and `inboardFlapLE(spec)` (0.45 m behind the leg's axis at the inboard end, hingeF at the outboard end). The fixed wing runs to it, so the gear hangs from structure. The spoilers keep their width but move aft to overhang the flaps by the travel less a slot (`OVERHANG`; widebodies: `flapTravel` − 0.15, at most 0.6 of the flap's chord); a fixed shroud runs under them the flaps' whole span. Canoes: the aft part is its own bone (`canoe{i}{L,R}`), hinged at the split, turned by 0.55 × the flap angle. Slats: two tracks each, on the slat's bone. |
| `src/geometry.js` | The A321's `WING.rootX` is 3.57 (was 4.6): Airbus's AC 2-2-0 top view puts the root's trailing edge 1.33 m behind the main gear. The nav lights (`NAV_X`) and the wingtip strike points follow it. `NACELLES` didn't move: the engines now sit a little further ahead of the wing than Airbus draws (about 0.6 m). |
| `src/audio/synth.js` | The cockpit's mix (`MIX[…].in`) and low-pass (`INSIDE_LP`, 1.3 kHz): the engines up, most of all the low roar and rumble, so the cockpit stays duller than outside (`audio-render.mjs` checks that by centroid); the wind (`in` 0.48) and the air conditioning (0.02) trimmed to sound as before through the wider low-pass. |
| `tests/cloud/models.cjs`, `tests/dev-aircraft.html`, `tests/dev-widebody.html` | Close-ups of each type's wing, gear and doors (landing, clean, doors), from the dev pages' `window.dev.look()` and `png()`. |
| `tests/dev-audio-render.html` | `renderClip(name, { noeng: true })` renders a clip with the engines stopped, to tell them from the rest of a mix. |

### v0.3.2: 45,000 ft, Duplicate, the Weight tab

| Where | What |
|---|---|
| `ALT_TOP` in `src/ui/boeing/mcp.js`, `setAlt()` in `src/sim/autopilot-boeing.js` | 45,000 ft, both. Nothing else stops at the 43,100 ft ceiling: the ISA, the thrust lapse and the Mach buffet carry on above it. |
| `duplicate()`, `copyName()` in `src/scenarios.js` | A copy is `create()` with the original's state, summary and type, named "(copy)", "(copy 2)", … (a copy of a copy counts on from the same name). It's saved now, so it heads the list; never legacy; the logbook's flights stay with the original. |
| `src/ui/menu.js` (Load scenario), `saveCopy()` in `src/main.js` | Duplicate on each row (a note over the list says what happened; storage full makes no copy and changes nothing). The pause menu's Save a copy saves, then duplicates the current scenario; the flight goes on in the original. |
| `setLoad()` in `src/sim/sim.js` | Payload and fuel within the sim's limits, the fuel put in as at a reset (wings first). The reference point stays put (the CG moves inside the airframe, so the core's CG position moves by the change); speeds and attitude don't change; `thsTakeoff` follows the CG. `paxN`, `cargoKg` and `fuelAddedKg` are core fields (null, null, 0 by default; `restore()` defaults them for older saves), shown in `state`. The logbook's fuel used is `fuelAtStart + fuelAddedKg − fuel`. |
| `src/ui/load-window.js`, `src/ui/sky-window.js`, `sky-window.css` | The Weight window: the Sky window's frame and place, with tabs in the title bar (`createSkyWindow({ tabs })`, `ontab`); `showLTab()`, `toggleL()` in `main.js`, and L opens the tab last shown. Its sums use the sim's own OEW and tanks (`loadNow()`; the A321's setup still shows v0.1.0's, 400 kg lighter with 354 kg more fuel). Its fields take the keys (the flight's keys pause while one has the cursor; Apply, Esc or a click outside give them back). `loadCheck()` and `maxFuel()` are pure, tested in `tests/load.test.mjs`. |
| `src/main.js` | Skip to final keeps the present load (it used the plan's payload); the plan isn't changed by the Weight tab, so Restart the flight and New flight start from the setup's load. |

### v0.4.0: the weather

| Where | What |
|---|---|
| `src/sim/weather.js` | The settings (`calmWeather()`, `normalizeWeather()`: JSON-safe, never shared), `compileWeather()` (what the step reads), `windAt()` (the wind at a point and a time: the mean by height, the shear, gusts, microbursts, turbulence and the roll gust), `RUNWAY_TYRES` and `runwayStateOf()`. No state and no `Math.random()`. Directions are converted once, at `refX`, `refY` (the arrival airport). |
| `src/sim/sim.js` | `setWeather()` (at once, in flight too), `setBaro()`, `setBaroStd()`, `setLocalQnh()`, `sim.weather`, `sim.baro`. The default weather is `null`, which skips every new term. The step's air-relative velocity (the gear keeps the inertial one), the flat rating (`flatSigma()`, both sides of ISA), the windshear detector (`wsF`, `wsT`: F over 1 km), and `state.altInd`, `baroAlert`, `wind` (with `sfcX`, `sfcY` and `gustKt`: the tower's wind) and `drift`. `trimAirborne()` crabs for the mean wind. `restore(snap, { keepWeather })`: a rewind or a jump keeps the weather set now. |
| `src/sim/atmosphere.js` | `columnInto()` (ISA + ΔT, with the QNH at sea level), `pressureAltitude()`, `indicatedAltitude()`. |
| `src/sim/autopilot-boeing.js`, `autopilot.js` | The autopilots fly `state.altInd`. The Boeings' LNAV, LOC, ROLLOUT and TO/GA in the air fly the track (`S.drift`); the runway alignment from 500 ft (`ALIGN_*`, `boAlign`); the rollout's aileron into the wind. |
| `src/sim/weather-presets.js` | `PRESETS`, `presetWeather()`, `weatherContext()`, the tab's form (`weatherForm()`, `weatherFromForm()`, `weatherCheck()`), `finalMicroburst()`, `metarOf()`. |
| `src/ui/weather-window.js`, `sky-window.css` | The Weather tab, the third window in the L frame (`.fssw.fswx`). |
| `src/main.js` | `startFlight()` sets the plan's preset, then the day's QNH; `placeOnFinal()` sets the HDG to the crabbed heading and the ALT from the altimeter; `applyWeather()` (the tab); `shownWeather` redraws the world and tells the synth when `sim.weather` changes; K is `localQnh`. |
| `src/ui/nd.js`, `boeing/nd.js`, `pfd.js`, `boeing/pfd.js`, `fcu.js`, `boeing/mcp.js` | The wind readouts (`windReadout()`), the setting and STD, the BARO boxes (`turnBaro()`, `typedBaro()`, `toggleStd()`), WINDSHEAR and the transition reminder. |
| `src/score.js`, `ui/score-panel.js`, `ui/logbook.js` | `windAtTouchdown()` (the tower's wind, its gusts and its parts), the card's line, the logbook's column. |
| `src/world/sky.js`, `glsl.js` and the ground's shaders | The haze as uniforms (the visibility, the fog's top), the overcast light, wet and snowy ground. |
| `src/world/clouds.js`, `precip.js`, `src/sim/lightning.js` | The flat layers and the lightning; rain, snow, the windshield's drops and the rain shafts; the seeded strikes. |
| `src/audio/synth.js`, `callouts.js` | Rain, thunder, the gusts, the Boeing's siren; the windshear calls. |
| `tests/weather*.test.mjs`, `tests/browser-weather-*.mjs`, `tests/cloud/weather-final.cjs` | The run's tests (104 of the 626 unit tests), its Chrome checks on the Mac, and the review's cloud check. |

### v0.4.1: the wings, Indestructible, auto-trim, storms, signs

| Where | What |
|---|---|
| `src/widebody.js`, `src/aircraft.js` | The wing box's sections include `LAST` (the aileron's end): the 777's ended at the last station before it, 28 m, and left a 1.6 m hole in front of the aileron. Where the outer slat runs past the aileron (the 777's), the tip has the box's round nose until the slat ends. The slats droop about one hinge line a wing, through the fixed nose's centre, with no travel: the nose (`nose: 1`, a half-circle) fills the slat's back at any angle. Narrow gaps between slats are sunken fillers on the slats' bone; gaps between trailing-edge surfaces are fixed fillers. The specs' `slatTravel` and `slatOutDeg`, and the slat tracks, are gone. `wingSec` in `aircraft.js` is exported (the wing check reads the planform). |
| `tests/cloud/wing-gaps.cjs` | Each type's skinned triangles, cut into cross-sections every 2 cm of span, looked through along vertical lines and lines 20° to 65° fore and aft: stowed, across the chord; slats and flaps out, across the front 45% (the flaps' own slots are real). It finds v0.4.0's hole, its slots and its slats' gaps. About 15 s. |
| `src/sim/sim.js` | `setOption()`: `opts` (`indestructible`, `autoTrim`), `sim.setIndestructible()`, `sim.setAutoTrim()`; a snapshot has `options` only when one is on, and `restore()` takes them from it (`main.js`'s `applyFlightOpts()` puts the player's back after every restore). Indestructible: `crash()` pushes a `damage` event instead (once while it lasts, again after 3 s of none); the crash points are skids before the integration (`SKID`: spring and damper per kg, friction 0.4), `X.scrapes` (which are down) and `state.scraping`, `scrapeDepth`. |
| `src/sim/predict-core.js` | A path ends at the first skid's touch (`S.scraping`), or wheels on the water, as it would have at the crash. |
| `src/score.js`, `ui/score-panel.js`, `ui/logbook.js` | `damage` events from 10 s before the touchdown on make the part "Would have crashed" (`COST.crash`, 2.3: as off the runway; `DAMAGE_SHORT` for the value), `result.indestructible`, `result.damage`; the card's line and verdict; the logbook's tag. |
| `src/sim/fbw-boeing.js` | `E.autoTrim`: hands off, the path held (latched as `fbw.js` does); gear down and flaps over 18°, the stick a path rate (`PATH_RATE`, 3.5°/s); elsewhere load factor; the stall protection as before; `vRef` follows the speed, so turning it off carries on smoothly. The PFD hides the TRIM mark while it's on. |
| `src/main.js`, `src/ui/menu.js`, `index.html` | `flightOpts`, `setFlightOpt()`: the settings, saved; the Settings page's two rows; the `damage` toast; the crash panel's hint. |
| `src/sim/weather.js`, `weather-presets.js` | `turbulenceScales(level, ft, out, w20)`: below 1,000 ft W20 is the wind at 20 ft (`C.w20`) × `K_W20` (0.7, 1, 1.4), at least half the level's own; without `w20` it's the standard's categories (the tests' reference). Three storm presets; `stormCells()` gives a severe storm's microbursts, one at about one airport in three. |
| `src/world/taxisigns.js` | `taxiSignSites(airport)`: arrays from the taxi graph's junctions of two or more names (`walk()` back 32 m along the way in, left side unless that's pavement, clear of the runway strip, 22 m apart at least), the painted names, and the mandatory signs at hold-shorts (pattern A). `SIGN` sizes them. |
| `src/world/apron.js` | `buildSigns()` (boxes, faces and letters; `SIGN_VERT`/`SIGN_FRAG`: lit by the sun, glowing at night), the painted names in `buildPaint(…, signs)`, the glyph atlas with the taxiways' and runways' characters and eight arrows (`ARROWS`). A fourth draw call an airport. |
| `tests/indestructible.test.mjs`, `boeing-autotrim.test.mjs`, `taxisigns.test.mjs` | The new tests (20); `weather.test.mjs` and `weather-presets.test.mjs` grew. |

### v0.4.2: the known list

| Where | What |
|---|---|
| `index.html`, `src/main.js` | The crash panel's "Rewind 30 s with Indestructible on" (`rewind-ind`: `setFlightOpt()`, `rewindNow()`, a toast). The hydroplaning toast (`state.hydroplaning`, once a landing). The spray made per type in `modelFor()` and updated in `render()`. |
| `src/sim/fbw-boeing.js` | With auto-trim: the flare law (`X.flare`, `X.flareTheta`, `X.flareT`; `FLARE_*`), latched from 50 to 30 ft with the gear down, sinking, off the AP and not in a go-around, dropped above 60 ft; the attitude held and sunk 0.25°/s to +0.5°, the stick a pitch rate. The trim switches (`c.trim`, H/Y) nudge the held path at `TRIM_PATH_RATE`. |
| `src/sim/autopilot-boeing.js` | The alignment's bank aims the track at the centreline through a bounded integrator (`X.boAlignBI`, `ALIGN_KIB`), the decrab's yaw has one too (`X.boAlignI`, `ALIGN_KI`); the rollout's yaw `ROLL_KP` 8, `ROLL_KD` 16. Both integrators are core fields (`coreFields()`, and the restore defaults in `sim.js`). |
| `src/sim/sim.js` | `skidPoints()`: the crash points and three belly skids (`SKID_POINTS`, Indestructible's); `hardStop()`: past `SKID_HARD_PEN` (0.6 m) an impulse at the deepest skid through the inertia (`SKID_RESTITUTION` 0.2), its g added to `nz`; skids count as ground for `airTime`/`groundTime` and arm the touchdown. `pwsScan()` and `X.pwsT`/`X.pwsClock` (core fields): `W.windshearAhead`. `state.hydroplaning` from the legs' `kctx.hydro`. |
| `src/score.js` | `scraping` counts as grounded, so a gear-up landing gets its card. |
| `src/sim/weather.js`, `src/sim/gear.js`, the types' data | `runwayTyresOf()` adds `hydro` (standing water, from the rain's rate) to a wet runway's tyres; `legStep()` cuts the side grip and the braking above `HYDRO_MS` (9√`TYRE_PSI` kt) across `HYDRO_BAND`; `TYRE_PSI` in each type's file (estimates). |
| `src/ui/pfd.js`, `src/ui/boeing/pfd.js`, `src/audio/callouts.js` | W/S AHEAD and WINDSHEAR AHEAD in red; the voices, once an occurrence. |
| `src/world/taxisigns.js`, `src/world/apron.js` | `RUNWAY_SIGN`: exit signs (`exits`) where a named taxiway's line leaves a runway, and distance remaining signs (`distance`), back to back; `buildSigns()` draws them with the rest (`FACE.dist`: white on black). `PAINT_FRAG` hides the paint under `uRwySnow`. |
| `src/world/precip.js` | `WIPER`; `uWipe`/`uWipeT` (pivot, length, side; clock, period, regrowth, or parked); the drops' shader hides drops the blade crossed lately; `WIPER_VERT`/`WIPER_FRAG` and `wiperGeometry()`; `update()` takes `origin` (the seat's side from the camera's offset in the body). |
| `src/world/spray.js` | `createSpray(GEAR, uniforms)`, `sprayAmount()`: instanced sprites per leg in the model's frame, a function of a clock (no per-frame state). |
| `tests/cloud/v042-shots.cjs` | v0.4.2's pictures, some against v0.4.1 served beside it as `games/flight-sim-041/`. |
| New tests | `boeing-autotrim-787`, `yaw-approach`, `windshear-ahead`, `spray`; `boeing-autotrim`, `indestructible`, `taxisigns`, `weather-autoland` (tightened) and `weather-precip` grew. |

### v0.4.3: Shane's findings from testing v0.4

| Where | What |
|---|---|
| `src/widebody.js` | The wing bend (`setWingFlex()`, `uFlex`) is added after `#include <skinning_vertex>`, straight up by `bendY`; it was added before the skinning, and each slat's and flap's own rotation turned it into a gap (the 787's outer slats half a metre off the wing on final). The engine's parts (intake, sleeve, cascades, core, plug, fan case, fan faces, spinner, blades, pylon) pass `BY = ey` as their `bendY`, so the engine rides the wing at its pylon's span as one piece: bent vertex by vertex, the turning fan carried each blade's own lift round with it and wandered off the axis. The fan case (`C.fanCase`) runs from the sleeve's inner lip (`SLEEVE`'s last row) to the intake's inner end (`INTAKE`'s first); `innerR()` gives the duct's radius anywhere, the fan face reaches it, and a disc 12 mm behind faces aft. |
| `src/aircraft.js` | `Builder.add(geo, bone, color, uv, bendY)`: a part's bend span; the geometry gets a `bendY` attribute (each vertex's own span unless set) once any part sets one, so the A321's geometry is unchanged. The A321's fan case, from (0.0, 1.02) to (1.45, 0.93), and its back disc. |
| `src/sim/b777-300er.js` | `CM.elevator` 1.70 and `CM.ths` 3.99: the 787-9's 1.45 and 3.4 per unit of tail volume (V_H 1.106 against 0.943, from the drawn planforms in `src/widebody-specs.js`; the STATUS entry has the sums). |
| `src/sim/fbw-boeing.js` | `PATH_Q_MAX` (2.2°/s): with auto-trim, gear down and the landing flaps, hand flown, not in the flare or a go-around (TO/GA thrust), `qCmd` is capped. A held key asks for 3.5°/s of path; the nose ran at 4°/s and stopping it took the elevator to its rate limit. |
| `src/world/sky.js` | `aurora(d)` in `NIGHT_GLSL`: three arcs about north (full to ±43°, gone by ±77°), each with a lower edge that folds (`vn3` noise and a sine, drifting with `uTime`), green fading up into red, a violet fringe, rays (`vn3` at 95 and 26 per radian of azimuth). The dome adds it times `uAurora` (the stars' visibility, `L.stars`), the horizon's haze and `AURORA_GAIN`, over the sky's own brightness. No draw call of its own; by day the dome is as before, pixel for pixel. |
| `tests/boeing-pitch-settle.test.mjs`, `tests/aurora.test.mjs` | New. `boeing-autotrim.test.mjs`'s no-auto-trim case now holds a push and lets go: its stick pilot chased the law into a ±3° oscillation, and passed or failed by where it let go. |
| `tests/cloud/wing-gaps.cjs` | Also checks that the compiled vertex shader bends after the skinning (it fails on v0.4.2). |
| `tests/cloud/look.cjs`, `tests/cloud/v043-shots.cjs` | New: any view of a type's model on its dev page, the wing bent or not; and v0.4.3's aurora pictures. |

## Working from a Cowork session

Shane's GameDump folder is `~/Desktop/ClaudeProjects/GameDump` on the Mac. When it's connected, it's `$HOME/mnt/GameDump` in the device shell.

- **Editing:** work on the Mac directly, with a short Python read-modify-write or `sed -i`. Never retype a file from tool output, which can be cut short. The device shell can't delete files, and each call stops at 180 s.
  - v0.2.1, v0.3.1 and v0.3.2 worked the other way round, which also works: edit the staged copy in the container with the Edit tool, test it there, then copy the changed files to `/mnt/user-data/outputs/` and `device_commit_files` them back with `expectedMtimeMs` from staging, and compare the md5s at the end.
- **Unit tests on the Mac** go through the guard. Its state folder must be writable in the VM:
  ```
  cd "$HOME/mnt/GameDump/games/flight-sim"
  FLIGHT_SIM_CPU_DIR="$HOME/fs-guard-check" python3 tools/cpu-guard.py --minutes 10 -- node --test tests/*.test.mjs
  ```
  Then run it with `--status` (no slots in use) and `--sweep` (clean).
- **Visual checks in the cloud container,** which has Chromium and Playwright preinstalled (`require('playwright')` works; don't install it again), 2 cores and SwiftShader WebGL:
  1. **Stage the game** with `device_stage_files`, at most 50 per call: `src/` (68 files), `data/` (15, 14 MB), `vendor/` (14), `assets/menu/` (4), `index.html`, `style.css`, `thumb.svg`, `tests/e2e-controller.js` and `tests/cloud/`. They land under `/mnt/user-data/uploads/GameDump/games/flight-sim/`. A copy staged in an earlier session may still be there: compare each file's md5 with the Mac's and stage only what differs.
  2. **Serve it** with no caching: `python3 tests/cloud/serve.py /mnt/user-data/uploads/GameDump &`, which serves on port 8765.
  3. **Run the tools in `tests/cloud/`** (each file's header says how):
     - `stills.cjs`: stills of the 3D view with a free camera or from the seats, read off the canvas. About 30 s each.
     - `land.cjs`: a landing through the real game loop from a 15 nm final, with the score's parts and costs, and optionally a picture of the card. About 2 minutes. Its modes:
       - `normal`: the controller's own approach;
       - `low`: about 150 ft 1 km out, then a recapture;
       - `short`: an undershoot onto the grass.
     - `ui-shots.cjs`: the performance bar, the pause menu, the volume slider and both settings surviving a reload. About 3 minutes.
     - `route-views.cjs` (v0.2.1): the view switch, a dragged waypoint, Change route, then a landing at the new destination. About 15 minutes.
     - `camera-drag.cjs` (v0.2.1): the one-finger camera with the real mouse: each view, the limits, clicks, double-clicks, drags over the HUD and the map, the swipe and the pinch. About 2 minutes.
     - `athr-lever.cjs` (v0.2.2): on a 15 nm final with A/THR on, the lever and the ring at its thrust, a one-frame tap of R (the frame clock held and stepped), A/THR off with the toast, X giving it back. About 2 minutes.
     - `models.cjs` (v0.3.1): close-ups of each type's wing, gear and doors.
     - `weight-copy.cjs` (v0.3.2): the Weight tab (tabs, fields, checks, Max, Enter, keys, the live fuel, Esc, skip to final), Save a copy, Load scenario → Duplicate, and a copy flying on from the same point; at 1440×900 and 1280×720. About 4 minutes.
     - `wing-gaps.cjs` (v0.4.1): no light through any type's wings, stowed and with the slats and flaps out (see v0.4.1's table). About 15 s.
     - `v042-shots.cjs` (v0.4.2): the runway signs by day and night, snow over the taxiway paint and far cloud against v0.4.1, the wiper from the captain's seat, the spray, the crash screen and both PFDs' windshear warning. About 5 minutes.
     - `look.cjs` (v0.4.3): any views of one type's model on its dev page, with any state (slats, flaps, gear, `flex` for the bent wing, `engines` for the fans); `FS_BASE` points it at a pushed copy for a before. Seconds a view.
     - `v043-shots.cjs` (v0.4.3): the aurora from Gimpo and FL350, south (none), under broken cloud, and by day against v0.4.2 (served beside it as `games/flight-sim-042/`). About 3 minutes.
     - `weather-final.cjs` (v0.4.0's review): a 15 nm final started with the Gusty crosswind preset (the altimeter at the day's QNH, the AP's ALT at its reading, the crabbed heading holding the centreline), K, skip to final, a landing by the test pilot in 15 kt gusting 22 with the card's and the logbook's wind, and the same start in calm air as v0.3.2's. About 3 minutes.
     - The sound: `FS_CLOUD=1 E2E_ROOT=http://127.0.0.1:8765/ NODE_PATH=$(npm root -g) node tests/audio-render.mjs` (the measured checks; 30 of them) and `… node tests/audio-clips.mjs outDir` (the flight phases as WAV and MP3 to listen to; `SYNTH=<url>` renders another copy of the synth, to compare).
  4. **Against the last pushed version,** for anything that should be unchanged: `git clone https://github.com/NuclearPlane787/flight-sim` in the container (outside GameDump, so git is fine there), serve the clone beside the new copy (for example as `games/flight-sim-032/` under the same root), and compare `__fs.renderer.info.render` (calls, triangles) and the canvas from the same views and clock, in a fresh browser context each. v0.4.0's review did this for clear weather at six views, day and night: the same draws and triangles, and the same pixels but the spinning fan blades. The clone also gives the list of changed files (hash both trees).
  5. **Re-stage every file you change** on the Mac before the next run. Then compare the two copies (the same hash on both sides):
     ```
     find src index.html style.css tests/e2e-controller.js tests/cloud -type f ! -path '*/__pycache__/*' | LC_ALL=C sort | xargs md5sum | md5sum
     ```
  6. **Deliver pictures:** convert them to JPG and copy them to a new folder under `/mnt/user-data/outputs/`. Then `device_commit_files` each one to `Claude outputs/flight-sim/`, named by version and topic (`v013-perf-bar.jpg`). Look at every picture before you describe it.
- **The project doc** `claude/flight-sim-prototype.md` (the Games project on claude.ai) is a status section per session, newest first, then the plan. Edit a local copy and write it once: `project_write` replaces the whole doc.
- **Pitfalls with the tools:**
  - **Headless captures hang once the game is running on SwiftShader.** That goes for `page.screenshot` and raw CDP captures, even of another page in the same browser. Read the 3D view off the canvas (`toDataURL` right after `renderOnce()`). Take the page with `tests/cloud/snap.cjs`, with the game's frames throttled or paused.
  - **Killing by pattern** (`pkill -f serve.py`) kills your own shell too (exit 144). It still kills the target, but the call reports an error.
  - **The browser pane on the Mac draws nothing while it's hidden** (no animation frames, stale screenshots).
  - **Caching:** Python's `http.server` sends no Cache-Control, so Chrome on the Mac can keep old modules after an update. Shane needs a hard reload.
  - **Free-camera stills** need `rig.viewId = 'orbit'`. In a seat view the nose is hidden.
  - **The image search tool shows its pictures to Shane.** Don't use it to gather references.
  - **The cloud checks fake the frame clock:** each frame is 0.1 s of sim, run as fast as the browser can, so a lot of flying happens between two `page.evaluate` calls. Read and act in one `evaluate`, or pause quietly (`setPaused(true, true)`) around an exact check. A quiet pause also hides the pause menu; to picture the menu, capture without one (`shotMenu()` in `tests/cloud/weight-copy.cjs`).
  - **The container refuses `rm` on a path built from a shell variable** (`rm $OUT/*.png`). Overwrite instead, or write `"${OUT:?}"/*.png`.
  - **The cloud container's files and processes can vanish between turns.** Check the server (`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/games/flight-sim/index.html`) and the staged copy before you trust them.

## Pitfalls already hit in the game

- **A type's data must export every name `a321neo.js` does** (the data tests check). A missing one is `undefined`, and the first symptom is NaN everywhere.
- **Exit to menu saves.** A test that edits a save has to do it after that, or the edit is overwritten (it hid a v0.2.2-save check once).
- **`VMM_FACTOR` has to leave the amber band below Vref:** the law's default of 1.3 put it above Vref on every approach. Each Boeing sets its own.
- **Screenshots use the clock:** a check run at night is a night shot. `tests/browser-boeing-flight.mjs` fixes the afternoon.

- **The screens draw in B612,** whose digits are wider than Helvetica's, which the windows were first sized for. Text in a fixed window goes through `fitSize()` (pfd.js) or gets measured; check the PFD at FL350 and on final after any change (`tests/dev-ui.html` renders the screens without WebGL, so ordinary screenshots work there).
- **Runways that cross** have one surface: anything that needs a runway's height uses `profileAt()` or `rectElev()`, never a straight line between its ends, and `heightAt` (heightfield.js) and `flattenRunways` (glsl.js) must stay the same rule.
- **Coplanar pavement flickers.** Since v0.1.1 the pavement writes no depth and draws in a fixed order: taxilanes, then taxiways, then aprons and stands (see `apron.js`'s header). Anything new on the ground has to fit that scheme.
- **Flat triangles don't follow curving ground.** Pavement 8 cm up dipped under the terrain wherever a long triangle spanned a bend in it (v0.2.0: −0.58 m on Jeju's taxiway P). Anything new laid on the ground goes through `refineSoup()` (or `refineLine()`), and `tests/apron-ground.test.mjs` checks it on the real terrain.
- **Nothing lifted off the ground may overlap a runway.** The runway lies on its surface and wins by its pull towards the camera, which beats a few centimetres of lift only when seen from above; at the cockpit's grazing angles the lifted thing wins. That was v0.2.0's taxiway clipping. Clip ground pieces to `drawnRunwayRects()`, and put paint meant to show on a runway on its surface with `PULL.lead`.
- **The route's waypoints are the map's** (`map.waypoints`), not `plan.waypoints`, which is only what a flight started or loaded with. `captureState()` saves the map's.
- **While the A/THR drives the thrust lever, the sim writes `controls.thrust`** (v0.2.2). Anything else that sets it then is a pilot's move and disconnects the A/THR: a test or a tool that wants to move it should toggle the A/THR off first (as `tests/e2e-controller.js` does at the retard), or mean the takeover.
- **The engines' sound isn't steady on purpose** (v0.2.2): their tones waver and the two engines beat. `tests/audio-render.mjs`'s spool-up checks allow for that (1.5 dB a second, 2 dB in 300 ms); the fan tone is checked where it should be (18 × the shaft frequency), not as the strongest tone, which the buzz-saw can beat at high N1.
- **The fuselage isn't one ellipse per section any more.** Use `fuseSection()` and `fusePoint()`. After any change to the nose, check that the cockpit's interior stays inside the skin: v0.1.2's worst corner was at 0.993.
- **A runway end's x, y is its landing threshold:** the bake already applies `displacedM`. Applying it again put Jeju 31's glideslope 411 m down the runway until v0.1.3.
- **The thrust acts at `ENGINES`, not `NACELLES`.** Moving it changes the pitch moment from thrust and would need the sim recalibrated.
- **The scorer's track:**
  - a rewind calls `scorer.reset(true)`, which keeps the approach flown before it;
  - a new flight or a skip to final calls `reset()`;
  - a lift-off or a go-around clears it by itself.
- **Saves must stay deterministic.** `sim.snapshot()` round-trips through JSON exactly (`tests/scenario-state.test.mjs` flies a restored sim 120 s against the original, within 1e-6 m). New sim state that a step reads must go in the snapshot, or a loaded scenario will drift.
- **Night needs every ground shader:** new ground surfaces take `uSunColor`/`uSkyAmb` (the light), `uNight` (their own lights) and `aircraftLights()` (the lamp pools; `main.js` already scales the lamps by `uNight`, so don't multiply again).
- **Night-only objects hide by day** (`visible = false` under uNight 0.01): the day's draw calls must equal the day's before night existed.
- **Three windows share the Sky window's frame** (`.fssw`): the Weight window is `.fssw.fslw` and the Weather window (v0.4.0) `.fssw.fswx`. The Sky window is created first, so `.fssw [data-…]` still finds its parts first, but scope new selectors: the Sky window alone is `.fssw:not(.fslw):not(.fswx)` (v0.4.0's review had to fix `weight-copy.cjs` for it).
- **The A321's setup shows v0.1.0's empty weight and tanks** (50,100 kg and 18,864 kg, against the sim's 50,500 and 18,510). The Weight tab sums with the sim's (`loadNow()`); ROADMAP has it under "Seen while building v0.3.2".
- **The sim's touchdown g follows the sink rate** (about 1.3 g at 200 ft/min, 2.0 g at 360). That's why g weighs little in the score.
- **Calm is v0.3.2's arithmetic** (v0.4.0). The default weather is `null` in the sim, and every weather term is skipped or exactly zero there; `tests/golden-a321.test.mjs` checks it to 1e-9. New sim code has to keep that, and clear weather must keep drawing as before (weather-only objects hide in clear weather).
- **Nothing random in the sim:** the live sim steps at 1/120 s and the prediction at 1/30 s, and a jump restores the worker's snapshot, so anything that varies (the gusts, the turbulence, lightning) is a function of position and time, seeded, as `src/sim/weather.js` is.
- **`sim.weather` is replaced, never changed in place:** `main.js` redraws the world and tells the synth when its identity changes, and snapshots share the object.
- **The wing bend is a vertex-shader term after the skinning** (v0.4.3): anything that moves on a bone on the wing (slats, flaps, spoilers, the fan) is bent where it is, by `bendY`. A rigid part hung off the wing (an engine, a pylon) passes its attachment span as `bendY`, or the bend shears it and, on a turning part, travels round with it. The CPU's skinned positions (`getVertexPosition()`, the wing-gaps check) don't include the bend.
- **The dev pages don't spin the fans or bend the wings by themselves:** set `engines` (n1) and call `dev.flex(m)`, and wait between shots (`look.cjs`).
- **A canvas read must follow a draw in the same task** (v0.4.2): the renderer keeps no drawing buffer, so `toDataURL()` a frame later reads back black. Call `__fs.renderOnce()` in the same `evaluate` (`v042-shots.cjs`'s wiper frames).
- **`out` is a GLSL keyword:** a variable named `out` stops the shader compiling, and the error shows only in the console (v0.4.2's spray).
- **Check a visual fix on screen against the pushed version** before trusting a model test: v0.4.2's far-cloud change passed its own test and only blurred the clouds in every view a player sees.
- **The altimeter isn't the altitude** (v0.4.0): the autopilots, the PFDs and the FCU/MCP work in `state.altInd`, from the static pressure and the setting; the radio altimeter, the score, the map and the terrain use `state.pos.z`. An altitude set from geometry (a final start's ALT) has to go through the altimeter, or the AP climbs or descends to make it read right.

## Working with Shane on this game

- **How he plays and reports:** in Chrome on his M5 MacBook, from his own server (`python3 -m http.server 8001` in GameDump). He reports from playing, often with a screenshot.
- **Versions:** he names each one ("Package these into v0.1.2", "Call this 0.1.3") and pushes it himself with `sh tools/push.sh vX.Y.Z`. The commit's title is the version alone.
- **Who builds them:** a judgment per job, and one session takes an update from end to end (2026-11-10; `AGENTS.md` → Versions). Long builds that want the Mac's GPU and Chrome suit a Claude Code run briefed from Cowork; focused changes are done in the Cowork session.
- **His controls:** the Mac's keyboard and touchpad, or a mouse at most. No joystick (2026-11-10).
- **He often plays while you work.** Keep your changes in the container and sync them to the Mac in one batch at the end (v0.3.2).
- **Realism:** he wants it, and he talks like a pilot ("centerline", "touchdown zone", "bob in the air"). Check the A321 against Airbus's documents. They're git-ignored in `reference/docs/`; the numbers used are in `src/sim/a321neo.js` and STATUS's v0.1.2 entry.
- **Feedback:** he values it direct and unhedged.
- **Final messages are short:**
  - what changed;
  - the push command and the hard reload;
  - what wasn't checked;
  - where the screenshots are.
- **Ask what you can't see.** His logbook lives in his Chrome, so for v0.1.3 he was asked for his landing's numbers and answered at once.
- **Standing decisions:**
  - keys H and Y are the Boeings' trim, O their TO/GA, `[` and `]` the flap lever's steps (v0.3.0);
  - the CPU rules (`tools/cpu-guard.py`);
  - no Ctrl key bindings;
  - no network at runtime;
  - the repository is public: no third-party PDFs, no paths with a user name, no real airline's branding;
  - the Nuclear Airlines livery;
  - keys 1, 2, 3 are the views (v0.2.1); 6–0 the flaps.

## Starting a new chat

A first message that works, in the Games project with the GameDump folder connected:

> Read games/flight-sim/HANDOFF.md in my GameDump folder, then its AGENTS.md, ROADMAP.md's "The long term" and the newest entries in its STATUS.md. Then take v0.5.0, the parts model and a first warehouse, from start to finish, as HANDOFF.md's first section says.

For a later update, the last line names that update instead.
