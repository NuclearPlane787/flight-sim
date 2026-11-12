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

Found after v0.2.1 (Shane, 2026-11-04, "For v0.2.2, let's fix these"):

- **The engine sound** ("The current engine sounds don't sound accurate to a real A321. Let's fix that if possible."). **Done in v0.2.2**: rebuilt from the LEAP-1A's real tones and checked by measurement; no agent can listen, so it rests on Shane's ears (before/after clips in `Claude outputs/flight-sim/`).
- **The Cockpit button swapping seats** ("When you are in cockpit view, you can transfer to the first officer's seat by pressing the button again."). v0.2.2 read this as a fault and took the swap out; it was a request for the swap, and **v0.3.1 put it back** (below).
- **The A/THR and the thrust levers** ("When autothrottle is on, the blue dot on the engine power view doesn't move. So when I press R or F slightly, the engines change power significantly. Have autothrottle move this blue dot as well."). **Done in v0.2.2**: the A/THR moves the lever (as a Boeing's does; an Airbus's stay in CL), and R/F take it from there and disconnect it.


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
| 1 | Aircraft customisation: a parts "warehouse" | "Airplane customisation beyond normal; Similar to MSFS, have a 'warehouse' where you can swap out elements like engines for other planes' parts. So, you can attach GE90 engines to an A321, for example." | Each part becomes a module with its own numbers (an engine's thrust, fuel burn, weight, size and sound), which the model, the sim and the synth read. Other types' parts come with those types (row 3). Size matters: a GE90-115B's fan is 3.25 m across, against 1.98 m for the LEAP-1A's, and the A321neo's nacelles clear the ground by 0.45 m, so a GE90 there needs taller gear, or it scrapes. **2026-11-10:** the KSP half of the long-term plan: "a sort of 'warehouse' where I can take base models like the B777-300ER and make changes, whether it be adding more engines for fun, making them more powerful, or any sandbox like changes, then run scenarios on them." It stands on the parts model. In the version plan: **v0.5.0** ("The long term" below). |
| 2 | Leaving the seat on autopilot, and walking the cabin | "When on autopilot, you can get up from your seat in the cockpit, exit through the cockpit door, and go around the cabin. This means creating an interior for our planes: one very big job." | An interior for each type: the cockpit door, galleys, cabin seats, lavatories and doors. A walking mode, in which W/A/S/D walk instead of fly, with collisions, while the autopilot flies. Today's cockpit is `PLAN.md`'s simple one, built only for the view out. **2026-11-10:** "People, if possible as well." Passengers as many as the Weight tab says, and crew. In the version plan: **v0.18.0**, one type first. |
| 3 | More aircraft: the A330, B737, B747, B777 and B787, with their variants | "Adding other planes like the A330, B737, B747, B777, and B787, and all their variants. Another huge job." | Each type needs its numbers from its type certificate and airport-planning document (the A321neo's method, in `src/sim/a321neo.js`), its own flight model and control laws, a model, a cockpit and sound. The 737 and 747 have conventional controls; the 777 and 787 have Boeing's fly-by-wire, which a pilot can override. The variants multiply all of it. Extends "More aircraft types" above. **The 787-9 and 777-300ER: done in v0.3.0** (2026-11-04, overnight Claude Code run; one variant and engine each). Still to come: the A330, B737, B747 and the variants. **2026-11-10:** the A330, 737 and 747 are **v0.17.0** in the version plan; the 737 and 747 need conventional (not fly-by-wire) controls. Special aircraft are row 12. |
| 4 | Detailed airports: terminals with windows and insides | "Detailed airports. Instead of just gray slabs being the airports, have windows with faintly visible insides. Maybe even be able to walk inside them." | Faint insides can be faked without building rooms: interior mapping, a shader that draws rooms behind the glass, is cheap enough for every terminal. Walking inside needs real interiors and the walking mode (rows 2 and 8). |
| 5 | UI fixes, and a new font | "Fix various UI elements. I can't change the autopilot's heading from 066, for example. Also, I can't select a point on the path we are given. The buttons and fonts for the settings pages are not my favourite. Maybe change the font for the whole game?" | **Done in v0.1.4** (2026-11-01): the heading and the path (see "Found after v0.1.0" above), and new fonts: B612, made for Airbus's cockpit screens, on the screens and the FCU, and Barlow in the menus (both under the SIL Open Font Licence, in `vendor/fonts/`), with darker buttons. More of the UI changes with v0.2.0's menus. |
| 6 | Changing the route in flight | "Allow another path to be reset on command so you aren't stuck with what you started with." And for v0.2.1 (2026-11-03): "Be able to change the route during a flight." | **Done in v0.2.1** (2026-11-03). On the map, Change route (or a click on an airport) picks a new destination and runway, and the magenta line, the ND, the PFD's approach scales, skip to final, the score and the saved scenario follow. Dragged waypoints show in flight now, too (they never did before). The departure can't change once set. |
| 7 | Other aircraft and ATC, formation flying, and collisions (2026-11-10; was "without collisions") | "Add other planes and ATC, and we have to be deliberately careful not to collide with those planes. This has some feasibility issues, but we will consider them later." | Extends "Air traffic control" and "Other aircraft in the air and on the taxiways" above: traffic in and out of the three airports, ATC that sequences it and you, and collisions with it (with TCAS-style alerts, for example). Feasibility to be weighed later, as Shane said. **2026-11-10: collisions are wanted now:** "Other airplanes in the sky flying with me if possible, taxiing or taking off, maintaining formation, etc. ... Crashing into another plane causes realistic things like wing parts to tear off or the body to break apart and crash." So formation flying too. In the version plan: **v0.16.0**, after crash physics (v0.12.0). |
| 8 | Inside the terminals: lounges | "Enter airports and go to lounges." | Shares the terminal interiors and the walking mode with rows 2 and 4. |
| 9 | Engine shutdown, gear-up landings and every emergency | "Be able to shut off engines, land without gear, and simulate virtually every emergency scenario." | Brings in what `PLAN.md`'s decision 3 left out of the first build ("No aircraft systems (hydraulics, electrics, failures)"), and replaces the candidate "Aircraft systems" that was below. Today the fuselage, an engine or a wingtip touching the ground ends the flight, so a gear-up landing needs contact physics for them (row 11). **2026-11-10:** as a panel: "a sort of 'failure simulation panel' where I can cause things like engine fires, gear malfunctions, or any feasible failure on command." In the version plan: **v0.8.0**. |
| 10 | Every kind of weather, and the night sky | "Add crosswind, rain, snow, thunder, microbursts, and almost every weather event imaginable. Also the night sky, which I sort of what to look like Satisfactory's majestic night sky." | **The night sky goes into v0.2.0** (2026-11-01, Part 2 of `V020.md`, after the menu and scenarios), with the time of day, city lights and the airports lit. Shane: "Should we add the adding the Satisfactory-like night thing to the list as well, with the city gaining point-source lights like looking out from a plane window, with runways appropriate lit up?" Asked whether the sky should be Satisfactory's alien one (its gas giant, cracked planet and dwarf star) or Earth's, he chose Earth's sky in Satisfactory's look: real stars, the Milky Way and one Moon with its phases. The time of day gets an adjustable clock like Satisfactory's Sky window ("Satisfactory has an adjustable clock that can be opened via Cmd+L. Maybe have an adjustable thing similar to that?"). Night replaces the candidate "Time of day and night" that was below. The weather stays here, and extends "Weather" above. **The night sky: done in v0.2.0** (2026-11-01): the KST clock and the Sky window (L, Cmd/Ctrl+L), the real sun, Moon and phase, 8,404 BSC5 stars and the Milky Way, twilight, the light following the sun, city lights, airport and taxiway lights, the A321's lights by phase and the cockpit at night. The weather is still to come. **2026-11-10:** "Weather elements like rain, thunder, snow, and all that. The plane would feel these in the form of crosswind, headwind, tailwind, visibility, etc. With a control panel for this as well of course." **v0.4.0**, decided: "I think weather for 0.4.0 is the right move." **The weather: done in v0.4.0** (2026-11-10; a Claude Code run briefed by `V040.md`, reviewed by the Cowork session that wrote it): the L window's Weather tab with eight presets and every setting, the setup's choice, the wind by height, gusts, Dryden turbulence, shear and microbursts (seeded, so saves, rewinds and the predicted path stay exact), temperature and QNH with a real altimeter (K, the BARO boxes), the Boeings flying the track and decrabbing, windshear warnings, the wind at touchdown on the card and in the logbook, wet, snowy and icy runways, fog, cloud layers, rain, snow, lightning, the overcast light, and the sound of rain, thunder and gusts. Moving fronts and volumetric clouds are still to come. |
| 11 | Crash physics | "Realistic crash physics with thousands of pieces of physics calculations. Right now it is just a popup that says 'you crashed'." | The aircraft breaking into pieces with their own physics (thousands of rigid bodies and bits of debris), with fire and smoke. It has to fit the CPU rules: the 60 fps cap and a budget per frame (`PLAN.md` → CPU at runtime). Rewind and restart stay. **2026-11-10:** "Semi-realistic crash animations, beyond just a popup." People are humanoid dolls that get thrown around and don't break apart, and the aircraft are sturdier than Besiege's ("The long term" below). Tens of real bodies plus particle debris, not thousands of bodies. In the version plan: **v0.12.0**. |

Found after v0.3.0 (Shane, 2026-11-08, "Let's go for v0.3.1"):

- **The gear and the high-lift surfaces** ("The landing gear on all three planes look strange when flaps are fully down. They seem to attach to thin air. I don't [think] there should be air gaps in the wing when the surfaces on the front of the wing and the flaps are extended. They should still be connected to something."). **Fixed in v0.3.1**: each inboard flap now starts behind the main gear's leg, so the fixed wing carries the gear (the A321neo's wing also moved 1.03 m aft, to where Airbus draws it); the spoilers overhang the flaps, leaving a slot, not a gap; the slats run on tracks in front of a rounded leading edge; the flap track fairings stay in one piece.
- **The seat swap** ("I can't seem to switch to the first officer's seat by just clicking the cockpit button one more time."). **Done in v0.3.1**: in a seat, Cockpit (or 1) swaps to the other one.
- **The engines in the cockpit** ("I can't hear the engines much at all from the cockpit. They should be muffled and quieter than the outside, but not almost absent."). **Done in v0.3.1** (see `Updates.md`).
- **The gear doors** ("The polygons of the landing gear doors are only visible from one side."). **Fixed in v0.3.1**: the Boeings' doors are panels with an inside.

Found after v0.3.1 (Shane, 2026-11-08, for v0.3.2):

- **Higher than the ceiling** ("Can you change the maximum altitude on the autopilot from 43000 to 45000? I know the coffin corner effect, but I just want to know what happens a little higher."). **Done in v0.3.2**: the Boeings' ALT window goes to 45,000 ft.
- **Duplicating a scenario** ("Add the ability to duplicate a scenario, since I've found that I want to test various from certain points."). **Done in v0.3.2**: Duplicate in Load scenario, and Save a copy in the pause menu.
- **The weights in flight** ("Be able to change the weight settings of a flight during the flight. Maybe put it under the L (time) tab or put under another tab."). **Done in v0.3.2**: the L window's Weight tab.

## The long term: MSFS, KSP and Besiege (Shane, 2026-11-10)

Shane: "As a general thing, I want it to be a mix of MSFS (for the visuals and groundwork) + Kerbal Space Program (for the sandbox) + Besiege (for the physical realism), all of which I played a long time ago. Though, unlike Satisfactory, I won't copy game assets or anything one to one, just morphing the 'ideas' to fit my own." And: "No assets will be copied."

- **Ideas, never assets:** the three games' mechanics are fair to borrow; their models, textures, sounds, UI art and names aren't. Real aircraft are built as the 777 and 787 were: shapes and numbers from public documents, with no manufacturer or airline branding.
- **The foundation is a parts model.** Today each type is one rigid body with hand-tuned numbers: two engines, one wing and three gear legs, fixed in code. As parts (fuselage, wings, engines, gear and tail, each with its mass, position, aerodynamics and strength), the aircraft is what the warehouse edits (row 1), what failures act on (row 9), what breaks off in a crash or a collision (rows 11 and 7), and what makes new aircraft cheaper (rows 3 and 12).

Decided on 2026-11-10:

- **v0.4.0 is the weather:** "I think weather for 0.4.0 is the right move."
- **No joystick or gamepad:** "I plan to always use my mac keyboard and touchpad, or just an external mouse at best for controls."
- **People in a crash are humanoid dolls:** "They don't break apart or anything, they just get thrown around on impact." Graphic injury stays out.
- **Sturdier than Besiege:** "The planes were a bit too fragile. They have connectors that attach parts that weren't strong, so a landing any harder than a feet per second would rip the landing gear, and anything more than 1.5G would tear the wings, etc. I think we can make our planes a little more durable than that." Claude's proposal, from the certification rules (CS/FAR 25):
  - **The gear** takes 10 ft/s (600 ft/min) with no harm and must survive 12 ft/s. It collapses past about 15 ft/s (900 ft/min), where the sim draws the line today (`GEAR_BREAK_VS`, 4.6 m/s).
  - **The wings** take their limit load with no harm: +2.5 g and −1 g clean, +2.0 g with flaps out. Between that and 1.5 times it they can be damaged, and they break only past 1.5 times it (+3.75 g).
  - **Flaps and gear** lowered too fast are damaged.
- **Airports in three regions beyond Korea, with flights inside a region:** "Maybe just those three regions locally, with long international flights unavailable." See row 13.
- **Shanghai Pudong, Haneda and Narita join Korea's region** (later on 2026-11-10): "If anything, adding more varied airports like Shanghai Pudong or Haneda + Narita might be better, since that with Korea can be considered one region." More Korean airports, no.
- **The region data goes in git:** "Adding the region map to git is reasonable, I think."
- **Kept from Claude's suggestions:** the replays and black box (row 14), the challenges (row 15) and the X-15-style rocket plane (row 12).

### More additions (2026-11-10), numbered on from the 2026-11-01 list

| # | Addition | In Shane's words | Notes |
|---|---|---|---|
| 12 | Special aircraft | "Add more planes. Beyond just Airbus and Boeing models, which might become monotonous, add special planes like the Concorde, Antonov planes, or military jets like the SR-71, B-2, or the C-17 globemaster." | Each needs physics the airliners don't. **Concorde:** a delta wing that gets extra lift from vortices at high angles of attack, no flaps, the drooping nose and visor, afterburners, Mach 2 at about 60,000 ft, and fuel pumped aft to trim. **An-225:** six engines, the warehouse's showcase (the An-124 is its four-engine sibling). **C-17:** steep, short landings on dirt strips, and backing up with reverse thrust. **SR-71:** Mach 3.2 at about 85,000 ft, so the air model must go past 20 km (`atmosphere.js` is isothermal above 11 km, which is right only to 20 km); inlet unstarts are a ready-made failure, and its flight manual is public. **B-2:** a flying wing that steers with split drag rudders; most of its numbers are classified, so they'd be estimated. **A rocket plane like the X-15** (Claude's suggestion, kept on 2026-11-10: "The X-15 rocket-type plane can stay, I think."): to the edge of space, KSP taken literally, so the air and the sky have to go up to about 100 km. Military types get made-up markings, as the airliners get made-up liveries. In the version plan: **v0.9.0** (Concorde, An-225), **v0.13.0** (SR-71, the rocket plane) and **v0.14.0** (C-17, B-2). |
| 13 | Airports beyond Korea, in three regions | "I want to expand beyond just Korea, but I'm sure mapping the whole world out is infeasible. The airports I want to add are these: In Europe, airports like Heathrow, CDG, Frankfurt, Madrid, Zurich. In North America, airports like SFO, LAX, Seattle, Dulles, JFK, Boston, Chicago, Toronto, Vancouver. In Oceania, airports like Sydney, Perth, Melbourne, Auckland. Those are the three regions I want to cover eventually. Though that leaves the question of how mapping the entire world would work. Maybe just those three regions locally, with long international flights unavailable." And on 2026-11-10: "I don't think more Korean airports would add much. If anything, adding more varied airports like Shanghai Pudong or Haneda + Narita might be better, since that with Korea can be considered one region." | **East Asia, with Korea as one region:** ZSPD (Shanghai Pudong), RJTT (Haneda), RJAA (Narita). **Europe:** EGLL, LFPG, EDDF, LEMD, LSZH. **North America:** KSFO, KLAX, KSEA, CYVR, KIAD, KJFK, KBOS, KORD (O'Hare taken for "Chicago"), CYYZ. **Oceania:** YSSY, YMML, YPPH, NZAA. How the regions would work is below. In the version plan: **v0.6.0** (East Asia, with the terrain in tiles), **v0.7.0** (the regions, and Europe), **v0.10.0** and **v0.11.0** (North America's west, then its east) and **v0.15.0** (Oceania). |
| 14 | Replays and a flight recorder | Claude's suggestion, kept on 2026-11-10: "About your other suggestions: the replay and black box feature can stay" | The sim is repeatable, so the recorded inputs replay a flight exactly. MSFS-style cameras (tower, flyby, wing), and after a crash a black box of the last minutes: altitude, speed, angle of attack, g. Not slotted: a smaller job that can come any time, though its black box matters most once crash physics (v0.12.0) exists. |
| 15 | Challenges | Claude's suggestion, kept on 2026-11-10: "... as well as the challenges." | KSP's contracts in this game's form, scored by the landing score: a 35 kt crosswind at Jeju, low visibility, an engine failure at V1, a dead-stick glide to Gimpo. `PLAN.md`'s decision 15 has them come once weather exists. Not slotted: a first set after v0.4.0, more with failures (v0.8.0). |

