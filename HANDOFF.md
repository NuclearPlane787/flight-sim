# Flight Sim: handoff

Read this first if you're picking the game up. Its first section is the job in hand; the rest is how the game is built and how to work on it. Then read `AGENTS.md` (the rules), `ROADMAP.md`'s "The long term" (where the game is going) and the newest entries in `STATUS.md` (what was done, with the evidence).

It was first written on 2026-10-31 by the Cowork session that made v0.1.1 to v0.1.3, and every session and run since has kept it up: the Cowork sessions that made v0.1.4, v0.2.1 and v0.2.2, the Claude Code runs that made v0.2.0, v0.3.0 and v0.4.0, the Cowork session that made v0.3.1 and v0.3.2 and set the long-term plan with Shane on 2026-11-10, and the Cowork session that settled v0.4.0's scope, briefed its run, reviewed it, and then made v0.4.1 (Shane's fixes after flying it), v0.4.2 (the list of what was already known) v0.4.3 (Shane's findings from testing v0.4) and v0.4.4, then settled v0.5.0's scope with Shane, briefed the Claude Code run that built it (2026-11-13, 03:26 to 04:10 KST), and reviewed it. That session wrote this first section's plan for v0.6.0, then made v0.5.1 (the warehouse's hangar) and v0.5.2 (parts anywhere), briefed the Claude Code run that built v0.5.3 (the airframe from parts, 2026-11-15) and reviewed it. The Cowork session after it made v0.5.4 to v0.5.8 with Shane (2026-11-16 to 19), closing Update 5, and brought this section up to date on 2026-11-19 for the session that takes v0.6.0. That session planned v0.6.0 with Shane, briefed the Claude Code run that built it in two sittings (2026-11-19 to 20) and the overnight run that built v0.6.1, reviewed both, and rewrote this section for v0.7.0 on 2026-11-20.

## The next session: v0.7.0, the regions and Europe, from start to finish

**Status (2026-11-20, 10:20 KST): v0.6.1 written up for Shane to push; v0.7.0 not started.** Update 6 opened with East Asia: v0.6.0 (planned with Shane on 2026-11-19, built by a Claude Code run in two sittings, `V060.md`) and v0.6.1 (the overnight run's list and Yancheng, 2026-11-20), both reviewed and written up by the Cowork session that took v0.6.0 (`STATUS.md`'s 01:50 and 10:20 entries). Nothing is planned for v0.7.0 beyond `ROADMAP.md`'s row.

Shane, 2026-11-10: "I would rather a new session work completely from end to end of an update." v0.7.0 is the next update in the version plan: the region picker, and Europe. That's you:

1. **Plan it with Shane before anything is built.** The questions below each have a default, so he can answer by picking options (AskUserQuestion takes up to four a call). Check each default against its source before you offer it (they were written on 2026-11-20 from memory). He's at school on weekdays ("I am in school right now, so it is a bit tedious to organise long sessions", 2026-11-19): ask when he can sit for the planning and when the run can go, and plan its sittings around that, as v0.6.0's were (15:15–17:15, 17:30–01:30, then overnight to 08:00).
2. **Write the plan down as `V070.md`** and let him read it before the run starts. Model it on `V060.md`: Shane's decisions, the rules found in planning, the parts in priority order behind flags, the definition of done, the run's rules, the starting prompts and their `/goal`s.
3. **Get it built:** a Claude Code run on the Mac that you brief (the downloads, the bake through the guard, the GPU checks, all headless). The cloud container's network reaches package registries and GitHub, not the data's hosts.
4. **Check it, write it up and hand it to him to push** ("After the run", below).

Your last job is to rewrite this section for the session after you (v0.8.0 in the plan: failures).

### Where you start

