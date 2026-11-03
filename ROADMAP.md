# Roadmap

These are the future additions after the first build. They were saved on 2026-10-31 at Shane's request: "Record all the potential future additions in a separate md file like how Satisfactory has it."

The plan itself, with Shane's answers word for word, is in `PLAN.md` here, and in the Games project doc `claude/flight-sim-prototype.md`. Keep this file current: when something ships, mark it **Done** in its table with the version and date, and log the details in the project doc.

## The first build (agreed 2026-10-31: "Yes, functional")

| Milestone | What | Done |
|---|---|---|
| M1 | The first playable build, enough for a full Gimpo to Jeju flight, runway to runway: the A321neo with realistic physics (stall, flap and gear drag, spool-up, brakes, reverse thrust, fuel weight) and fly-by-wire; the 1st-person (nose) and 3rd-person (orbit) views and both seats, with a simple cockpit; the PFD, ND, engine panel and FCU; the holds-only autopilot and autothrust; 16× time compression, the path map with jumps, and skip to final; terrain for the whole map with the real coastline and elevation, procedural trees, farm plots and city blocks; Gimpo and Jeju with their runways; runway starts; the callouts, RETARD included; rewind after a crash. | **Done** in v0.1.0, 2026-10-31 04:43 KST (overnight run; evidence in `STATUS.md`) |
| M2 | The three airports in full: Incheon added; taxiways, aprons, numbered gates and terminals; gate starts with pushback and taxi routes; parked aircraft and moving vehicles. | **Done** in v0.1.0, 2026-10-31 06:19 KST (overnight run; evidence in `STATUS.md`) |
| M3 | Engine and environment sound, the landing score and logbook, polish. | **Done** in v0.1.0, 2026-10-31 06:19 KST: sound synthesised and measured offline (not yet listened to), landing score card, logbook, world polish |

Found in M1–M3 and left for later:

- **Gimpo stand 7** had no taxi route to 14L/32R: **fixed in v0.1.4** (2026-11-01). It had none to any runway: its pushback ended on a piece of taxi line that passes 14 m from the network without meeting it. Pieces like that are joined now (`bridgeIslands()` in `src/ground/taxi.js`).
- **Pushback speed:** about 100 s at 1.5 m/s (measured in v0.1.4: a median of 60–70 s at the three airports, up to 170 s): **done in v0.1.4** (2026-11-01). = speeds a pushback up to 4×, and the tug keeps its real speed.
- **The synth's sound hasn't been listened to.** Its levels are measured (`tests/audio-render.mjs`), but the engine timbre needs a real listen.
- **The landing score:** **fixed in v0.1.1** (2026-10-31). It used to measure a touchdown that wasn't on a runway against the runway picked in setup, and none of its penalties had a ceiling. Shane's first flight (Gimpo to Incheon) scored 0/100; which of the two caused it wasn't confirmed, and both are fixed.

Found after v0.1.0:

- **Incheon's taxiways flickered** where concrete taxilanes overlapped asphalt taxiways: **fixed in v0.1.1** (2026-10-31), with the faint gaps on the outside of taxiway bends.
- **The cockpit windows looked strange**, and from the seats the side post crossed the view ahead: **fixed in v0.1.1** (2026-10-31), redrawn after the A320 family's.
- **From outside, the windshield was taller than the side windows** (Shane: "it should be thinner than the side windows"): **fixed in v0.1.2** (2026-10-31), with the nose's crown cut down over the windshield.
- **The engines sat up against the wing, like a 737 MAX's**: **fixed in v0.1.2** (2026-10-31), hung at the A321neo's 0.45 m ground clearance under a wing raised 0.3 m.
- **Touching the grass just short of the runway crashed the aircraft**: **fixed in v0.1.2** (2026-10-31). A gentle touchdown on grass is fine; a hard one, or a fast run of more than 450 m across it, still ends the flight.
- **The landing score was too lenient** (Shane: 100/100 "for a landing that was ok but had obvious flaws"): **reworked in v0.1.3** (2026-10-31). No free bands, the approach counts, and his landing now scores 80; 100 and 0 are both nearly out of reach.
- **Jeju 31's glideslope and localizer** on the PFD were measured from 411 m past its displaced threshold (the displacement was applied twice): **fixed in v0.1.3** (2026-10-31).
- **Jeju's crossing runways** (07/25 and 13/31) are each drawn at their own end elevations. Where they cross, those differ by about 1 m, so each cuts through the other along a diagonal seam. **Fixed in v0.1.4** (2026-11-01): the longer runway (07/25) is drawn whole through the crossing, and 13/31 bends to meet it at its edges and is cut away there (`runwayCrossings()` in `src/world/runways.js`). The seam was the smaller part of it: near the crossing the ground under 07/25 followed 13/31's slope, up to 0.69 m below 07/25's surface. Now the ground on every runway is that runway's surface.
- **The FCU's heading won't change** (Shane, 2026-11-01: "I can't change the autopilot's heading from 066, for example."). **Fixed in v0.1.4** (2026-11-01). Reproduced in the game: the knob did turn when scrolled, but 1° per 25 px of trackpad scrolling, and nothing on screen said it could; 066 is Jeju 07's course, which the FCU takes on a 15 nm final start or a skip to final. Now a click opens the window for typing a value, scrolling turns it a step per 12 px, and a flick turns it in big steps.
- **A point on the path can't be picked for a jump** (Shane, 2026-11-01: "I can't select a point on the path we are given."). **Fixed in v0.1.4** (2026-11-01). In the game a click on one of the path's dots did offer the jump, but a click between dots (5 s of flight apart, far apart when zoomed in) didn't, and the magenta line never does. Now a click anywhere on the bright path picks its nearest point, and a click on the magenta line says why it doesn't jump.
- **Why the checks missed both:** `tests/browser-ui.mjs` scrolled the FCU and confirmed a jump on a mock page (`tests/dev-ui.html`) with mouse-wheel notches, and the end-to-end flight set its heading and jumped through test hooks. Neither went through the game itself with a trackpad.