### How the regions would work

- **Each region is its own world,** picked with the scenario, with its own map frame (Korea's is one Lambert conformal conic centred at 36°N 127.5°E, `src/world/frame.js`). Flights stay inside a region. Europe spans about 2,000 km; North America (Vancouver to Boston) and Oceania (Perth to Auckland) span about 5,000 km each, which the same kind of map holds to within a couple of percent of scale at its edges. If that shows, those two split into halves.
- **East Asia is Korea's region, grown:** Korea's map frame has its standard parallels at 33° and 38°, and a Lambert conformal conic's scale depends on latitude only, so Shanghai (31°N) and Tokyo (35.5°N) sit in it to a fraction of a percent. The frame stays, and the scenarios saved in it keep their coordinates; what Japan and eastern China need is the terrain in tiles.
- **Terrain in tiles:** Korea's fits in one 250 m texture (`data/terrain/`, 12 MB). A region several times wider doesn't, so the terrain moves to tiles at several resolutions, read from the game's own folder as you fly. The no-network rule stands.
- **The data follows Korea's rule** (macro-scale details from real data, finer detail procedural):
  - elevation from Copernicus GLO-90, with GLO-30 around the airports, as now;
  - land cover and built-up areas from ESA WorldCover (10 m, CC BY 4.0), because OpenStreetMap's land use over a continent is far too heavy to bake (the 18.7 GB incident of 2026-10-31);
  - coastlines from OpenStreetMap's land polygons, clipped;
  - each airport from its own small OpenStreetMap extract.
- **What changes per region:** local time with summer time (the browser knows the time zones offline), magnetic variation from the World Magnetic Model (public domain), the altimeter in inches of mercury in the US and Canada, and each country's transition altitude.
- **Size:** tens to a few hundred MB of data per region, against Korea's 13 MB. It goes in git (Shane, 2026-11-10), in tiles, each under GitHub's 100 MB per file.
- **What it rules out:** flights between regions. The Concorde's real routes (London and Paris to New York) cross two of them, so here it flies inside one. A whole globe would lift that, but every part of the game assumes one flat map today, so it would be a rebuild, not an addition.

### The version plan (2026-11-10)

Shane: "Slot the new planes and airports into the updates and we can add it to roadmap." Revised the same day, with East Asia and the kept suggestions. Who builds each version is a judgment, and one session takes each update from end to end (`AGENTS.md` → Versions). The order after v0.4.0 is a plan, and Shane can reshuffle it. It alternates a systems step with content that uses it.

| Version | What | Needs |
|---|---|---|
| v0.4.0 | **Weather** (row 10): wind that changes with height, gusts, turbulence, wind shear and microbursts; visibility and fog; cloud layers; rain and snow, lightning and thunder; wet and snowy runways that brake worse; temperature and QNH, so density altitude and the altimeter setting matter. A Weather tab in the L window (Sky · Weight · Weather), with presets. Seeded, so the predicted path and the jumps stay exact. Volumetric clouds come later, as a step of their own. | **done** (2026-11-10) |
| v0.4.1 | **Fixes** (Shane, 2026-11-10): the 777's wingtip hole and the slats' gap; landing the 777 (Indestructible and Boeing auto-trim in Settings); storms more like real ones, in three strengths; taxiway and runway signs. | **done** (2026-11-11) |
| v0.4.2 | **The known list** (Shane, 2026-11-12: "do your list for v0.4.2"): the "Found while building" items below that fit a third-decimal version: the crash screen's Indestructible button, auto-trim's flare law and trim switches, more skids and a hard stop for Indestructible and a card after a gear-up landing, the Boeing autoland's alignment and rollout, runway exit and distance remaining signs, snow over the taxiway paint, broken cloud far off (checked, left as it was), predictive windshear, hydroplaning, wipers and spray. Shane's own findings from flying v0.4.1 go in v0.4.3. | **done** (2026-11-12) |
| v0.4.3 | **Shane's findings from testing v0.4** (2026-11-12): the 787's and 777's slats and flaps standing off the bent wing in flight, the engines' see-through edges and off-centre fans, the 777's pitch settling after an input (to the 787's), and auroras on every clear night. | **done** (2026-11-13) |
| v0.5.0 | **The parts model and a first warehouse** (row 1): the three types rebuilt from parts and flying exactly as now (golden flights, as v0.3.0 did); the warehouse changes engine count and placement, thrust, weight and fuel, and saves designs that show in the aircraft picker. Off-centre thrust yaws, more engines burn more fuel, and too much thrust for a pylon breaks it. Changing the wing (aerodynamics from its shape) comes later. | |
| v0.6.0 | **East Asia: Korea's region grows** (row 13): Shanghai Pudong, Tokyo Haneda and Narita, in Korea's own map frame. The terrain moves to tiles at several resolutions, read from the game's folder as you fly, which every later region needs. | |
| v0.7.0 | **The regions, and Europe** (row 13): the region picker and everything per region (above); Heathrow, Charles de Gaulle, Frankfurt, Madrid and Zurich. | v0.6.0 |
| v0.8.0 | **Failures** (row 9): a failure panel, on command or at random within a set time: engine fire and failure, gear that won't extend or collapses, hydraulic loss (degraded control laws), unreliable airspeed, jammed or split flaps, depressurisation, bird strikes, burst tyres; the warnings and their checklists; the belly sliding along the ground in a gear-up landing (v0.4.1's Indestructible already slides on seven skids). | v0.5.0 |
| v0.9.0 | **Special aircraft, 1** (row 12): the Concorde, whose home airports come in v0.7.0, and the An-225. | v0.5.0 |
| v0.10.0 | **North America's west** (row 13): San Francisco, Los Angeles, Seattle and Vancouver. | v0.7.0 |
| v0.11.0 | **North America's east** (row 13): Dulles, JFK, Boston, Chicago O'Hare and Toronto. The continent flies as one region, so coast to coast works. | v0.10.0 |
| v0.12.0 | **Crash physics** (row 11): a rigid-body engine for many pieces (Rapier, bundled with the game: Apache-2.0, has a repeatable mode, runs in the browser). In a crash, or past a part's ultimate load, the parts come apart at their joints (wings fold, engines shear off, the fuselage splits), with dust, fire and smoke, and humanoid dolls thrown about. Sturdier than Besiege (above). It runs only during a crash, inside the 60 fps budget. | v0.5.0 |
| v0.13.0 | **Special aircraft, 2: high and fast** (row 12): the SR-71 and an X-15-style rocket plane, with the air and the sky up to the edge of space. | v0.5.0; v0.10.0 for the SR-71's home |
| v0.14.0 | **Special aircraft, 3** (row 12): the C-17 and the B-2. | v0.5.0 |
| v0.15.0 | **Oceania** (row 13): Sydney, Melbourne, Perth and Auckland. | v0.7.0 |
| v0.16.0 | **Traffic, ATC, formation and collisions** (row 7): other aircraft on repeatable schedules (so the jumps still work), taxiing on the taxi network; ATC in the callouts' voice; formation flying with an AI wingman or behind an AI lead; collisions that tear aircraft apart (v0.12.0's breakup); wake turbulence. | v0.12.0 |
| v0.17.0 | **More airliners** (row 3): the A330, 737 and 747; the 737 and 747 need conventional (not fly-by-wire) controls. | v0.5.0 |
| v0.18.0 | **The cabin** (row 2): walking while the autopilot flies, in a cabin that moves with the aircraft (turbulence makes you stagger); passengers as many as the Weight tab says, and crew; one type first (the 777-300ER). | |
| any time | **Replays and the flight recorder** (row 14), and **challenges** (row 15): a first set after v0.4.0, more with failures. | v0.4.0 for the challenges |

