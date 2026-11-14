# Updates

What each update added and changed, newest first. Dates are in KST. Each commit to the repository is titled with its version number alone, and this file says what's in it. The game shows its version in the pause menu and on the loading screen.

<!-- Agents: add new versions here, newest first, in the same style. -->

## v0.5.2 · 2026-11-14 · The warehouse, KSP's way: parts anywhere

- **Build it from parts.** The warehouse's editor works like a sandbox now: pick a part from the palette over the aircraft (the LEAP-1A, the GEnx-1B, the GE90-115B, a wing tank, a hold tank, ballast) and it follows the pointer over the airframe as a ghost, green where it fits and red where it doesn't, with its name and where it would go beside the pointer. Click to attach it.
- **Engines go where you put them:** under the wing, over it on a pylon above, on the rear fuselage's sides, or one in the tail. Up to eight, each its own type and thrust, and each can be nudged forward, back, up or down and turned a few degrees (toed in or out, pitched up or down).
- **Mirror** puts a twin on the other side and keeps the two together as you edit either. Turn it off for a lopsided aircraft.
- **Fuel and weight as parts:** teardrop tanks under the wing (each brings its fuel and its drag), tanks in the cargo hold, and ballast to move the centre of gravity.
- **Click a part to select it,** drag it to move it, Delete removes it. Its settings take over the side panel: its mount, its engine, where it sits, its nudges and turns, its thrust or its fuel. **Undo and Redo** (Z and Shift+Z) step through every change.
- **See the balance:** the centre of mass (yellow and black) and the centre of thrust (magenta, its arrow along the thrust) show over the model as you build.
- **New checks:** lopsided thrust (more yaw than an engine failure is red: the rudder can't hold it on the runway), the centre of gravity's move fore and aft, parts in each other's way, the thrust's pitch, every engine's and tank's ground clearance, and too much thrust for a light aircraft (full power can lift the nose into a tail strike). An aircraft with no engines can't be saved.
- **Each part flies:** its weight where it is (the centre of gravity and the inertia follow), its drag where it is (a lone wing tank pulls the nose towards it), and each engine its thrust along its own line. Mixed engines each run on their own numbers and sound like themselves.
- **Fly it** from the warehouse: the design is saved, and New scenario opens with it picked.
- Designs from v0.5.0 open as they were and fly the same.

## v0.5.1 · 2026-11-13 · The warehouse is a hangar

- **A real hangar round your design.** The warehouse's flat grey ground is now the inside of a maintenance hangar big enough for the 777-300ER: steel columns and roof trusses, a corrugated roof with skylights, rows of high-bay lamps, sprinkler pipes and ventilation ducts, and glazing high on the walls.
- **The way in:** behind the tail are the hangar doors the aircraft came in by: four sliding leaves a side on their floor tracks, pushed back to leave the middle open onto a sunny apron, under a door header with warning beacons.
- **Along the walls:** two storeys of offices and workshops across the back with a mezzanine and stairs, under the company's sign and a clock; pallet racking full of boxes, workbenches and tool chests, a spare engine on its stand, a forklift, a tug, tyres, fire points, exits and safety signs in Korean and English.
- **A painted floor:** grey epoxy with its joints, the stand's yellow lead-in line with a stop bar for each type's nose wheel, a dashed box round the parking area with its tie-down points, green walkways, and keep-clear hatching inside the doors and at the office doors.
- **People** in hi-vis vests and hard hats walk the walkways, and a few work at the benches, by the spare engine and at the tug.
- **The camera stays inside:** zoom out and it stops at the wall, the roof or the floor instead of going through. The lens is wider, so the whole 777 still fits.

## v0.5.0 · 2026-11-13 · The warehouse: your own aircraft

- **Warehouse** on the main menu: make your own aircraft from the A321neo, the 787-9 or the 777-300ER. Choose how many engines (2, 4 or 6 in pairs on the wings, or 3 with one in the tail), which ones (the LEAP-1A, the GEnx-1B or the GE90-115B), where each pair hangs on the wing, how strong they are (half to three times), the empty weight, the fuel capacity, longer gear, a name and a registration. The aircraft turns in 3D beside the parts, with the numbers that follow: empty weight, payload room, thrust to weight, range, the tail-strike angle, and each engine's ground clearance and pylon load.
- **Fly them:** saved designs are cards in New scenario's aircraft picker, under the three types. A scenario keeps its own copy of the design, so changing the design later doesn't change a saved flight. The logbook names the design.
- **Realistic limits:** each pylon holds about one and a half times its engine's rated thrust. Turn the thrust up past that and an engine tears off at full power: it's gone from the wing, the screens show it OFF, and the aircraft yaws towards the dead side. Two GE90s on an A321 sit a metre into the runway until you lengthen the gear, and their thrust line, far below the centre of gravity, wants a gentle hand on the levers.
- **Every engine counts:** the engines' weight moves the centre of gravity and the inertia, each engine has its own thrust, fuel flow and sound, and the A321's engine panel and the Boeings' EICAS show all of them.
- **The three aircraft fly exactly as before:** each one's recorded test flight matches to the ninth decimal place.

## v0.4.4 · 2026-11-13 · A wide view, the view switch in the cockpit, living auroras, and the gear tucked away

- **Hide panels:** a switch at the top left hides the PFD, the ND and the engine panel for a wide view, and Show panels brings them back. The FCU (or MCP) and the view switch stay, and the choice is kept for next time.
- **The view switch stays at the top right in the cockpit.** The seat's label (CPT or F/O) made it too wide to fit beside the FCU, so it jumped to the bottom of the screen. Now its text gets a little smaller first, and on a narrow window it sits just under the top row, still at the right, with the panels on that side starting below it.
- **The auroras move like auroras.** Their folds open and close in slow waves that run along the curtains, ripples run along the lower edge, the shapes change as they go instead of only sliding sideways, and each arc slowly brightens and fades.
- **The Boeings' main gear tucks into the wing.** With the gear up, the top of each main leg hung just under the wing near the body, a cylinder you could see from a level view. The legs now fold up inside the wing, and their doors close flush.
- **The A321's flight setup uses the sim's weights:** its empty weight read 400 kg light, and fuel above the tanks' 18,510 kg was quietly cut. Now the setup shows what the sim flies.

## v0.4.3 · 2026-11-13 · Shane's findings: the wings in flight, the engines, the 777's pitch, and auroras

- **No more gaps at the Boeings' slats and flaps in flight.** As the wing bent up under the lift, each slat and flap turned the bend with its own angle, so on a 787 final the outer slats stood about half a metre off the wing, the flaps and flaperons a little, and a 777's outer flaps looked detached. Now everything on the wing rises with it.
- **The engines are solid.** Past the fan's rim you could see through the cowl to the sky, on all three aircraft: they now have a fan case, the fan's face reaches it, and from behind you see the back of the fan.
- **The fan stays centred.** In flight the bend moved each Boeing fan blade by its own amount as it turned, so the fan wandered off the engine's axis. The engines now ride the wing as one piece.
- **The 777 settles after a pitch input as the 787 does.** With auto-trim on and the landing flaps out, a one-second press used to leave the 777's nose going on 2.8° after you let go, then swinging back 2.7° over nearly 4 s. It now stops within about a degree and settles in under a second, on both Boeings. Its elevator and stabiliser now have the power its bigger tail gives it, and with auto-trim the pitch rate on final is capped at 2.2°/s, except in the flare and a go-around.
- **Auroras** on every clear night: green curtains with red and violet tops, low in the northern sky, folding slowly, with fine rays that drift and flicker. They're far away, so they stay put as you fly, and cloud hides them.

## v0.4.2 · 2026-11-12 · Practice aids, the autoland, runway signs, and the rest of the weather

- **The crash screen** has a button that rewinds 30 s with Indestructible on, so a crash while practising is one click from flying on.
- **Boeing auto-trim flares as the A321 does.** Below 50 ft on a landing it holds the attitude and lets the nose sink a little, so you flare yourself and the aircraft settles instead of floating; a long pull no longer balloons it and drops it on its nose wheel. H and Y now nudge the flight path it holds (half a degree a second), finer than W and S.
- **Indestructible holds up better:** three more skids along the belly, so the fuselage doesn't dip into rough ground between them; a hard stop past 0.6 m, so flying into a hill no longer buries the nose 4 to 6 m deep for a moment; and a gear-up landing gets its landing card.
- **The Boeing autoland lines up better in a crosswind.** In 20 kt it has 5° of crab left at 200 ft (6.5° before), touches down 1.5 to 2.6 m off the centreline with about 1.4° of crab (5 to 6 m and 3° before), and holds the rollout within about 7 m of the centreline (up to 19 m before).
- **Runway signs:** beside the runway, 60 m before each named exit, an exit sign with the taxiway's name and an arrow, for each way along it; and distance remaining signs every 1,000 ft along both sides, white numbers on black, in thousands of feet. No no-entry signs: the map data doesn't say which taxiways are one-way.
- **Predictive windshear:** below 1,200 ft, and on the take-off roll, the weather radar looks along your path from half a mile to a mile and a half ahead for a microburst. WINDSHEAR AHEAD on the PFD and in the voice ("go around, windshear ahead" on a Boeing's approach); in a test it came on about 50 s before the reactive warning.
- **Hydroplaning:** in heavy rain the runway has standing water, and above about 130 kt the tyres ride on it, so the brakes and the steering hardly grip until you slow down. A message says so.
- **Wipers:** in rain or snow, in the cockpit and below 230 kt, a wiper sweeps your windshield, faster the harder it rains, and the drops come back behind it.
- **Spray** off the wheels on a wet or snowy runway, more the faster you roll and the harder it rains.
- **Snow covers the taxiway paint** and the taxiways' painted names, as it covers the runways'.
- **Broken cloud far off** was looked at again, side by side with v0.4.1 from 12,000 and 35,000 ft: broken and scattered layers keep their gaps and their cloud out to the haze, so they weren't changed (softening the far edges only blurred them).
- **The 777's yaw** was measured against the other two types: on final in the same storm it yaws the least (1.2°/s against the A321's 1.5°/s), and its Dutch roll is as well damped, so it wasn't changed.

## v0.4.1 · 2026-11-11 · Fixes: the wings, landing the 777, storms, and signs on the taxiways

- **No more hole in the 777's wings.** Each had a gap in front of the aileron, just inboard of the raked tip, with the sky showing through it. It's closed, and so are the narrow slots between the slats, and between the flaps and ailerons, on all three aircraft.
- **The slats seal against the wing.** They droop from the leading edge instead of running out on tracks, so there's no air gap behind them any more.
- **Indestructible**, in Settings (also from the pause menu): no crash ends the flight. The gear holds a hard landing, a tail strike scrapes, a belly landing slides to a stop on the fuselage, and a wingtip bounces off the ground. A message says what would have crashed, and the landing card says so too: it's marked, and a landing that would have been a crash scores as low as one off the runway. The logbook marks these landings. The crash screen points to it.
- **Boeing auto-trim**, in Settings: the 787 and 777 hold their flight path when you let go, as the A321 does. With the flaps for landing, W and S nudge the path instead of pulling g, so a tap makes a small change that stays; the autothrottle looks after the speed. Turned off, they fly as before. In a test with the keys alone, a 777 final stayed within 19 m of the glide path with it on, and wandered 165 m off with it off.
- **Storms come in three strengths:** light, moderate and severe (in the Weather tab, and in the setup). Microbursts come only with a severe storm, and rarely: about one airport in three has one, 6 to 16 km out. Before, every storm put two or three round every airport.
- **Gusty winds hold their direction better.** Near the ground the turbulence now grows with the wind that's actually blowing, as it does in reality. In a moderate storm's 14 kt wind the crosswind swings about half as much as before. A strong wind is as bumpy as before, or a little more.
- **Signs on the taxiways.** Where named taxiways meet, a row of signs in the grass on your left shows the taxiway you're on (yellow on black) and where the others go (black on yellow, with arrows). The name is painted on the taxiway before the junction too. Every runway holding position has a red sign with the runway's numbers. They're lit at night, and the taxi instructions' names are the ones on the signs. Taxiways without a name in the map data have no signs.

## v0.4.0 · 2026-11-10 · The weather

- **Weather, from the L window's new Weather tab** (Sky · Weight · Weather). It has eight presets: clear, few clouds, overcast, rain, thunderstorm, snow, fog, and a gusty crosswind straight across your arrival runway. Every setting is under them:
  - the wind at the surface and aloft, gusts and turbulence;
  - a low-level shear, and a microburst on final;
  - the visibility and fog, and up to three cloud layers;
  - rain or snow, and lightning;
  - the runway's state, the temperature and the QNH.

  A METAR-style line at the top sums it up, and a change applies at once in flight. The setup has the presets too, next to the start time; a new scenario starts clear.
- **You feel it.** The wind changes with height and blows you sideways, so a crosswind landing means crabbing on the approach and straightening up in the flare. A tailwind makes the landing longer. Gusts and turbulence bump you about. A microburst on final gives you a headwind, then a downdraft and a tailwind, with a WINDSHEAR warning in each maker's voice. Hot air is thinner, so take-offs are longer; the engines hold their thrust up to ISA + 15.
- **The altimeter is real:** it reads the air's pressure against the QNH you set. Each flight starts with the day's QNH set; K sets it again, or use the BARO box on the FCU or the MCP (scroll it, type into it, or STD). Above 14,000 ft with a QNH still set, the setting flashes (an amber box on the Boeings) until you set STD; below FL140 on STD in a descent, the same. On a cold day you're lower than the altimeter says, as in a real aircraft.
- **On the screens:** the ND shows the wind, with an arrow, and the drift between your heading and your track; the PFD shows the altimeter's setting. The landing card and the logbook give the wind at touchdown as the tower does, gusts included, with its crosswind and its head or tailwind part.
- **The Boeings' autopilot flies the track:** LNAV and LOC hold their course in a crosswind, and the autoland lines up from 500 ft and lands decrabbed. It always tries, whatever the wind. On a 15 nm final the heading held is the crabbed one, so the A321's HDG keeps you on the centreline too.
- **Wet, snowy and icy runways,** from the rain, the snow and the temperature, or set by hand. You stop much later on them and slide sideways more easily.
- **The look:**
  - haze and fog to the visibility you set;
  - cloud layers to fly through and above: a white floor in the sun, lit orange by the cities at night;
  - grey overcast light;
  - rain streaks and drops on the windshield, snow falling and lying;
  - lightning that lights up the clouds, and rain shafts under the storm cells;
  - the runway lights reflected in a wet runway at night.

  Clear weather looks exactly as it did.
- **The sound:** rain drumming on the skin, louder in the cockpit; thunder after the flash, as late as the strike is far; gusts in the wind's noise.

## v0.3.2 · 2026-11-08 · The Boeings to 45,000 ft, duplicating a scenario, changing the weights in flight

- **The 787's and 777's ALT window now goes to 45,000 ft** (it stopped at 43,000), 1,900 ft past their certified ceiling, so you can take them up there and see what happens. A light one climbs there and levels off; a heavy one runs out of thrust before it. The A321neo's still stops at 39,800 ft.
- **Duplicate a scenario:** each scenario in Load scenario has a Duplicate button. The copy is the same moment, aircraft and load, named "(copy)", at the top of the list. In flight, the pause menu's Save a copy keeps this moment as a new scenario while you fly on in this one. To try things from one point again and again, keep one copy as it is and duplicate it each time: a scenario you fly saves itself as it goes.
- **Change the weights during a flight:** the L window has a Weight tab beside Sky (or Weight and fuel in the pause menu), for the passengers, cargo and fuel, in the air or on the ground. It has the setup's checks (the seats, the hold, the tanks, MZFW and MTOW, and a warning over MLW), Max fills the tanks up to MTOW, and Apply (or Enter) loads it. The aircraft flies on from where it is with the new weight and CG, and the logbook's fuel used stays the fuel burned. Restart the flight goes back to the setup's load.

## v0.3.1 · 2026-11-08 · The gear and flaps on the wing, the seat swap, the engines in the cockpit, the gear doors

- **The main gear hangs from the wing again with the flaps out,** on all three aircraft. The inboard flaps used to start in front of the gear's legs, so with them out the legs seemed to hang from thin air. Each inboard flap now starts behind the legs, and the wing ahead of it carries the gear, as on the real aircraft. The A321neo's wing also sits where Airbus's drawings put it, about a metre further back than before.
- **No more open gaps with the slats and flaps out.** The spoilers overhang the flaps, as real ones do, so a flap that's out leaves a narrow slot under them. The slats run out on tracks in front of a rounded leading edge, the flaps have rounded noses, and the flap track fairings stay in one piece, their tails hinging down with the flaps.
- **Cockpit (or 1) swaps seats again:** press it in the captain's seat for the first officer's, and again to come back.
- **The engines in the cockpit:** still muffled and quieter than outside, but now clearly there. At idle they're level with the air conditioning and on an approach above the wind, where before both all but buried them. In cruise the rush of air still leads.
- **The Boeings' gear doors** have an inside now, so they don't vanish when you see them from the other side.

## v0.3.0 · 2026-11-04 · The Boeing 787-9 and 777-300ER

- **Two new aircraft, in Nuclear Airlines colours.** The 787-9 (HL7879, GEnx engines) and the 777-300ER (HL7773, GE90-115Bs) join the A321neo, each with its own numbers from its type certificate and Boeing's airport-planning document, its own model and cockpit, and its own engine sound. The A321neo flies exactly as it did.
- **Pick the aircraft in New scenario,** with a picture and the key numbers of each. A scenario keeps its aircraft, your old saves load as the A321neo, and the logbook shows each flight's type.
- **They fly like Boeings.** The aircraft holds the speed it's trimmed for, not the flight path: let go and it settles back to that speed, and more thrust raises the nose.
  - **Trim:** H nose up, Y nose down. The trim moves the reference speed (a small mark beside the speed tape). The autopilot trims for itself.
  - **The flare is yours:** there's no flare law and no RETARD call. It takes back pressure, and more as the speed bleeds off.
  - **Soft protections you can overpower:** the trim stops at the minimum manoeuvring speed (the amber band), with a stick shaker and a pitch-limit indicator on the PFD; the nose comes up past VMO/MMO; past 35° of bank it rolls back to 30° once you let go. Holding full input overrides each one.
  - **Flaps:** Boeing's detents (787: UP, 1, 5, 10, 15, 17, 18, 20, 25, 30; 777: UP, 1, 5, 15, 20, 25, 30). `[` and `]` step through them on any aircraft; 6 to 0 go to UP, 5, 15, 20, 30.
- **Boeing's flight deck on screen:** an MCP in place of the FCU (with the same typing and scrolling), and Boeing's PFD with its three-part mode annunciator, ND and EICAS.
  - **More than the A321's autopilot does:** LNAV follows the map's route, a simple VNAV, FLCH, V/S, and APP, which captures the ILS and lands by itself, down the centreline to 30 kt, where it hands back. (No autobrake: you brake.)
  - **The autothrottle:** O is TO/GA: the levers go to take-off thrust, then HOLD above 80 kt. R and F move the levers against it, and it takes them back a second after you let go; X turns it off. There's no alpha floor: armed, it wakes near the stick shaker, except in FLCH with HOLD, as on the real aircraft, and that one can catch you out.
- **The wings bend with the lift,** rising through the rotation: the 787's by a couple of metres at the tips in cruise, the stiffer 777's less.
- **Widebody stands:** the setup lists only the stands a widebody fits (Incheon's code F stands first), parked aircraft are kept clear of yours, and the pushback swings wider. At tight corners on the taxi lines you'll need to swing wide yourself.

## v0.2.2 · 2026-11-04 · Engines that sound like the A321's, the autothrust moving the thrust levers, the Cockpit button

- **New engine sound.** Each engine was one steady tone over a low rumble. Now it's built from what makes a real LEAP-1A's sound, at its real frequencies:
  - the fan's tone (18 blades, so about 240 Hz at idle and 1.1 kHz at take-off thrust) with its harmonics;
  - the buzz-saw rasp that comes in as the fan's tips go supersonic, from about 75 % N1;
  - the core's whine, broadband fan noise, the jet's roar (which grows steeply with thrust), and the combustion rumble.
  - The tones waver a little, as real ones do, and the two engines run a hair apart, so they beat gently.
  - Outside, where you're listening from matters: from the nose you hear the fan and the buzz-saw, from behind the jet's roar, and in 3rd person a far-off aircraft is quieter and duller.
  - In the cockpit the engines are muffled, and in cruise the air outside drowns them.
- **The autothrust moves the thrust levers.** While A/THR is on, the levers (and the blue ring on the N1 dials) follow the thrust it sets, as in a Boeing; "A/THR" shows between the dials.
  - Before, the levers stayed in CL, so a tap of R jumped the engines to climb thrust: from 59 % to 91 % N1 on a final. Now the same tap takes the thrust from where the autothrust had it, a few percent more (59 % to 64 %), and turns A/THR off, with a message. X turns it back on.
  - Pulling the levers to idle at the RETARD still turns it off quietly, as before.
  - The blue ring now sits at the N1 the lever asks for at your altitude and speed, so the needle settles on it.
- **The Cockpit button (and 1) no longer moves you to the other seat** when you're already in the cockpit: there it does nothing. From the other views it takes you to the captain's seat. V still steps through all four views, the first officer's seat too.

## v0.2.1 · 2026-11-03 · Clean runway junctions, changing the route in flight, a view switch, one-finger looking, more stars

- **Taxiways no longer cut into the runways.** Where a taxiway joined a runway (at Jeju, and at Gimpo and Incheon too), its asphalt lay a few centimetres above the runway and was drawn over it whenever you saw it from low down. From the cockpit or a low orbit it showed as jagged dark patches across the runway and its edge lines.
  - The taxiways now stop at the runway's edge.
  - Their yellow centrelines carry on across the runway as lead-on and lead-off lines, painted on it from any angle.
  - The grass no longer shows through the taxiways where the ground curves, as it did on Jeju's parallel taxiway, where the flattened ground by the runway meets the slope. The taxiways and their paint follow the ground there.
- **Change the route in flight.** On the map (M), **Change route**, or a click on an airport, picks a new destination and runway.
  - It opens on the runway you'd fly straight in to, with the distance and bearing direct from where you are, and whether the fuel on board is enough.
  - **Fly there** turns everything to the new runway: the magenta line, the ND, the PFD's approach scales, Skip to 15 nm final and the landing score. The scenario saves it.
  - The departure stays as it was. After landing there's nothing to change: a new flight does that.
- **Dragging the magenta line works in flight.** A waypoint dragged onto the line on the map was kept but never drawn or counted: the map, the ND and the distance still followed the route from the setup screen. Now the line bends through it, and Clear waypoints straightens it again.
- **A view switch** at the top right, next to the FCU: Cockpit, Nose and 3rd person, also on 1, 2 and 3.
  - In the cockpit, Cockpit (or 1) again moves you to the other seat.
  - V still steps through all four views.
- **Look around with one finger.** Press on the view and drag: from the cockpit or the nose it looks around, in 3rd person it goes round the aircraft. The view follows your finger, the same way round as the two-finger swipe, which still works, as do pinch to zoom and double-click to recentre. A plain click does nothing, and a drag that starts on the panels or the map doesn't move the camera.
- **More stars.** On a dark night the sky is full of them: about eight times as many stand out as before, thicker along the Milky Way, and the real stars of the constellations are brighter. Under a bright Moon the faint ones fade, as they do outside.

## v0.2.0 · 2026-11-01 · A main menu, scenarios, and night

- **A main menu, like Satisfactory's.** The game opens on a title screen over a still from the game (Gimpo's apron, the approach to Jeju, or Seoul from the air): Continue, New scenario, Load scenario, Logbook, Settings, Controls, and Exit to Game Dump. Nothing runs behind it.
- **Scenarios: save slots with the whole flight.** Each one keeps everything: where the aircraft is, its speed and attitude, the autopilot and FCU, the fuel, a pushback under way and the taxi route, the approach flown so far (so a landing after a reload still scores the approach), the view and the time of day. Load one and it's exactly where you left it, and it flies on.
  - **Continue** picks up the newest. **Load scenario** lists them newest first, with the route, where the aircraft is ("FL350, 120 nm to RKPC", "Parked at RKPC stand 12") and when it was saved, and they can be renamed or deleted (it asks first).
  - **New scenario** is the flight setup with a name ("Scenario 2" by default, 3–40 characters).
  - **Saving is automatic,** as in Satisfactory: every 60 s in flight, on pause, when the tab hides or closes, and on Exit to menu. The pause menu has Save too. A crash never overwrites the last good save.
  - **Your last v0.1 flight is "Scenario 1",** and your logbook is kept as it was, under it.
- **The pause menu** is a column: Resume, Save, Logbook, Rewind 30 s, Restart the flight, New flight, Settings, Controls, Time of day, and Exit to menu. New flight replaces the scenario's flight; parked at a stand after landing, it starts from that stand.
- **The logbook knows the scenarios.** From the pause menu it shows this scenario's flights; from the main menu all of them, with a filter. A deleted scenario's flights stay, under its name.
- **Settings and Controls pages,** from both menus: the master volume, the callouts, the performance readout, and the keys.
- **Night.** The time of day is a clock in Korean time that runs with the flight (time compression speeds it up). A new flight starts at the real time in Korea, or at a date and time you pick in the setup.
  - **The sky is Earth's:** the sun and the Moon where they really are, the Moon with its phase and a glow, the 8,400 brightest real stars in their constellations, and the Milky Way with its dark rift, all turning with the Earth. Sunsets and sunrises go through golden hour and twilight, with the Earth's shadow and the pink band opposite the sun, and the stars come out as it gets dark. At cruise the sky is darker and the stars sharper.
  - **The light follows the sun,** down to a moonlit or starlit night that is never pitch black: under a full Moon the land is readable.
  - **The cities light up:** streetlights in sodium orange and white, brighter centres, and lit apartment windows close up. From cruise, Seoul and the coast are a sea of points.
  - **The airports are lit:** runway edge and centreline lights, thresholds and ends, touchdown zones, the approach lights with the rabbit, the PAPI, green and blue taxiway lights, red stop bars at the holding points, floodlit aprons and lit terminals.
  - **The A321's own lights** come on as pilots use them: nav lights, the red beacons while the engines run, strobes on the runway and in the air, landing and taxi lights with pools of light on the ground, and the logo light on the tail. Parked aircraft show their nav lights. The cockpit is dimly lit at night, with the screens readable.
- **The Sky window** (L, or Cmd+L as in Satisfactory) stands at the bottom left while you fly: a little sky with the sun's and the Moon's paths and the Moon's phase, a 24-hour track to click or drag, play and pause, the clock's speed, jumps to sunrise, noon, sunset, midnight and now, and the date. It's also in the pause menu and Settings.

## v0.1.4 · 2026-11-01 · Typing into the FCU, easier jumps, stand 7's routes, faster pushbacks, Jeju's crossing, new fonts

- **Type values into the FCU.** Click a window (SPD, HDG, ALT or V/S), type the value and press Enter (or click the window again).
  - Enter also pushes the knob, so a new ALT starts the climb or descent and a new V/S engages V/S. Enter with nothing typed just pushes, as a click did before.
  - An ALT under 1,000 is a flight level (350 is FL350), and a V/S of 60 or less is in hundreds (−15 is −1,500 ft/min).
  - Esc, a click elsewhere or any flying key closes the window unchanged, and the flying key still works. ↑ and ↓ step the value; with Shift, in big steps.
  - While a window is open the digits go to it, so 6–0 don't move the flaps.
- **Scrolling a window turns it faster:** a step for every 12 px of trackpad scrolling instead of 25, and a quick flick turns it in big steps (10°, 10 kt, 1,000 ft or 500 ft/min). Hovering over a window says how it works.
  - 066 is Jeju 07's course, which the FCU takes when you start on (or skip to) a 15 nm final. The knob did turn when scrolled, but only a degree per 25 px of trackpad scrolling, and nothing said it could.
- **Jumps on the map are easier to pick.** A click anywhere on the bright path takes the nearest point of it. It used to need to land within 9 px of one of its dots, which are 5 s of flight apart and far apart when zoomed in.
  - A click on the magenta line now says why it doesn't jump: with the autopilot off there's no bright path, and with it on, jumps go along the bright path, so turn the heading towards the line first.
- **Gimpo stand 7 has taxi routes again,** to all four runway ends. Its pushback ended on a piece of taxi line that passes 14 m from the rest without meeting it, so no route led anywhere. Pieces like that are joined to the rest now, which also connects two short stretches of taxiway by the runways at Gimpo and Jeju.
- **Faster pushbacks:** = speeds a pushback up to 4×. The tug keeps its real 1.5 m/s, and the rate drops back to 1× when the pushback ends.
- **Jeju's runway crossing is one surface.** 07/25, the longer runway, runs whole through the crossing with its markings and lights, and 13/31 meets it at its edges.
  - Near the crossing, the ground under 07/25 used to follow 13/31's slope and sat up to 0.7 m below the drawn runway, so the wheels sank into it. The ground on every runway is now that runway's own surface.
- **New fonts:** B612, made for Airbus's cockpit screens, on the screens and the FCU; Barlow, the menu font of Game Dump's Satisfactory, in the menus. The pause menu's buttons are darker, with Resume highlighted.

## v0.1.3 · 2026-10-31 (night) · A stricter landing score, a master volume, and a performance readout

- **The landing score is stricter: 100 and 0 are both nearly out of reach.**
  - Every part costs something as soon as it's off its ideal. The free bands are gone (±150 m around the aiming point, 3 m either side of the centreline, 60–250 ft/min).
  - The costs multiply the score down, so 100 takes a landing that's perfect in every part, and 0 takes several things going badly wrong at once. One poor part on its own, say 900 ft/min or 20 m off the centreline, still leaves 20 or more.
  - **The approach counts now**, from 1,000 ft down: how far it strayed from the PFD's glideslope and localizer (in dots), and how much the sink rate swung (bobbing).
  - Set against your landing: 190 ft/min, 2 m left of the centreline, 150 m past the aiming point, after a final that was about 150 ft up 1 km out and had to bob back up. It scored 100 before and **80 (B)** now. The same touchdown after a steady approach scores about 91.
  - The card's verdict names the biggest flaw ("Off the path on final (low). Get on it early and stay there."), and the points it lists add up to what was lost.
  - A touchdown off a runway (a taxiway, say) now scores about 10 at best, not 0.
  - The grades are unchanged: A from 90, B from 78, C from 64, D from 50.
- **A master volume slider** in the pause menu, for the engines, the warnings and the callouts. When you let go of it you hear a moment of sound at the new level. It's remembered.
- **A performance readout like Satisfactory's.** F3 or ` (or the pause menu) shows a line across the top: fps; ms per frame, split into the physics and the drawing; physics steps; draw calls; triangles; the GPU's geometries, textures and shaders; terrain rings, buildings and lights; the resolution; and memory. The screens move down to make room. It's remembered too.
- **Fixed:** at Jeju runway 31, which has a displaced threshold, the PFD's glideslope and localizer were measured from a point 411 m too far down the runway, and so was the route's end on the ND and the map. On the real path 3 km out, the PFD showed you most of a dot low.

## v0.1.2 · 2026-10-31 (evening) · A lower windshield, engines under the wing, and grass that doesn't bite

- **The windshield is a low band now, thinner than the side windows,** as on the real A320 family.
  - The nose's crown drops steeply over the windshield and then runs gently down the radome to the tip, so the windshield sits on the steep part.
  - From the seats you still see about 17° down over the nose and 16° up. The glare shield, the FCU and the instrument panel moved back to fit under it.
  - The side windows are taller, and the rear window is smaller than the sliding window.
- **The engines hang clearly below the wing, with the pylon showing,** instead of tucked up against it like a 737 MAX.
  - They sit where Airbus's documents put them: the nacelle's low point is 0.45 m above the ground.
  - The wing is about 0.3 m higher, which Airbus's documents also support, and the main gear legs now reach up into it.
  - The parked aircraft at the airports got the same treatment.
- **Touching down on the grass doesn't crash you any more,** as long as the touchdown is gentle. A hard touchdown still breaks the gear anywhere.
  - On grass the wheels roll heavier and brake and grip less than on a runway.
  - A long, fast run across the grass (more than 450 m above 29 kt) still ends the flight.
  - The score counts a touchdown up to 400 m short of a runway, if it was lined up with it, and adds "On the grass" (−25). A landing 150 m short scores an F 40: "Short of the threshold. Far too close."

## v0.1.1 · 2026-10-31 (afternoon) · Fixes: Incheon's taxiways, the cockpit windows and the landing score

- **No more flickering taxiways.** Where a concrete taxilane met an asphalt taxiway, the two surfaces fought over the same spot and flickered in jagged patches, worst at Incheon. The airport ground now draws in a fixed order (taxilanes, then taxiways, then aprons and stands), so the overlaps are clean at all three airports.
  - The faint pale lines across gently bending taxiways are gone too. They were small gaps on the outside of each bend.
- **New cockpit windows, shaped like the A320 family's:** a wide windshield either side of a slim centre post, a slanted side post, the sliding window, and the smaller rear window.
  - From the seats, every frame is a straight line, and the side post is about 45° to your left (to the right for the First Officer). It used to cross the view straight ahead.
  - From outside, the glass has crisp edges and catches the sun.
- **A fairer landing score.**
  - Every part now has a ceiling, so one bad number costs a lot but can't zero the score by itself: vertical speed 50, peak g 15, the touchdown point 35, the centreline 20, bank 15, pitch 15 and bounces 25. A normal 350–400 ft/min landing in the touchdown zone now scores a B.
  - It's measured against the runway you actually touched down on, whichever that is.
  - A touchdown off the runway, on a taxiway say, scores 0 and says so: "That wasn't a runway." It used to be measured against the runway picked in setup.
  - Peak g counts the touchdown and any bounce, not the bumps and braking on the rollout.

## v0.1.0 · 2026-10-31 (overnight) · The first build: an A321neo over South Korea

- **The A321neo, with realistic physics** from Airbus's and EASA's published numbers: weights, flap and gear speeds, stall speeds, and the LEAP-1A's thrust and spool-up.
  - Flaps and slats, with 1+F on the ground.
  - Gear, wheel brakes, reverse thrust, and ground spoilers that come up on touchdown.
  - Fuel burns off and lightens the aircraft.
- **Fly-by-wire:**
  - In Normal law, the aircraft holds its attitude and trims itself when you let go, and the flare law has you flare by hand.
  - A switch on the FCU gives Alternate law, which has no stall protection, so you can stall it.
- **Four views:**
  - 1st person from the nose;
  - 3rd person around the aircraft;
  - the Captain's and the First Officer's seats in a simple cockpit.

  A two-finger swipe looks around, a pinch zooms, and a double-click recentres.
- **Screens in every view:**
  - the PFD, with ILS-style deviation scales for the destination runway;
  - the ND, a moving map with the line to your destination;
  - an engine panel: N1, fuel flow, fuel, flaps, gear, spoilers and brakes;
  - the FCU along the top.
- **Autopilot and autothrust:** heading, altitude (click ALT for a level change), vertical speed and speed.
  - Time compression goes up to 16× while the autopilot flies, at least 2,000 ft above the ground. It drops back to 1× by itself on a disconnect, a warning, or near the ground.
- **The map (M):**
  - the line to your destination from wherever you are (it never says you're going the wrong way), and waypoints you can drag onto it;
  - with the autopilot on, the path the aircraft will fly, in a bright colour, ending with a red cross where it would meet the terrain;
  - click a point on the path to jump there;
  - "Skip to 15 nm final".
- **South Korea:**
  - the real coastline and elevation for the whole country, with the neighbours' coasts around it;
  - the Han River and the big lakes;
  - forests, fields and rice paddies, and cities of apartment slabs, placed from real land cover with procedural detail that fades as you climb.
- **Gimpo, Incheon and Jeju:**
  - runways with markings, lights and PAPIs;
  - taxiways, aprons, numbered stands, jet bridges and terminals;
  - parked aircraft in made-up liveries, and ground vehicles driving around.
- **Three ways to start:** lined up on the runway, on a 15 nm final, or at a gate.
  - At a gate, P pushes back, and a taxi route drawn on the ground leads to the runway.
  - After landing, a new route leads to a free stand.
- **Sound:**
  - engines, wind, gear, flaps, spoilers, reversers and brakes;
  - the warnings;
  - the radio-altitude callouts from twenty-five hundred down to ten, with RETARD.
- **Landing score and logbook:**
  - Every landing gets a grade, from vertical speed, g, the touchdown point against the aiming point, distance from the centreline, bank, pitch and bounces.
  - The logbook (pause menu) keeps your flights.
- **Rewind 30 s,** after a crash or from the pause menu (T).
- **Nuclear Airlines:** white and navy, uranium green and Cherenkov blue, hazard stripes, a glowing atom on the tail, registration HL8787.
- **Light on the machine:** a 60 fps cap, and nothing runs while paused or in a hidden tab.
- **Known issues:**
  - Gimpo stand 7 has no taxi route to 14L/32R.
  - Pushback is slow (about 100 s).
  - A late keyboard flare still lands firm.
  - If the first touchdown isn't on a runway, the score is measured against the runway picked in setup, and the distance from its centreline has no cap, so the landing can score 0/100.