Found after v0.2.0:

- **Taxiways clipping the runways** (Shane, 2026-11-03: "Some taxiways at Jeju airport still clip strangely with the runway."). **Fixed in v0.2.1** (2026-11-03).
  - The cause: OSM's taxiway lines end on the runway's centreline, so every taxiway ran half across the runway it joins. Its pavement lay 8 cm above the runway, which won only from high enough: from the cockpit or a low orbit, the taxiway's asphalt was drawn over the runway in jagged patches. It was the same at Gimpo and Incheon.
  - Now the pavement stops at the runway's drawn edge (`clipSoupOutside()` in `src/world/apron-geom.js`), and the taxiway centrelines carry on across the runway as lead-on and lead-off lines lying on its surface.
  - Also found: long flat taxiway triangles dipped under curving ground, by up to 0.58 m on Jeju's parallel taxiway P, so the terrain showed through. They're split where they'd stray from it now (`refineSoup()`).
- **A waypoint dragged onto the magenta line never showed in flight** (found while building v0.2.1; there since v0.1.0). **Fixed in v0.2.1**. The map kept it, but the map, the ND and the distance read the setup's waypoints, so the line stayed straight.
- **Switching views** (Shane, 2026-11-03: "Have an easy way to transfer between a cockpit view, a nose view, and a third person view, maybe a switch somewhere."). **Done in v0.2.1**: a switch at the top right, and 1, 2 and 3.
- **Steering the camera with one finger** (Shane, 2026-11-03: "For steering the camera, I have to use two finders, but I am not used to that, so change it to clicking and dragging with one finger."). **Done in v0.2.1**: press and drag on the view. The two-finger swipe still works too.
- **More stars** (Shane, 2026-11-03: "Add some more stars to the night sky."). **Done in v0.2.1**: the fill of stars past the catalogue's 6.5 is brighter and denser, and the catalogue's faint stars are brighter; a bright Moon washes the faint ones out.


## Future additions Shane named (2026-10-31)

