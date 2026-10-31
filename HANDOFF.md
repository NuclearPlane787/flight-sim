# Flight Sim: handoff

Written at 23:10 KST on 2026-10-31, at the end of a long Cowork session that made v0.1.1, v0.1.2 and v0.1.3, and updated on 2026-11-01 by the second Cowork session, which made v0.1.4. If you're picking the game up, read this first. Then read `AGENTS.md` (the rules) and the newest entries in `STATUS.md` (what was done, with the evidence).

## Where things stand

| Version | What | Pushed |
|---|---|---|
| v0.1.0 | The overnight build: M1–M3 from `PLAN.md` | yes (`cc22094`) |
| v0.1.1 | Incheon's flickering taxiways, new cockpit windows, a fairer landing score | yes (`a4df7a4`) |
| v0.1.2 | A lower windshield, the engines under the wing, gentle touchdowns on grass | yes (`7d6edc4`) |
| v0.1.3 | A stricter landing score that counts the approach, a master volume slider, a performance readout bar, Jeju 31's glideslope fix | yes (`7bd1a6c`, 23:01 KST) |
| v0.1.4 | Typing into the FCU, jumps picked anywhere on the bright path, Gimpo stand 7's routes, pushbacks at up to 4×, Jeju's crossing as one surface, the B612 and Barlow fonts | not yet (2026-11-01) |

- **Check first:** `GIT_OPTIONAL_LOCKS=0 git log --oneline -3` (the only git command allowed here), to see what Shane has pushed since.
- **Not in any commit yet:** v0.1.4, with this file, `tests/cloud/` and the docs written after v0.1.3. Shane pushes them together: `sh tools/push.sh v0.1.4`.
- **Passing at hand-off:**
  - 175 unit tests (`node --test tests/*.test.mjs`, about 3 s in the Mac's Linux VM);
  - `node --check` on all 102 `.js` and `.mjs` files.
- **No agent has yet:**
  - flown v0.1.2, v0.1.3 or v0.1.4 in Chrome on the Mac's GPU (their visual checks were all in the cloud container, with SwiftShader);
  - listened to the synth, or to the volume slider's preview.

## Next: v0.2.0, a main menu and scenarios

**Shane's request (2026-10-31):** "I do also want to add a menu screen like Satisfactory, and since I probably don't want to have everything in just one scenario, so let the current scenario be 'Scenario 1', and you can create more and choose where to begin and where to land."

**Decided (2026-10-31):**

1. **A scenario is a save slot:** "the saved state including the plane's location, speed, roll, everything, so that when you reload a scenario after doing a another, it is exactly where it was before."
2. **The menu's backdrop is a still:** "I'd say stick with a still picture."
3. **Saves stay in the browser** (2026-11-01). Asked whether each scenario should also be copied into the folder (Chrome's File System Access API), Shane said: "Nah its fine. Keep it browser."

**It's next (2026-11-01):** an overnight Claude Code run, once v0.1.4 is pushed (Shane: "0.2.0 can run overnight after that, with the whole game changes"). `V020.md` is the brief, with the starting prompt.

**What a save has to hold ("everything"), from the code as it stands:**

- **`sim.snapshot()`** (`src/sim/sim.js`) holds the core state (97 fields), the controls, the autopilot and FCU (`AP_FIELDS` in `src/sim/autopilot.js`) and the wheels' contact. That's about 2 KB as JSON, and `sim.restore()` rebuilds the rest.
- **Not in the snapshot** (all in `src/main.js` unless noted):
  - **the plan:** `plan` (origin, runways, destination, gate, start type, waypoints, payload, fuel);
  - **the ground flow:** `gate` (`src/ground/gate-flow.js`: pushback, taxi-out and taxi-in), which `afterJump()` notes isn't in the snapshots;
  - **the flight:** `landed`, `arrivalStand`, `liftoffT`, `fuelAtStart`, and the keyboard's thrust lever (`input.lever`);
  - **the scorer** (`src/score.js`): the touchdown and the approach track. A save made on final has to keep the track, or the approach parts will be missing from the score;
  - **the camera:** the view and its looks (`src/camera.js`);
  - **probably not saved:** time compression (back to ×1), the rewind ring, and the callouts' armed state (`reset()` re-arms them).
- **Storage:**
  - localStorage, about 5 MB per origin in Chrome, under `gamedump:flight-sim:`: a list key, and one key per scenario.
  - Today's `lastflight` and `logbook` become Scenario 1.
- **Still to settle** (ask Shane, or decide and log it under STATUS's decisions):
  - Does each scenario keep its own logbook? The option he said yes to included "its own logbook".
  - When does it save: automatically (on pause, on leaving, every so often), by hand, or both?
  - How many slots, and are they named? Satisfactory's New game asks for 3–40 characters.
  - What does New scenario ask? The flight setup screen already picks the origin, destination, runways, gate and start.
- **The menu:**
  - Satisfactory's title screen is a full-screen grid: the title on the left, the buttons on the right, and a gradient over a backdrop image. See `.screen--title` in its `style.css` and `pickBackdrop()` in its `src/ui.js`; read them, change nothing there.
  - For the still: render one from the game and ship it as a JPG in this folder. `tests/cloud/stills.cjs` can, but a shot on the Mac's GPU will look better.
  - Claude's default buttons, which Shane didn't object to: Continue, New scenario, Load scenario, Logbook, Settings (the volume and the readout), Controls, Exit to Game Dump.

## Other open items

- **From `ROADMAP.md`:**
  - nobody has listened to the synth.
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
