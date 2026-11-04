# Updates

What each update added and changed, newest first. Dates are in KST. Each commit to the repository is titled with its version number alone, and this file says what's in it. The game shows its version in the pause menu and on the loading screen.

<!-- Agents: add new versions here, newest first, in the same style. -->

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