| Addition | In Shane's words | Notes |
|---|---|---|
| Autopilot: route following, planned climb and descent, ILS capture | "b will be hard to detail, so just a for now. Add b and c later." | Once it follows a route, the map's bright predicted path bends with the route instead of running straight along the selected heading. |
| Autopilot: autoland (flare and rollout) | (same answer) | RETARD moves from 20 ft to 10 ft in an autoland. |
| Weather: wind direction and speed, gusts, crosswinds, rain, clouds | "Clear skies for now, and we'll add weather in a future update." | Extended on 2026-11-01 (row 10 below). |
| Challenges and landing replays | "c once weather (wind currents and direction, crosswind, rain) is added." | For example a gusty crosswind at Jeju, an engine failure on take-off, or a night approach (if night exists by then). |
| Air traffic control | "c and d are for future updates." | Text clearances, taxi routes, "cleared to land". Extended on 2026-11-01 (row 7 below). |
| Other aircraft in the air and on the taxiways | (same answer) | Today it's "just me for now in the air", with parked aircraft and moving vehicles on the ground. Extended on 2026-11-01 (row 7 below). |
| More aircraft types | "We can add more later." | The first is the A321neo. Shane named the next ones on 2026-11-01 (row 3 below). |
| More airports | "For now, just have the three" | The other 12 Korean airports with airline service in OurAirports: Gimhae (Busan), Cheongju, Daegu, Gwangju, Muan, Yangyang, Ulsan, Yeosu, Sacheon, Pohang, Gunsan and Wonju. |
| A main menu like Satisfactory's, and scenarios | "I do also want to add a menu screen like Satisfactory, and since I probably don't want to have everything in just one scenario, so let the current scenario be 'Scenario 1', and you can create more and choose where to begin and where to land." (2026-10-31) | Planned for **v0.2.0**, not before (Shane: "Don't make these two changes until its time for v0.2.0 though."). Decided 2026-10-31: a scenario is a save slot holding the whole state ("the saved state including the plane's location, speed, roll, everything, so that when you reload a scenario after doing a another, it is exactly where it was before"), and the menu's backdrop is a still ("I'd say stick with a still picture"). Saves stay in the browser's localStorage: asked on 2026-11-01 whether to keep a copy in the folder too, Shane said "Nah its fine. Keep it browser." **Done in v0.2.0** (2026-11-01, overnight Claude Code run): the main menu over stills rendered from the game, scenarios with the whole state, autosave, Load/rename/delete, one logbook tagged by scenario, Settings and Controls pages; v0.1.x's last flight became "Scenario 1". |

## Future additions Shane named (2026-11-01)

Shane: "Add these to the roadmap." Numbered as he sent them.

