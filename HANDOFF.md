# Flight Sim: handoff

Written at 23:10 KST on 2026-10-31, at the end of a long Cowork session that made v0.1.1, v0.1.2 and v0.1.3, updated on 2026-11-01 by the second Cowork session, which made v0.1.4, and again on 2026-11-01 (about 05:30 KST) by the overnight Claude Code run that made v0.2.0. If you're picking the game up, read this first. Then read `AGENTS.md` (the rules) and the newest entries in `STATUS.md` (what was done, with the evidence).

## Where things stand

| Version | What | Pushed |
|---|---|---|
| v0.1.0 | The overnight build: M1–M3 from `PLAN.md` | yes (`cc22094`) |
| v0.1.1 | Incheon's flickering taxiways, new cockpit windows, a fairer landing score | yes (`a4df7a4`) |
| v0.1.2 | A lower windshield, the engines under the wing, gentle touchdowns on grass | yes (`7d6edc4`) |
| v0.1.3 | A stricter landing score that counts the approach, a master volume slider, a performance readout bar, Jeju 31's glideslope fix | yes (`7bd1a6c`, 23:01 KST) |
| v0.1.4 | Typing into the FCU, jumps picked anywhere on the bright path, Gimpo stand 7's routes, pushbacks at up to 4×, Jeju's crossing as one surface, the B612 and Barlow fonts | yes (`f4482a4`) |
| v0.2.0 | The main menu, scenarios (save slots with the whole state), one logbook tagged by scenario, Settings and Controls; night: the KST clock and the Sky window, Earth's sky with real stars and the Moon, the light following the sun, city, airport, taxiway and aircraft lights | not yet (built 2026-11-01, 04:10–05:30 KST) |

- **Check first:** `GIT_OPTIONAL_LOCKS=0 git log --oneline -3` (the only git command allowed here), to see what Shane has pushed since.
- **Not in any commit yet:** v0.2.0. Shane pushes it: `sh tools/push.sh v0.2.0`, then a hard reload (Cmd+Shift+R) in Chrome.
- **Passing at hand-off** (all on the Mac, Chrome on its GPU, through the guard; `STATUS.md` has the commands and numbers):
  - 262 unit tests in 34 files (`node --test tests/*.test.mjs`);
  - every `.js`/`.mjs` in `src/` and `tests/` checked **as a module** (copy to `.mjs`, then `node --check`; a plain `node --check file.js` checks it as a script and missed a broken `if … else` once);
  - `tests/browser-scenarios.mjs` 23/23, `browser-night.mjs` 3/3 (60 fps at night over Seoul, 45 draws, 0.75 M triangles), `browser-review-fixes.mjs` 7/7, `browser-e2e.mjs` 12/12, `browser-cpu.mjs` 6/6.
- **No agent has yet:**
  - listened to the synth, or to the volume slider's preview;
  - played v0.2.0 the way Shane will: a whole evening flight from the menu with the clock running through dusk (the checks set the clock and stop it).

## v0.2.0: what it is, and what's next

`V020.md` was the brief; `STATUS.md` (from "2026-11-01, 04:10 KST: v0.2.0 run started") has the log, the decisions made overnight and the evidence. In short:

- **The main menu** (`src/ui/menu.js`): shown on load over one of four stills from the game (`assets/menu/`, rendered by `tests/render-stills.mjs`); nothing renders behind it.
- **Scenarios** (`src/scenarios.js`, `captureState()`/`applyState()` in `main.js`): `gamedump:flight-sim:scenarios` (the index) and `…:scenario:<id>`. A save holds `sim.snapshot()`, the plan (with the map's waypoints), `gate.serialize()`, the flight's flags, `scorer.serialize()` (the approach track as arrays), `rig.serialize()` and `clock.serialize()`. Autosave every 60 s in flight, on pause, hide, `pagehide`, Exit to menu, after a landing, and Save; never a crashed state. v0.1.x's `lastflight` became "Scenario 1" (`legacy: true`); its keys are untouched.
- **The logbook** tags each flight with `scenarioId`/`scenarioName` (`unsaved` for flights without a scenario); untagged v0.1 flights count as the legacy Scenario 1's.
- **Night:** `src/clock.js` (KST, stepped by the sim time stepped), `src/astro.js` (Meeus), `src/world/sky.js` (`setTime`, `lightingAt`, stars from `data/stars.json`, BSC5), `uNight` and the lamp uniforms in `glsl.js`, `citylights.js`, `taxilights.js`, the light shaders in `airports.js`, floods and windows in `apron.js`, `aircraft-lights.js` (`lightsFor` by phase), the cockpit's `setNight`, and the Sky window (`src/ui/sky-window.js`, L or Cmd/Ctrl+L, the one Ctrl binding).

**Next:** nothing is decided. ROADMAP's 2026-11-01 table is the list; weather (row 10's other half) pairs naturally with the night.