- **v0.6.0 is pushed** (`908d111`), and **v0.6.1 was written up and ready to push** when this was written (2026-11-20, 10:20 KST). Check with `GIT_OPTIONAL_LOCKS=0 git log --oneline -3`, the only git command allowed in GameDump. If the top line isn't v0.6.1, ask Shane to push it first (`sh tools/push.sh v0.6.1`): a run starts only from a pushed version.
- **Passing at v0.6.1:** 1232 unit tests with the defaults and with `FS_EAST_ASIA=0 FS_CITIES=0 FS_GROUND=0`, on the Mac and in the container (a clean clone of the public repository runs them all), the golden flights exact over Korea's tiles and the region's; in the container, `land.cjs` (RKSI 33L: B 89, as since v0.1.3), `athr-lever`, `camera-drag`, `weather-final`, `weight-copy`, `v056-keys`, `v058-home`, `v058-rename` and `route-views`; on the Mac's GPU, headless, the overnight run's final chain (`STATUS.md`'s 06:53 entry: Korea with the flags off against v0.5.8 at max diff 0, no frame over 17 ms in a 16× cruise from Seoul to Tokyo, Yancheng and Gimpo to Haneda end to end).
- **The flags are still in:** `EAST_ASIA_ON`, `CITIES_ON` and `GROUND_ON` (`src/world/region.js`), all on; `?eastasia=0&cities=0` is v0.5.8's Korea pixel for pixel, kept with Korea's own tiles and national files (19 MB). A second region beside a third code path is a lot to carry: ask Shane first whether they go (question 1).
- **Open from v0.6.x, his to decide:** Gimhae's 18L and 18R finals (a final start or Skip to final there flies into the hills: refuse those ends for final starts, or a circling start); whether the glass patches' new places, the paddies and bare ground look right to him; Gimhae's elevations and widths from its AIP (it moves the ground under saves); weather by place (his "sub-update", 2026-11-19). `ROADMAP.md`'s "Found while building v0.6.1" and "v0.6.0" have the rest.
- **The browsers run headless** (Shane, 2026-11-19: no windows taking over his screen). Every script defaults to it since v0.6.1 (`--headed` to watch). Headless Chrome renders on the M5's GPU, so frame rates count, but only on mains and alone on the GPU: run `pmset -g batt` (on battery under 20 % Chrome halves the frame rate, which cost v0.6.0's evening its numbers for an hour).
- **Subagents:** Opus or lower, at most three at once (Shane's rule for Anemoia's sessions, 2026-11-19: "all of them have to be Opus or lower", after Fable subagents ran a session out of his limit; v0.6.1's run took it here).
- **The direction:** `ROADMAP.md` → "The long term", "How the regions would work" and the version plan. Europe is the first region in a frame of its own; North America (v0.10.0, v0.11.0) and Oceania (v0.15.0) follow the same way, so build the region work generally.

### What v0.6.0 and v0.6.1 built that v0.7.0 meets

- **One region, one frame, one manifest.** Everything reads Korea's map frame (`src/world/frame.js`: a Lambert conformal conic at 36° N 127.5° E, parallels 33° and 38°) and one `data/manifest.json`: the region's tiles (`tilesRegion`: `data/terrain/r0/` at 250 m and `r1/` at 1 km, 128 km each on Korea's lattice from −400 km), the 31 m cover (`data/terrain/fine/`), the airports and their 30 m patches, the coast file (`data/coast-region.json`), the country raster (`data/country.*`) and the WMM grid (`data/magvar.*`). A second region needs its own frame and its own set of all of these, and whatever holds one today must take the region: `MAP_EXTENT` and `terrainSpec()` (`region.js`), `AIRPORT_ORDER` (`ui/setup.js`), `REGION_ICAOS` (`ground/taxi.js`), the routes, the map's coastline, the prediction worker's loads, the home page's places. Saves carry map coordinates, so each must carry its region too (old ones are East Asia's).
- **The tiles are general:** `src/world/tilestore.js` (waits, pins, eviction, retries), `heightfield.js` over it, the loader's waits in `region.js` (the sim never reads a missing tile), the GPU's clip window (`clipwindow.js`, `terrain.js`), the nearest patches and runways in the uniforms (`MAX_PATCHES` 4, `MAX_RUNWAYS` 12). A second set of tiles should be a second manifest, not new code, once the frame and the lattice are parameters.
- **The local rules are by country** (`src/world/geo-rules.js`): the country from the raster (the sea takes its nearest land's), then its rules: the altimeter's units, the transition altitude, the metric altitude, local time through `Intl` (summer time comes with it), the METAR's form, WMM2025 outside `south-korea.poly`. Europe brings five or more countries with their own transition altitudes (each AIP's), all hectopascals and feet.
- **The bake is the region's:** `tools/bake_region_*.py` (heights from GLO-90 and the 1 km land, WorldCover's cover, the coast and inland water, the airports from small OpenStreetMap extracts cut with osmium and an AIP table for lights and ILS, the 30 m patches from GLO-30, the centres from OpenStreetMap's buildings), each through the guard; `bake_common.py` has the frame. Check each for East Asia's assumptions: the box, the lattice's origin, the frame, the country list, `south-korea.poly`.
- **Cities and landmarks are by country** (`cities.js`'s mixes, `centres.js`'s real buildings, `landmarks.js` and `landmark-models.js`: our own models from public figures, with no logos or names). Europe's centres are low and old (Paris's blocks, London's mix, Frankfurt's towers, Madrid's four towers, Zurich small): new mixes, and Shane will want landmarks.
- **The countryside is by country** (`finecover.js`, `rural.js`, `greenhouses.js`): WorldCover's cover near the camera, fields, villages in each country's style, trees (all conifers still: a broadleaf tree is new work, and Europe has more of them).
- **The scene's budget:** v0.6.1 brought the big cities to about a million triangles by drawing houses and trees only where they stand and cities and traffic only in view (`?cull=0` to compare). Keep Europe's cities under it.
- **A new airport waits behind `PENDING_ON`** (`?pending=1`, `FS_PENDING=1`; the manifest's `airportsPending`) until it passes the check every new airport passed: a gate start, pushback, taxi, take-off and a landing by the test pilot, and taxi-in; the gate and a final by day and by night; 60 fps at a stand and on a 3 nm final.
- **Size:** `data/` is about 155 MB for East Asia (13 MB before v0.6.0). It goes in git (Shane, 2026-11-10), each file under GitHub's 100 MB (East Asia's largest is 6 MB). Europe's default box below is nearly twice East Asia's area and mostly land: work out its size before you promise it.

### What Shane has said, in his words

- **2026-11-10** (ROADMAP row 13): "In Europe, airports like Heathrow, CDG, Frankfurt, Madrid, Zurich. ... Maybe just those three regions locally, with long international flights unavailable." And: "Adding the region map to git is reasonable, I think."
- **2026-11-19, planning v0.6.0,** he asked for more than the plan had: airports so that no stretch of land is empty ("there is a huge stretch of land where are no landing sites"), a real ground ("Right now it is all just square fields, but in reality it is a mix of forests, fields, and some buildings"), and landmarks ("famous buildings as their own things on the maps"). Expect the same for Europe: offer airports for the gaps and landmarks from the start.
- **2026-11-19, the weather:** "One weather, true everywhere now, but we'll probably fix that in a subupdate."
- **2026-11-20:** Yancheng ("There is a huge stretch of that coast of china with no airports, and one in the middle would be good").

### Proposed, not confirmed: ask him first

1. **The flags.** Default: `EAST_ASIA_ON`, `CITIES_ON` and `GROUND_ON` go, with Korea's old tiles and national files and the flags-off paths (`c2` becomes `c`; six old test files' expectations rewritten for the region, as v0.6.0's hand-over lists), as v0.7.0's first part, once he has flown v0.6.x and is happy with it.
2. **The region picker.** Default: New scenario asks for the region first (East Asia, Europe), then the airports; each save carries its region (old saves are East Asia's); the map, the setup's lists, the home page's ticket and the Load list work per region; the game loads only the chosen region's data.
3. **Europe's extent and frame.** Default: 250 m data over about 36° to 56° N and 10° W to 17° E (Madrid to Copenhagen's latitude, Ireland to Vienna), with 1 km land round it; its own Lambert conformal conic, centred near 46° N 4° E with parallels near 40° and 53° (work out the scale at the corners). Fit the box to the airports he picks.
4. **The airports.** Default: the plan's five (Heathrow, Charles de Gaulle, Frankfurt, Madrid Barajas, Zurich) in full detail, and candidates for the gaps for him to pick from (for example Amsterdam, Munich, Barcelona, Gatwick or Orly, Milan, Vienna), as East Asia's grew from three to nine.
5. **The local rules.** Default: hectopascals and feet everywhere; each country's transition altitude from its AIP; Western and Central European time with summer time; WMM2025; METARs in Europe's form.
6. **Cities and landmarks.** Default: each country's mix; real centres from OpenStreetMap's buildings in London, Paris, Frankfurt, Madrid and Zurich; landmarks as our own models, from a list he picks from (for example the Eiffel Tower, the Shard, Frankfurt's towers, Madrid's four towers).
7. **Weather by place.** Default: still one weather in v0.7.0, true to north everywhere; weather by place as its own sub-update after it (his word), now that two regions make it matter more.
8. **Who builds it, and when.** Default: a Claude Code run on the Mac in sittings he sets, briefed by `V070.md`, its parts in priority order behind flags: the flags' removal (if he agrees), the region picker and a second frame, Europe's bake, its airports, its rules, its cities, its ground.

### Where the regions plug in

From the code at v0.6.1 (2026-11-20). Check the details, which drift.

| Where | What to know |
|---|---|
| `src/world/frame.js` | Korea's frame as constants: the projection, the grid convergence (the sky, the wind and the headings turn by it), `magVar()`'s plane inside `south-korea.poly`. |
| `src/world/region.js` | The flags, `PENDING_ON`, `MAP_EXTENT`, `terrainSpec()` (what the manifest offers), the loader's waits; `regionQuery()` passes them to the prediction worker. |
| `data/manifest.json` | `tilesRegion` (r0, r1), Korea's own `l0`/`l1` and national files (for the flags off), `airports`, `patches`, `coastPatches`, `airportsPending`, `patchesPending`. |
| `src/world/tilestore.js`, `heightfield.js`, `clipwindow.js`, `terrain.js` | The tiles (128 km of 512 cells, with borders); the store's waits, pins, eviction and retries (its retry timer is `unref`'d, so a node test that waits on it keeps the loop alive: `tests/tilestore.test.mjs`); the GPU's window. |
| `src/world/geo-rules.js`, `data/country.*`, `data/magvar.*` | The country by position and its rules; the WMM2025 grid. |
| `src/ui/setup.js` (`AIRPORT_ORDER`, the lists by country), `src/ground/taxi.js` (`REGION_ICAOS`, `regionRules()`), `src/ground/gate-flow.js` | The airports' lists and the region's taxi rules (taxi-in by an exit ahead). |
| `src/world/cities.js`, `centres.js`, `landmarks.js`, `landmark-models.js`, `src/ui/line-art.js` | Cities by country, real centres, landmarks; the home page's skyline. |
| `src/world/finecover.js`, `rural.js`, `greenhouses.js`, `detail.js` | The ground near the camera, and the culling. |
| `tools/bake_region_*.py`, `tools/bake_common.py` | The bake, every step through the guard (`python3 tools/cpu-guard.py -- …`: 2 at once, 20 minutes, 6 GB). |
| `tests/v060-*.test.mjs`, `tests/v061-*.test.mjs`, `tests/region-*.test.mjs`, `tests/browser-v060-*.mjs` | The region's checks: in node, and in the Mac's headless Chrome (the airports end to end, the flight, the hitch run, the stills, the hub). |

### After the run

1. **Read the run's `STATUS.md` entries** and go through the definition of done item by item against the evidence.
2. **Check it yourself:**
   - **The unit tests both ways.** On the Mac through the device shell, each call stops at 3 minutes and takes its background processes with it: run the suite in three groups of files, through the guard (`FLIGHT_SIM_CPU_DIR="$HOME/fs-guard-check"` there). Or in the container, with no time limit: v0.6.1's review cloned the public repository (`git clone https://github.com/NuclearPlane787/flight-sim`), staged in the files changed since the push (`find . -newermt …` on the Mac) and ran it there.
   - **The cloud checks** in that clone: `python3 tests/cloud/serve.py <a folder holding games/flight-sim> 8765`, and Playwright on the container's Chrome. Its own Chromium isn't installed, so a preload that wraps `chromium.launch` with `executablePath: '/usr/bin/google-chrome'` (`node -r <preload> …`, `NODE_PATH` at the global modules) runs the scripts unchanged. `ui-shots.cjs` is stale since v0.2.0 (its `#volume` is the menu's `data-s="volume"` now).
   - **The pictures:** stage them and look (contact sheets help); diff before and after where nothing should change.
3. **Fix what's wrong:** in the session if it's small, as a v0.7.1 patch if it isn't.
4. **Write it up:** `src/version.js` (the build number is the day; versions on the same day share it), `Updates.md`, `README.md`, `PLAN.md`, `ROADMAP.md` (row 13, the version plan, "Found while building"), `AGENTS.md` (the game's line, State, Next), `HANDOFF.md`'s table, `STATUS.md`, the hub's blurb in GameDump's `data/games.js`, and the Games project doc.
5. **Hand it to Shane:** `sh tools/push.sh v0.7.0`, then Cmd+Shift+R in the app.
6. **Rewrite this section** for the session after you.

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
| v0.4.3 | Shane's findings: the slats and flaps stay on the bent wing in flight; solid engines with centred fans; the 777 settles after a pitch input as the 787; auroras on every clear night | yes (`1f04a03`) |
| v0.4.4 | Hide panels; the view switch kept at the top right in the cockpit; auroras that undulate; the Boeings' main legs folded into the wing; the A321's setup weights | yes (`d484689`) |
| v0.5.0 | The Warehouse: designs on any of the three types (engines: count, type, stations, thrust; empty weight, fuel, longer gear, name, registration), flown from New scenario; engines as parts in the sim, the model, the screens and the sound; pylons that give way | yes (`3aeaa07`) |
| v0.5.1 | The warehouse is a hangar: steel frames and roof trusses, skylights and lamps, offices, racks, benches and a spare engine along the walls, sliding doors part open onto the apron, a painted floor with the stand's lead-in and a stop bar per type, people walking; the camera stays inside | yes |
| v0.5.2 | Parts anywhere, KSP's way: engines under or over the wing, on the rear fuselage or in the tail (up to 8, mixed types, nudged and turned), wing tanks, hold tanks and ballast, each with its mass, drag and thrust line; the editor's palette, ghost, mirror, select, drag, undo and redo, the CoM and CoT, new checks, Fly it | yes (`31c1fb3`) |
| v0.5.3 | The airframe from parts: each wing side's span, chord, sweep and dihedral, the tailplane's and fin's size and the fuselage's plugs in the warehouse, the handling from the parts (strips with their own airflow, one rigid body), the model following, the structure's weight, new checks (static margin, Cnβ, stall speed, nose-wheel load, code letter), self-tuning yaw gains, stands that fit, the A321's sharklets as a switch | yes (`08f3e82`) |
| v0.5.4 | Shane's list after v0.5.3: a Pause button beside Hide panels (the L window works while paused), a renamed design renamed in its scenarios, landings out of 10 per part (a weighted average, the worst part capping it), sweep moving the coffin corner's top and MMO, Drop wing tanks, keys for the selected part in the warehouse, the tails' overhang and the A321's inner flap fixed, the hangar's doors shut | yes (`c466026`) |
| v0.5.5 | Shane's list after v0.5.4: the Esc menu doesn't pause (only the HUD's button does), the views, camera and controls work while paused and act on Resume, the landing card's rows as shares of 100 that add up with penalty rows after them (a would-be crash halves), bounces counted from the wheels | yes (`c2ebae4`) |
| v0.5.6 | Keys per aircraft (every control rebindable, engine groups with their own levers), flaps on − and =, the swept wing's area, the main gear following the wing and a wing position, take-off trim for tails and moved engines, VMC, drop tanks that fall away, the warehouse's keys for a part in hand and drag from the palette | yes (`7a6cea8`) |
| v0.5.7 | The warehouse's key block (7–0, U–P, J–;, M–/: each aircraft's own keys, only there) and every other key global on the Controls page, each engine its own keys, the moved keys (TO/GA Shift+T, QNH Shift+B, pushback Shift+G, map N, the Sky window \\), a keyboard drawing on the Controls page; a new home page (the moving path and plane, the floating boarding pass and suitcase, a skyline of 22 landmarks scrolling like a tape, a dusk background, the saved flight as a ticket), no subtitle | yes (`c806ab5`) |
| v0.5.8 | The last before v0.6.0: one engine down bites (the laws leave a thrust asymmetry to the pilot; the Boeings roll with it), design names follow the warehouse everywhere (the logbook too), the home page's ground band fixed, three travel prints rendered from the game, stars and an aurora | yes (`0a31e32`) |
| v0.6.0 | East Asia: eight new airports (Pudong, Hongqiao, Qingdao, Haneda, Narita, Kansai, Fukuoka, Gimhae), the terrain in tiles with 1 km land round the region, each country's rules (inHg, metres, local time, WMM2025), each country's cities with nine real centres and nineteen landmarks, a new countryside from WorldCover; a Claude Code run in two sittings (`V060.md`) | yes (`908d111`) |
| v0.6.1 | Yancheng Nanyang, the twelfth airport; the scene culled to about a million triangles near the cities; greenhouses as tunnels; smoother small waters; taxi-in at Narita and Korea's airports; Gimhae as published; a Claude Code run overnight | written up; `sh tools/push.sh v0.6.1` |

- **Check first:** `GIT_OPTIONAL_LOCKS=0 git log --oneline -3` (the only git command allowed here), to see what Shane has pushed since.
- **v0.6.1's** is in its `STATUS.md` entries: the overnight run's (from "2026-11-20, 02:25 KST" to its hand-over, "06:53") and the review's ("10:20"): 1232 unit tests both ways, on the Mac and in a clean clone of the repository; the cloud checks; the pictures `v061-*.png`.
- **v0.6.0's** is in its `STATUS.md` entries: the plan's ("2026-11-19, 11:50 KST" and "15:05"), the run's (from "15:15" to its hand-over, "23:30", with additions to 01:30) and the review's ("2026-11-20, 01:50"): 1200 unit tests both ways, the run's Chrome checks on the Mac's GPU, and the pictures `v060-*.png`.
- **Passing at v0.3.0's hand-off:** 501 unit tests; `browser-boeing-flight.mjs` and `browser-types.mjs` on both Boeings; `browser-e2e.mjs` 12/12, `browser-scenarios.mjs` 23/23. `audio-render.mjs` 30/30 on each Boeing, six runs in a row; on the A321 its reverser door clunk can still fail now and then (it's too quiet there by the check's measure, and the A321's sound stays as it is). Not played by hand or listened to.
- **v0.3.0's evidence** is in `STATUS.md` (from "2026-11-04, 04:36 KST"), its final entry says what's weak, and ROADMAP has the leftovers.
- **v0.3.1's** is in its `STATUS.md` entry ("2026-11-08, 03:40 KST"): 506 unit tests, `route-views.cjs`, `audio-render.mjs` 30/30 on each type, and before/after close-ups of every type's wing, gear and doors (`tests/cloud/models.cjs`).
- **v0.3.2's** is in its two `STATUS.md` entries ("2026-11-08, 15:05 KST" and the one after): 521 unit tests, `tests/cloud/weight-copy.cjs` (new) and `route-views.cjs`.
- **v0.4.1's** is in its `STATUS.md` entry ("2026-11-11, 00:20 KST"): 646 unit tests, the cloud checks, and before/after pictures of the wings, the signs and the card.
- **v0.5.0's** is in its `STATUS.md` entries: the brief's ("2026-11-13, 03:35 KST"), the run's (from "03:26" to its final entry, "04:10 KST") and the review's ("2026-11-13, 09:30 KST"): 719 unit tests, the run's Chrome checks on the Mac, the cloud checks, and the pictures `v050-*.png`.
- **v0.5.1's** is in its `STATUS.md` entry ("2026-11-13, 10:55 KST"): 722 unit tests, `tests/cloud/v051-hangar.cjs` and the pictures `v051-hangar-*.jpg`.
- **v0.5.2's** is in its `STATUS.md` entry ("2026-11-14"): 744 unit tests, `tests/cloud/v052-editor.cjs` and `v052-designs.cjs`, and the pictures `v052-*.jpg`.
- **v0.5.3's** is in its `STATUS.md` entries: the run's (from "2026-11-15, 04:04 KST" to "12:42 KST", with the validation table at 04:18) and the review's ("2026-11-15, evening"): 850 unit tests, the run's Chrome checks on the Mac, the cloud checks, and the pictures `v053-*.png`.
- **v0.5.8's** is in its `STATUS.md` entry ("2026-11-19, 01:25 KST").
- **v0.5.7's** is in its `STATUS.md` entry ("2026-11-18, 21:55 KST").
- **v0.5.6's** is in its `STATUS.md` entry ("2026-11-18, 03:35 KST").
- **v0.5.5's** is in its `STATUS.md` entry ("2026-11-18, 00:40 KST"): 890 unit tests and `weight-copy.cjs`.
- **v0.5.4's** is in its `STATUS.md` entry ("2026-11-16, 02:05 KST"): 885 unit tests, the cloud checks, and the anchors of the new landing score (`tests/score.test.mjs`).
- **v0.4.4's** is in its `STATUS.md` entry ("2026-11-13, 03:15 KST").
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

### v0.5.8: the last touches before v0.6.0

| File | What's there |
|---|---|
| `src/sim/sim.js`, `src/sim/fbw.js`, `src/sim/fbw-boeing.js` | `E.nThrust` (the engines' own yaw moment, 0 for symmetric thrust); `asymmetryInto()`: the sideslip and yaw rate the asymmetry explains, which the yaw damper and turn coordination leave alone; the Boeings' hands-off roll and the wheel's rate drifting with the sideslip's dihedral effect, fading out by 34°. |
| `src/designs-store.js`, `src/ui/logbook.js`, `src/ui/home-card.js`, `src/ui/setup.js`, `src/ui/menu.js`, `src/main.js` | `designName(id, stored)`, `store.names()`, `store.nameOf()`; `designIdOf()`, `designLabel()`; `flightCard(entry, { place, designName })`; the Load list's rows; `designNameNow()`, the saves and log entries with the live name, `renamedState`. |
| `src/ui/home-scene.js`, `src/ui/home.css` | `groundLineUp()`, the suitcase's spot, `PRINT`, `PRINT_SLOTS`, `PRINT_SIZES`, `printSpots()`, `printOverlap()`, the stars (`TWINKLE`), the aurora's curtains. |
| `assets/menu/b777-landing-day.jpg`, `b787-cruise-night.jpg`, `a321-pushback-sunset.jpg`, `tests/cloud/v058-photos.cjs` | The prints, rendered from the game with a free camera (posed stills; the script makes them again). |
| New tests | `thrust-asymmetry`, `design-names` (node), `home-scene` grew; `tests/cloud/v058-home.cjs`, `v058-rename.cjs`, `v058-photos.cjs`; `designs.test.mjs`'s pylon test now holds the sideslip and bank with rudder and wheel. |

### v0.5.7: the key block and the home page

| File | What's there |
|---|---|
| `src/keys.js` | `BINDINGS` (every control global now, in the Controls page's sections), `BLOCK` (the warehouse's 16 keys) with `BLOCK_TEXT` and the refusals' wording, `RESERVED` (Esc, \\, Tab, \`, Return, Backspace, Delete, F5/F11/F12), the store v3 `{ v: 3, global: { bind }, aircraft: { <scope>: { engines, drop } } }` with the v2 migration, refusals both ways, the engine and Drop keys per aircraft, `engineSlots(def)` (a design's engine parts in the sim's engine order, by `geo.NACELLES[i].part`), `keysFrom()`. |
| `src/input.js`, `src/main.js` | The single-lever path untouched until an engine's own key parts the levers; then R and F move every lever and an engine's keys its own (each with its detents; its down key at idle on the ground its reverse); `input.engineTook` (a Boeing's A/T disconnects; `groupTook` an alias); `applyKeys()`, the \\ and Cmd/Ctrl+L handler, key names in text read from the bindings. |
| `src/ui/menu.js` (`createControlsPage()`), `src/ui/keyboard-map.js`, `src/ui/menu.css` | The Controls page: 36 controls in seven sections, keycaps to click, the keyboard drawing (`ROWS`/`layout()` data, `toneOf()`, `keyTip()`, `renderKeyboard()`, lit rows; `controlsPage.board` for checks). |
| `src/ui/warehouse.js` | The keys tab: an engine's own up and down keycaps (one engine at a time, block keys only), a wing tank's Drop key, the airframe parts' note pointing to the Controls page, the stock editor (engines only), Clear them; keys copied with a duplicate and dropped with a delete or discard; `window.__wh.selectPart(id)` for checks. |
| `src/ui/home-scene.js`, `src/ui/home-card.js`, `src/ui/home.css`, `src/ui/menu.js` (`createMenu()`) | The home page: the path, the plane and the dashes (pure geometry and timing, tested), the floaters, the skyline tape, the three backgrounds (`window.__fs.menu.setBackdrop(name)`, `?backdrop=` in the URL), stopping when hidden or covered; the card's text from the summary (`flightCard()` in `home-card.js`, with `readFlight()`, `parseWhere()` for older saves, `shortPlace()`), place names from main.js. The scene's tunables: `PLANE`, `DASH`, `FPS`, `TAPE_PX_S`, `DEFAULT_BACKDROP` in `home-scene.js`. |
| `src/ui/line-art.js` | `SKYLINE` (3935 × 220, baseline 212, 22 landmarks with `landmarks: [{ name, x0, x1 }]`, seamless) and `ICONS` (`planeTop`, `planeSide`, `boardingPass`, `suitcase`), all stroke-only path data built by helper functions at import (about 20 ms). |
| `src/scenarios.js` | `flightFields()`, `altText()`, `PHASES`: the summary's phase, origin, dest, at, stand, alt, distNm and landed for the card, kept by `create()`/`write()`. |
| New tests | `keyboard-map`, `line-art`, `home-card`, `home-scene` (node), `keys` and `warehouse-keytab` rewritten; `tests/cloud/v057-home.cjs`, `v057-line-art.cjs`; `v056-keys.cjs` and `v056-groups.cjs` updated in place to the block; `tests/dev-line-art.html`. |

### v0.5.6: keys, and the warehouse's leftovers

| File | What's there |
|---|---|
| `src/keys.js`, `src/input.js`, `src/ui/menu.js`, `src/ui/warehouse.js`, `src/main.js`, `src/ground/gate-flow.js` | The bindings: `BINDINGS` (each part control with its `part`), the store `{ v: 2, global, scopes }` (the global keys; the parts' per `type:<id>`/`design:<id>`, a design falling back to its base type; v0.5.6's first shape read leniently), conflicts (a taken key moves within an aircraft; the global and part sides refuse each other's), reserved keys (Esc, L, the browser's), engine groups (by engine index); `input.js` builds its maps from them and moves one lever per engine for a group; the Controls page edits the global keys; the warehouse's part tabs (keycaps) the parts', with a keys-only editor for the three types; `main.js` applies the flown aircraft's on a flight's start and on a change, disconnects a Boeing's A/T when a group's key takes the levers (`groupTakesAthr()`), and gives the pushback's messages the bound keys (`gate.setKeyNames()`); `window.__fs.setKeys()` for checks. |
| `src/sim/sim.js` | `controls.thrustEng` (null, or one lever per engine) through the engine loop, the A/THR (driving, it brings them together), idle/speedbrake/ground spoilers by the highest lever, reverse by any; `state.engines[i].leverN1`; snapshot/restore; `previewControls()`; `takeoffThs()`: moments about the main wheels at the base's lift-off speed, discounting what the airframe moves. |
| `src/sim/parts-aero.js`, `src/sim/parts-aero-cal.js` | A strip's area: chord × width across the span; the calibration refitted (`tools/fit-parts-aero.mjs`); the wing strips shifted by `wingX`. |
| `src/sim/designs.js`, `src/sim/airframe-map.js`, `src/aircraft.js`, `src/widebody.js`, `src/ground/taxi.js` | `applyAirframeGeo()`, `mainX0()`, `tailAngle()`, `noseShare()`, `stationRange()`: the main legs where the stock legs are relative to the wing; `airframe.wingX` (−3 to +3 m; the wing's map, strips, structure, fuel and gear together); `vmcKt`, `vmcAllKt`, `vrKt` in `designNumbers()`; the models' legs, braces and the A321's belly fairing; stands by the wheelbase too. |
| `src/engine-model.js`, `src/audio/synth.js`, `src/ui/engine-row.js`, `src/ui/engines-panel.js`, `src/ui/boeing/eicas.js` | `podDropper(B)(dropped, t)`: the tanks fall in the aircraft's frame on sim time, hidden after 3.5 s; the release clunk on the flag's change in flight; `DROP_MEMO` for 20 s; `ringN1()`: each engine's ring. |
| `src/ui/warehouse.js` | The keys on a part in hand, the drag from the palette, the wing's Position slider, the VMC rows. |
| New tests | `keys`, `takeoff-trim`, `vmc`, `gear-follows-wing`, `wing-position`, `v056-tanks-fx`, `warehouse-v056`, `warehouse-keytab` (node); `tests/cloud/v056-editor.cjs`, `v056-groups.cjs`, `v056-keys.cjs`. |

### v0.5.5: Shane's list after v0.5.4

| File | What's there |
|---|---|
| `src/main.js`, `index.html`, `src/input.js`, `src/ui/hud.js`, `src/ui/menu.js` | `setMenu()`/`menuOpen` (the Esc menu, modal for the keys, the flight running under it; saves on opening); `setPaused()` (the HUD's button, a hidden page, the setup and menus); `pausedKick()`/`pausedFrame()` (a frame after any input while paused; the levers while R or F is held: `input.leverHeld()`, `input.updateLever()`); toasts for gear, flaps and speedbrake set while paused. |
| `src/sim/sim.js` | `previewControls()`: the lever's detent and N1 target, the flap lever's configuration, the parking brake and law into the state, nothing integrated; `step()` never calls it. |
| `src/score.js`, `src/ui/score-panel.js`, `src/ui/logbook.css` | `shareOut()`, `rowPoints()` (points out of shares of 100), the penalty rows (`kind: 'penalty'`, `minus`), `bounceTracker()` (a hop of 0.15 m, or 0.03 m for 0.2 s, within 8 s of an arrival); the card's three formats (penalties before v0.5.4, scores out of 10 in v0.5.4, shares from v0.5.5). |

### v0.5.4: Shane's list after v0.5.3

No brief: Shane's list (2026-11-16) built by the Cowork session with five subagents, each owning its files. `STATUS.md`'s 2026-11-16 entry has the checks.

| File | What's there |
|---|---|
| `src/ui/hud.js`, `src/ui/ui.css`, `src/main.js` | The Pause button (`.fsui-pause-btn` in `panelsBox`; `hud.setPause(paused, available)`, `hud.onpause`); `syncPauseBtn()`; Esc from a quiet pause opens the menu (`setPaused(paused && ui.pause.hidden ? true : !paused)`); the menu's Weight and fuel and Time of day keep the game paused quietly; `dropWingTanks()` and the Weight tab's `tanks`; `summary.designId` in saves. |
| `src/scenarios.js`, `src/designs-store.js`, `src/ui/menu.js` | `renameDesign(id, name)`, `renamedState()`, `stateDesignId()`; `onDesignRename()` (a saved design's name changed, by Rename or the editor's Save) → `scenarios.renameDesign()`. |
| `src/score.js`, `src/ui/score-panel.js`, `src/ui/logbook.css` | `RATE` ([k, weight] per part), `scoreFor()`, `CAP` (taxiway, would-be crash 10; grass 49), `WORST_CAP` (50 + 10 × the worst part's score); `sharePoints(parts, points, by)`; the card's bars filled to score/10 (old entries' from their penalties); the verdict by the lowest score. |
| `src/sim/parts-aero.js`, `src/sim/airframe-map.js` | `normalMach` (each side's cos Λ against the base's, by the quarter chord) in the strips' CLmax with Mach (`clmaxMachOf()`); the tails scaled about their roots' trailing edges in `shapeOf()`, `tail()` and `fin()` (a factor of 1 exactly the base's). |
| `src/sim/designs.js`, `src/sim/sim.js` | `D.DROP_TANKS` (the pods' fuel, the centre tank's own, the centre fuel's CG without them, their empty masses), the pods' drag `pod: true`, `D.MMO` by Korn from the mean sweep (0.70–0.95), `designNumbers().mmo`; `sim.dropTanks()`, `X.tanksDropped` (saved, rewound, predicted), `fuelMax()`. |
| `src/ui/warehouse.js` | `nudgeOf()`, `nudgePart()`, `nudgeHelp()`, `NUDGE_KEYS`; `engineAxes()` (a turned engine's pick box and outline); the MMO row when the sweep moves it. |
| `src/aircraft.js`, `src/engine-model.js`, `src/ui/hangar.js` | The A321's inner flap re-clamped behind its leg on a changed airframe; `podDropper()` (the pods and pylons hidden while `tanksDropped`); the hangar's doors shut, the apron gone. |
| New tests | `scenarios-rename`, `sweep-mach`, `drop-tanks`, `tail-pivot`, `warehouse-keys`, `v054-models` (node); `tests/cloud/weight-copy.cjs` checks the Pause button. |

### v0.5.3: the airframe from parts

`V053.md` was the brief; `PLAN.md` → "The airframe from parts (v0.5.3)" has the design, and `STATUS.md`'s 04:18 KST entry the validation table.

| File | What's there |
|---|---|
| `src/sim/parts-aero.js` | `baseShape()` (each type's wing, tailplane, fin and fuselage as planforms from its geometry), `shapeOf()` (a design's: `wingSide()`, the tails scaled, the plugs, `SHARKLET_AR`), `partsModel()` (the strips, memoized by the airframe), `partsInto()` (the coefficients for a state: two passes over the wing, the tail in the lagged downwash, the fin in the sidewash, the fuselage), `partsDeltaInto()` (`lumped + parts(design) − parts(base)`), `clmaxDelta()` and `wingClmax()` (the speeds), `partsNumbers()`. Pure, allocation-free per call; the prediction worker builds its own. |
| `src/sim/parts-aero-cal.js`, `tools/fit-parts-aero.mjs`, `tests/parts-aero-table.mjs` | The calibration: one physical factor per row, written by the fit (`--print` prints the table); the rows' tolerances and envelopes. |
| `src/sim/airframe-map.js` | `airframeMap(base, af)`: `wing(side, x, y, z)`, `tail()`, `fin()`, `bodyX()`, `bodyXBase()`, `wingBase()`, `wingStation()`, `tipY`, `span`; `plugCuts()` (the plugs 1 m clear of the wing's root). The model, the mounts, the strips and the warehouse's outline go through it. |
| `src/sim/designs.js` | `AIRFRAME_RANGES`, `defaultAirframe()`, `fixAirframe()`, `isBaseAirframe()`, `HAS_SHARKLETS()`; the mounts on the design's airframe (`airframe(base, af)`, `designAirframe()`, `designSketch()`); in `designDef()`: `geo.AIRFRAME`, `geo.DESIGN_SHAPE`, the moved points, `airframeMasses()`, the wing's fuel, `PARTS_AERO`, `GAIN_SCALE` (`gainScale()`), `AIRFRAME_CG_SHIFT`, `scoreBand()`; `designNumbers(def).airframe` (static margin, Cnβ, stall and approach speeds, tail strike, `noseLoad`, `noseLoadThrust`, the code letter) and `touchesGround`. |
| `src/sim/sim.js` | `partsDeltaInto()` after `coefficients()` in `step()` and `trimAirborne()`; `clAil`, `clSp` (the roll powers with the parts'); `kL` from `clmaxDelta()` for the protections' and the tape's speeds; `takeoffThs()` for a design's own tail (the types keep `takeoffThs0()`). |
| `src/sim/fbw.js`, `fbw-boeing.js`, `autopilot-boeing.js` | `gainFor()`: `K_YAW` (the yaw damper, the turn coordination, the autoland's alignment) and `K_PITCH` (the ground mode's direct pitch), exactly 1 without `GAIN_SCALE`. |
| `src/aircraft.js`, `src/livery.js` | `mapGeometry()` through the design's maps (normals by the Jacobian), applied after the UVs; the fuselage lofted over the design's stations with whole window bays; the sharklets off. |
| `src/widebody.js` | `AirframeBuilder` (maps every vertex, the bend's `bendY` its base span), `plugPlan()` (texture seams and whole window pitches), the belly fairing with the root's chord, the inboard flap behind the leg. |
| `src/ui/warehouse.js` | `AIRFRAME_ON`; `pickAirframe()`, `editAirframe()`, the airframe panel (sliders, Mirror, As the base, Done, Sharklets), the green outline while a slider moves, the warnings held still mid-drag; `readout()`'s airframe rows and `canFly`; the keys kept after a re-render; a lost pointer capture waits for the release. |
| `src/ground/taxi.js`, `gate-flow.js`, `src/main.js`, `src/ui/setup.js` | `standGeo()` (the design's own span and length for stands), `geoNow()`, `standClear()`; New scenario's Fly off for a design that touches the ground standing. |
| New tests | `parts-aero`, `designs-airframe`, `designs-airframe-flight`, `aircraft-airframe`, `widebody-airframe`, `warehouse-airframe`, `stands-airframe`, `sharklets` (node); `browser-airframe`, `browser-warehouse-airframe`, `browser-warehouse-limits`, `browser-widebody-airframe`, `browser-stands-airframe`, `browser-sharklets` (Chrome on the Mac); `browser-designs` and `browser-warehouse` brought up to date. |

### v0.5.2: parts anywhere

| File | What's there |
|---|---|
| `src/sim/designs.js` | A design is `v: 2` with `parts` (engines, tanks, ballast; mirror twins by `pair`). `normalizeDesign()` migrates v0.5.0's fields exactly (and an old caller's `{ ...design, count }` still rebuilds the engines from them). `addPart()`, `updatePart()` (the twin follows the shared fields; a part moved to the tail loses its twin), `removePart()`, `setMirror()`. `airframe(base)` (the mounts' sketch of the wing and fuselage), `mountRange()`, `placeEngine()`, `placeTank()`, `placeBallast()`. `buildGeo()`: `NACELLES` with each part's id and mount, `THRUST_DIRS`, `PODS`, tank-strike crash points; the base's exact geometry when the engines are its own (`baseEngines()`). `buildData()`: `ENGINE_DATA` (mixed engines), `ENGINE_MASSES`, `DRAG_PARTS`, the tanks' fuel; v0.5.0's pylon scatter key for designs v0.5.0 could have made (`v1Shape()`). `def.sounds` for mixed types. |
| `src/sim/sim.js` | `bindKit()`: an engine kit per `ENGINE_DATA` entry (cached by the frozen object); the engine loop steps each with its own; `DRAG_PARTS` against the airflow with their moments (before `fAeroX`); the thrust along `THRUST_DIRS` with full moments (straight thrust takes the old exact path); `ENGINE_MASSES` in `massPropsDesign()`. |
| `src/engine-model.js` | `addEngine()`: a turned engine through one rotation about its centre (its fan's axis too); `overwingPylon()`, `bodyPylon()` (the body's half-width from `host.bodyHalf`); `addPod()` for a wing tank (bone `pod<k>`, its span as the bend on the Boeings). |
| `src/ui/warehouse.js` | The editor: `PALETTE`, the view's hooks (`down` claims a press on a part, `move`, `up`, `hover`, `click`, `cancel`, `leave`), the overlay (`setOverlay()`: ghosts, selection lines, the hold's parts, the CoM and CoT, drawn without depth test), `project()`, the camera's view offset for the palette; pure: `readout()`, `thrustLine()`, `editDesign()`, `editPart()`, `placement()`, `hitAirframe()`, `partBox()`, `partBoxes()`, `rayBox()`, `pickPart()`, `createHistory()`, `viewKey()` (the parts it draws, not thrust or the hold). `window.__wh` is the page, `window.__fsw` the view. Fly it calls `api.onfly`. |
| `src/audio/synth.js` | `SNDS` (`def.sounds`): each engine's spec in `update()`, and its waveforms (`wavesOf()`, `applyWaves()`). |
| `tests/designs-parts.test.mjs`, `tests/warehouse.test.mjs`, `tests/designs-flight.test.mjs`, `tests/audio-engines.test.mjs` | The parts' API, mounts, data and sim effects; the editor's pure parts; two parts designs flown; mixed engines' voices. |
| `tests/cloud/v052-editor.cjs`, `v052-designs.cjs` | The editor's flows from the cloud (attach, select, drag, undo, delete, checks, Save, Fly it); three parts designs in the game. |

### v0.5.1: the hangar

| File | What's there |
|---|---|
| `src/ui/hangar.js` | `HANGAR` (the room's size), `cameraBox(floorY)`, `rayExit(p, u, box)`, `walkPath(s)` and `WALK_LENGTH` (pure, node-tested in `tests/hangar.test.mjs`); `createHangar(THREE, { maxAnisotropy })` → `{ group, update(tSec), dispose() }`: an `Acc` per material merges boxes, beams, cylinders and quads (struct, clad, floor, mark, hatch, decal, glow, out); canvas textures for the cladding, the epoxy floor, the hatching and a 2048 × 1024 atlas of signs and floor lettering; `createPeople()` as five instanced meshes. Three.js frame as the models': x right, y up, z aft; the floor y = 0 in the group. |
| `src/ui/warehouse.js` | `createView()`: the hangar at the design's wheels, its lights, the camera clamped with `rayExit()`, the 30 fps loop (`ANIM_MS`) only while shown, `setAnimate()`, `busy` = a rebuild pending; `window.__fsw` is the open view, for checks. |
| `tests/cloud/v051-hangar.cjs` | Each type in the editor from the cloud: pictures from several views, draw calls, the people moving and holding still, nothing running after Back. |

### v0.5.0: the parts model and the warehouse

`V050.md` was the brief; `PLAN.md` → "The parts model and the warehouse (v0.5.0)" has the design.

| Where | What |
|---|---|
| `src/sim/designs.js` | A design's shape, `normalizeDesign()` (the ranges), `newDesign(base)` (its base exactly), `designDef()` (memoized: a type entry with the base's id and family and the design's data and geometry), `resolveDef()` (a type id or a design), `stationRange()`, `designNumbers()` (the warehouse's numbers and issues), the pylons' limits (`PYLON_LIMITS_N`, 0 to 10 % over 1.5 × rated, seeded by the parts). |
| `src/sim/engine-types.js` | The LEAP-1A, GEnx-1B and GE90-115B as parts: each one's numbers from its aircraft's data module (`ENGINE_KEYS`), its nacelle, its dry and installed weights (installed = 1.45 × dry [EST]), `pylonLimitN()`. |
| `src/sim/sim.js` | The engines as five arrays in the core (`ENGINE_FIELDS`: `eN1`, `eN1t`, `eRev`, `eThr`, `eFf`) stepped in one loop in the old order; `migrateEngines()` for a v0.4.4 save; `createSim({ type })` and `setType()` take a design; `snapshot().design`; the `engineOff` event; `massPropsDesign()`. Engine order: 1 is the left outboard, then inboard, the tail, and the right wing out. |
| `src/engine-model.js` | One engine builder for all three aircraft (each engine type's look, moved here unchanged from `aircraft.js` and `widebody.js`), a bone per engine (so one torn off hides with its pylon), the tail engine, `bendY` per station; `createAircraft({ def })` and `createWidebody(spec, { def })` take a design's geometry (longer legs by `GEAR_EXTEND_M`, its registration). |
| `src/ui/engine-row.js`, `src/ui/engines-panel.js`, `src/ui/boeing/eicas.js` | Any number of engines on the A321's panel and the Boeings' EICAS; an engine off in amber. Two draw exactly as before. |
| `src/audio/synth.js` | A voice per engine (up to six, `MAX_ENGINES`), panned by its y; a twin exactly as before. |
| `src/designs-store.js`, `src/ui/warehouse.js`, `src/ui/warehouse.css`, `src/ui/menu.js` | The designs under `gamedump:flight-sim:designs`; the Warehouse page (the list, the editor, the 3D view drawn on demand); `WAREHOUSE_ON`. |
| `src/main.js`, `src/scenarios.js`, `src/ui/setup.js`, `src/ui/logbook.js` | `useType()` takes a design; a design's model built per flight; a scenario keeps its own copy of its design; the picker's design cards; the logbook's design and engines; `?design=<json>`. |
| `tests/golden-boeing-flight.mjs`, `tests/fixtures/golden-b787-9.json.gz`, `golden-b777-300er.json.gz` | The Boeings' golden flights (v0.4.4's code, recorded with macOS's node); `goldenWorst()` compares them to 1e-9 of the value above 1 (see "Pitfalls"). |
| `tests/designs*.test.mjs`, `engines-list`, `warehouse`, `engine-row`, `audio-engines`; `browser-designs.mjs`, `browser-warehouse.mjs` | The run's tests: a design's round trip, the prediction, asymmetric thrust, mass properties, designs flown by the test pilot, the store, the warehouse, the screens, the voices; in Chrome on the Mac, the designs in the game and the warehouse. |

### v0.4.4: small things before v0.5.0

| Where | What |
|---|---|
| `src/ui/hud.js`, `src/ui/ui.css` | `panelsBox`: Hide panels / Show panels at the top left, the view switch's twin; hides the PFD, ND and engine panel (not drawn while hidden), kept as `hidePanels` in `gamedump:flight-sim:settings`. `placeViews()` places both corners and the side panels: the view switch beside the FCU, compact, then a smaller font (to 72 %), then just under the top row (`under`); the side panels start under their corner's switch. The `low` class (the bottom centre) is gone. |
| `src/world/sky.js` | `aurora()`: the curtain's azimuth `w` sways (monotonic in az), ripples on the lower edge, the folds' noise moves in time, the arcs breathe (`tall`, `glow`), and the arc factor never drops below 0.25. |
| `src/widebody-specs.js` | `mainPivotZ` 0.45 m higher on both Boeings (787 −0.80, 777 −1.30): folded, the main leg lies inside the wing and its door closes about flush; extended, nothing changes below the wing. |
| `src/sim/types.js` | The A321's setup limits: `OEW` and `FUEL_MAX` from `sim/a321neo.js` (50,500 and 18,510 kg). |
| `tests/cloud/v044-hud.cjs`, `tests/cloud/v044-aurora.cjs` | New: the switch and the panels switch for two types at three window sizes, through a reload; the aurora over time, then and now (the shader's clock pinned per frame). |

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

**How Update 5's session worked** (v0.5.4 to v0.5.8, 2026-11-16 to 19), which worked well and fast:

- **A working copy in the cloud container** (`/tmp/fs/gd/games/flight-sim`, outside GameDump): the quickest way to get one is to `git clone` the public repository there (git is fine outside GameDump) and check it against the Mac with the tree hash below; anything not pushed yet is staged from the Mac on top. The container's files can vanish between turns: check before trusting them.
- **The tree hash,** run the same on both sides (in the game folder): `find . -type f ! -path './reference/*' ! -path './.git/*' ! -name '.DS_Store' ! -path '*/__pycache__/*' -print0 | sort -z | xargs -0 sha256sum | sha256sum`. Equal hashes close every sync.
- **Edit and test in the container,** then sync in one batch at the end (Shane plays while you work): copy the changed and new files to a fresh folder under `/mnt/user-data/outputs/`, read each Mac file's mtime in the device shell as `int(os.stat(f).st_mtime * 1000)` (the tool compares whole milliseconds), and `device_commit_files` them with that `expectedMtimeMs`, at most 50 a call. The outputs folder re-encodes JPEGs (the same pixels, different bytes): copy them back from there into the container before you compare the hashes.
- **Cloud checks:** serve the copy with `python3 tests/cloud/serve.py /tmp/fs/gd 8765 &` (from `/tmp/fs/gd`), then `NODE_PATH=/opt/node-tools/node_modules timeout 900 node tests/cloud/<name>.cjs <outdir>`, one at a time (2 cores; SwiftShader takes about 30 s to start a flight). The server dies with the container: `curl` it first.
- **Subagents,** each owning its files (shared files edited with the Edit tool only), for the parts of a version that don't touch each other, then an independent reviewer for anything with logic in it (v0.5.6's and v0.5.7's found real bugs). Shane has been fine with it ("You can run subagents if you would like").


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

- **Golden flights recorded with one build of node can miss 1e-9 absolute on another** (v0.5.0): the Boeings' were recorded by the run with macOS's node, and Linux's (the Mac's VM, the cloud) flies them to roundoff only, the thrust in newtons then about 2e-9 apart. Compare to 1e-9 of the value above 1 (`goldenWorst()`); record new goldens where they will be checked, or compare the same way.
- **The cloud's upload folder keeps files staged by earlier sessions** (`/mnt/user-data/uploads/GameDump/...`): copy out only the files you just staged (by name), never the whole folder, or stale copies overwrite newer ones. Then compare the two trees' hashes.
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

- **How he plays and reports:** in the GameDump desktop app on his M5 MacBook (Cmd+Shift+R reloads after a push; it used to be Chrome from his own server, `python3 -m http.server 8001` in GameDump, which still works). He reports from playing, often with a screenshot, and often gives a time to finish in ("about 60 minutes", "about 20 minutes"): keep to it, and say what you dropped.
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
  - the keys (v0.5.7): the warehouse's block 7–0, U–P, J–;, M–/ (and Shift with them) is each aircraft's own, set in the warehouse; everything else is on the Controls page, the same for every aircraft; a key pressed more than once a flight in the air needs no Shift (Shane's rule). The defaults: W/S, A/D, Q/E, R/F, H/Y the Boeings' trim, − and = the flaps a step, C and Shift+C, G, Space, B, Z, X, Shift+T TO/GA, Shift+B the local QNH, 1, 2, 3 and V the views, [ and ] time, T rewind, N the map, Shift+G pushback, F3 the readout; \\ the Sky window (with Cmd/Ctrl+L), Esc the menu; \` Tab Caps Lock Return delete and the Shifts can't be keys;
  - the CPU rules (`tools/cpu-guard.py`);
  - no Ctrl key bindings (Cmd/Ctrl+L the only one);
  - no network at runtime;
  - the repository is public: no third-party PDFs or images, no paths with a user name, no real airline's branding;
  - the Nuclear Airlines livery;
  - each version its own commit, for a consistent history (Shane, 2026-11-18): v0.5.5 was pushed on its own after v0.5.6 was built, by putting the folder back to v0.5.5's exact files for the push.

## Starting a new chat

A first message that works, in the Games project with the GameDump folder connected:

> Read games/flight-sim/HANDOFF.md in my GameDump folder, then its AGENTS.md, ROADMAP.md's "The long term" and the newest entries in its STATUS.md. Then take v0.6.0, East Asia, from start to finish, as HANDOFF.md's first section says: plan it with me carefully first (the questions, then V060.md for me to read), and only then get it built.

For a later update, the last line names that update instead.
