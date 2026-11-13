# Flight Sim: read this first

Flight Sim (`flight-sim`) is the ninth Game Dump game: a 3D airliner sim of South Korea (the A321neo, 787-9 and 777-300ER), flown between Incheon, Gimpo and Jeju. GameDump's root `AGENTS.md` (the house rules) applies on top of this file.

**Picking the game up? Read `HANDOFF.md` first:** where things stand, what's next (v0.2.0's decisions), and how the Cowork sessions checked their work (`tests/cloud/`).

**Briefing a Claude Code run? `V040.md` (v0.4.0, the weather) is the latest brief to model it on:** Shane's decisions, the scope, the definition of done, the run's rules and the starting prompt.

## Files

| File | What |
|---|---|
| `HANDOFF.md` | Where things stand, what's next, and how to work on the game from a Cowork session. Read it first. |
| `V020.md` | The brief for v0.2.0 (the main menu and scenarios, then night), an overnight Claude Code run. |
| `V030.md` | The brief for v0.3.0 (aircraft types, then the Boeing 787-9 and 777-300ER), an overnight Claude Code run. |
| `V040.md` | The brief for v0.4.0 (the weather), a Claude Code run on the Mac. |
| `PLAN.md` | The design: Shane's decisions (final) and how each part is built. The spec for everything. |
| `STATUS.md` | The progress log. Append a checkpoint after every step, and read it after any context compaction. |
| `ROADMAP.md` | Milestones M1–M3 with a Done column, and the future additions. |
| `Updates.md` | What each version added, newest first (see "Versions"). |
| `src/version.js` | The version the game shows. |
| `tools/push.sh` | Shane's commit-and-push script. |
| `README.md` | Written at the end of M1: how to run it, the controls, the code map. |
| `tools/cpu-guard.py` | Shane's CPU rules as a tool: every heavy command goes through it (see "CPU rules"). |
| `reference/raw/` | Downloads (git-ignored). |

The Games project doc `claude/flight-sim-prototype.md` lives on claude.ai, where Claude Code can't reach it. `STATUS.md` is the log; a Cowork session copies it into the project doc later.

## State