## Other open items

- **From `ROADMAP.md`:**
  - nobody has listened to the synth.
- **From v0.2.0** (STATUS's final entry lists them all):
  - the cockpit at night is plain (a warm flood and lit screens, no panel backlighting); the terminal windows read a little like a checkerboard close up; distant taxiway lights merge green and blue into cyan; stop bars are always lit;
  - a moonless night away from the cities is very dark, especially from cruise (the ambient is at the top of the brief's 2–5% of day);
  - the Moon is drawn 2.4× its size so it reads on screen;
  - an autosave can catch a moment just before a crash (it never saves the crash itself);
  - the old `tests/browser-boot.mjs` expects the setup screen on load; the main menu replaced that, and `browser-scenarios.mjs` covers the boot now.
  - (Jeju's runway seam, Gimpo stand 7's routes, the slow pushback, and Shane's FCU heading and path-pick bugs of 2026-11-01 were all fixed in v0.1.4.)
- **His 11 future additions of 2026-11-01** are in ROADMAP's newest table: parts swaps, walking the cabin, five more types, detailed terminals, the UI and a font, changing the route in flight, traffic and ATC, lounges, emergencies, all weather and the night sky, crash physics.
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

## Working from a Cowork session

Shane's GameDump folder is `~/Desktop/ClaudeProjects/GameDump` on the Mac. When it's connected, it's `$HOME/mnt/GameDump` in the device shell.

- **Editing:** work on the Mac directly, with a short Python read-modify-write or `sed -i`. Never retype a file from tool output, which can be cut short. The device shell can't delete files, and each call stops at 180 s.
- **Unit tests on the Mac** go through the guard. Its state folder must be writable in the VM:
  ```
  cd "$HOME/mnt/GameDump/games/flight-sim"
  FLIGHT_SIM_CPU_DIR="$HOME/fs-guard-check" python3 tools/cpu-guard.py --minutes 10 -- node --test tests/*.test.mjs
  ```
  Then run it with `--status` (no slots in use) and `--sweep` (clean).
- **Visual checks in the cloud container,** which has Chromium and Playwright preinstalled (`require('playwright')` works; don't install it again), 2 cores and SwiftShader WebGL:
  1. **Stage the game** with `device_stage_files`, at most 50 per call: `src/` (58 files), `data/` (13, 14 MB), `vendor/` (3), `index.html`, `style.css`, `thumb.svg`, `tests/e2e-controller.js` and `tests/cloud/`. That's about 85 files in two calls, and they land under `/mnt/user-data/uploads/GameDump/games/flight-sim/`.
  2. **Serve it** with no caching: `python3 tests/cloud/serve.py /mnt/user-data/uploads/GameDump &`, which serves on port 8765.
  3. **Run the tools in `tests/cloud/`** (each file's header says how):
     - `stills.cjs`: stills of the 3D view with a free camera or from the seats, read off the canvas. About 30 s each.
     - `land.cjs`: a landing through the real game loop from a 15 nm final, with the score's parts and costs, and optionally a picture of the card. About 2 minutes. Its modes:
       - `normal`: the controller's own approach;
       - `low`: about 150 ft 1 km out, then a recapture;
       - `short`: an undershoot onto the grass.
     - `ui-shots.cjs`: the performance bar, the pause menu, the volume slider and both settings surviving a reload. About 3 minutes.
  4. **Re-stage every file you change** on the Mac before the next run. Then compare the two copies (the same hash on both sides):
     ```
     find src index.html style.css tests/e2e-controller.js tests/cloud -type f ! -path '*/__pycache__/*' | LC_ALL=C sort | xargs md5sum | md5sum
     ```
  5. **Deliver pictures:** convert them to JPG and copy them to a new folder under `/mnt/user-data/outputs/`. Then `device_commit_files` each one to `Claude outputs/flight-sim/`, named by version and topic (`v013-perf-bar.jpg`). Look at every picture before you describe it.
- **The project doc** `claude/flight-sim-prototype.md` (the Games project on claude.ai) is a status section per session, newest first, then the plan. Edit a local copy and write it once: `project_write` replaces the whole doc.
- **Pitfalls with the tools:**
  - **Headless captures hang once the game is running on SwiftShader.** That goes for `page.screenshot` and raw CDP captures, even of another page in the same browser. Read the 3D view off the canvas (`toDataURL` right after `renderOnce()`). Take the page with `tests/cloud/snap.cjs`, with the game's frames throttled or paused.
  - **Killing by pattern** (`pkill -f serve.py`) kills your own shell too (exit 144). It still kills the target, but the call reports an error.
  - **The browser pane on the Mac draws nothing while it's hidden** (no animation frames, stale screenshots).
  - **Caching:** Python's `http.server` sends no Cache-Control, so Chrome on the Mac can keep old modules after an update. Shane needs a hard reload.
  - **Free-camera stills** need `rig.viewId = 'orbit'`. In a seat view the nose is hidden.
  - **The image search tool shows its pictures to Shane.** Don't use it to gather references.
  - **The cloud container's files and processes can vanish between turns.** Check the server (`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/games/flight-sim/index.html`) and the staged copy before you trust them.

## Pitfalls already hit in the game

- **The screens draw in B612,** whose digits are wider than Helvetica's, which the windows were first sized for. Text in a fixed window goes through `fitSize()` (pfd.js) or gets measured; check the PFD at FL350 and on final after any change (`tests/dev-ui.html` renders the screens without WebGL, so ordinary screenshots work there).
- **Runways that cross** have one surface: anything that needs a runway's height uses `profileAt()` or `rectElev()`, never a straight line between its ends, and `heightAt` (heightfield.js) and `flattenRunways` (glsl.js) must stay the same rule.
- **Coplanar pavement flickers.** Since v0.1.1 the pavement writes no depth and draws in a fixed order: taxilanes, then taxiways, then aprons and stands (see `apron.js`'s header). Anything new on the ground has to fit that scheme.
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
- **The sim's touchdown g follows the sink rate** (about 1.3 g at 200 ft/min, 2.0 g at 360). That's why g weighs little in the score.

## Working with Shane on this game

- **How he plays and reports:** in Chrome on his M5 MacBook, from his own server (`python3 -m http.server 8001` in GameDump). He reports from playing, often with a screenshot.
- **Versions:** he names each one ("Package these into v0.1.2", "Call this 0.1.3") and pushes it himself with `sh tools/push.sh vX.Y.Z`. The commit's title is the version alone.
- **Who builds them** (2026-11-01): patches (v0.1.4) directly in Cowork; minor versions (v0.2.0) by a Claude Code agent on the Mac, briefed from Cowork. See `AGENTS.md` → Versions.
- **Realism:** he wants it, and he talks like a pilot ("centerline", "touchdown zone", "bob in the air"). Check the A321 against Airbus's documents. They're git-ignored in `reference/docs/`; the numbers used are in `src/sim/a321neo.js` and STATUS's v0.1.2 entry.
- **Feedback:** he values it direct and unhedged.
- **Final messages are short:**
  - what changed;
  - the push command and the hard reload;
  - what wasn't checked;
  - where the screenshots are.
- **Ask what you can't see.** His logbook lives in his Chrome, so for v0.1.3 he was asked for his landing's numbers and answered at once.
- **Standing decisions:**
  - the CPU rules (`tools/cpu-guard.py`);
  - no Ctrl key bindings;
  - no network at runtime;
  - the repository is public: no third-party PDFs, no paths with a user name, no real airline's branding;
  - the Nuclear Airlines livery;
  - the menu and scenarios wait for v0.2.0.

## Starting a new chat

A first message that works, in the Games project with the GameDump folder connected:

> Read games/flight-sim/HANDOFF.md and games/flight-sim/AGENTS.md in my GameDump folder, and the newest entries in its STATUS.md. Then: …
