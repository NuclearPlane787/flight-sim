# Updates

What each update added and changed, newest first. Dates are in KST. Each commit to the repository is titled with its version number alone, and this file says what's in it. The game shows its version in the pause menu and on the loading screen.

<!-- Agents: add new versions here, newest first, in the same style. -->

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