## Found while building v0.4.3 (left for later)

From the session's entry (`STATUS.md`, 2026-11-13):

- **The aurora is the same strong display every clear night:** no quiet nights, no substorm bursts, and it lights nothing: no reflection in the sea or on a wet runway, no glow on the ground or the clouds. It's centred on true north (from Korea the geomagnetic pole is about 4° east of it). Real auroras over Korea are rare and red; Shane chose the high-latitude green curtains.
- **Without auto-trim the Boeings still swing after a press:** the speed-stable law takes the nose back towards its trim speed, several degrees after a 1 s press on both (the 787 7.9° on and 8.0° back; the 777 9.9° and 8.3°, from 11.5° and 8.6° before its elevator change). Not changed; with auto-trim on both stop within about a degree.
- **The A321's law wasn't touched:** a 1 s press leaves its nose going on about 1.4° and swinging 1.3° back over about 3 s, as the 787's did at v0.4.2. The Boeings' path-mode cap (2.2°/s) could go on it too, if Shane wants the same feel.
- **The elevators' rate is 30°/s on all three** [EST]; the 777's real figure wasn't found.

## Found while building v0.4.2 (left for later)

From the session's entry (`STATUS.md`, 2026-11-12):

- **No no-entry signs:** the map data doesn't say which taxiways are one-way. Unnamed exits (most of Incheon's) get no exit sign, and a distance remaining sign that would stand on a taxiway is left out.
- **The wiper is one blade, in front of the seat you're in,** sweeping a pane drawn as a region of the view, not on each type's own windshield; the other seat's wiper isn't drawn. No wiper switch: it runs by itself.
- **The spray is one plume per leg** (not per wheel), in the aircraft's own frame, and lit only by the sky and the sun (not the landing lights).
- **Predictive windshear sees only microbursts** (as the radar sees the rain in their outflow): no caution band from 1.5 to 3 nm ("MONITOR RADAR DISPLAY"), no icon on the ND.
- **Hydroplaning is dynamic only,** from the rain's rate (no water depth of its own, no viscous or rubber-reversion hydroplaning), and the tyres' pressures are estimates.
- **The 777's yaw on the approach** was measured, not changed: on final in the moderate storm it yaws less than the A321 (yaw rate σ 1.2 against 1.5 °/s) and its Dutch roll is as damped (ζ about 0.3; `tests/yaw-approach.test.mjs`). If it still swings for Shane on v0.4.1, his findings will say where.
- **Indestructible's hard stop** pushes straight out of the ground at the deepest skid; sliding up a hillside at speed it keeps most of its speed along the slope.