- **v0.1.0** (2026-10-31): M1, M2 and M3 from `PLAN.md`, built in one overnight Claude Code run (03:21–08:37 KST). `STATUS.md` has the log and the evidence.
- **Shane's first flight**, Gimpo to Incheon, went "mostly good (other than the 0/100 landing)".
- **v0.1.1** (2026-10-31, a Cowork session): Incheon's flickering taxiways, new cockpit windows (`src/cockpit-windows.js`) and a fairer landing score. `STATUS.md` has the details.
- **v0.1.2** (2026-10-31, the same session): a lower windshield on a reshaped nose (sections are now two half-ellipses, `fuseSection()` in `aircraft.js`), the engines under the wing (`NACELLES` in `geometry.js`; the sim's thrust still acts at `ENGINES`), and gentle touchdowns on grass.
- **v0.1.3** (2026-10-31, the same session): a stricter landing score that counts the approach (`score.js`: 100 × e^(−cost), calibrated so Shane's described landing scores 80), a master volume slider and a performance readout bar (F3), and Jeju 31's glideslope fix (`thresholdOf()` in `ui/common.js`).
- **v0.1.4** (2026-11-01, a second Cowork session): typing into the FCU and faster scrolling (`ui/fcu.js`), jumps picked anywhere on the bright path (`ui/map.js`), Gimpo stand 7's routes (`bridgeIslands()` in `ground/taxi.js`), pushbacks at up to 4× (`main.js`), Jeju's crossing as one surface (`runwayCrossings()` in `world/runways.js`, used by the heightfield, the terrain shader and the runway shaders), and the fonts (B612 and Barlow in `vendor/fonts/`; `fitSize()` in `ui/pfd.js`).
- **v0.2.0** (2026-11-01, an overnight Claude Code run, 04:10–05:30 KST): the main menu and scenarios (`src/scenarios.js`, `src/ui/menu.js`; a scenario is a save slot with the whole state), one logbook tagged by scenario, then night: the KST clock and the Sky window (`src/clock.js`, `src/ui/sky-window.js`, L or Cmd/Ctrl+L), Earth's sky (`src/astro.js`, `src/world/sky.js`, BSC5 stars), and city, airport and aircraft lights. `V020.md` was the brief; `STATUS.md` has the evidence.
- **v0.2.1** (2026-11-03, a Cowork session): Shane's three fixes. Taxiways stop at the runways' drawn edges, with their centrelines carried across as lead lines (`drawnRunwayRects()`, `clipSoupOutside()`, `splitPolyline()` in `world/apron-geom.js`); Change route on the map (`ui/map.js`; `changeRoute()` in `main.js`), and waypoints dragged in flight now show (`view.waypoints` is the map's); the view switch at the top right (`ui/hud.js`; 1, 2, 3). Then two more he grouped in: one-finger drag to look around or orbit (`camera.js`), and more stars (`fillStars()` and `starBrightness()` in `world/sky.js`).
- **v0.2.2** (2026-11-04, the same Cowork session): Shane's three fixes. The engine sound rebuilt from the LEAP-1A's real tones (`audio/synth.js`: the fan's blade-passing tone, the buzz-saw, the core's whine, the jet's roar); the A/THR moves the thrust lever and the N1 ring, and R/F take it over smoothly (`athrStep()` in `sim/autopilot.js`, `input.js`, `ui/engines-panel.js`); Cockpit (1) no longer swaps seats (`selectView()` in `main.js`).
- **v0.3.0** (2026-11-04, an overnight Claude Code run; `V030.md` was the brief): aircraft types (`src/sim/types.js`, `src/type-assets.js`, `useType()` in `main.js`), with the A321neo unchanged (`tests/golden-a321.test.mjs`), then the Boeing 787-9 and 777-300ER: their numbers (`src/sim/b787-9.js`, `b777-300er.js`), Boeing's law and autoflight (`fbw-boeing.js`, `autopilot-boeing.js`), `src/widebody*.js`, `src/cockpit-boeing.js`, `src/ui/boeing/`, `src/audio/engine-sounds.js`, code E stands (`standsFor()`). `STATUS.md` has the evidence and what's weak.
- **v0.3.1** (2026-11-08, a Cowork session): Shane's four fixes. The main gear carried by fixed structure with the flaps out (each inboard flap's leading edge behind the leg: `FLAP_IN_LE_X` in `aircraft.js`, `inboardFlapLE()` in `widebody.js`; the A321's wing 1.03 m aft, to Airbus's drawing), spoilers that overhang the flaps over a fixed shroud, slat tracks, rounded noses, flap track fairings that hinge; Cockpit (1) swaps seats again (`selectView()` in `main.js`); the engines about 7 dB up in the cockpit (`MIX`, `INSIDE_LP` in `audio/synth.js`); the Boeings' gear doors two-sided (`slab()` in `aircraft.js`).
- **v0.3.2** (2026-11-08, the same Cowork session): Shane's one change, then two more. The Boeings' MCP altitude goes to 45,000 ft, from 43,000, past their 43,100 ft ceiling on purpose (`ALT_TOP` in `ui/boeing/mcp.js`, `setAlt()` in `sim/autopilot-boeing.js`; the ceiling, `MAX_ALT_FT`, is data only). Duplicate a scenario (`duplicate()` and `copyName()` in `scenarios.js`, the Load list's Duplicate in `ui/menu.js`, the pause menu's Save a copy, `saveCopy()` in `main.js`). The weights in flight: the L window's Weight tab (`src/ui/load-window.js`, beside the Sky window, which takes `tabs`), and `sim.setLoad()`; the load's parts and the fuel added live in the sim's core, so saves, rewinds and copies carry them.
- **v0.4.0** (2026-11-10, a Claude Code run in two sittings, briefed and reviewed by a Cowork session; `V040.md` was the brief): the weather. The settings and the wind field (`src/sim/weather.js`: the mean wind by height, gusts, Dryden turbulence, shear and microbursts, all functions of position and time, seeded, in the snapshot), the air (`columnInto()` and `indicatedAltitude()` in `sim/atmosphere.js`; the flat rating, the air-relative velocity and the windshear detector in `sim/sim.js`), the Boeings flying the track and decrabbing (`sim/autopilot-boeing.js`), the runways' state (`RUNWAY_TYRES`, `k.tyres` in `sim/gear.js`), the presets and the METAR line (`sim/weather-presets.js`), the Weather tab (`ui/weather-window.js`), the screens' wind and BARO, K, the wind at touchdown (`score.js`), the look (the haze as uniforms in `world/sky.js` and `glsl.js`, `world/clouds.js`, `world/precip.js`, wet runways in `world/airports.js`) and the sound (`audio/synth.js`). The review set the altimeter to the day's QNH at each flight's start, held the crab on a final start, flat-rated the engines on cold days too, kept the transition reminder on in level flight, and put the tower's wind on the card. Calm is v0.3.2 exactly: the golden flight to 1e-9, and clear weather draws as v0.3.2 did.
- **v0.4.1** (2026-11-11, a Cowork session, after v0.4.0's review): Shane's five fixes. The 777's wings had a hole in front of each aileron (`LAST` among the box's sections in `widebody.js`), and the slots between the slats and between the trailing-edge surfaces are closed on all three types; the slats droop about their hinge line against a round nose, sealed, instead of running out on tracks (`widebody.js`, `aircraft.js`; `tests/cloud/wing-gaps.cjs` looks for light through the wings). Indestructible (Settings): a crash is a `damage` event and the crash points are skids (`SKID`, `setOption()` in `sim/sim.js`; `COST.crash` and the card's note in `score.js`, `ui/score-panel.js`). Boeing auto-trim (Settings): the path holds itself, and with landing flaps the stick asks for a path rate, as the A321's does (`E.autoTrim` in `sim/fbw-boeing.js`). Storms in three strengths, microbursts only in a severe one and rare (`sim/weather-presets.js`), and the low-level turbulence follows the wind blowing (`K_W20`, `w20` in `sim/weather.js`). Taxiway and runway signs, and the names painted on the taxiways (`src/world/taxisigns.js`; `buildSigns()` and the painted names in `world/apron.js`).
- **v0.4.2** (2026-11-12, a Cowork session, while Shane tested v0.4 for v0.4.3): the known list. The crash screen's Rewind with Indestructible on (`index.html`, `main.js`); Boeing auto-trim's flare law and H/Y (`FLARE_*`, `TRIM_PATH_RATE` in `sim/fbw-boeing.js`); Indestructible's belly skids and hard stop, and the gear-up card (`skidPoints()`, `hardStop()` in `sim/sim.js`; `scraping` as grounded in `score.js`); the Boeing autoland's alignment integrators and rollout gains (`ALIGN_KI`, `ALIGN_KIB`, `ROLL_KP`, `ROLL_KD` in `sim/autopilot-boeing.js`); runway exit and distance remaining signs (`RUNWAY_SIGN` in `world/taxisigns.js`); predictive windshear (`pwsScan()` in `sim/sim.js`, the PFDs, `audio/callouts.js`); hydroplaning (`hydro` in `sim/weather.js`, `HYDRO_MS` in `sim/gear.js`, `TYRE_PSI` per type); the wipers (`WIPER` in `world/precip.js`), the spray (`src/world/spray.js`), snow over the taxiway paint (`apron.js`). Broken cloud far off and the 777's yaw were checked and left as they were (`STATUS.md` says why).
- **v0.5.0** (2026-11-13, a Claude Code run from 03:26 to 04:10 KST briefed by `V050.md`, reviewed and written up by the Cowork session): the parts model and the Warehouse. Designs (`sim/designs.js`, `designDef()`), engine types as parts (`sim/engine-types.js`), the sim's engines as arrays, the pylons' limits, one engine builder (`engine-model.js`), screens and voices for any number of engines, the Warehouse page (`ui/warehouse.js`, `designs-store.js`). The Boeings' golden flights (`tests/golden-boeing*.mjs`) are compared to 1e-9 of the value above 1 (absolute below), since they were recorded with macOS's node and Linux's differs by roundoff.
- **v0.4.4** (2026-11-13, the same Cowork session, about 30 minutes before v0.5.0's run): Hide panels at the top left (`panelsBox` in `ui/hud.js`, `hidePanels` in the settings); the view switch stays at the top right (`placeViews()`: a smaller font, then just under the top row with that side's panels below it; never the bottom centre); the aurora undulates (`aurora()` in `world/sky.js`: a swaying azimuth, edge ripples, shapes that evolve, breathing arcs); the Boeings' main legs pivot inside the wing (`mainPivotZ` in `widebody-specs.js`, 0.45 m higher); the A321's setup limits from `sim/a321neo.js`.
- **v0.4.3** (2026-11-13, the same Cowork session): Shane's findings from testing v0.4. The Boeings' wing bend goes on after the skinning (`setWingFlex()`'s shader in `widebody.js`), so slats and flaps rise with the bent wing, and the engines ride it as one piece (`bendY`, the Builder's fifth argument in `aircraft.js`), so the fans stay centred; a fan case, a full fan face and a back disc on all three types' engines (no light through the cowl); the 777's elevator and stabiliser power from its tail volume (`CM` in `sim/b777-300er.js`) and a 2.2°/s pitch-rate cap in auto-trim's path mode (`PATH_Q_MAX` in `sim/fbw-boeing.js`), so it settles as the 787; and the aurora on every clear night (`aurora()` in `world/sky.js`).
- **Next:** v0.5.0 in `ROADMAP.md`'s version plan (the parts model and a first warehouse), taken from start to finish by a new session; `HANDOFF.md`'s first section is its handoff. `ROADMAP.md`'s "The long term" (Shane, 2026-11-10: MSFS, KSP and Besiege) has the plan after it, to v0.18.0.

## Versions, Updates.md and pushing

This is the same system as Satisfactory's.

- **Where the version lives:** `VERSION` in `src/version.js`. The pause menu and the loading screen show its label, for example `Flight Sim v0.1.0 · CL#261031`, where the build number is the date as YYMMDD.
- **Numbering:** every update gets a version, and Shane usually names it ("For v0.1.1: …"). Otherwise, a round of fixes or small changes bumps the patch (v0.1.1), and a new series of features bumps the minor (v0.2.0).
- **With every update:**
  - bump `VERSION` (the number, build and label);
  - add an entry at the top of `Updates.md`, in the same style, saying what a player notices;
  - mark finished items in `ROADMAP.md`;
  - log the details in `STATUS.md`.
- **The commit's title is the version number alone** (`v0.1.1`). What changed lives in `Updates.md`.
- **Shane commits and pushes,** with `sh tools/push.sh v0.1.1` from this folder. The repository is public: github.com/NuclearPlane787/flight-sim. Agents never run git here.
- **Who builds a version is a judgment per job.** Shane, 2026-11-01: "if a job is very big, it is probably better to hand it to a Claude Code agent. ... This is for when you increment the second decimal. For the third decimal, doing it directly from cowork is fine." And on 2026-11-10: "Note that the second decimal Claude Code thing is more a suggestion than a rule. Whether the job is such that a CC session would work better if handed to them is your judgment to make."
  - A long, unattended build that wants the Mac's own GPU and Chrome for its checks (most second-decimal versions) suits a Claude Code run on the Mac: the session writes its brief (Shane's decisions, the scope and a definition of done) and gives Shane the starting prompt.
  - A focused change (most patches) is done directly in the Cowork session.
  - A run starts only once the last version is pushed, so two agents never edit the same files.
- **One session takes an update from end to end** (Shane, 2026-11-10: "I would rather a new session work completely from end to end of an update."). A new session starts each update and:
  - settles its scope with Shane;
  - builds it, or briefs a Claude Code run, gives Shane the starting prompt and reviews what the run did;
  - checks it, fixes what's wrong, writes it up, and hands it to Shane to push;
  - last, rewrites `HANDOFF.md`'s first section for the next session.
- **What a public repository rules out:**
  - third-party documents (the Airbus and EASA PDFs stay git-ignored);
  - absolute paths with the Mac's user name (build paths from `__file__` or `import.meta.url`);
  - any real airline's branding.

## House rules

- **Never run git** in GameDump, not even `git status`. Shane commits. (`GIT_OPTIONAL_LOCKS=0 git log` is the only safe read.)
- **Stay in `games/flight-sim/`.** The only exceptions:
  - screenshots go in `Claude outputs/flight-sim/`;
  - the registry entry goes in `data/games.js` at the end.

  Don't touch the hub, the other games or the root files. If something outside is in the way, note it in `STATUS.md`.
- **Scratch outside GameDump:** put Python venvs, Playwright's install and temp files in `/tmp/flight-sim/`. Test scripts themselves go in `tests/`.
- **Browser storage keys** start with `gamedump:flight-sim:` (`settings`, `logbook`, `lastflight`, and since v0.2.0 `scenarios` and `scenario:<id>`). No service workers.
- **No network at runtime.** The game loads only files in its own folder; downloads happen in the bake scripts.
- **No build step:** vanilla ES modules. Copy `three.module.js`, `three.core.js` and `THREE-LICENSE.txt` (r186) from `games/satisfactory/vendor/` into `games/flight-sim/vendor/`. That's a read-only copy: change nothing in Satisfactory.

## CPU rules (Shane's)

Shane made these after "4 rogue Python scripts took up half my entire cpu for 6 hours and almost cooked my device". The rule: "have a count cap and a time cap for 100% CPU core scripts." `tools/cpu-guard.py` enforces it for every agent at once, so use it rather than trusting anyone to remember.

**Memory cap, added at about 03:50 KST on 2026-10-31.** A Python process from this run reached 18.7 GB of this Mac's 24 GB, and macOS's kernel_task went to 200% swapping, so Shane force-quit it. The guard now also stops a command once its processes together hold more than **6 GB** (exit 123).

- Never load a whole dataset at full resolution. Stream or tile it:
  - filter the OSM extract by tag before building any geometry (pyosmium filters with a node-location index, or osmium-tool's `tags-filter`);
  - build the rasters tile by tile.
- `FLIGHT_SIM_MEM_GB` tells scripts the cap.

- **What goes through the guard:** anything that can keep a core busy for more than about a minute, such as bake scripts, test suites, headless sim runs, browser checks and benchmarks. The form is `python3 games/flight-sim/tools/cpu-guard.py -- <command>`. Run pipelines through `bash -c '...'`.
- **Count cap:** 2 guarded commands at once, across all agents and subagents. The rest wait their turn.
- **Time cap:** 20 minutes per command. After that the command is stopped, with everything it started, and each process also has a CPU-time limit.
  - A job that needs longer gets split into resumable pieces (per tile, per airport), never a bigger cap.
  - Thread pools are capped at 2 (`FLIGHT_SIM_THREADS` tells scripts the number).
- **Claude Code's own command timeout stops nothing.** A command that outlives it moves to the background and keeps running, so the guard's cap is the one that counts.
- **On a new machine**, check the guard first:
  - `python3 games/flight-sim/tools/cpu-guard.py --minutes 0.05 -- python3 -c "while 1: pass"` must print the time-cap message and exit 124 after about 3 s.
  - `python3 games/flight-sim/tools/cpu-guard.py --mem-gb 0.3 -- python3 -c "import time; a=[b'x'*(100<<20) for _ in range(8)]; time.sleep(10)"` must print the memory-cap message and exit 123.
- **Servers and browsers** that you keep running for testing don't go under the guard. Note their PIDs in `/tmp/flight-sim/pids`, and stop them as soon as the check is done.
- **At every checkpoint**, run `python3 games/flight-sim/tools/cpu-guard.py --sweep`. Stop anything you started that it lists, and log what you stopped.
- **The game itself** stays light too: see `PLAN.md` → CPU at runtime.

## Environment

- **This Mac:** Apple M5, Chrome, a 120 Hz screen, and normal internet access.
- **Serving:** the hub's server is `python3 -m http.server 8001` from the GameDump root.
  - Check whether something already listens on 8001 (`lsof -i :8001`) and reuse it.
  - Python's server sends no Cache-Control. For testing, run your own no-cache server from `/tmp/flight-sim/` on another port (for example 8014), or add `?v=` to module URLs.
- **Python:** `python3 -m venv /tmp/flight-sim/venv`, then install what the bake scripts need:
  - numpy;
  - tifffile and imagecodecs, for the GeoTIFFs;
  - osmium, for the `.osm.pbf`;
  - shapely, if it helps.
- **Node:** check `node -v`. Unit tests run with `node --test games/flight-sim/tests/*.test.mjs`.
- **Browser checks:** Playwright installed in `/tmp/flight-sim/`, driving the installed Chrome (`channel: 'chrome'`) so WebGL runs on the M5's GPU. A headed window is fine overnight. Save screenshots to `Claude outputs/flight-sim/` with names that say what they show, and look at every one.

## Data

1. **Check `reference/raw/` first.** Whatever is missing, download it yourself with the commands in `PLAN.md` → Data:
   - OpenStreetMap's South Korea extract;
   - the Copernicus 90 m and 30 m elevation tiles;
   - Natural Earth;
   - OurAirports;
   - the two A321neo PDFs.
2. **Read the A321neo numbers** listed in `PLAN.md` from the PDFs.
3. **Bake:** scripts go in `tools/` and their outputs in `data/`. Keep `data/` compact: tens of MB, not hundreds.

## Splitting the work (as the first build was split)

A suggested split for the first hours: five jobs with separate files.

1. **Bake pipeline** (`tools/`, `data/`):
   - OSM → coastline and water distance fields, land cover (forest, farmland, built-up), and the three airports as JSON;
   - elevation → the national height texture and the 30 m airport patches, with built-up areas filtered and airfields flattened.
2. **Simulation** (`src/sim/`, `tests/`):
   - the atmosphere, the A321neo's data, the flight model, engines, gear and fly-by-wire;
   - the autopilot and autothrust, prediction and jumps;
   - the node tests against the real numbers.
3. **Screens** (`src/ui/`): the PFD, ND, engine panel and FCU, the map with the predicted path and jumps, and flight setup.
4. **Aircraft and cockpit** (`src/aircraft.js`, `src/cockpit.js`): the procedural A321neo with moving surfaces and gear, the Nuclear Airlines livery, and the simple cockpit.
5. **World rendering** (`src/world/`): the map frame, terrain clipmap, sea, sky, surface detail, cities and runway rendering.

You own `src/main.js`, `src/input.js`, `src/camera.js`, the integration and the end-to-end check. Before the jobs start, write the shared interfaces into `STATUS.md`: the map frame functions, the aircraft state object, the data file formats and the module boundaries.

## Definition of done for M1 (also the checklist before a release)

Every item needs evidence in `STATUS.md`: the command and its result, or a screenshot's file name.

- [ ] `node --test games/flight-sim/tests/*.test.mjs` passes, including the flight model checks against the A321neo's published numbers.
- [ ] The game loads at `http://localhost:8001/games/flight-sim/` in Chrome with no console errors. Once the registry entry exists, it also loads from the hub's player (`play.html?game=flight-sim`).
- [ ] It holds the 60 fps cap on the M5 at 1440×900, on the ground at Gimpo and at 3,000 ft over Seoul. Record triangles and draw calls from the performance overlay; aim for at most about 1 M triangles and 300 draw calls.
- [ ] The scripted end-to-end flight passes:
  1. take off from a Gimpo runway and climb, with scripted inputs;
  2. engage the autopilot towards Jeju;
  3. use time compression and a path-map jump;
  4. skip to final at Jeju;
  5. land with a test-only landing controller (not a game feature).

  The landing score comes out and nothing crashes. Take a screenshot at each phase.
- [ ] Screenshots, looked at and judged right:
  - all four views;
  - the map with the bright predicted path;
  - the PFD, ND, engine panel and FCU;
  - Gimpo's and Jeju's runways, with markings, lights and PAPIs;
  - Seoul's buildings and the Han River;
  - Hallasan from the approach.
- [ ] A reviewer subagent has checked the build against `PLAN.md`'s M1 list, and every finding that affects correctness is fixed.
- [ ] The game holds the CPU-at-runtime rules in `PLAN.md`: nothing runs while it's paused or the tab is hidden, and the predicted path stays within its CPU budget.
- [ ] Nothing started tonight is still running: `cpu-guard.py --status` shows no slots in use, and `--sweep` is clean.
- [ ] `README.md`, the registry entry, `ROADMAP.md` and the final `STATUS.md` entry are written.

## Registry entry (added at the end of M1)

Insert our object before the `coming-soon-slot` entry in `data/games.js`, with a short read-modify-write script that adds only that object. Never rewrite the file.

- `id: "flight-sim"`, `title: "Flight Sim"`, `tags: ["sim", "flight"]`, `input: "both"`, `status: "live"`, `dateAdded: "2026-10-31"`.
- `thumbnail: "games/flight-sim/thumb.svg"`: draw an original 16:10 tile, for example the Nuclear Airlines tail over a runway.
- `accent`: the livery's Cherenkov blue.
- A one-line `blurb` in the same voice as the other entries.

The "Current games" table in GameDump's root `AGENTS.md` is Shane's file, so don't edit it. Write the row he should add into `STATUS.md`.
