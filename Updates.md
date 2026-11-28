# Updates

What each update added and changed, newest first. Dates are in KST. Each commit to the repository is titled with its version number alone, and this file says what's in it. The game shows its version in the Esc menu and on the loading screen.

<!-- Agents: add new versions here, newest first, in the same style. -->

## v0.8.0 · 2026-11-28 · Failures: the Failures tab, warnings and checklists, the engines, the gear, the hydraulics and the degraded control laws; the data in its own repository

Update 8 begins. Things can now fail, when you say so or by surprise.

- **A Failures tab in the L window** (`\` or Cmd+L, beside Sky, Weight and Weather). Pick a failure, what it happens to and when: now, at a moment of the flight (on the take-off roll above 100 kt, at rotation, after lift-off, climbing through 10,000 ft, in cruise, on approach below 3,000 ft, on short final below 500 ft), after a time, or at random within a window. A random failure tells you only "A random failure armed, within N minutes": not which, not when. The tab lists what is armed and what has failed, with Disarm, Repair and Repair all.
- **Master warning and master caution.** A red MASTER WARN and an amber MASTER CAUT light by the PFD (WARNING and CAUTION on the Boeings), with Airbus's repetitive chime and single chime and the Boeings' fire bell, siren and caution beeper, all synthesised. Click a light, the SILENCE button or `'` to cancel the sound and the light; the message stays on the engine display, as ECAM's on the A321 and as an EICAS list on the Boeings.
- **Clickable checklists.** Each failure opens its real procedure in short form beside the engine display. A step that is a switch is a button that does it; a step that is flying ticks itself when it is true. No overhead panel and no new keys.
- **Each engine has a switch on the engine display:** ENG MASTER on the A321, FUEL CONTROL on the Boeings, one under each engine of a design. Click it to shut the engine down, click again to start it: about a minute on the ground, and in the air 30 to 50 s inside the start envelope (too high or too slow and it won't light, and the checklist says why).
- **Engine failures:** a flameout (the engine windmills and drags; switch it off and on to relight it), a seizure (N1 to 0 in seconds, more drag, no restart) and a fire (it trails smoke and keeps running until you shut it down: the lever to idle, the switch off, the fire handle, agent 1, agent 2 if it still burns after 30 s). Most fires go out with the first bottle, some need the second, and a few burn on to the landing.
- **Gear failures:** the normal extension fails (the doors open, the legs stay up, and the checklist's gravity extension drops them in about 30 s, unless that has failed too), a leg that won't lock down, and a leg that collapses at the next landing. Each leg now moves on its own.
- **You can see which leg is missing:** in the outside view, and on the gear lights (a red triangle on the A321, three boxes reading DN or UP on the Boeings).
- **Landings on two legs or none.** Land with the gear up or a leg missing, whether it failed or you forgot it, and if you fly it on gently the aircraft slides to a stop on its belly and nacelles. The landing card says what kind of landing it was. Fly it on hard and it is a crash, as before.
- **Hydraulics.** Each type has its three systems (green, blue and yellow on the A321; left, centre and right on the Boeings) with their pumps, the A321's PTU and the RAT. Fail an engine's pump, a system's electric pumps, or drain a whole system from the Failures tab. A lost system takes its users with it: the gear lever (use the gravity extension), the normal brakes, the nose-wheel steering, a reverser, some spoilers, the flaps' and slats' speed, and some of the controls' speed. An engine failure now costs its pump; the RAT drops out by itself when every engine stops or two systems are lost.
- **Degraded control laws.** With two hydraulic systems lost the A321 flies in alternate law and, gear down, in direct law (the stick moves the surfaces directly and you trim by hand: "USE MAN PITCH TRIM"); the Boeings fly in secondary mode, and in direct mode with all three lost. No autopilot in direct law or secondary mode.
- **Flaps and slats can jam.** They stay where they are; the PFD's speeds are the real ones for that, and the checklist gives the approach speed and how much longer the landing is.
- **Rewinds, jumps and saves know about failures.** What you have armed stays armed through a rewind or a jump, so the failure happens again when you fly through its moment again; a repaired failure is gone for good; a scenario saves both. A skip to final keeps what has failed, so you can fail an engine in cruise and skip ahead to land on one.
- **The game's data has its own repository,** [flight-sim-data](https://github.com/NuclearPlane787/flight-sim-data), cloned as `data/` inside the game's folder. The game's own repository is much lighter to clone from here on, and its history still holds the data up to v0.7.9. If the data isn't there, the loading screen says so with the command to get it.
- **With no failure armed and the gear down nothing has changed:** the flight model is the same to the last bit, and the world draws exactly as in v0.7.9.
- **Estimates:** the start envelopes, the start times, a dead engine's drag, the fire's odds, the gravity extension's time, a belly landing's limits, which hydraulic system drives what, and the degraded laws' feel are estimates; no type's own document was read for them.

## v0.7.9 · 2026-11-24 · The map's airports and bases, cities at night, and the leftovers

- **Military bases have a colour of their own on the path map.** Ramstein, Lakenheath, Fairford, Lossiemouth and Rota are amber, their runways too. The four airports shared with an air base (Zaragoza, Komatsu, Kunsan and Cheongju) keep the airports' blue with a small amber diamond. The legend and the tooltip on an airport say "military base" or "joint civil and military".
- **Zoom in on an airport and the map draws it in full:** the aprons and taxiways at their real widths; then the taxiways' names in sign-style boxes, the hold-short bars and the runway numbers at the thresholds; then the yellow centrelines and the stand numbers. The map now zooms in to 1 m a pixel (2 m before).
- **Your taxi route is on the map.** At the gate, during the pushback and while taxiing, the map draws the route you were given from the aircraft to its end, labelled "HOLD 27R" or "STAND 38". It clears once you line up or reach the stand.
- **Cities at night look like cities from above.**
  - **The main roads are lit:** motorways, trunk and primary roads from OpenStreetMap as continuous lines of streetlights, brighter and whiter on the bigger roads. From 10,000 ft you see each city's road net, its ring roads and its bridges: Tokyo's expressway web, the Périphérique, the M25, the Han's bridges.
  - **Cars on the motorways:** white headlights coming toward you and red tail lights going away, on the country's side of the road, moving with the clock and thinning out late at night.
  - **Downtowns are brighter and denser; parks, rivers and water stay dark;** the suburbs' lights no longer sit on a grid. The colours follow the country: whiter LED in Korea and Japan, a mix in China, warmer sodium in Europe's streets.
- **Towns by day, seen from afar,** are no longer flat grey ground. Past the buildings the ground shows the town's blocks, lots and roofs in each country's colours (slate in Britain, zinc and slate in Paris, terracotta in the south, Korea's apartment slabs, Japan's dark tiles); the real city centres are a darker, denser mass; parks and rivers stay green and blue. It shows most from 10,000 ft; from 3,000 ft the far ground's grey speckle is gone and neighbourhoods and avenues show faintly through the haze, most over Paris.
- **Weather by place, the second half:**
  - **You see the destination's weather ahead.** On a flight between two weathers the clouds are drawn where they are: from the cruise in clear air the destination's overcast stands on the horizon ahead and grows as you near it, where the sky stayed clear all round until you flew into it. Lightning flashes come from where the storm is.
  - **Fronts can move.** In the Weather tab, a flight with two weathers has a "Front" row: Still, To departure or To destination. A moving front carries the destination's weather toward the departure (or away from it) at 30 kt along the route, so the weather at a place changes with the clock: wait at the gate and the storm arrives.
- **Taxi routes:**
  - **After a pushback the taxi route leaves ahead of the nose.** Where two ways to the runway were nearly as long, the route could start behind the aircraft, or go ahead and double straight back, so you had to turn round in a junction: about one pushback in twenty did (42 of 872 tried, at Narita, Fukuoka, Qingdao, Zurich, Lyon, Venice, Gibraltar and others). Now the route takes the way ahead where there is one within 800 m of the shortest, crossing no more runways than before where it can; sixteen of those 872 still turn round, where no taxiway leads on ahead. At Prague this was the corner where A1 meets Z: from stand 3 to runway 24 the taxi now stays on the pavement.
  - **Glasgow:** a departure from 23 is sent to hold B1, as the published procedure has it; it was sent to a hold on a taxiway loop that led nowhere.
  - **Lossiemouth:** after landing, the route turns into your ramp spot from the taxiway behind it; it passed the spot and doubled back.
  - **Fairford:** the hardstands round the loops are joined to the taxiways by concrete.
- **The gates' leftovers:**
  - **Every type's nose wheel stands on the stop bar.** The bar is the A321's; a 787-9's nose wheel stopped 0.1 m short of it, a 777-300ER's 0.6 m and a parked widebody's 1.7 m.
  - **Thirty-one more gates have a jet bridge** (2,330 of 2,480): a bridge round an elbow where the terminal's wall is ahead of the nose on its right, and a long link where the wall is 80 to 110 m from the door. No bridge passes over another stand, across another bridge or through a building.
  - **A gate with nobody at it keeps its bridge drawn back** toward the terminal; it stood out in the open apron where a door would be.
  - Four of Incheon's bridges reached 80 m and more behind their gates, toward an aircraft at another stand with the same number; mended.
- **Looks:**
  - **Park trees in the real city centres have round crowns,** where they were faceted mounds.
  - **The Bergisel jump's in-run** is a ramp between walls on a deep girder with legs, not a thin strip.
  - **Notre-Dame de la Garde stands on a grey limestone crag** above Marseille.
  - **Kanazawa's centre is drawn building by building** (7,115 buildings, 965 before), so the old town round the castle reads as a dense city.
  - **The Rock of Gibraltar's ridge is sharper** and higher at its north end, its east face steeper, shaped to its published heights (426 m at O'Hara's Battery, 412 m at the north summit).
- **Not in this update** (each is in the roadmap): Cologne Bonn's south-west apron, Barcelona's harbour basin, Cheongju's centre (OpenStreetMap has no downtown there yet), and published values for the fifteen airports that are still estimates.
- **Switches** on the page's address, each giving v0.7.8's look back: `?map79=0`, `?lights79=0`, `?gates79=0`, `?wxahead79=0`, `?towns79=0`, `?trees79=0`, `?bergisel79=0`, `?ndg79=0`.

## v0.7.8 · 2026-11-23 · The gates, the runway crossings, landmarks, parks and East Asia's ground

- **The gates fit the aircraft at every airport.** The jet bridge and the stop bar stood 21 m ahead of the aircraft they served (v0.7.6 mended four airports); now, at all seventy-two:
  - **The jet bridge's cab stands at the front door of the aircraft at that gate,** yours or a parked one: 4 m behind the nose for an A321, 6.3 m for a 787-9 and 6.8 m for a 777-300ER, higher and further out for the widebodies. Take a 777 to a gate and its bridge moves to the 777's door. A gate with nobody at it keeps a bridge that clears every type.
  - **The stop bar lies under the nose wheel,** and the lead-in line ends at it, where it ran on 5.3 m.
  - More gates have a bridge: 2,299 of the 2,480 gates in the game, where 1,869 had one, and a gate that has one has it for every type. Qingdao has thirteen fewer (their terminal walls are on the wrong side of the nose).
- **Runways that cross meet without a step.** Where a runway crossed a longer one at an angle, its surface stepped off the centreline: 33 cm at 20 m off at Dublin, 27 cm at Prague, 24 cm at Lossiemouth, 12 cm at Cologne Bonn, 8 cm at Jeju, and 3 to 6 cm at Zurich, Orly, Haneda, Niigata and Hamburg. Every such runway now bends where each edge of the longer runway meets each of its own sides, as Brussels's 01/19 has since v0.7.4, and nothing over 2 cm is left at any crossing in the game (the largest, 1.7 cm, is a slope at Dublin). The ground there has changed: Prague's 12 starts 0.4 m higher, level with the runway it crosses, and falls gently for its first 23 m.
- **Landmarks:**
  - **Nagoya's and Osaka's castles** have weathered green roofs and mid-grey stone bases; they read pale mint and pale grey.
  - **Tower Bridge runs on to both banks:** its south end stood in the river.
  - **Hamburg's Elbphilharmonie** has its glass crown rising in waves to the 108 m tip over the brick warehouse.
  - **Innsbruck's Bergisel jump:** the tower stands on the hill's crest and the in-run runs down the slope; it was a small tower at the foot.
  - **Notre-Dame de la Garde stands on its 150 m hill** over Marseille; the hill wasn't there.
  - **The Rock of Gibraltar rises to its full 426 m** (364 m before).
- **The air bases:** the hardened shelters are low concrete vaults with their doors toward the taxiways, where they were 9 m boxes (Ramstein, Lakenheath, Lossiemouth, Zaragoza, Cheongju, Komatsu, Kunsan). Zaragoza's and Lossiemouth's shelters, hangars and pads are joined to the taxiways by pavement; Fairford's hardstands have smooth edges; Zaragoza's stand 2, which overlapped stand 1, is gone.
- **Parks, trees and the town near airports:**
  - **Parks in the cities with real buildings are parkland:** mown lawns with scattered broadleaf trees, where a conifer forest stood, as round the Atomic Bomb Dome and in Hiroshima's Peace Park, and round Nagoya's, Osaka's and Kanazawa's castles.
  - **No tree grows through a real building or a landmark.**
  - **Near an airport the generated town keeps low:** two or three storeys within about 500 m of the field and under the first 4 km of each final. The wall of towers past Itami's fence and the tall dark blocks under Kunsan's final to 18 are gone.
- **East Asia's ground:**
  - **Kanazawa has a real city centre** from OpenStreetMap: the station, the castle park, Kenrokuen and Korinbo.
  - **Hokkaido's 30 m land cover is cleaned of speckle,** as the rest of the region's was (about 1 pixel in 75 changes).
  - **Thirty-eight cells where neighbouring 250 m tiles disagreed are mended;** none was in sight of an airport.
- **Europe's countryside: the Fens and East Anglia are big open arable fields** in stubble, soil and crop, where v0.7.7 made them small hedged pastures.
- **Taxi instructions are one line.** They name taxiways, not their numbered pieces or gates ("KA", not "KA-7"; never "GATE-5"), and don't repeat a name. A long one keeps its first taxiways, its last and every runway it crosses or runs along, with "…" for what is left out in between: "Taxi to holding point J14 for 17R via B, C, Z6, Z3, T4, Y3, …, J14, crossing 17L/35R". Madrid's longest ran to 262 characters over two lines and named a gate; Pudong's to 186; none is over 84 now.
- **The high Alps carry snow,** as do the Pyrenees' tops and the Sierra Nevada's summit; steep faces stay rock, and the valleys are as they were.
- **Kaiserslautern has a real city centre** from OpenStreetMap, by Ramstein's finals: the old town round the Stiftskirche, the town hall's 80 m tower, the station and the stadium on the Betzenberg.
- **Incheon's stand 7 pushes back on pavement:** the wedge its lead-in line crosses was unpaved.
- **A gate start on sloping ground stands on its wheels.** At Jeju's stand 1, where the apron falls nearly 2 m along the aircraft, the game stood the aircraft level, the nose gear began inside the ground, and the flight opened with the aircraft thrown into the air and a tail strike. A start on ground steeper than 2 % along the aircraft now takes the ground's own pitch. This was an old fault, found by this version's checks.
- **The new looks can be turned off from the page's address:** `?gates78=0` (the gates), `?crossings78=0` (the crossings' shapes), `?landmarks78=0`, `?bases78=0` (the shelters), `?trees78=0` (parks and trees), `?towers78=0` (the low town near airports), `?fens78=0` and `?snow78=0`. The baked data has no switch: the Rock, Notre-Dame de la Garde's hill, Zaragoza's, Lossiemouth's and Fairford's pavement, Kanazawa's and Kaiserslautern's centres, Incheon's stand 7, Hokkaido's cover and the mended cells.
- **Against v0.7.7:** with every switch off, all sixteen of East Asia's standard views and all twenty-six of Europe's match the last version pixel for pixel. With the new looks on, fifteen of East Asia's differ: the gates at Gimpo and on Haneda's, Pudong's and Beijing's finals, the parks in Seoul, Beijing and Tokyo, and the lower town short of Pudong's and Beijing's runways (0.05 to 3.7 % of their pixels). Twenty-one of Europe's differ: London's and Paris's parks, the snow over Zurich and on the Alps from FL350, and the gates and the lower town on eight finals (up to 1.9 %). The frame rate holds: 60.0 to 60.1 fps, worst frame 16.8 ms, at a stand by day and by night and on the final at Incheon and at Heathrow, each alone on mains. A scene draws 1,000 to 5,000 more triangles for the bridges.

## v0.7.7 · 2026-11-23 · Europe's towns, countryside and ground

- **Europe's towns:**
  - **Courtyards are open in the thirty-four real city centres.** A building round a courtyard was roofed over from wall to wall; now its yards are open to the sky, with walls on their inner sides: 6,473 courtyards, from London's and Paris's blocks to Zaragoza's. The centres draw about 3 % more triangles.
  - **The generated town blends into the real centre** instead of stopping at a ring round it. Over a band round each centre, whose line wanders by about 250 m, the generated town thins to about half; further out its courtyard blocks give way to other buildings, the storeys fall, and the blocks' size and the roofs' colours vary from place to place. Flats near a centre stand taller. Where a centre's real buildings stand dense right up to its edge a line can still show, as on the west side of London's.
  - **Low suburbs past the centres.** Away from a centre fewer of the generated town's blocks are courtyard blocks (from about 85 % near one to 30 % far off), and the rest are terraced houses: rows of terraces up to 110 to 160 m long under tiled ridge roofs, with gardens between them reaching to the street (lawns in several greens, a ragged hedge line, the odd patio or tree). Each quarter of a block is laid out its own way, three to five rows, across the quarter or along it, and about one in ten is left as a green; many rows are broken short; a neighbourhood shares one family of roof tiles, so a town no longer reads as one block stamped over and over. No house stands in a wood. Toulouse's and Dijon's suburbs, London's outskirts and Amsterdam's south-east are streets of terraces now. Villages keep their look, Lucerne's among them. The gardens are drawn only as far as the houses reach, about 6 to 8 km from you, so from high up there is no lattice of green plots over a city.
  - **No town blocks in the rivers.** No generated building stands on a river where the 30 m land cover maps water: the pink block in the Main below Frankfurt's Commerzbank Tower is gone, and within 8 km of Frankfurt, London and Zaragoza no building has its middle on the water (26 to 48 at each before). In a town, near the bank, the river's edge is drawn from the 30 m land cover, so a narrow river reads its own width close up. Where there is no 30 m cover (Dijon), on rivers only one or two of its cells wide, and from far off, rivers are drawn as before: the Seine by Issy is as blurred from 3,000 ft as it was.
- **Europe's countryside:**
  - **The fields follow the borders,** not bands of latitude and longitude, with each change softened over about 10 km: all of Great Britain and Ireland are small hedged pastures; France has its hedges in Normandy and Brittany, open fields in its north and middle and dry fields in the south; Spain and Portugal are dry but for their green Atlantic north; the other countries' fields are as they were. The Fens are hedged too now, where the real ones are big open fields. The hedged fields' colour from far off is a little brighter, so no step shows where it takes over.
  - **The polders have no seams.** Their strips turn a little from one district to the next, where they turned 90° at straight lines every 8 km; the grassland in a polder is drawn as the polder's own strips, not as blurred bands across them; and their colours are muted to the grass's tone with a few brown parcels, so Schiphol's final has no bright patch with a straight edge. A ditch now crosses the head of every row of strips, where the next row's ditches start out of line, and in the middle distance the ditches stay thin lines instead of dark smears. Polder strips are the Netherlands' alone now: the Fens, the German and Danish marsh coasts and the Po's delta lose theirs.
  - **Bare ground isn't snow.** Below about 1,900 to 2,600 m bare ground is a darker, warmer earth, and in a town it takes the town's ground: the Bardenas Reales by Zaragoza, a pale grey-white sheet before, are brown earth, and the straight graded lots and wheel tracks that crossed them are drawn only in towns now.
  - **An airfield's grass takes its place's tone.** In the dry country it is straw-coloured, and its edge is soft and uneven: Zaragoza's is no longer a hard-edged green rectangle on dry ground.
- **Europe's ground:**
  - **Lakes lie flat at their own level.** A lake's surface was drawn 2 m under each of its nearest banks, so it wasn't flat and climbed its shores in the mountains. Now every lake that the elevation data maps flat is drawn at its own level: the IJsselmeer and the Markermeer at −0.25 m (from −2.75 to 0.75 m and −5.25 to −1.75 m before), Loch Ness at 16 m (19 to 484 m), Lake Lucerne at 433.5 m (412 to 620 m), and Geneva, Constance, Garda, Maggiore, Zurich, Lough Neagh and Bolsena likewise: about 16,900 km² of water in all. No lake is ever drawn at the sea's level. Rivers, ponds and the water below a dam are as before.
  - **Schiphol's ground** no longer dips to −19.5 m under Amsterdam's stadium and in the city's south-east: nothing in its 30 m ground is lower than −7 m, the polders' real depth. The airfield itself is unchanged, and its finals by 1.5 m at most.
  - **Cristo Rei stands on its cliff** above the Tagus: the ground under the statue is 115 m, where it was 87 m and the statue stood half sunk behind the cliff's edge; from the river its whole pedestal shows at the plateau's edge.
- **The new looks can be turned off from the page's address:** `?towns77=0` gives v0.7.6's towns back (the roofed courtyards, the ring round each centre, the blocks in the rivers, the courtyard blocks out to the town's edge), `?suburbs77=0` takes away the suburbs alone, keeping the rest of the towns' changes, and `?fields77=0` v0.7.6's countryside. The lakes, Schiphol's ground and Cristo Rei's cliff are the ground's data and have no switch.
- **Against v0.7.6:** All sixteen of East Asia's standard views match the last version pixel for pixel. In Europe, with both switches off, all twenty-six standard views match v0.7.6 drawn on the new ground pixel for pixel; against v0.7.6 itself fifteen of them differ, only where the lakes' new levels and Schiphol's ground show (London by day and by night, the Thames from 10,000 ft, Zurich by day and by night, the Alps from FL350, Rome, both polder views, Biscay to Madrid and Vienna from FL350, and Madrid's and Schiphol's finals, by 0.0002 to 0.97 % of their pixels; Barcelona and Munich's final by one level in a few pixels). With the new looks on, all twenty-six differ, in their towns and fields (Vienna from FL350 by two levels in a few pixels). The frame rate holds: 60.0 to 60.1 fps, worst frame 16.8 ms, at Heathrow's and Frankfurt's stands and finals by day and by night and over Paris, London and Frankfurt from 3,000 ft, each alone on mains.

## v0.7.6 · 2026-11-22 · Ramstein, Lossiemouth, Lakenheath, Fairford, Zaragoza and Rota

- **Six military bases in Europe, forty-three airports there and seventy-two in all,** each about 95 km or more from any other airport in the game:
  - **Ramstein** (ETAR), the US Air Force's base by Kaiserslautern in Germany, 95 km from Frankfurt: two runways side by side, 08/26, 3.2 km, and 09/27, 2.8 km (its numbers are old: it points about 7° from what they say), with an ILS to all four ends. Four ramp spots on Ramp 1.
  - **Lossiemouth** (EGQS), the Royal Air Force's base on the Moray coast in the north of Scotland: 05/23, 2.8 km, with an ILS both ways, and 10/28, 1.85 km, crossing it. Two groups of nine hardened shelters. Four ramp spots on D Apron.
  - **Lakenheath** (EGUL), in Suffolk, 125 km from Heathrow: one runway, 05/23, 2.7 km, with an ILS both ways, and 43 hardened shelters. Three ramp spots on Victor Ramp. Its neighbour Mildenhall, 8 km off, is not built.
  - **Fairford** (EGVA), in Gloucestershire, 95 km from Heathrow: 09/27, 3.0 km long and 61 m wide, one of Europe's longest runways, with an ILS both ways; no shelters, only open hardstands, as the real field has. Three ramp spots on the north-east apron.
  - **Zaragoza** (LEZG), Spain's air force base shared with Zaragoza's airport: two parallel runways, 12R/30L, 3.7 km, and 12L/30R, 3.0 km, with a category III ILS to 30R, the only one. Its civil apron has 22 stands and its airliners, as at any airport; the air force's side is empty.
  - **Rota** (LERT), the Spanish and US Navy's base on the Bay of Cádiz: one runway, 10/28, 3.7 km long and 61 m wide, with an ILS to 10 and no approach lights at either end. Five ramp spots on the main apron.

  Zaragoza and Rota are from Spain's AIP (their runways, lights, PAPIs, ILS and transition altitudes, 6,000 ft at both). The four others' military AIPs couldn't be read, so their lights, ILS categories and threshold heights are estimates; their runways are OpenStreetMap's, checked against OurAirports.
- **The military sides are empty,** as Cheongju's, Komatsu's and Kunsan's are: the hardened shelters (drawn as plain blocks 9 m high, an estimate) and hangars from OpenStreetMap's buildings, the ramps and taxiways, and no parked aircraft, no ground vehicles and no gate. At each base but Zaragoza a few ramp spots are for you alone, to start from. The military taxiways are kept, so a route can cross them.
- **New ground round the bases:** 250 m terrain over Scotland's far north (Lewis, Caithness and Orkney), Devon and the Bristol Channel, and the Gulf of Cádiz with the Algarve's east, and 30 m land cover within 100 km of each base.
- **Zaragoza has a real city centre** from OpenStreetMap: the old town between the Ebro and the Paseo de la Independencia, La Seo, and both banks at the stone bridge.
- **Three new landmarks by the bases,** sixty-four in Europe: Ely Cathedral, near Lakenheath, with its west tower and the Octagon's lantern over the fens; Zaragoza's Basílica del Pilar on the Ebro, with its four towers and eleven domes tiled in green, yellow, blue and white, floodlit at night; and Cádiz Cathedral on the sea front across the bay from Rota, with its golden dome and two towers.
- **East Asia's aurora is in the north only,** as Europe's has been since v0.7.4: full from 44° N (Hokkaido's north), fading to none at 40° N. Over Sapporo it is strong, over Aomori faint, and over Sendai, Tokyo, Nagoya, Osaka, Seoul and Jeju there is none. `?auroraband=0` on the page's address brings back the old sky.
- **The jet bridges and stop bars meet the aircraft** at Centrair, Itami, Hiroshima and Cheongju. The aircraft was always parked in the right place; the bridge's door and the stop bar were laid out about 21 m ahead of its nose. Now the stop bar is under the nose wheel and the bridge comes to the door behind the nose. The same is true at every other airport, where nothing has changed yet: `?gatefit=1` shows them all laid out the new way, `?gatefit=0` none.
- **Against v0.7.5:** with the aurora's band and the gates' fit switched off, East Asia's sixteen standard views match the last version pixel for pixel. With them on, six night views differ in their skies alone (Seoul by night and from 3,000 ft, Tokyo from 3,000 ft, and Haneda's, Pudong's and Beijing's finals), and no standard view shows one of the four airports' gates. In Europe twenty-four of the twenty-six standard views match pixel for pixel; the other two differ only in a thin band at the horizon where a new base's ground lies (Fairford, from 10,000 ft over the Thames looking west; Zaragoza, from FL350 over the Bay of Biscay).

## v0.7.5 · 2026-11-22 · Cheongju, Hiroshima, Centrair, Itami, Komatsu and Kunsan, and every runway end

- **Six more airports in East Asia, twenty-nine there and sixty-six in all:**
  - **Cheongju** (RKTU), in the middle of South Korea: two parallel runways of 2.7 km, 06L/24R and 06R/24L, with an ILS to all four ends. It shares its runways with an air force base: 06L/24R is the airliners' runway, and 06R/24L, the air force's, is listed after it as a standby (the AIP allows it to airliners only when the other is closed). 17 stands on the civil apron.
  - **Kunsan** (RKJK), on the Yellow Sea coast by Gunsan: one runway, 18/36, 2.7 km, with an ILS both ways, on an air base with a small civil terminal at its north end. Two stands, none for a widebody (the taxiway to the terminal takes nothing wider than about 36 m).
  - **Osaka Itami** (RJOO), Osaka's city airport among the houses, 44 km from Kansai: 14R/32L, 3.0 km, and 14L/32R, 1.8 km. **The approach to 32L comes in low over the city,** with the only ILS. **14R and 14L are circling-only:** a straight final to either passes too low over the hills to the north-west, so you circle to them from an approach to the south-east end, as the real approaches do. 51 stands.
  - **Nagoya Chubu Centrair** (RJGG), on its own island in Ise Bay: one runway, 18/36, 3.5 km, with an ILS both ways (category III to 36). Its two passenger terminals carry their numbers, T1 and T2, on the map. 80 stands.
  - **Komatsu** (RJNK), on the Sea of Japan coast by Kanazawa: one runway, 06/24, 2.7 km, with an ILS to 06, shared with an air base. Seven stands.
  - **Hiroshima** (RJOA), on its plateau about 330 m up in the hills about 50 km east of the city: one runway, 10/28, 3.0 km, with a category III ILS to 10. Nine stands.

  All six are from their AIPs (Korea's eAIP and AIP Japan): their runways, thresholds, lights, PAPIs and ILS, and at the Japanese four their stands' published positions.
- **The military sides are empty.** At Cheongju, Komatsu and Kunsan the air force's side has its hardened shelters and hangars, and its ramps and taxiways where OpenStreetMap maps them (at Komatsu it maps none, so the shelters stand on grass), with no parked aircraft and no stand offered there; the civil aprons have their airliners as usual. You can still taxi across the military taxiways.
- **Every runway end can be picked,** for landing and for take-off, in New scenario, in the map's Change the route, for a start on a final and for Skip to final. Ends the airport's AIP uses only one way were left out of the lists before (Barcelona's 20 among them): now they come last in each list, with a note such as "20 · take-offs only in the AIP", and the map writes the note by the threshold instead of hiding the end. The runway picked for you is still one the AIP uses that way. That brings back ten landing ends and ten take-off ends at Frankfurt, Madrid, Barcelona, Schiphol and Hamburg, each with a localizer for LOC and APPR. Circling-only ends are flown as before, but in an arrival list they now come after the straight-in ends, so the runway first offered for landing always has a final (Itami's is 32L; Gimhae's is now 36R, not 18L; Innsbruck's 26, not 08). After a landing on Schiphol's 36L or 18L or Madrid's 36R the game may find no taxi route in: the exits there face the other way.
- **Two more real city centres and five landmarks:**
  - **Nagoya and Hiroshima** have real centres from OpenStreetMap: Nagoya's station towers at their true heights, Sakae and the castle; Hiroshima's centre between its rivers, with the Peace Memorial Park and the station. **Osaka's centre now reaches north** over Umeda, Shin-Osaka and Juso, so the final into Itami's 32L passes over the real city.
  - **Five new landmarks:** Nagoya Castle with its small keep, on their stone bases; Nagoya's TV tower, lit at night; the great torii of Itsukushima, standing in the sea off Miyajima; the Atomic Bomb Dome, the ruin as it stands, by the river; and Osaka Castle's main tower in its park, floodlit at night. Thirty-five landmarks in East Asia.
- **Parked aircraft keep their distance.** None is parked within 4.5 m of yours, wingtip to wingtip (at Vienna's F31 and Orly's A stands one stood close beside you), and none stands with its tail over a taxiway behind its stand (Naples's gates): such a stand gets a shorter aircraft or stays empty. Across the sixty older airports there are 6,536 parked aircraft where there were 6,804: about 300 are taken away, about sixty stands get the shorter aircraft, and a few dozen stands that an overlap had kept empty gain one. `?tailfit=0` on the page's address brings back the old layout.
- **East Asia, against v0.7.4:** with the new parked rule switched off, fifteen of the sixteen standard views match the last version pixel for pixel; the sixteenth, from FL350 east of Seoul, shows Cheongju's new ground in a far band at its edge. With the rule on, seven views differ, at parked aircraft only (Gimpo, and Haneda's, Pudong's and Beijing's finals). In Europe, all twenty-six views match with the rule off, and nine differ at parked aircraft only with it on (Heathrow, Charles de Gaulle, Frankfurt, Madrid, Schiphol, Gatwick, Fiumicino).

## v0.7.4 · 2026-11-22 · The cockpit, the whole map, weather by place, and the fixes

- **Sturdier landing gear on all three types.** The legs, pistons and braces are thicker, with collars, and the torque links are plates. Every wheel has a rim of its real size in light metal on both faces, with a dished face, a bright hub cap, and the dark brake stack inside on the main wheels, where each face was a flat dark disc. On the 787 and 777 the bogie beam is a deep forged box instead of a thin rod (from the side the wheels hide most of it). The nose gears match. Only the look has changed: the wheels touch the ground where they did, and the aircraft fly as before.
- **The autothrust's full range.** When a 787's or 777's autothrottle wakes up to save a low speed, it now goes to full take-off thrust, and never pulls the levers back from where you had them; once the speed is back within 2 kt of its target, it hands back to its usual limit. On the A321, full thrust is 96.5 % N1, as on the real aircraft, and the engine panel now says so above the dials ("TOGA 96.5 %"); the Boeings' EICAS shows their limit the same way ("TO 97.0" on the 787, "TO 100.0" on the 777, "G/A" while the autothrottle is awake), and the lever's ring sits on the limit at full.
- **A fairer centreline score.** A touchdown within 1.5 m of the centreline scores full marks, and from there the score falls in a straight line to 0 where the outer main wheel's outer edge reaches the runway's edge: about 18 m off for the A321 on a 45 m runway and 16 m for the 777, more on a 60 m runway. Your 5.7 m in an A321 on a 45 m runway now scores 7 of 10 (it was 3). The logbook keeps the scores it recorded.
- **Headings to a decimal, and the A321 lands itself.**
  - **Type a heading such as 071.466** on the A321's FCU or a Boeing's MCP, and the aircraft flies exactly that. The window still shows the whole degree, and one step of the knob goes to the next whole degree (072 to the right, 071 to the left). Saves keep the decimals, and the heading bugs sit at the exact value.
  - **Runway courses to 0.1° magnetic** wherever the game shows one: the PFDs' ILS line ("337.7°"), the map's runway labels and Change the route, the heading tip over the magenta line, and the setup's runway pickers ("RWY 14L (144.1°, 3,600 m)"). The course is the one that flies the runway the game draws, taken 5 nm out on the final.
  - **LOC and APPR on the A321's FCU,** LOC after the HDG window and APPR after V/S: LOC flies the localizer, APPR the localizer and the glideslope, and the FMA shows LOC*, LOC, G/S* and G/S, with the armed modes in cyan.
  - **The A321 autolands** in APPR with the autopilot on: LAND at 400 ft, FLARE at 40 ft, the thrust to idle from 10 ft with RETARD called at 10 ft (20 ft in a landing by hand, as before), a decrab from 150 ft, and ROLL OUT on the centreline until 30 kt, when the autopilot lets go. You still set the gear and the flaps and do the braking (there is no autobrake). In LAND, FLARE and ROLL OUT the FCU's knobs and buttons do nothing, as on the real one; a changed ILS or route there disconnects the autopilot with the cavalry charge.
  - **The HDG-V/S / TRK-FPA button** between the HDG and ALT windows: in TRK-FPA the autopilot flies a track over the ground and a flight path angle from −9.9° to +9.9°, the FMA shows TRACK and FPA, and the PFD shows the flight path vector, the "bird".
  - **Every runway end that is landed on straight in has a localizer,** on all three types. A circling-only end has none (Gimhae's 18L and 18R, Wonsan's 33L and 33R, Innsbruck's 08): their straight-in line meets the terrain, so a Boeing can no longer arm LOC or APP to them.
- **A button that silences the warnings, and a volume for each kind of sound.** SILENCE sits in the bottom-right corner of the PFD's panel on all three types, and lights amber while something is silenced. It silences every warning sounding at that moment (the overspeed chime, the stall's cricket and tone, the autopilot's cavalry charge, the windshear siren, and the voice's "pull up", "sink rate" and the rest); a silenced warning sounds again if its condition ends and comes back, and any other warning sounds as usual. The ' key does the same, and is on the Controls page. Settings has four volumes under the master: Warnings, Callouts volume (the voice), Engines, and Airframe and ground (wind, gear, flaps, wheels, brakes, packs, rain and thunder). Each is saved; at 100 % everything sounds as before. A new flight, a load, a jump or a rewind clears what was silenced.
- **The whole map:**
  - **The 250 m data's edge** is a plain white dotted line on a dark casing, readable over the new colours, and its staircases are cut diagonally where the tiles step, in both regions. The region's edge is a heavier dashed line, so it still reads first.
  - **Country borders** are a warm grey dash-dot line of their own, land borders only, and **the countries' names** in English fade in as you zoom out. A name that doesn't fit at its usual place is tried elsewhere in its country, large countries first, and a small country's name is never stronger than a large neighbour's.
  - **The runway ends' names and courses** stand beyond each end, clear of the runway, and "15 NM FINAL" keeps off the airports' labels.
  - **The terminals:** zoomed in to an airport, every terminal building is drawn at all sixty airports, and the passenger terminals carry the numbers the airport signs them by (Incheon's T1 and T2, Haneda's T1 to T3, Heathrow's T2 to T5, Charles de Gaulle's T1, 2A to 2G and T3, and so on). An airport with one terminal gets no number.
  - **The land is coloured by height:** pale low ground, deeper high ground, in steps at 500, 1,500, 3,000, 5,000, 8,000 and 12,000 ft, with a soft hillshade lit from the north-west so ridges and valleys read, and a small legend at the bottom left. Land below the sea (the Dutch polders) has a pale tone of its own. Over China it fades out towards the edge of the game's height data, and in Europe it stops at the region's edge. It stays quiet under the cities, the airports, the route and the predicted path.
- **Weather by place.** New scenario's "Time and weather" sets the departure's weather and the arrival's (the arrival's first choice is "Same as departure"). The Weather tab's switch has three positions: Both ends (the tab as it was), the departure, and the destination, each changeable in flight, with the other end's METAR in a dim line under the one shown. Each end's weather holds over its third of the route and blends smoothly across the middle, so the wind, the clouds, the rain, the temperature and the QNH change as you fly, and the altimeter setting matters en route. Every airport's METAR is its own, in its country's form. The sky, the clouds, the rain and its sound follow the air where you are. The clouds keep their pattern and drift across the blend, and only the cover, the bases, the rain and the haze change. A route changed in flight takes the destination's weather with it, and a circuit back to the departure has one weather. A save or scenario from before v0.7.4 flies as it did, with the same weather at both ends.
- **Fixes you can see:**
  - **Brussels's 01/19 is shaped to both runways it crosses,** and 19 can be taken off from again: both ways, with no lip at either crossing.
  - **Berlin's de-icing pads are no longer offered as stands** (156 stands, 173 before).
  - **Transition altitudes stop at borders.** An airport's own transition altitude holds only on its own country's side: Lugano has Switzerland's 7,000 ft, not Malpensa's 6,000 ft; Geneva's French side, Germany north of Zurich and Italy east of Nice have their own countries'. Gibraltar's own ground reads as Gibraltar.
  - **The aurora is in Europe's north only:** full over Scotland and Denmark, fading south of 56° N and gone by 50° N, so Paris and Lisbon have none. East Asia's is unchanged.
  - **The edge of the 250 m terrain in mountains** no longer shows as a wall or pale wedges from high up: the heights are blended into the coarser data over 4 km at the edge (the Tatras, the Sierra Nevada, the Taihang), and the coasts there keep their land and sea.
  - **Prague's field follows its runways' bent profile,** so the stands beside the crossing no longer stand up to 3 m off the ground.
  - **Venice's lagoon** has no step in its water at the edge of the raised old city.
- **New looks from the list for Europe's look pass, which you haven't seen before** (each can be turned off from the page's address, as in brackets):
  - **The terminals at night** (`?termnight=0`): their glass is lit storey by storey, with dark slab bands at each floor, stretches of dim offices, lit concourses and a few brighter bays, and the gate level brighter than the rest, instead of a checkerboard of big pale squares with black holes. By day they look as before.
  - **No more slivers of grass between aprons** (`?aprongrass=0`): where two pieces of apron didn't quite meet, a strip of grass up to about 2 m wide showed through (Gatwick, Madrid, Heathrow, Frankfurt). Every apron now has a narrow concrete edge, so its outline sits about 1.5 m further out.
  - **Tower Bridge is a bridge** (`?landmarks77=0`, for this and the next two): two stone towers on piers with corner turrets and pointed roofs, the closed bascules between them, the two high walkways, and the chains dipping to the road and rising to the towers at each end.
  - **Village churches** in Europe have a tall slate spire in the north and centre and a low tiled cap in Spain, Portugal and Italy, with a dark belfry opening, and no window bands on the tower or the nave.
  - **Madrid's Torre Cepsa** is lit at night like its three neighbours; before, its two side cores were a plain unlit slab.
- **East Asia, against v0.7.3:** its sixteen test views match v0.7.3 pixel for pixel with the new looks above turned off; with them on, seven match and nine differ only where the aprons' new edges and the terminals' night light show. The gear, the map and the landing score change as described above. In Europe, the views that changed besides the new looks are London's night sky (the fainter aurora) and two views over the 250 m terrain's edge.

## v0.7.3 · 2026-11-22 · Innsbruck, Gibraltar, Hamburg, Venice, Marseille, Lyon, Porto and Naples

- **The last eight of Europe's thirty-seven airports, sixty airports in all:**
  - **Innsbruck** (LOWI): one runway, 08/26, 2.0 km, in the Inn valley at 580 m with peaks over 2,200 m on both sides. **You land on 26 straight in; 08 is circling-only,** because a straight final to it runs into the mountains, as its real approaches say. Eight stands.
  - **Gibraltar** (LXGB): 09/27, 1.8 km, the sea at both ends and the Rock beside it; Africa across the Strait. Central European time. Nine stands.
  - **Hamburg** (EDDH): two crossing runways of 3.3 and 3.7 km; no take-offs from 15 and no landings on 33, as its rules say. 89 stands.
  - **Venice** (LIPZ): 04R/22L, 3.3 km, on the lagoon's shore, with its second runway a standby. 60 stands.
  - **Marseille** (LFML): two runways beside the Étang de Berre, 3.5 and 2.4 km. 99 stands.
  - **Lyon** (LFLL): two parallel runways of 4.0 and 2.7 km. 76 stands.
  - **Porto** (LPPR): 17/35, 3.5 km, near the coast. 44 stands.
  - **Naples** (LIRN): 06/24, 2.6 km, in the city, with Vesuvius 13 km away. 43 stands.

  Innsbruck, Hamburg, Marseille and Lyon are from their countries' AIPs. **Gibraltar's, Venice's, Porto's and Naples's lights, ILS and thresholds are estimates:** their AIPs couldn't be read.
- **Europe's ground reaches them.** 250 m terrain now also covers Andalusia, the Strait and Morocco's north, northern Portugal, the plain behind Venice and Campania (219 tiles of 128 km, 201 before), with the finer ground cover within 100 km of each new airport; closer ground round Innsbruck along 45 km of its valley, round the whole Rock and its bay, and round Naples as far as Vesuvius.
- **Six more real city centres** from OpenStreetMap's buildings: Hamburg between the Alster and the Elbe, the whole of Venice's old city on its islands, Marseille round the Vieux-Port, Lyon between its two rivers, Porto's Ribeira with Gaia across the Douro, and Naples's old centre down to the port. Thirty-three in Europe.
- **Eight more landmarks,** lit at night: Hamburg's Elbphilharmonie on the Elbe and its TV tower; St Mark's Campanile with the basilica's domes beside it; Notre-Dame de la Garde above Marseille's old port; Fourvière's basilica and its metal tower above Lyon; the Dom Luís I Bridge's iron arch over the Douro; and the Bergisel ski jump above Innsbruck. Sixty-one in Europe. Vesuvius and the Rock of Gibraltar are the terrain itself.
- **Taxiing after landing at Venice** leaves the main runway ahead and runs along the second runway, which serves as its taxiway there.
- **East Asia is unchanged:** the same picture pixel for pixel, the same flights.
## v0.7.2 · 2026-11-21 · Düsseldorf, Cologne Bonn, Prague, Geneva, Nice, Edinburgh, Glasgow, Nantes and Santiago

- **Nine more airports in Europe, twenty-nine there and fifty-two in all,** each with its runways, lights, ILS, taxiways and signs, stands with their own numbers, jet bridges, parked traffic and taxi routes out and in:
  - **Düsseldorf** (EDDL): two parallel runways of 2.7 and 3.0 km, every threshold set 300 m in; 176 stands.
  - **Cologne Bonn** (EDDK): the long 13L/31R (3.8 km), the short 13R/31L, and 06/24 across both; 184 stands.
  - **Prague** (LKPR): 06/24 and 12/30, 3.7 and 3.3 km; 103 stands.
  - **Geneva** (LSGG): one runway, 04/22, 3.9 km, between the Jura and the Salève, with the lake beyond 04's end; 138 stands.
  - **Nice** (LFMN): two runways on land taken from the sea, the approaches over the water along the coast; 178 stands.
  - **Edinburgh** (EGPH): 06/24, 2.6 km, with the Firth of Forth to the north; 76 stands.
  - **Glasgow** (EGPF): 05/23, 2.7 km, beside the Clyde; 53 stands.
  - **Nantes** (LFRS): 03/21, 2.9 km, the Lac de Grand-Lieu to the south; 33 stands.
  - **Santiago** (LEST): 17/35, 3.2 km, 370 m up in Galicia's hills, ILS category III to 17; 57 stands.

  Eight are from their countries' AIPs. **Geneva's lights, ILS and thresholds are estimates:** Switzerland's AIP asks for a login.
- **Europe's ground reaches them.** 250 m terrain now also covers Scotland with the Hebrides, Bohemia, Galicia, the Loire's mouth and the rest of the Côte d'Azur and the western Alps (201 tiles of 128 km, 170 before), with the finer ground cover within 100 km of each new airport.
- **Their rules.** Czechia's transition altitude is 5,000 ft, read from its AIP; Edinburgh, Glasgow and Santiago have their own 6,000 ft, Nantes and Nice 5,000 ft; Geneva's 7,000 ft is an estimate. Prague keeps Central European time; Edinburgh and Glasgow GMT and BST.
- **Nine more real city centres** from OpenStreetMap's buildings: Düsseldorf's Altstadt on the Rhine, Cologne round its cathedral, Prague's Old Town and Malá Strana, Geneva at the lake's end, Nice's old town and port, Edinburgh's Old and New Towns, Glasgow's grid, Nantes round its château and Santiago's old town. Twenty-seven in Europe now.
- **Ten more landmarks,** lit at night: Cologne Cathedral's twin spires and Düsseldorf's Rheinturm on the Rhine; Prague's Žižkov tower, and the castle with St Vitus Cathedral above the river; Geneva's Jet d'Eau in the lake; the three Forth bridges side by side (the red cantilever railway bridge, the suspension road bridge and the cable-stayed Queensferry Crossing) and Edinburgh Castle on its rock; and Santiago's cathedral. Fifty-three in Europe.
- **East Asia is unchanged:** the same picture pixel for pixel, the same flights.
## v0.7.1 · 2026-11-21 · Toulouse, Berlin, Milan, Vienna, Brussels, Dublin, Lisbon, Copenhagen and Manchester

- **Nine more airports in Europe, twenty there and forty-three in all,** each with its runways, lights, ILS, taxiways and signs, stands with their own numbers, jet bridges, parked traffic and taxi routes out and in:
  - **Toulouse** (LFBO): 14L/32R and 14R/32L, 3.0 and 3.5 km, with **Airbus's assembly halls** on the west side and the big plant to the north, their aprons and the taxiways that join them to the runways; 107 stands, 25 of them on the factory's flight line.
  - **Berlin** (EDDB): two runways of 3.6 and 4.0 km, named 06L/24R and 06R/24L as its AIP has them now, ILS category III to all four ends; 173 stands.
  - **Malpensa** (LIMC): two 3.9 km runways under the Alps; 81 stands.
  - **Vienna** (LOWW): 11/29 and 16/34, 3.5 and 3.6 km; 169 stands.
  - **Brussels** (EBBR): 07L/25R, 07R/25L and 01/19; 166 stands.
  - **Dublin** (EIDW): 10R/28L, the north runway 10L/28R, and 16/34, by Dublin Bay; 138 stands.
  - **Lisbon** (LPPT): one runway, 02/20, 3.8 km, among the city's hills beside the Tagus; the approach to 02 comes in over the river and the city; 93 stands.
  - **Copenhagen** (EKCH): 04L/22R, 04R/22L and 12/30 on Amager, the Øresund on three sides; 140 stands.
  - **Manchester** (EGCC): 05L/23R and 05R/23L, 3.0 km each; 125 stands.

  Six are from their countries' AIPs. **Malpensa's, Brussels's and Lisbon's lights, ILS and thresholds are estimates:** Italy's AIP asks for a login, and Belgium's and Portugal's wouldn't answer a script that evening.
- **Europe's ground reaches them.** 250 m terrain now also covers Ireland, Wales and northern England, Denmark and the south of Sweden, Brandenburg, Austria east to Vienna and into Hungary, Portugal, and the south-west of France (170 tiles of 128 km, 93 before), with the finer ground cover within 100 km of each new airport.
- **Their countries' rules.** Austria's transition altitude is 10,000 ft and Ireland's 5,000 ft, read from their AIPs; Denmark's is 3,000 ft with 5,000 ft round Copenhagen; Manchester has its own 5,000 ft; Toulouse 5,000 ft. Belgium's 4,500 ft and Portugal's 4,000 ft are still estimates. Dublin keeps GMT and IST, Lisbon WET and WEST.
- **Nine more real city centres** from OpenStreetMap's buildings, each a tight core: Toulouse's old town round the Capitole, Berlin from the Brandenburg Gate to Alexanderplatz, Milan round the Duomo, Vienna inside the Ring, Brussels's Pentagon, Dublin along the Liffey, Lisbon's Baixa and Alfama, Copenhagen's Indre By and Manchester's centre. Eighteen in Europe now.
- **Fifteen more landmarks,** lit at night: Berlin's Fernsehturm and the Brandenburg Gate; Vienna's Stephansdom, Donauturm and Riesenrad; Milan's Duomo; Lisbon's 25 de Abril Bridge, Cristo Rei and the Vasco da Gama Bridge; the Øresund Bridge and Malmö's Turning Torso; Dublin's Poolbeg chimneys; Brussels's Palais de Justice; the Lovell Telescope south of Manchester; and the rocket at Toulouse's Cité de l'Espace. Forty-three in Europe.
- **Europe's fields look like Europe's.** Big open fields with no hedges across northern France, Germany and the centre; small green fields inside dark hedges, with trees in the hedges, in Britain, Ireland, Normandy and Brittany and Spain's green north; pale dry fields, red soil and olive groves in Spain, Portugal, Italy and the south of France, with terraces on the slopes and straw-coloured grass between them; and in the Dutch polders, the Fens and the marsh coasts, long narrow strips of wet pasture between straight ditches, all running one way across a polder. From high up Spain is ochre and Ireland green. East Asia's fields are as they were.
- **East Asia is unchanged:** the same picture pixel for pixel, the same flights.
- **Under the hood:** v0.7.0's two slow frames at 16× were the test's own screenshot, taken in mid-cruise (each sat just above the cruise level less 500 ft); the test now takes its picture with the frame count paused. Gatwick's and Munich's fine ground now reaches as far east of each field as west of it, and a strip of ground wrongly near sea level 14 km east of Gatwick is gone. 1,406 unit tests; `data/` is 411 MB (322 MB before), Europe's share 212 MB.
- **Known:** Malpensa, Brussels and Lisbon are estimates, as above (and Zurich, Schiphol and Fiumicino still). The aurora shows over all of Europe on clear nights, Lisbon and Milan included. At Brussels the short runway 01/19 crosses both others and the game shapes only one of the two crossings, so 19 is offered for landings only (the game's own limit, not the airport's rule) and a small lip (0.2 to 0.3 m) is left in the ground where 01/19 meets the northern runway's end. Berlin's de-icing pads are offered as stands. At Manchester a landing on 23L finds no exit ahead and taxis back along the runway. A parked aircraft can stand close beside yours at Vienna. From high up the nine new city centres are small cores inside the same generic town; Europe's forests are still all conifers; and Cristo Rei stands on a lower hill than the real one. The fields' zones follow latitude and longitude, not borders, so a district near a zone's edge may be of either kind.
## v0.7.0 · 2026-11-21 · The regions, and Europe

- **A second region: Europe.** New scenario asks where you want to fly first, East Asia or Europe. Each region is its own map, and a flight stays inside one. The Load list shows both regions' scenarios under their names; loading one from the other region reopens the game there. The home page's ticket and the logbook name either region's airports.
- **Eleven airports in Europe, thirty-four in all,** each with its runways, lights, ILS, taxiways and signs, stands with their own numbers, jet bridges, parked traffic, taxi routes out and in, and its terminals from OpenStreetMap:
  - **Heathrow** (EGLL): two runways of 3.9 and 3.6 km, ILS category III to all four ends, 288 stands.
  - **Gatwick** (EGKK): the main runway 08R/26L, 3.3 km, and the northern runway as a standby: listed last and never picked for you. 189 stands.
  - **Charles de Gaulle** (LFPG): four runways in two pairs, the long ones 4.2 and 4.1 km, ILS category III to all eight ends, 446 stands.
  - **Orly** (LFPO): 06/24 and 07/25, with 02/20 as a standby; 155 stands.
  - **Frankfurt** (EDDF): 07C/25C and 07R/25L, 4 km each; 07L/25R for landings only and 18 for take-offs only, as its AIP has them; 366 stands.
  - **Munich** (EDDM): two 4 km runways, ILS category III to all four ends, 209 stands.
  - **Madrid** (LEMD): four runways, each used one way (land on the 32s or the 18s, take off from the 36s or the 14s), 609 m up; 381 stands.
  - **Barcelona** (LEBL): by the sea, three runways; 20 for take-offs only; 209 stands.
  - **Zurich** (LSZH): 14/32, 10/28 and 16/34; 218 stands.
  - **Schiphol** (EHAM): six runways on a polder 3.4 m below the sea; the Polderbaan and the Aalsmeerbaan used one way each; 293 stands. From the Polderbaan it is a 5.6 km taxi to the gate, as it really is.
  - **Fiumicino** (LIRF): by the sea, three runways; 144 stands.

  Eight are from their countries' AIPs. **Zurich's, Schiphol's and Fiumicino's lights, ILS and one-way runways are estimates:** those three AIPs couldn't be read by a script. The setup lists the airports by country. Some routes, as the game measures them: Heathrow–Charles de Gaulle 187 nm, Zurich–Gatwick 405 nm, Heathrow–Madrid 667 nm, Schiphol–Fiumicino 696 nm, Frankfurt–Madrid 762 nm.
- **Europe's ground.** 250 m terrain over England, the Low Countries, France, western Germany, the Alps, northern Italy to Rome, and Spain round Madrid and Barcelona, with 1 km terrain to the region's edge (Ireland and Scotland to Denmark, Vienna, Sicily, Lisbon and the Strait). The Alps, the Pyrenees, the Thames, the Seine and the lakes are where they are. **Land below sea level stays below it:** the Dutch polders and Schiphol's runways.
- **Each country's rules.** Hectopascals and feet everywhere; each country's transition altitude, and each airport's own where it sets one (6,000 ft round Heathrow and Gatwick, 13,000 ft round Madrid, 7,000 ft round Zurich); local time with summer time (GMT and BST, CET and CEST, WET and WEST); weather reports in Europe's form (`EGLL 24008KT 9999 SCT035 12/07 Q1013 NOSIG`).
- **Runways used one way.** An end that is only taken off from isn't offered as an arrival, and the other way round, in the setup, on the map and for Skip to final.
- **Nine real city centres** from OpenStreetMap's buildings: London (Westminster and the City to Canary Wharf), Paris (La Défense to the Marais), Frankfurt, Madrid (Sol to the four towers), Zurich, Amsterdam's canal ring, Munich, Barcelona (the Eixample and the old town) and Rome inside its walls.
- **Twenty-eight landmarks,** lit at night: the Shard, Westminster with the Elizabeth Tower, the London Eye, St Paul's and Tower Bridge; the Eiffel Tower, the Arc de Triomphe, Sacré-Cœur, Notre-Dame and the Grande Arche; Frankfurt's Commerzbank Tower, Messeturm and Europaturm; Madrid's five towers and the leaning Puerta de Europa; Zurich's Grossmünster and Prime Tower; Munich's Olympiaturm and Frauenkirche; the Sagrada Família, Torre Glòries and the Collserola tower; St Peter's and the Colosseum.
- **Europe's towns.** Brick terraces under slate round Britain's cities; five- to seven-storey blocks round courtyards on the continent, zinc grey in France, red tile in Germany and the Low Countries, terracotta in Spain and Italy; a church spire here and there; no tower blocks outside the real centres. In the country, villages in each country's style: brick and slate in Britain, pale render and steep slate or low terracotta in France, red-brown tile in the centre, cream walls under terracotta in the south, steep dark roofs on brick in the Low Countries; farmhouses and long barns among the fields, and a church with its tower in most villages.
- **The path map** draws Europe's outline, coast, city areas and names.
- **East Asia is unchanged:** the same picture pixel for pixel, the same flights, and your saved scenarios load as they were. Under the hood, v0.6.0's test switches and Korea's old map files are gone (18 MB lighter), and every picture check now steps a fixed number of frames, so the same view gives the same picture every time.
- **Under the hood:** 1,392 unit tests; `data/` is 322 MB (217 MB before), Europe's share 123 MB.
- **Known:** Zurich, Schiphol and Fiumicino are estimates, as above. At Munich, OpenStreetMap maps only part of the aprons, so the ground under each stand's pushback is paved by the game's own rule (a strip from the stand back to its taxi line). Europe's fields are still the generic ones: no hedgerows, no Dutch ditches, no olive groves; and its forests are all conifers. The aurora shows over Europe on clear nights as it does over East Asia. Town blocks can stand in a narrow river (the Main at Frankfurt, the Thames by Tower Bridge), and a real centre's courtyards are roofed over. Gatwick's fine ground stops just east of the field and Munich's 15 km east of it; beyond, the ground is the coarser 250 m kind. One frame of 33 ms at 16× on the way from Heathrow to Charles de Gaulle, at the same place each time, not yet found. With Paris's or Madrid's centre in view the scene is over its budget of a million triangles (it still holds 60 fps on the Mac it was measured on). Low landmarks (the Arc de Triomphe, the Colosseum, Notre-Dame) are hidden behind their neighbours from low down, as they are in life.

## v0.6.4 · 2026-11-21 · Pyongyang, Wonsan, Niigata, Sendai, Aomori and Sapporo

- **Six more airports, twenty-three in all.** North Korea and northern Japan:
  - **Sapporo New Chitose** (RJCC): two 3,000 m runways, ILS category III to 19R, the curved terminal, 68 stands with their real spot numbers.
  - **Pyongyang Sunan** (ZKPY): one runway, 17/35, 3,440 m, the terminal with its jet bridges, 24 stands. The old crossing runway, closed for years, isn't drawn.
  - **Sendai** (RJSS): 09/27, 3,000 m, by the Pacific, and the short 12/30; ILS to 27; 28 stands.
  - **Niigata** (RJSN): 10/28, 2,500 m, on the Sea of Japan's shore, crossed by the short 04/22; ILS to 28; 39 stands.
  - **Aomori** (RJSA): 06/24, 3,000 m, on a plateau 200 m up; ILS category III to 24; six stands, none for the widebodies (the real airport takes nothing bigger than a 767).
  - **Wonsan Kalma** (ZKWS): two long runways on a spit in the bay, six stands. Runways 33L and 33R are circling-only: a ridge stands under their straight-in paths, so the setup and Skip to final won't put you on a final to them.

  The four Japanese airports' runways, lights and ILS are the published ones (Japan's AIP). The setup lists them after Fukuoka, south to north, and Pyongyang and Wonsan under North Korea. Some routes: Gimpo–Sapporo 751 nm, Haneda–Sapporo 443 nm, Haneda–Sendai 165 nm, Gimpo–Niigata 585 nm, Incheon–Pyongyang 112 nm, Gimpo–Wonsan 102 nm, Wonsan–Vladivostok 330 nm.
- **Hokkaido in detail:** ten more tiles of 250 m terrain and 30 m countryside, from the Tsugaru Strait to north of Sapporo and east to Kushiro's coast. Nothing already there moved.
- **North Korea's rules:** hectopascals and feet, a transition altitude of 12,000 ft (FL130 above it), Pyongyang's own time, and the tower's wind in metres per second on the weather line. There is no official source online for these, so they are the best open ones.
- **Real buildings in four more centres:** Pyongyang along the Taedong, Sapporo, Sendai and Niigata.
- **Four more landmarks,** thirty in all: Pyongyang's Ryugyong Hotel (the 330 m three-winged pyramid) and Juche Tower with its flame, the Sapporo TV Tower, and the Sendai Daikannon, a 100 m white statue on its hill.
- **Fixed on the way:** with twenty-three airports the terrain far from the aircraft could stop filling in from cruise (every airport keeps its own ground loaded, and together they had filled the terrain's memory). The memory now grows with the airports.
- **Under the hood:** 1,383 unit tests; `data/` is 217 MB (204 MB before).
- **Known:** North Korea publishes no AIP, so Pyongyang's and Wonsan's lights and ILS come from open navigation data and scenery, and nearly everything at Wonsan is an estimate (its six stands are made up). Aomori's runway sits about 60 m along its own line from where it is published, as OpenStreetMap draws it. At Niigata, stand 10's taxi route starts along the short runway; at Sendai and Wonsan a landing rolled far down the short or the unlit runway may find no taxi route in. Stand numbers OpenStreetMap doesn't carry are made up (R1 and on).

## v0.6.3 · 2026-11-21 · Beijing, Shenyang, Dalian and Vladivostok; cities on the map

- **Five new airports, seventeen in all.** East Asia grows west to Beijing and north to Vladivostok:
  - **Beijing Capital** (ZBAA): three runways of 3,200 to 3,800 m, terminals 2 and 3 with their piers, 393 stands.
  - **Beijing Daxing** (ZBAD): four runways, the star-shaped terminal, 392 stands. Its east-west runway's 11L end has no approach aids, as the real one has none: it's a departure end.
  - **Shenyang Taoxian** (ZYTX): one runway, 06/24, 3,200 m, 87 stands.
  - **Dalian Zhoushuizi** (ZYTL): one runway, 10/28, 3,300 m, among hills by the sea, both thresholds displaced, 46 stands.
  - **Vladivostok** (UHWW): one runway, 07R/25L, 3,500 m, ILS category II to 25L, 23 stands numbered as its real chart numbers them. Its runway, lights and stands are the published ones (Russia's AIP).

  Each has gate starts, pushbacks, taxi routes, signs and parked traffic, and the widebodies get stands at all five (at Vladivostok the six its chart gives them). The setup lists Beijing's two first in China, then Dalian and Shenyang after Qingdao, and Vladivostok under Russia. Some routes: Incheon–Beijing 487 nm, Pudong–Beijing 593 nm, Gimpo–Vladivostok 427 nm, Incheon–Shenyang 286 nm, Incheon–Dalian 249 nm, Shenyang–Vladivostok 398 nm.
- **More land in detail.** The 250 m terrain and the 30 m countryside now reach round Beijing and Tianjin, down the Beijing–Shanghai route, across Liaoning and North Korea's north, and over Mount Paektu (its crater lake is there) to Vladivostok and its bays: 26 more tiles, fitted to the routes rather than a rectangle. Nothing already there moved, so saved flights stand where they stood.
- **Russia's rules at Vladivostok:** the altimeter in hectopascals and altitudes in feet, a transition altitude of 8,000 ft (FL090 above it), the clock ten hours ahead of UTC (shown as VLAT), and the tower's wind in metres per second on the weather line.
- **Cities on the map.** The path map (N) now shows built-up areas as pale shapes on the land, with the cities' names in English: the great cities with the whole region on screen (Tokyo, Seoul, Shanghai, Beijing, Osaka and a few more), and more as you zoom in, down to towns. Names keep clear of the airports' labels; the route and the bright path stay on top. The faint dashed outline of the detailed terrain is its real stepped shape now.
- **Real buildings in five more centres:** Beijing from Financial Street to the CBD, Tianjin along the Hai River, Shenyang, Dalian and Vladivostok round the Golden Horn.
- **Seven more landmarks:** Beijing's CITIC Tower (528 m, with its narrow waist), the CCTV Headquarters' loop and the Central Radio and TV Tower; Vladivostok's two cable-stayed bridges, the Russky Bridge to its island (pylons 321 m, a kilometre's span) and the Zolotoy Bridge over the Golden Horn; Tianjin's TV tower in its lake and Liaoning's in Shenyang. Twenty-six in all.
- **Under the hood:** `?mapcities=0` after the address draws the map without the cities, for comparison; 1,307 unit tests; `data/` is 204 MB (153 MB before).
- **Known:** China's AIP can't be read without an account, so the Chinese airports' lights and ILS categories come from open navigation data and their approach lights' length is the standard 900 m; Daxing's stand numbers beyond the ones OpenStreetMap carries are made up (R1 to R275), and so are the holding points at all five. Vladivostok's taxiways are named only along the parallel (A). The place names come from Natural Earth's list of 419 places in the region: fine for cities, thin for small towns.

## v0.6.2 · 2026-11-20 · The landing itself, one bar along the top, panel size, and the heading on the map

- **The landing score is the landing itself.** The approach no longer counts: the glide path and the sink rate's swings are gone, so lining up late and putting it down well scores well (a good touchdown after a quick line-up went from 50 to 99). Nothing caps the total any more but a hard touchdown: 900 ft/min with the rest right still scores 50, a D, but landing long or off the centreline just loses those parts' points (700 m long with the rest perfect: 78). The grass, a touchdown off a runway and a would-be crash still come off. Landings already in your logbook keep the scores they were given.
- **One bar along the top:** Hide panels and Pause, the autopilot panel and the view switch now sit in one row that never wraps. On a narrow window the view switch drops its key labels, then the whole row's text shrinks to fit. The side panels start under it.
- **Panel size:** Settings → Panel size scales the PFD, the ND and the engine panel from 50 % to 120 % as you drag, and it's kept for next time.
- **The heading to fly:** hover over the magenta line on the map to see the heading that follows it, as "Set HDG 118° to follow this line (track 123°, 5° into the wind)": magnetic, as the FCU takes it, for the wind where you are, at the point under the pointer.
- **Gimhae's 18L and 18R are circling-only,** as the real ones are: their straight-in path runs into the hills north of the field. The setup marks them and won't start you on a 15 nm final to them, the map draws no 15 nm final for them, and Skip to final says why instead of flying you into the hillside. Every other runway end's final was checked against the terrain: all clear by 86 m or more.
- **Behind the scenes:** the briefs for the Claude Code runs moved to `briefs/` as `V0-X-Y.md`; new browser checks for the top bar, the panel size, the map's tip and Gimhae (`tests/cloud/v062-hud.cjs`, `v062-map.cjs`), and the old UI check rewritten for today's menu; 1,237 unit tests. A rule for the regions to come: they needn't be rectangles (`ROADMAP.md`).

## v0.6.1 · 2026-11-20 · Yancheng, a lighter scene, and greenhouses

- **A twelfth airport: Yancheng Nanyang,** halfway along the 325 nm of China's coast between Pudong and Qingdao, which had none. One runway, 04/22, 2,800 m with an ILS each way, and twenty stands. It's a code C airport, as the real one is, so the 787 and the 777 start there on the runway or on a final, not at a stand. The setup lists it in China between Hongqiao and Qingdao, with new routes from Incheon (390 nm, a real A321neo route), Pudong (159 nm) and Qingdao (176 nm).
- **A lighter scene with the same picture.** Houses and trees are drawn only where they stand, and city blocks, buildings and parked aircraft only when they're in view, so near the big cities the scene is down from 1.3–1.9 million triangles to about a million or less: Tokyo at 3,000 ft from 1.8 M to 1.0 M, Seoul from 1.4 M to 0.85 M, a stand at Pudong from 1.7 M to 0.83 M. On the M5 the heaviest views now have about twice the headroom they had.
- **Greenhouses:** Korea's white greenhouse ground now has rows of low plastic tunnels on it near you.
- **Smoother small waters:** ponds and small rivers no longer step along their edges when you're low above them.
- **Taxi-in after landing:** at Gimpo (32L and 14R), Incheon (33L) and Narita the route to a stand now leaves the runway by an exit ahead of you, as at the other new airports. Jeju's still turns back along the runway from late on 31 or 13: its map has no other way off.
- **Gimhae as published** (Korea's AIP): ILS category II on 36L and I on 36R, their approach lights, and 18R's threshold displaced 600 m. Pudong's and Qingdao's ILS categories come from open navigation data.
- **The countryside:** paddies follow their valleys, bare ground (the Nakdong delta's new town) has some texture, no fields grow inside an airfield's fence, and Gimhae's aprons are joined up. The greenhouse ground sits in slightly different places than in v0.6.0.
- **The map:** the straight seam in the inland water west of Korea is gone.
- **Under the hood:** `?greenhouses=0` and `?cull=0` after the address show the ground without the tunnels and the scene without the culling, for comparison; 1,232 unit tests, which now also pass in a fresh copy of the repository.
- **Known:** Gimhae's 18L and 18R have no straight-in approach (the real ones are flown by circling from the approach to 36, because of the hills to the north), so a final start or Skip to final on them flies into the hills: pick 36L or 36R there for now. The trees are still conifers.

## v0.6.0 · 2026-11-20 · East Asia: eight new airports, Tokyo and Shanghai, nineteen landmarks, and a new countryside

- **The map grows into East Asia.** The world now covers all of Korea, Kyushu, Shikoku and Honshu to Sendai, and China's coast from Ningbo to the Shandong peninsula at Korea's detail (real elevation every 250 m), with coarser land around it out past Beijing, Hokkaido's south and Taiwan's north, so the edge of the world never shows from cruise. It's still one map in Korea's own frame, so your saved scenarios keep their places. The terrain streams in as you fly, in 128 km tiles.
- **Eight new airports, eleven in all:** Shanghai Pudong, Shanghai Hongqiao and Qingdao Jiaodong in China; Tokyo Haneda, Narita, Osaka Kansai and Fukuoka in Japan; and Gimhae in Busan. Each is built as Incheon is: runways with their lights, PAPIs and ILS, named taxiways and signs, numbered stands (code E for the widebodies), terminals and parked traffic in the game's made-up liveries, gate starts, pushbacks and taxi routes. Each has 30 m terrain round it, and so does Mount Fuji, whose snow-capped cone stands on the horizon on the way into Haneda. The setup lists the airports by country, and a long stand list (Pudong offers 638) has a search box.
- **New routes,** from Gimhae–Fukuoka (122 nm, the game's shortest international hop) to Gimpo–Haneda (637), Incheon–Pudong (444), Gimpo–Hongqiao (468), Incheon–Qingdao (313), Kansai–Haneda (233) and Hongqiao–Haneda (960). The fuel estimate now follows the sim within about 1 % from 120 to 960 nm (the old rule, tuned on Gimpo–Jeju, put a third or more too much in for the long ones).
- **Each country's rules.** In Japan the altimeter is set in inches of mercury, as Japan's controllers give it: Shift+B sets the local QNH in inches (29.92 is the standard setting, as 1013 hPa is), and a click on IN/HPA switches the units. (The BARO window always shows the setting you've dialled, not the pressure outside: that's why it stayed at 1013.) China gives its levels in metres: there the PFD shows your altitude in metres too (METRIC ALT on the A321, MTRS on the Boeings), while the ALT window stays in feet, and Pudong's transition is 3,000 m, against Korea's and Japan's 14,000 ft. The clock is local time where you are (KST and JST, or CST an hour behind in China), magnetic variation comes from the World Magnetic Model outside Korea, the sun, Moon and stars now stand where they should far east and west of Korea (Tokyo's sun was 7° off), and METARs take each country's form (Japan's give the inches in the remarks, China's give the wind in metres per second).
- **Cities that look like their countries:** Japanese towns are dense and low with tower clusters, Chinese cities tall point towers and skyscraper clusters, Korean ones as before. Nine centres are built from real buildings' footprints and heights (OpenStreetMap): central Tokyo, Yokohama's Minato Mirai, Shanghai's Lujiazui and Puxi, Seoul's centre, Yeouido, Gangnam and Jamsil, Incheon's Songdo, Busan's Haeundae, Osaka, Fukuoka and Qingdao, lit at night with red lights on the tallest.
- **Nineteen landmarks,** each its own model, with no logos or names on any of them: Lotte World Tower, the 63 Building, N Seoul Tower and Parc1 in Seoul; Shanghai Tower, the World Financial Center, Jin Mao and the Oriental Pearl; Tokyo Skytree, Tokyo Tower, Azabudai Hills, the Metropolitan Government Building and Yokohama's Landmark Tower; Busan's LCT and Songdo's Northeast Asia Trade Tower; Osaka's Abeno Harukas and the Umeda Sky Building; and Fukuoka Tower with its dome. The Oriental Pearl joins the home page's skyline too.
- **A new countryside.** The ground near you comes from real 31 m satellite land cover (ESA WorldCover), Korea included, so woods, fields, villages and ponds are where they really are: fields in rows of uneven plots with tracks and tree lines, terraces on the slopes, woods whose crowns still read from 10,000 ft, trees out to 3,000 m above the ground, villages of houses and sheds in each country's style, and Korea's white greenhouses on the plains. The old grid of rectangular plots is gone.
- **After landing at the new airports,** the taxi route to a stand leaves the runway at an exit ahead of you on every runway (Korea's three airports are as before).
- **The weather** is still one weather for the whole flight, but its wind now stays true to north wherever you are (between Seoul and Tokyo the map's grid turns about 7.5°).
- **Under the hood:** no frame over 17 ms in a 16× cruise from Seoul to Tokyo while the terrain streams in, the airports build in slices as you come within 200 km, and memory comes back when you leave. v0.5.8's Korea is still there, pixel for pixel, with `?eastasia=0&cities=0` after the address (`?ground=0` shows the old ground).
- **Known limits:** near the big cities the scene has 1.3 to 1.9 million triangles (60 fps on the M5, with half a frame to spare); the approach lights at Pudong, Hongqiao and Qingdao and Gimhae's ILS category are estimates until their charts are read; small rivers and ponds show 31 m steps from close above; the nearest trees are still simple cones.

## v0.5.8 · 2026-11-19 · Photos and an aurora on the home page, one engine that bites, and names that follow the warehouse

- **The home page's ground line and its shade line up:** the darker band under the skyline now starts exactly at the white ground line, at every window size (the line used to sit a few pixels above it).
- **Travel photos:** the suitcase moved up beside the boarding pass, and the space below the flight path holds three framed prints from the game itself, tilted and overlapping a little like snapshots on a table: a 777-300ER landing at Incheon by day, a 787-9 over Seoul's lights at night (with the aurora), and an A321neo pushing back at Gimpo at sunset, each captioned on its bottom edge as if in pen ("777 · landing at Incheon", "787 · Seoul by night", "A321 · Gimpo at sunset"). The upper print lies on top, so every caption shows. They drift very slightly; at small window sizes the top one shrinks or steps aside. The Warehouse row lost its subtitle.
- **Stars and an aurora** over the top of the home page: green curtains with red tops and a violet lower edge, the colours of the game's own aurora, drifting and shimmering slowly behind the title; some of the stars twinkle. Strongest on night, softer on dusk, faint on blueprint.
- **One engine down now bites.** With the thrust off on one side, all three aircraft now yaw clearly towards it and hold the sideslip until you use the rudder: the laws' yaw damper and turn coordination used to cancel about half of it by themselves (like a thrust asymmetry compensator), and they now leave the engines' part alone while still damping turns, gusts and the Dutch roll. The 787 and 777 also roll towards the dead side, up to about 34°, as the sideslip's dihedral effect does on a conventional aircraft; the A321 still holds its bank (Airbus's normal law) while its heading wanders. It was never the auto-trim, which is pitch only. Holding it takes about 4° of rudder at 250 kt and 13–16° on an approach. The real 777 and 787 have TAC, which would put that rudder in for you; it isn't modelled. Symmetric flight is exactly as it was.
- **A design's name follows the warehouse everywhere:** rename a design and every place that shows it (the logbook's rows too, which kept the old names, and a flight already loaded) shows the new one, because each looks the name up by the design's id when it's shown. The stored name only shows once the design is deleted.

## v0.5.7 · 2026-11-18 · A key block for the warehouse, a keyboard on the Controls page, and a new home page

- **A block of keys for the warehouse.** The 16 keys under your right hand, 7 8 9 0, U I O P, J K L ; and M , . / (Shift with them too), belong to the warehouse: each aircraft sets its own keys there, and nothing else uses them. Every other key is set on the Controls page, the same for every aircraft. Shane's idea: "we should leave a chunk of the keyboard completely free of keybindings", so an aircraft's own keys never clash with the flying keys, even with several aircraft in one scenario later.
- **Each engine its own keys, one at a time.** Click an engine in the warehouse and give it an up and a down key from the block; Mirror no longer gives its twin the same keys. Engines start with none. R and F still move every lever; an engine's own keys move only its lever, and its down key held at idle on the ground holds its reverse. A wing tank's Drop key comes from the block too. Keys stay with the engine, so deleting another engine no longer moves them (v0.5.6's engine groups went by number).
- **The flying keys are back on the Controls page,** the same for every aircraft: the wing, tailplane, fin and fuselage in the warehouse no longer carry keys. Your v0.5.6 key changes on the Controls page carry over where the key is still allowed; each aircraft's part keys and engine groups don't.
- **Keys that moved out of the block:** the Sky window to \\ (Cmd/Ctrl+L still opens it), the map to N, and, being pressed about once a flight, TO/GA to Shift+T, the local QNH to Shift+B and pushback to Shift+G. The performance readout is F3 only. The rule from now on: a key you press more than once a flight in the air needs no Shift.
- **A keyboard on the Controls page:** a drawing of the Mac keyboard above the list, the block's keys cyan, the Controls page's sand (faint when free), and \` Tab Caps Lock Return delete and the Shifts grey, as they do nothing on their own (they can't be keys either). Hover a key to see what it does, or a row to light its keys. Each key in the list is a keycap: click it and press the new key.
- **A new home page.** The left side is white line art: a dotted flight path whose dashes flow the way the little airliner flies along it; near the end it shrinks into the dot, then comes back out and flies the other way. A boarding pass and a suitcase float beside the path, and along the bottom a skyline of 22 world landmarks (Sungnyemun, the Eiffel Tower, the Sydney Opera House, N Seoul Tower, the Burj Khalifa, Lotte World Tower, Tower Bridge, the Petronas Towers, Tokyo Skytree and more) scrolls from left to right like a tape, across the whole width. The background is a calmer dusk: navy above, a faint warm glow behind the skyline (night and blueprint looks are built in too). On the right, your newest scenario is a ticket ("En route to Jeju", its altitude and the distance left) with Resume flight, then New scenario, Load scenario, Warehouse and Logbook, Settings and Controls. "Airliners over South Korea" is gone from the title.
- **The home page's cost:** the floating and the tape are CSS animations, the plane moves at most 30 times a second, and everything stops while you fly, when a page covers the menu, or when the window is hidden. With reduced motion turned on in macOS it's a still picture.

## v0.5.6 · 2026-11-18 · Your own keys for each aircraft, and the warehouse's leftovers

- **Your keys, Besiege-style, in the warehouse.** Click a part and its tab shows its keys as keycaps: click one and press the new key (Esc cancels, Backspace clears). Engines: thrust R and F. The wing: ailerons A and D, flaps − and = (the five detents are there too, unbound), speedbrake C, ground spoilers Shift+C. The tailplane: elevator W and S, trim Y and H. The fin: rudder Q and E. The fuselage: gear G, brakes Space, parking brake B. A wing tank: Drop, unbound, which drops the tanks in flight. With Mirror on, a twin takes the same keys. Every design has its own keys, starting from its base type's. The A321neo, 787-9 and 777-300ER have a keys-only editor in the warehouse's list. Keys save as you set them. The Controls page keeps the keys that aren't parts, the same for every aircraft: the views, time, the autopilot, map, pushback, rewind, QNH and the readout. A key one side uses is refused on the other, with the control named, and Esc and L stay as they are. Nothing takes Ctrl, Cmd or Alt.
- **Engine groups:** give an engine (and its twin, with Mirror on) its own thrust keys in its tab, and those keys move only its lever, so you can run engines at different thrust. As the others puts it back on the all-engines keys, which every engine's tab shows too. The levers show apart on the engine panel, each engine with its own command ring. The all-engines keys (R and F) still move every lever. A group key disconnects the A/THR or the A/T, which can't hold engines apart, and the lever the autothrust and the PFD read is the most advanced one, so two groups at TOGA show MAN TOGA.
- **Flaps on − and =,** a step a press; 6 to 0 are free (bind the detents there again if you want them). Time compression moves to [ and ] (Num + and Num − still work).
- **Sweep no longer makes the wing bigger.** Since v0.5.3 the wing's strips counted their length along the sweep, so +8° made the 777's wing 8% bigger (534 m² against 492) and it stalled about 4% slower than it should. Now each strip counts its width across the span: the 777's wing is 433 m² (the real one is about 437), swept or not, and the calibration was refitted to it. Now sweep changes only how the wing behaves with Mach. On a six-engine 777 at FL450 and 265 t, +8° is clear of the stick shaker from M0.85 to M0.95, but the amber band covers all of it, so there's no comfortable window. The stock wing has none either.
- **The main gear follows the wing.** On a changed wing the legs stand where the stock legs stand relative to the wing, so chord and sweep move them fore and aft and a longer span moves them out. The flaps keep a proper depth behind them, and the wheelbase, tail-strike angle and nose-wheel load in the warehouse follow. A smaller chord moves the legs forward, so a 777 or 787 with 0.8 chord now sits back on its tail at full thrust; move the wing aft (below) to fix it.
- **Move the wing:** a Position slider in the wing's panel moves the whole wing fore and aft (−3 to +3 m), with its engines, tanks and main gear. A 777 or 787 at 0.8 chord takes off normally again with the wing 2 m aft, and the A321 at −8° and 0.8 chord with 1 m. The catch is a very stable aircraft in pitch (a static margin near 48 % on the Boeings, flagged amber); ballast forward is the other way out.
- **The swept 777 lifts its nose at the right speed:** at +8° it lifted it by itself at 126 kt instead of 172, because the take-off trim counted the engines the swept wing carries aft as if you'd moved them. Now it lifts at 171 kt.
- **Take-off trim for bigger tails:** a 1.5 tailplane used to lift the nose by itself 6–8% early on a hands-off take-off run (a 0.6 one 5–6% late). Now it's within about 1% of the stock aircraft on all three types.
- **Minimum control speed (VMC)** in the warehouse: the slowest speed at which full rudder holds the aircraft with its worst engine out and the rest at full thrust, against the take-off rotation speed. It turns amber when VMC is within 5% of VR, red when it's above it. A design with lopsided thrust also shows the speed below which full rudder can't hold it with every engine running. Stock: A321 123 kt, 787 120 kt, 777 131 kt. The A321 reads about 10 kt above the published figure.
- **Drop tanks fall away** instead of vanishing: they drop and trail back, nose down, with a clunk, and WING TANKS DROPPED shows on the ECAM or EICAS for 20 seconds. Rewinding puts them back.
- **The warehouse:** the selected part's keys work on a part in hand too (↑ ↓ fore and aft, ← → out and in, Shift+↑ ↓ up and down, Q E turn), with the values beside the pointer, and Shift+click keeps them for the next one. You can also drag a part from the palette onto the aircraft; letting go somewhere it can't go puts it back.

## v0.5.5 · 2026-11-18 · Esc opens the menu without pausing, controls while paused, scores that add up

- **Esc opens the menu and doesn't pause.** Only the Pause button at the top left pauses and resumes. The menu is called Menu now, and its blue button is Close: it closes the menu and leaves the pause as it was. The flight goes on behind it (its keys wait until it's closed), opening it saves as the pause did, and Rewind 30 s works from it. Time of day and Weight and fuel open their window without touching the pause. Hiding the page still pauses, quietly, and the button reads Resume when you're back.
- **Set things up while paused:** switch between the cockpit, nose and outside views and move the camera freely; move the thrust levers (the engine panel's command marker follows at once, the engines when you resume), the flaps, the gear, the speedbrake, the autopilot and the FCU or MCP. Nothing moves until you press Resume, then it all responds at once; gear, flaps and speedbrake say so in a note when you set them.
- **Landing scores that add up.** Each category now scores out of its share of the 100 (vertical speed, the touchdown point and the centreline about 20 each, bank and pitch about 7), so the rows add up to the total, and anything taken off after that is a row of its own saying what it took: held down by the worst category, the grass (49 at most), off a runway (half). A would-be crash halves the total now instead of capping it at 10: your nose-gear landing on the 777 comes out at 31, halved to 15. Your reference landing scores 81. Older logbook cards show as they were.
- **Bounces are counted** from the main wheels leaving the ground: any hop after touchdown that rises 15 cm, or stays off for a fifth of a second, counts, even with the nose wheel still on. Before, the aircraft had to be off the ground for half a second with no wheel touching, so a quick hop after a flat, nose-first landing counted none.

## v0.5.4 · 2026-11-16 · A pause button, landings out of 10, and more for the warehouse

- **A Pause button** beside Hide panels pauses without the menu. While paused, L opens its window and everything in it works: the time of day, the weight and fuel, the weather. The pause menu's Weight and fuel and Time of day keep the game paused too.
- **Landings scored out of 10 per category.** Each part of the landing (vertical speed, peak g, the touchdown point, the centreline, bank, pitch, bounces, the approach path, the sink rate's swings) gets a score out of 10, and its bar fills to it: 6/10 fills it six tenths, coloured green down to red. The total is their weighted average out of 100 (vertical speed, the touchdown point and the centreline weigh most), held down by the worst part (50 + 10 × its score), so a slam can't hide behind a good approach, and several middling flaws make a C or a D, not 0. Your reference landing (190 ft/min, 2 m left, 150 m long, low at 1 km and a bob) still scores 80, a B. 100 takes 10/10 in every part; the grass is an F; a taxiway or a would-be crash 10 at most. Older logbook entries show as they were.
- **Renaming a design** in the warehouse renames it in Load scenario and in the saved flights that fly it (only the name: a saved flight keeps the parts it was saved with).
- **Sweep raises the top of the coffin corner.** Each side of the wing loses its maximum lift with the Mach number across its sweep, so a more swept wing holds its lift to a higher Mach, and a design's MMO follows its sweep (the 777's M0.89 is M0.95 at +8° and M0.83 at −8°; the warehouse shows it when it moves). A six-engine 777 at FL450 and 265 t has no window on its own wing; at +8° it's clear of the stick shaker from M0.79 and of the amber band from M0.91, up to M0.95. The three aircraft fly exactly as before.
- **Drop tanks:** the Weight tab's Drop wing tanks lets them go in flight, with the fuel still in them, their weight and their drag.
- **Keys for the part you've selected in the warehouse:** ↑ ↓ forward and aft, ← → out and in along the span, Shift+↑ ↓ an engine up and down, Q E turn an engine a degree. Each press is one undo step (a held key's repeats share one), the twin follows, the limits hold, and the help line under the view lists the keys the part takes. A turned engine is picked by its own turned box, and its outline turns with it.
- **The hangar's doors are shut.**
- **Fixed:** a bigger tailplane or fin no longer hangs past the end of the tail (they grow forward from their trailing edge), and the A321's inner flap stays behind its main leg on a short, forward-swept wing.

## v0.5.3 · 2026-11-15 · The airframe from parts

- **Reshape the airframe.** In the warehouse, click the wing, the tailplane, the fin or the fuselage, and its sliders take over the side panel: the wing's span and chord (0.8 to 1.3 times the base's), its sweep (±8°) and its dihedral (−3° to +8°), each side on its own if Mirror is off; the tailplane's and the fin's size (0.6 to 1.6 times); plugs in the fuselage ahead of and behind the wing (−4 to +6 m each). A green outline shows the new shape while a slider moves, the model follows when you let go, and Z undoes it. The A321's sharklets can come off.
- **It flies from its parts.** Each wing, each half of the tailplane and the fin is a row of strips, each in its own airflow, and the fuselage adds its own forces, so the handling follows the shape: a bigger tailplane is steadier and stiffer in pitch, a smaller fin is less steady in yaw, a longer wing lifts more and lands slower, and a wing longer on one side rolls the aircraft. The stall and approach speeds on the tape follow the wing's area, so a bigger wing opens the coffin corner. The three aircraft themselves fly exactly as before.
- **The model follows:** the wing with its flaps, slats, ailerons, spoilers, lights and engines (the Boeings' wings still bend), the tails scaled, the fuselage longer or shorter with its windows repeated or removed, never stretched.
- **The structure has weight:** a longer or swept wing, a bigger tail or a longer body weighs more and moves the centre of gravity, and a bigger wing holds more fuel.
- **New checks:** the static margin (red when the centre of gravity is behind the neutral point), the directional stability, the stall and approach speeds, the tail-strike angle, the load on the nose wheel standing and at full thrust, and the wingspan's code letter against the stand's. A design whose engines or tanks touch the ground standing can be saved, but not flown until it's fixed.
- **The controls tune themselves** to the new tail and wing (the yaw damper and the turn coordination), and the stabiliser's take-off setting allows for a bigger or smaller tailplane.
- **Stands fit the design:** one with a longer wing gets only the stands it fits, and parks with its own nose on the stop mark.
- Also: the keys stay in the warehouse after an undo, and a drag survives the pointer being taken away mid-drag. Designs from v0.5.2 open and fly as they did.

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