| # | Addition | In Shane's words | Notes |
|---|---|---|---|
| 1 | Aircraft customisation: a parts "warehouse" | "Airplane customisation beyond normal; Similar to MSFS, have a 'warehouse' where you can swap out elements like engines for other planes' parts. So, you can attach GE90 engines to an A321, for example." | Each part becomes a module with its own numbers (an engine's thrust, fuel burn, weight, size and sound), which the model, the sim and the synth read. Other types' parts come with those types (row 3). Size matters: a GE90-115B's fan is 3.25 m across, against 1.98 m for the LEAP-1A's, and the A321neo's nacelles clear the ground by 0.45 m, so a GE90 there needs taller gear, or it scrapes. |
| 2 | Leaving the seat on autopilot, and walking the cabin | "When on autopilot, you can get up from your seat in the cockpit, exit through the cockpit door, and go around the cabin. This means creating an interior for our planes: one very big job." | An interior for each type: the cockpit door, galleys, cabin seats, lavatories and doors. A walking mode, in which W/A/S/D walk instead of fly, with collisions, while the autopilot flies. Today's cockpit is `PLAN.md`'s simple one, built only for the view out. |
| 3 | More aircraft: the A330, B737, B747, B777 and B787, with their variants | "Adding other planes like the A330, B737, B747, B777, and B787, and all their variants. Another huge job." | Each type needs its numbers from its type certificate and airport-planning document (the A321neo's method, in `src/sim/a321neo.js`), its own flight model and control laws, a model, a cockpit and sound. The 737 and 747 have conventional controls; the 777 and 787 have Boeing's fly-by-wire, which a pilot can override. The variants multiply all of it. Extends "More aircraft types" above. |
| 4 | Detailed airports: terminals with windows and insides | "Detailed airports. Instead of just gray slabs being the airports, have windows with faintly visible insides. Maybe even be able to walk inside them." | Faint insides can be faked without building rooms: interior mapping, a shader that draws rooms behind the glass, is cheap enough for every terminal. Walking inside needs real interiors and the walking mode (rows 2 and 8). |
| 5 | UI fixes, and a new font | "Fix various UI elements. I can't change the autopilot's heading from 066, for example. Also, I can't select a point on the path we are given. The buttons and fonts for the settings pages are not my favourite. Maybe change the font for the whole game?" | **Done in v0.1.4** (2026-11-01): the heading and the path (see "Found after v0.1.0" above), and new fonts: B612, made for Airbus's cockpit screens, on the screens and the FCU, and Barlow in the menus (both under the SIL Open Font Licence, in `vendor/fonts/`), with darker buttons. More of the UI changes with v0.2.0's menus. |
| 6 | Changing the route in flight | "Allow another path to be reset on command so you aren't stuck with what you started with." And for v0.2.1 (2026-11-03): "Be able to change the route during a flight." | **Done in v0.2.1** (2026-11-03). On the map, Change route (or a click on an airport) picks a new destination and runway, and the magenta line, the ND, the PFD's approach scales, skip to final, the score and the saved scenario follow. Dragged waypoints show in flight now, too (they never did before). The departure can't change once set. |
| 7 | Other aircraft and ATC, without collisions | "Add other planes and ATC, and we have to be deliberately careful not to collide with those planes. This has some feasibility issues, but we will consider them later." | Extends "Air traffic control" and "Other aircraft in the air and on the taxiways" above: traffic in and out of the three airports, ATC that sequences it and you, and collisions with it (with TCAS-style alerts, for example). Feasibility to be weighed later, as Shane said. |
| 8 | Inside the terminals: lounges | "Enter airports and go to lounges." | Shares the terminal interiors and the walking mode with rows 2 and 4. |
| 9 | Engine shutdown, gear-up landings and every emergency | "Be able to shut off engines, land without gear, and simulate virtually every emergency scenario." | Brings in what `PLAN.md`'s decision 3 left out of the first build ("No aircraft systems (hydraulics, electrics, failures)"), and replaces the candidate "Aircraft systems" that was below. Today the fuselage, an engine or a wingtip touching the ground ends the flight, so a gear-up landing needs contact physics for them (row 11). |
| 10 | Every kind of weather, and the night sky | "Add crosswind, rain, snow, thunder, microbursts, and almost every weather event imaginable. Also the night sky, which I sort of what to look like Satisfactory's majestic night sky." | **The night sky goes into v0.2.0** (2026-11-01, Part 2 of `V020.md`, after the menu and scenarios), with the time of day, city lights and the airports lit. Shane: "Should we add the adding the Satisfactory-like night thing to the list as well, with the city gaining point-source lights like looking out from a plane window, with runways appropriate lit up?" Asked whether the sky should be Satisfactory's alien one (its gas giant, cracked planet and dwarf star) or Earth's, he chose Earth's sky in Satisfactory's look: real stars, the Milky Way and one Moon with its phases. The time of day gets an adjustable clock like Satisfactory's Sky window ("Satisfactory has an adjustable clock that can be opened via Cmd+L. Maybe have an adjustable thing similar to that?"). Night replaces the candidate "Time of day and night" that was below. The weather stays here, and extends "Weather" above. **The night sky: done in v0.2.0** (2026-11-01): the KST clock and the Sky window (L, Cmd/Ctrl+L), the real sun, Moon and phase, 8,404 BSC5 stars and the Milky Way, twilight, the light following the sun, city lights, airport and taxiway lights, the A321's lights by phase and the cockpit at night. The weather is still to come. |
| 11 | Crash physics | "Realistic crash physics with thousands of pieces of physics calculations. Right now it is just a popup that says 'you crashed'." | The aircraft breaking into pieces with their own physics (thousands of rigid bodies and bits of debris), with fire and smoke. It has to fit the CPU rules: the 60 fps cap and a budget per frame (`PLAN.md` → CPU at runtime). Rewind and restart stay. |

## Not on Shane's list (candidates; ask him)

- Working screens in the 3D cockpit. Today they're dark, and the working screens are drawn on the sides of the screen.
- Autobrake.
- Finer terrain everywhere, for low sightseeing over Seoul and Jeju.
- Expressways and other major roads from OpenStreetMap, which are easy to see from the air.
- International routes from Incheon to Japan and China. They need a bigger map frame and more terrain.
- Real departure, arrival and approach procedures and airways from Korea's AIP.
- Real building footprints around the airports, and landmark towers.
- Gamepad or joystick support, and key rebinding.
- More Nuclear Airlines liveries, and more made-up airlines for the parked aircraft.

## Not planned (Shane said no)

- A cold-and-dark start (battery, APU, engine start): "c is for actual trained pilots."

## Open decisions for Shane

- Hazard stripe colours on the livery: black and yellow by default. Shane may want green and black. Asked 2026-10-31.
- The order of the future additions. v0.1.4 (2026-11-01) took the FCU, the jumps, the three leftovers and the fonts. v0.2.0 is next, as an overnight Claude Code run: the main menu and scenarios, then night (row 10's night sky, with the time of day and the lights). Changing the route in flight (row 6) isn't in it. **v0.2.0 is done** (2026-11-01). v0.2.1 (2026-11-03, Cowork) took Shane's three fixes: the taxiways at the runways, changing the route in flight (row 6), and the view switch; then two more he grouped in with it: one-finger camera dragging and more stars. The next is open.