## Found while building v0.4.1 (left for later)

From the session's entry (`STATUS.md`, 2026-11-11). v0.4.2 did the struck-through ones.

- ~~**Signs only where named taxiways meet.** No runway exit, distance-remaining or no-entry signs.~~ v0.4.2: exit and distance remaining signs (no no-entry signs: no data). Most taxiways in the map data still have no name, so long stretches have no signs.
- **The slats droop and don't run out,** so even in the landing configuration there's no slot (a real slat opens one). It's the picture only: the aerodynamics didn't change. Kept: Shane asked for the gap closed in v0.4.1.
- ~~**Indestructible's skids are seven points**: on rough ground the fuselage between them can dip in. A gear-up landing gets no card. Flying into a hill at speed puts the nose up to 6 m into it.~~ v0.4.2: ten skids, a hard stop at 0.6 m, and a card.
- ~~**Boeing auto-trim has no flare law;** the trim keys do nothing while it's on.~~ v0.4.2: the A321's flare law (with a gentler sink, to +0.5°), and the trim switches nudge the path.
- ~~**The 777's yaw on the approach** wasn't changed.~~ v0.4.2: measured; see above.
- **Storms are still one weather for all Korea,** with cells that don't move. Above 2,000 ft the turbulence is the level's, as before.

## Found while building v0.4.0 (left for later)

From the run's final entry and the review (`STATUS.md`, 2026-11-10):

- ~~**The Boeing autoland's alignment** leaves about 6.5° of crab at 200 ft against its 5° target,~~ (v0.4.2: 5.1° at 200 ft, 1.5 to 2.6 m off at the wheels, the rollout within about 7 m) and under 3° at the wheels; in 20 kt of crosswind it touches down about 6.5 m off the centreline (within the 27 ft that CAT III autolands are certified to) and ends about 4 m off.
- ~~**Broken cloud layers look close to overcast from far off.**~~ (v0.4.2: not so. Side by side with v0.4.1 from 12,000 and 35,000 ft, a broken and a scattered layer keep their gaps and cloud out to the haze. Widening the far edges by the faded octaves' spread kept the same cover and only blurred them, so it was taken out again; `tests/cloud/v042-shots.cjs` broken-far, scattered-far.)
- **The approach lights make no reflections on a wet runway** (the runway's own lights do). Right as it is, v0.4.2 found: an approach light's reflection falls just short of the light, in front of the threshold, not on the runway. ~~On a snow-covered runway the taxiway paint still shows faintly.~~ (v0.4.2: covered.)
- ~~**Not built (the brief's Nices):** hydroplaning, wipers, spray from the wheels, the predictive windshear warning ("WINDSHEAR AHEAD").~~ (v0.4.2: all four; see its list.)
- **Simplified:** the wind doesn't veer near the ground by itself (the wind aloft carries the veer); the turbulence's lateral axis uses the longitudinal correlation, and the whole field moves with the surface wind.
- **Numbers from weaker sources:** the microburst's equations are Oseguera and Bowles's (NASA TM-100632) as remembered, checked for mass continuity and against their published form, but not read off the paper; the icy runway's braking (0.08) and the wet curve's mid-speed value are estimates.
- **The weather is one for all Korea,** and stays as set. Fronts and storms that move, and weather by place, come later; so do volumetric clouds.
- **Nobody has listened to the rain, the thunder or the gusts** (the clips are in `Claude outputs/flight-sim/`), and the crosswind landings by keyboard so far are the test pilot's.

## Seen while building v0.3.2 (left for later)

- **FLCH won't give up a climb it can't make:** in a climb its elevator floor is +100 ft/min (`speedOnElevator()` in `autopilot-boeing.js`), so a heavy Boeing at its thrust limit keeps climbing while the speed bleeds under the amber band toward the shaker. Not checked against Boeing's FCOM.
- **The IAS/MACH window keeps knots, not Mach** (`ap.spdKt`), so a FLCH climb from M.84 at FL410 ends near M.88 at FL450 (held 5 kt under VMO/MMO). A real Boeing in Mach holds the Mach.
- **The A321's setup shows v0.1.0's empty weight and tanks** (OEW 50,100 kg, 18,864 kg of fuel), against the sim's 50,500 kg and 18,510 kg: its ZFW reads 400 kg light, and fuel over 18,510 kg is cut without a word. The Weight tab uses the sim's numbers.

## Found while building v0.3.0 (left for later)

- **Both Boeings lift off late,** 16–20 kt after VR against about 5 in reality, and their take-off distances sit at the top of the bands.
- **`thsTakeoff`** is the A321's formula on all three types: on a Boeing it trims more nose-up at aft CGs, the wrong way round.
- **The landing distances pass only with a firm flare** (about 400 ft/min); a gentle one runs 10–20 % long.
- **The 777's single VMO** can't follow its 330-to-350 kt schedule; its semi-levered gear shows only in the tail-strike angle.
- **Taxi routes** ignore taxilane code limits and Gimpo's surface weight limit; some bends are tighter than a 777's wheelbase can trace.
- **No flight director bars** on the Boeing PFD (FLT DIR is annunciated only); VNAV PTH never engages; EGT and N2 on the EICAS are estimates.
- **The 787's head-up displays** aren't built (a stowed combiner only). Its wings do bend with the lift (v0.3.0, the 777's less).
- **Numbers from weak sources,** listed in each type's notes file: VFE and gear speeds from study cards, the 787's wing area and OEW from spec sites, the 777's tail-strike angle and eye height.

## Not on Shane's list (candidates; ask him)

- Working screens in the 3D cockpit. Today they're dark, and the working screens are drawn on the sides of the screen.
- Autobrake.
- Finer terrain everywhere, for low sightseeing over Seoul and Jeju.
- Expressways and other major roads from OpenStreetMap, which are easy to see from the air.
- International routes from Incheon to Japan and China. They need a bigger map frame and more terrain. (2026-11-10: Shanghai Pudong, Haneda and Narita join Korea's region in v0.6.0, row 13.)
- Real departure, arrival and approach procedures and airways from Korea's AIP.
- Real building footprints around the airports, and landmark towers.
- Key rebinding.
- More Nuclear Airlines liveries, and more made-up airlines for the parked aircraft.
- Suggested by Claude on 2026-11-10, not yet decided: **damage that stays**, a bent wing or damaged gear carried in the scenario until it's repaired in the warehouse (v0.12.0 makes the damage; this would keep it). Of the others, the replays and black box (row 14), the challenges (row 15) and the X-15-style rocket plane (row 12) were kept, and more Korean airports weren't.

## Not planned (Shane said no)

- A cold-and-dark start (battery, APU, engine start): "c is for actual trained pilots."
- Joystick or gamepad support (2026-11-10): "I plan to always use my mac keyboard and touchpad, or just an external mouse at best for controls."
- More Korean airports (2026-11-10): "I don't think more Korean airports would add much." East Asia's go into Korea's region instead (row 13).

## Open decisions for Shane

- Hazard stripe colours on the livery: black and yellow by default. Shane may want green and black. Asked 2026-10-31.
- The order of the future additions. v0.1.4 (2026-11-01) took the FCU, the jumps, the three leftovers and the fonts. v0.2.0 is next, as an overnight Claude Code run: the main menu and scenarios, then night (row 10's night sky, with the time of day and the lights). Changing the route in flight (row 6) isn't in it. **v0.2.0 is done** (2026-11-01). v0.2.1 (2026-11-03, Cowork) took Shane's three fixes: the taxiways at the runways, changing the route in flight (row 6), and the view switch; then two more he grouped in with it: one-finger camera dragging and more stars. v0.2.2 (2026-11-04, Cowork): the engine sound, the A/THR moving the levers, and the Cockpit button. **v0.3.0** (2026-11-04, overnight Claude Code run): the Boeing 787-9 and 777-300ER (row 3). The next is open. **Decided 2026-11-10:** v0.4.0 is the weather, and "The long term" has the version plan after it.
