# Peak Ooru — how the city moves

This is the model of a weekday's travel in Bengaluru: who travels where, by what, and how the roads and trains fill.
Slice 2 built it; slice 3 put right its known faults (peaks that never spread, trains that never filled, noise) and
added what the rules need (fares by line, passenger-km, ownership); slice 4 made the transit the player builds work in
it (metro lines, bus routes, bus lanes, more trains, works on the roads) and put right three faults in the data; slice 5
made travellers see the city's growth, made where people go answer to the roads, and added the player's roads, speed
limits, footpaths and road deaths (see "Slice 5" below); slice 6 added the state of the roads' surface and of each zone's
streets, floods, and what the rules need to wear roads down (see "Slice 6"); slice 7 made it fit to be scored on: routes
shared among near-best ways so that a small change moves a small share, events, and the named flood spots (see "Slice
7", which comes first where it and older text differ); slice 8 made a month quicker with the same answer to the last
bit, and fit to live for days in a server (see "Slice 8"); slice 9 left it as it was and measured what it says a new
player's first acts are worth (see "Slice 9"). It is written for whoever tunes it next, and for whoever builds the levers
on it. Brought up to date 29 September 2026 (slice 9).
Code: `src/sim/`. Tools: `tools/run-month.ts` (one month, its figures and timings; `--levers`, `--engines`,
`--engines --loaded`), `tools/calibrate.ts` (the model against published figures; `--fit`), `tools/measure-line.ts`
(what a line does; `--works`, `--load`); slice 5: `tools/measure-years.ts` (ten years of doing nothing through the
rules, month by month; `--lines`), `tools/measure-growth.ts` (the commute against growth), `tools/measure-roads.ts`
(the road levers and road deaths; slice 6: `repair`, `flood`), `tools/measure-lowland.ts` (slice 6: the low-lying links);
slice 7: `tools/measure-mend.ts`, `measure-noise.ts`, `measure-events.ts`, `measure-fair.ts`; slice 8:
`tools/measure-long.ts` (many cities in turn in one process, and its memory), `tools/measure-replay.ts`.

## In short

- A month is one weekday, worked out for four parts of the day: morning peak, midday, evening peak, night.
- **Demand:** round trips between zones by a gravity model: work trips from where people live, shared among the jobs;
  other trips (school, shopping, errands) held to the people who make them. Traffic from beyond the map enters by the
  main roads at the edge. Commercial traffic (goods, deliveries, taxis between fares) is added in proportion.
- **Modes:** each group of travellers (a home zone, a destination, a purpose) chooses among car, two-wheeler, auto or
  cab, bus, metro, suburban rail, cycle and walking by a cost of four parts: time, money, comfort, danger. A logit
  choice, with income setting the value of time, the dread of danger, and who has a car or two-wheeler to hand.
- **Roads:** vehicles in passenger-car units go over the routing network (5,086 links), each pair's shared among its
  near-best routes (slice 7), tolls counted. No link passes more than 1.5 times its capacity in the busiest hour: the rest are **held back into the
  shoulders of the peak**, never reach the links beyond, and pay for it in time. Nothing is shown slower than 5 km/h.
- **Trains fill:** each line carries at most its trains an hour times a train's crush load. Crowding weighs on every
  minute riding; beyond crush load riders are left behind and go another way.
- **The player's transit** (slice 4): any open line of kind metro, rail or bus in `CityState.transit`. How often it runs
  follows from its vehicles (`CityState.vehicles`), its length and its speed. A bus route runs on the roads at the
  traffic's speed, stops about every kilometre, shares its corridor with the city's buses, and feeds the stations near
  its stops. On a link in `busLanes` every bus runs free and the rest lose a lane; a link in `works` loses a lane.
- **Out:** flow and speed on every link in every period; commute door to door by zone and for the city; access to
  jobs within 45 minutes; trips by mode; riders by line; fares and passenger-km by mode and line; how full each line
  is; and what is needed to say why they changed.
- **Speed:** a month takes about 125–155 ms here (Apple M4 Pro, a busy machine) in WebKit and Chromium, 190–200 in
  Firefox, 205–220 under `vite-node`; with ten more metro lines and twenty bus routes, 160–205 and 255–275. See "Speed".
  Slice 5 (a machine busier still): Chromium least 156, median 165; WebKit least 136; Firefox 199, 206.
  **Slice 8** (load 6 to 7): Chromium least 208, median 229; WebKit 165, 176; Firefox 287, 291 (slice 7: 236/265,
  188/198, 310/313). Not the 175 ms aimed at: see "Slice 8".
- **The same everywhere,** and **smooth:** every engine gives the same fingerprint; a small change in the city gives
  a small change in the result, in one direction (see "Small changes, small effects").

## Slice 9

**Nothing in `src/sim/` changed.** The fingerprint of January 2026 is `faafa5f0` as before (`run-month.ts --digest`),
so every month the model works out for a given city is as it was. What slice 9 changed is in the rules (docs/RULES.md,
"Slice 9"): resurfacing done stretch by stretch, money scored in full from ₹1,000 crore, and "What could I do now?". This section is what the model was measured to say, for them.

### What a new player's first acts do (`tools/measure-first.ts`)

Each act done in January 2026 and nothing else, twelve months played, the score (the year in hand, as the screen shows
it) against doing nothing, after 3, 6 and 12 months. Before slice 9's rules and after (each column on its
own rules and marks; the "before" column is slice 8's rules and marks). `npx vite-node tools/measure-first.ts`, about 45 s:

| First act | Cost | Before: 3, 6, 12 months | After: 3, 6, 12 months |
|---|---|---|---|
| Doing nothing: the score itself | | 540, 532, 501 (547 at the start) | 555, 546, 515 (562 at the start) |
| Patch the worst road (Outer Ring Road, JP Nagar to Marathahalli, 14 km) | ₹2.4 crore | +3, +9, +2 | +2, +9, +3 |
| Resurface the worst road | ₹41 crore | −33, −9, +5 | −14, +3, +10 |
| Patch the ten worst roads (84 km) | ₹12 crore | +25, +22, +12 | +24, +23, +12 |
| Resurface the ten worst roads | ₹199 crore | **−98, −29, +8** | −15, +14, +32 |
| A bus route on the busiest corridor (10.5 km) | ₹6.6 crore | +12, +13, +13 | +11, +14, +13 |
| The bus route and lanes along it (20 km of lane) | ₹40 crore | +14, +18, +14 | +14, +19, +15 |
| Those bus lanes alone | ₹34 crore | +7, +16, +22 | +6, +17, +23 |
| Footpaths in the deadliest ward | ₹19 crore | 0, 0, −1 | 0, +1, 0 |
| Bus fare cut a fifth (₹1.60 to ₹1.30 a km) | fares forgone | +5, +5, +5 | +5, +7, +7 |
| Metro fare cut a fifth (₹4.50 to ₹3.60 a km) | fares forgone | +18, +18, +17 | +17, +19, +18 |
| The introduction: patch the worst road and a bus route | ₹9 crore | +15, +23, +15 | +14, +23, +15 |
| The same with the road resurfaced | ₹47 crore | −24, +7, +18 | +1, +19, +20 |

Doing nothing's own score falls through the first year (547 at the start, 540, 532, 501 on slice 8's marks) whatever the
player does: the city grows 3% a year and buys 2% more cars, the monsoon floods and wears the roads from June, and the
festival month (October) is the worst of the year. Every sensible cheap act above holds the score above that line; a
player sees their score fall less, and the report says by how much their own acts moved each measure (`explain`).
The first year's score is the average of its months, so an act's worth grows as its months accumulate.

- **Resurfacing** cost the most at first: a lane of every stretch shut for all of its (up to three) months, on the
  busiest roads in the city, and nothing good until the end. Resurfacing the ten worst roads cost 98 points of the year's
  score after three months. Done stretch by stretch (the rules, slice 9) it costs 15 at three months and is worth 32
  by twelve.
- **Footpaths in one zone** do nothing measurable to the city's score in a year, before or after: one ward of 369,
  five months to build, and the deaths saved (about 40% of those killed on foot there, a person or two a year) are
  within the model's noise of 3 deaths a year. That is right: they matter to the zone, not the city.
- **A bus route** is worth 13 points at once in January 2026 on the Outer Ring Road, but 2 or less once the Blue
  Line runs beside it (2027): a route is worth what it serves that the metro does not.

### What the model says each kind of suggestion is worth (`tools/measure-advice.ts calibrate`)

For "What could I do now?" the rules estimate each thing without the model and are fitted to these: the thing done,
twelve months played with it and without, from January 2026 and from January 2027, 2029 and 2031 of a game left
alone (points of the year's score):

| Thing | 2026 | 2027 | 2029 | 2031 |
|---|---|---|---|---|
| Patch the ten roads whose surface costs most time (₹12 to 16 crore) | 12.1 | 15.9 | 15.7 | 20.2 |
| Patch the one road that costs most | 2.7 | 1.7 | 4.3 | 6.6 |
| Resurface the three worst roads (₹80 to 128 crore), stretch by stretch | 14.3 | 9.3 | 7.3 | |
| Patch the streets of the ten zones where most live on broken streets (₹20 to 25 crore) | 6.7 | 10.0 | 7.1 | 6.6 |
| The busiest bus corridor no route of the player's serves | 13.6 | 2.1 | 0.6 | 7.9 |
| Redesign the three most jammed junctions | 4.9 | −0.2 | 0.3 | 1.8 |
| 40 km/h in the ten zones where most are killed | 4.7 | 5.5 | 0.2 | 7.7 |
| Footpaths in the three zones where most are killed | −0.5 | 1.1 | −0.7 | 0.5 |
| The upkeep budget from steady to generous | 24.2 | 31.5 | 37.0 | 39.3 |
| A standing order to patch potholes below 30 | 12.3 | 18.1 | 36.1 | |
| Three more trains on the fullest metro line | 10.3 | 9.3 | 9.3 | |

(The resurfacing and the last two rows' blanks: not measured on that month.) The junctions, the bus corridors after
2026 and the speed limits vary more than their size from month to month: the noise of a network change (above).

### Speed limits and footpaths, and the score (SLICE9, B job 4)

A month of January 2026's city, the 20 or 40 wards with most deaths, the measures scored:

| | Access ‰ | Commute s | Clean ‰ | Deaths a year |
|---|---|---|---|---|
| As it is | 136 | 3534 | 537 | 1,343 |
| 30 km/h in 40 wards | 125 | 3659 | 536 | 1,181 |
| 40 km/h in 40 wards | 132 | 3600 | 537 | 1,249 |
| Footpaths in 150 wards, 5% of each road's capacity taken (as the rules have it) | 131 | 3590 | 550 | 1,255 |
| The same, 2% (tried in slice 9, not kept) | 133 | 3572 | 551 | 1,266 |
| The same, none | 136 | 3540 | 552 | 1,276 |

A limit of 30 on the main roads of the forty deadliest wards (most of them on the fringe, where the main roads run
fast) saves 162 lives a year and costs 11 points of access (8%) and 2.1 minutes: by the score's weights, 23 points
for the lives against 62 for the time and reach. At 40 it saves 94 and costs 4 points and 1.1 minutes: about even.
A limit is kept to exactly in the model; in life drivers keep to it less, which would shrink both sides alike.

Footpaths at 2% rather than 5% were tried (a footpath takes mostly the verge and the edge already lost to parking, and
takes walkers off the carriageway): `safe-streets` rose 8 points, still under doing nothing, and good-governance's
kept list of actions from slice 8, played again under them, ran out of money in 2031 (the roads a little wider, more
driving, fewer fares by about ₹380 crore over five years). Not kept: the 5% stands.

## Slice 8

The server works out every month of every player's game, so every millisecond of a month is paid many times over; and
it runs for days in one process, for many players' cities in turn. **Nothing in this slice changes a result**: every
change below gives the same numbers to the last bit (the fingerprint of January 2026 is `faafa5f0` in all four engines
as before, and `a2081cc0` with ten more lines and twenty bus routes; all 80 cases of `measure-noise.ts` and every month
of all 28 scripted players come out bit for bit as before), so the season's marks and opening figures stand.

### 1. A month's time (`graph.ts`, `spread.ts`, `assign.ts`, `index.ts`)

`run-month.ts --engines`, load 6 to 7, against slice 7's final model:

| | Chromium least, median | WebKit | Firefox | Chromium, loaded city |
|---|---|---|---|---|
| Slice 7 (the brief's figures) | 236, 265 | 188, 198 | 310, 313 | 292, 326 |
| Slice 7, measured here at the start (load 4 to 5) | 244, 270 | 191, 200 | 311, 317 | |
| **Slice 8** | **208, 229** | **165, 176** | **287, 291** | **267, 281** |

Bundled for Node (as the server runs it), warm, least of 30 runs: about 222 ms → about 195. Side by side in one
process, the slice 7 code rebuilt beside this one: 276 → 250 least, 287 → 265 median (under `vite-node`, which is
slower than a bundle). So about 10 to 14% quicker everywhere. **The 175 ms in Chromium is not reached**, and I found no
way to reach it that keeps the answer (below).

What was done, each giving the same answer:
- **The holding back** no longer follows each root's trips to find what each link carries from it: loading the chosen
  demand keeps what each of a root's entries carried (`Ways.loadKeep`, into one array kept for every month), and the
  holding back reads it (`holdBack(…, kept)`). 28 → 15 ms.
- **Reading times along the ways**: the eighteen passes a zone took over its ways each month (the quickest times, the
  distances, the tolls, the city's buses, at each period's costs) are seven, each carrying several values at once,
  interleaved (`Ways.sweep`, `arrivalsOf`): along the midday ways at free flow and midday five values; the busy
  periods' buses together; at the end the night's and midday's times and the buses of all four periods together.
- **The guess and the traffic from beyond the map** are loaded in one pass (`Ways.load2`), not two.
- **The first eight roots of each busy period** are found on the roads empty, exactly as the midday's first eight are:
  they are copied from the midday's (`Ways.copy`) instead of found again.
- **Ways are written straight into their place** (`Ways.find`), not found into the finder's arrays and copied.
- **The tree** adds up its times as it takes each node, and needs no array of which nodes are taken (a node is taken
  when its distance is the bucket's).
- Smaller: the traffic fixed in advance added up in a loop, not by `map` with a function.

Where a month goes now (bundled Node, least of 30): the three periods' searches, the tree and the ways found from it,
about 60 ms of 195 (each of 584 roots: the tree about 60 µs, the ways from it about 45 to 70); loading them 25; reading
times along them 30; the four choices of mode 25; the holding back 15; the rest 40. The searches are what is left, and
are needed: every root at every period, each on the times the roots before it left.

Tried and **no quicker**: a bitmap of the buckets that hold entries (the empty ones are passed quickly already); a
tighter bound on how much slower a way may be (`SPREAD.cut` 240 → 150 s: the same time, since the work goes by nodes,
not by entries); Dijkstra on exact times with the ways weighed as each node is taken (10% quicker in a test harness,
and it changes every route a little); arrays of each node's incoming links' starts and costs; a sort of the nodes on a
separate array of distances.

**What would reach 175 ms, and what it costs** (for the coordinator to judge; none is done):
- Coarser zones: `GROUPING.share` 0.35 → 0.30 (172 → about 148 zones) is 13% quicker in Node (195 → 173), so about
  185 to 200 in Chromium, and moves every figure: the model would have to be calibrated again (docs/MODEL.md, "Speed":
  the grouping already costs 7.6 minutes of error in a zone's commute) and the marks set again.
- Ways found once at the midday for the traffic from beyond the map at the peaks (28 of 200 roots): about 3%
  (estimated), and that
  traffic would no longer go round the peaks' jams.
- Plain trees at midday and night (no sharing among near-best ways): about 6% (estimated from the parts), and the noise that slice 7 took out
  comes back to the midday's and the night's fifteen hours of traffic, where most road deaths are.
- Ways found once for the morning and the evening together: about 11% (estimated); tried in slice 7 for all periods and
  set aside (the jams of one period trap the other's traffic).

### 2. A model that lives long (`tools/measure-long.ts`, `tests/long-lived.test.ts`)

**What is kept between months, and how it is keyed.** Nothing kept can carry one city into another's month:
- `Ways` (spread.ts): the arrays of each period's ways, one set for each of the three periods, reused while large
  enough (slice 8: kept by period alone, not by the network's size, so that players' cities with different roads do not
  each make a set of their own; at most three sets, about 10 MB each). Every root's ways are written before they are
  read, every month.
- The kept flows for the holding back (`index.ts`, `keptStore`): one array, grown as needed, each root's part filled
  before it is read.
- `bus.ts`: the roads as a graph for finding bus routes, and the routes found: by the network object (a `WeakMap`, so
  it goes with the network), else by a fingerprint of everything read from it (the last four).
- `safety.ts`: each link's zone, by the network object, checked against a fingerprint of the zones' centres, else the
  last one by fingerprint.
- Nothing is kept by the identity of an object that the rules make afresh each month without also checking what it
  holds, and nothing in `src/sim/` changes an object it is given. The rules' caches (`networkOf`, the season's events,
  the lines' phases and lengths, the zones' totals) are keyed by the city's own objects, which the server loads once, or
  by the content of what the player built (`networkOf`: the last eight).
- `stages`, `guessScale`, `slowRatio` in `index.ts` are for the tools only: they are overwritten or added to, never
  grow and never feed a result.

**Tests** (`tests/long-lived.test.ts`): three players who change different things (lines, bus lanes, footpaths; fares
and tax; nothing), played month by month in turn, in changing order, come out as each does alone, month by month, by
`gameDigest`; each month started from a copy through JSON, as the server keeps a game, comes out the same; a game
played again between others comes out the same; the model worked out for two cities in turn gives each what it gives
alone. `tests/determinism.test.ts` (slice 3) does the same for the model on Bengaluru.

**Memory** (`tools/measure-long.ts`, a full collection before each reading):
- 10,000 months of the small city through the rules, forty players in turn, each game kept as JSON between months and
  begun again every 30 months: heap 36.4 MB after the first thousand, 34.8 MB after ten thousand; typed arrays 1.5 MB
  throughout.
- 400 months of Bengaluru, every month a different city (0 to 5 links added, surface, streets, lanes, works, floods,
  people, prices all different; every third month ten more lines and twenty bus routes): heap 29.7 to 30.2 MB, typed
  arrays 45.9 MB and external 53.5 MB from the 25th month to the 400th, unchanged; resident 460 to 520 MB under
  `vite-node` (which holds much of that itself).
So memory does not grow: **the model can live for 10,000 months of different games in one process**, holding about
30 MB of heap and 46 MB of arrays when working out Bengaluru.

### 3. Noise

Unchanged, since every result is: `measure-noise.ts` gives commute median 0.017, 90% 0.100, largest 0.233 minutes;
access 0, 0.1, 0.2 points; deaths 0, 1, 3 a year; clean trips 0.005, 0.035, 0.062 points; and all 80 of its cases (the
fifty changes and the thirty too small to matter) give the same fingerprint as slice 7's code, rebuilt beside it. These
are a little above the table in "Slice 7" (commute 0.08 and 0.22, clean 0.034 and 0.045), which was measured before
slice 7's final model; the final model's own figures are these.

## Slice 7

From this slice the model's figures are turned into points, so faults that could be shown are no longer tolerable.
What changed, in order of weight (`tools/measure-mend.ts`, `measure-noise.ts`, `measure-events.ts`, `measure-fair.ts`,
`measure-lowland.ts`; `measure-common.ts` holds what they share):

### 1. Routes shared among near-best ways (`spread.ts`; noise, and the mended road)

**What was wrong.** A root's trips went all one way (a tree), and each root's tree was found on the flows the roots
before it had left. A change of a hair on one link tipped a tie somewhere; that root's whole traffic moved, which moved
the times the next roots saw, and so on: a patch on four links of the Outer Ring Road moved the flow on 938 links by more
than 5% at the morning peak (1,006 at the evening), and a 1.1 km patch on Hosur Road took 37 seconds off the city's
commute, most of it from elsewhere. Measured again with the tools of this slice, the old model moved the city's commute
by up to half a minute for small changes, in either direction (below).

**Now** each root's trips are shared among the ways that lead ever further from it and are nearly as quick as the
quickest: a way `extra` seconds slower takes e^(−extra/60) as many (a minute slower, a third as many), counting less and
less beyond 2 minutes and not at all beyond 4 (`SPREAD`; Dial's method, a logit over efficient ways). A link that
barely leads further counts in proportion, so that a way comes in and goes out of those kept smoothly. Trips arriving
at a zone are shared among its junctions the same way. So the share on every link moves smoothly with every link's time,
and a small change moves a small share. Travellers read the quickest of their ways; the city's buses the midday
traffic's ways at each period's times. The rest of the order of work is as before (a root at a time, times brought up
to date every 8 roots). The rounds of assignment (`ASSIGNMENT.rounds`, never used) are gone.

What is left: loading a root at a time still passes a change on to the roots after it, smoothly now but not always
by a little. Two other ways were built and set aside, and are worth knowing: ways found once on a fixed "usual" traffic
(the network as built) made the model exactly smooth but trapped traffic on ways that the month's own jams made poor
(commutes of 7 hours between some zones, and a jump of 3 minutes for one link's patch); ways found on last month's
traffic (which the rules would have had to pass in) swung month to month by a minute and 60 deaths with nothing changed.

Also put right: the city's buses took their times from stale values for junctions a tree did not reach (a fault since
slice 4; bus times were a little short for some pairs); and the trains' crowding no longer moves riders from one
interchange to another all at once (`recost` in transit.ts: crowding weighs on the ways riders take, found without it).
The trains' left-behind are found in 8 rounds, not 4 (with more riders they did not settle).

**Recalibrated** (`calibrate.ts --fit`, `--deaths`), January 2026 as the season starts it: `ROAD.speedScale` 1.12 → 1.2,
`capacityScale` 1.05 → 1.12 (sharing traffic among ways loads more roads than sending it by the quickest alone);
`DEMAND.slow` 3.37, 1.33 → 2.74, 1.2; the fixed bothers car 6.6, two-wheeler 16.8, auto 13.1, bus −31.2, metro −4.8,
rail 7, cycle 95.3; the rates of road deaths. Commute 58.7 min (slice 6: 57.5), of it 19 lost to traffic; speed
morning / midday / evening 14.5 / 15.8 / 14.3 km/h (TomTom 14.6 / 16.6 / 13.2); shares and counts fitted as before;
878 deaths in the wards; Silk Board 19,100 PCU an hour entering (18,180), Hebbal 22,100 (18,154), Tin Factory 14,200
(16,919); the Outer Ring Road 1,530 PCU a lane an hour (1,330 before; BTP 2,800 on its busiest sections).

### 2. The mended road (job 1)

In slice 6 the screen forecast concrete on 1.8 km of the ring road at Marathahalli at 12.2 → 7.5 km/h. Two things were at
work, and both are the model's: the stretch's own links drew traffic from routes all over the city, since one change
reshuffled every route (above); and the "speed" was an average over the stretch, which moves as the traffic on its links
moves. The forecast itself compared like with like (both copies a month on, the road open at 100). Now
(`tools/measure-mend.ts`, the evening peak, per vehicle):

| Stretch mended | Its speed | Vehicles an hour, a link | Minutes over the stretch | City commute |
|---|---|---|---|---|
| ORR at Marathahalli, concrete (0.5 km, 37 → 100) | 18.0 → 24.6 km/h | 6,525 → 7,155 (+10%) | 1.32 → 0.99 | +0.00 min |
| ORR at Bellandur, concrete (1.5 km, 38 → 100) | 9.3 → 11.3 | 6,254 → 6,934 (+11%) | 7.28 → 5.85 | +0.17 |
| Hosur Road at Madiwala, patched (1.1 km, 39 → 62) | 10.4 → 11.8 | 4,250 → 4,569 (+8%) | 5.74 → 5.12 | +0.05 |
| Bellary Road at Hebbal, concrete (0.3 km) | 11.2 → 16.8 | 6,296 → 6,592 (+5%) | 1.44 → 0.97 | +0.05 |

The stretch is always quicker and carries more; routes elsewhere move on a few hundred links, not thousands. **But the
city's commute can still rise by a few seconds when a busy stretch is mended** (+3 to +12 s in these cases, rising
smoothly with the condition): more traffic comes down the corridor to the jams beyond it, and some leave the metro for
the road. Mending all of the Outer Ring Road still takes 0.8 minutes off, and every road at 100 6.7 (slice 6: 6.3). For
the screen: report a mended road by the vehicles it carries and the minutes each takes over its length (as C now does),
and the zones along it; never by the city's commute for one stretch, which is within the noise below.

### 3. Noise (job 2): `tools/measure-noise.ts`

Fifty small changes of nine kinds, one at a time, to January 2026 as the season starts it: one link's surface +15, short
stretches patched and laid in concrete, a zone's streets resurfaced, footpaths in a zone, a lane lost to works on a few
links, a link flooded a tenth of the month, a short new road, signals at a junction, bus lanes on a short stretch, a 30
km/h limit. Each is meant well or ill; "the wrong way" counts changes of the wrong sign (limits and bus lanes left out).

| | Commute, min | Access, points of % | Deaths a year | Clean trips, points of % |
|---|---|---|---|---|
| Old model: median, 90%, largest | 0.03, 0.37, 0.53 | 0, 0.1, 0.2 | 0, 3, 4 | 0.006, 0.059, 0.112 |
| Old: the wrong way (count, largest) | 9, 0.48 | 7, 0.2 | 11, 4 | 23, 0.095 |
| **Now: median, 90%, largest** | **0, 0.08, 0.22** | **0, 0.1, 0.2** | **0, 1, 3** | **0.003, 0.034, 0.045** |
| **Now: the wrong way** | **9, 0.18** | **0, 0** | **3, 1** | **14, 0.043** |

Thirty changes too small to matter (a fifth of a point on one busy link): commute at most 1 second, access 0.1 point
(the rounding), deaths 0, clean trips 0.001 points. The figures the score reads are whole seconds, thousandths and whole
deaths, so a change of 1 second or 1 thousandth is the rounding. **For D, the size below which a change is noise:**
commute **0.2 minutes (12 s)**, access **0.2 points of % (2 thousandths)**, deaths **3 a year**, clean trips **0.05
points of % (0.5 thousandth)**. The wrong-way results that remain are mostly real in the model: a lane lost on a jammed
trunk road meters the traffic into the jam beyond it and shortens the city's commute by up to 20 s ("works on 4 links
at 3396"); mending a busy stretch can lengthen it (above).

### 4. Fairness and the grouping of wards (job 3): `tools/measure-fair.ts`

The worst-served fifth is real: worked out with no grouping of wards at all (411 zones, 1 s a month), 80% of the people
in the worst fifth by access and 76% by commute are in the same zones as with the model's grouping; fairness 44.8%
grouped, 46.8% not. But grouping halves what a line does for the ward it serves: a metro line from Sampigehalli
(Vidyaranyapura, in the worst fifth) to MG Road raises that ward's access 4.7 → 5.6% grouped, 3.6 → 6.5% ungrouped, and
its commute falls 2.8 min grouped, 7.5 ungrouped. **And the measure falls even so** (44.8 → 44.4% grouped, 46.8 → 46.0%
ungrouped): the line raises the city's average more than the worst fifth's, since most of the worst fifth by access
are outer zones 20 km and more out (Bedarapalli, a zone of 148,000 on the south-east edge, is the largest), which no
line brings within 45 minutes of many jobs. A line from Bedarapalli to MG Road takes its access from 4.6 to 4.7%. So
fairness as a ratio to the average rewards leaving the centre alone; the rules may prefer the worst fifth's own level,
or its change against the average's.

### 5. Events (job 4): `tools/measure-events.ts`, `CityState.surge`, `busService`

- `surge` (thousandths): every resident's trip, work and other alike, times surge; goods and the traffic from beyond the
  map as usual. The routes are found at the network's size as before, so a surge never moves them. 1100: trips +10%,
  commute 58.7 → 62.3 min, vehicle-km +3.7% (the rest held back in the shoulders of the peak), deaths +60 a year.
- `busService` (thousandths): the city's own buses (the stand-in) come less often (the wait × 1/share, at most × 4,
  `BUS.mostSlower`) and carry at most share × 1.25 of those who would ride (`BUS.spare`, the room buses have off the
  peak); the rest go the other ways their group would choose, as those left behind by full trains do. The player's
  routes run as they are (a line on strike is given 0 vehicles). 750: bus trips −17%, autos +18%, cars +6%, commute +3.9
  min; 500: bus −55%, commute +8.1; 0: no bus, autos +119%, metro +52%, commute +9.4 min, clean trips 53.8 → 37.7%.
- A line on strike: the Purple Line with no trains: metro trips −53%, commute +6.6 min.
- Fuel: car and two-wheeler passenger-km answer the price with an elasticity of −0.17 (−10%), −0.19 (+10%), −0.25
  (+50%); car trips about −0.5, two-wheelers −0.07 (they are cheap to run); all vehicle-km on the roads −0.04 to −0.08
  (goods and outside traffic are held as they are, and jams hold back what the price frees). Published short-run
  elasticities of traffic to the price of fuel are about −0.1, long-run −0.3 (Goodwin, Dargay and Hanly 2004), and of
  vehicle travel −0.1 to −0.3 (Litman, *Transportation Elasticities*, VTPI): within range, at the low end for all
  traffic.
- A cave-in: `shut` at 1000 on the links of the stretch. Hosur Road at Madiwala (4 links): commute +0.8 min.

### 6. The flood list (job 5): `src/sim/lowland.ts`, `NAMED`

Beside the links found from the terrain (741), `LOWLAND` now holds the roads within 200 m of each of the 44 spots the
city, the traffic police and the press name as flooding (the four nearest within 600 m where none passes so close):
KR Puram, Hebbal (the flyover, taken at the junction the calibration uses, and Kempapura), Veerannapalya and Manyata,
Hennur–Bagalur Road, Kogilu Cross, Jayamahal Road, KR Circle, Peenya and the rest: 949 links (18.7%), 1,387 km.
`NAMED` gives each spot's name and links, for naming a flood. It now catches all 39 of the named spots with a road
near (it was built from them, so that is no test), and the BBMP's points a little better than before (flood-vulnerable
69% against 63%, low-lying 70% against 67%; link by link 2.75 times as likely near a published point, 1.66 before).
**For D:** 28% more links flood; every low-lying link shut 30% of the month now costs 7.4 minutes (slice 6: 3.2).

### 7. Also

- `MonthResult.cleanByZone` (C's field): the share of each zone's residents' trips by bus, metro, rail, cycle or on
  foot, thousandths, by home zone (the zone's group's).
- `homeTrips`, `homeClean` in `Choice` (modes.ts) carry it.

### 8. Where the ten years stand (job 6): D's scripted players on this model

`npx vite-node tools/playthrough.ts all`, 29 September, the rules as D had them then (their marks were set on the old
model, so the points are not yet meaningful; the figures are). Averages of the last twelve months:

| Plan | Access % | Commute min | Clean % | Deaths / lakh | Fairness % |
|---|---|---|---|---|---|
| good-governance | 15.9 | 47.6 | 55.6 | 5.9 | 43.1 |
| everything | 15.0 | 49.3 | 54.8 | 6.1 | 42.4 |
| lean-start | 13.8 | 50.3 | 56.1 | 6.2 | 42.3 |
| lanes-everywhere | 11.6 | 53.4 | 55.8 | 6.6 | 43.0 |
| metro | 11.7 | 57.0 | 51.3 | 7.2 | 42.5 |
| both | 11.7 | 57.4 | 51.7 | 7.2 | 41.8 |
| buses | 10.9 | 59.4 | 51.0 | 7.2 | 43.0 |
| keep-roads | 11.8 | 59.2 | 49.4 | 6.8 | 43.4 |
| roads | 11.5 | 60.0 | 49.3 | 7.4 | 42.7 |
| safe-streets | 10.0 | 63.6 | 51.2 | 6.1 | 42.9 |
| slow-everywhere | 9.8 | 65.3 | 49.5 | 4.0 | 42.9 |
| **nothing** | **10.6** | **62.9** | **50.4** | **7.1** | **42.7** |
| neglect (replaced in month 120) | 4.7 | 58.5 | 62.8 | 7.3 | 43.5 |

What is odd, and why:
- **Neglect comes out best of all on clean travel (62.8%) and better than doing nothing on the commute (58.5 against
  62.9).** Broken roads make driving slow enough that people walk, ride the metro, and take work and errands nearer
  home (access falls to 4.7%, the worst of all): the commute is an average of the trips made, and shorter trips made on
  foot shorten it. The same, less sharply, makes a city whose roads are kept up lose clean travel (keep-up, steady,
  roads: 49.3–49.5% against 50.4%) and a little safety (faster traffic kills more: roads 7.4 against 7.1 a lakh). The
  model is doing what it says; the measures reward it. For D: clean travel and the commute should be read beside access
  (or the commute taken for the same trips), or neglect should be kept from scoring on them.
- **Fairness hardly moves with any plan** (41.8–44.6%) and falls a little with a metro line: see 4.
- Otherwise the order is one a person would agree with: every plan that builds transit or bus lanes shortens the commute
  and raises clean travel; good governance is best on four measures of five.

### 9. Speed and sameness (job 7)

`run-month.ts --engines`, January 2026 as the data give it (no surface), the machine at a load of 6 to 9: **all four
engines give `faafa5f0`** (slice 6: `d6fa8e37`); with ten more lines and twenty bus routes, `a2081cc0`. Chromium least
236 ms, median 265 (slice 6: 175); WebKit 188, 198 (141); Firefox 310, 313 (216); loaded: Chromium 292/326, WebKit
223/237, Firefox 379/395. Under `vite-node` a month takes about 300 ms against the old model's 225, measured side by side.
**So a month is about 50% slower in Chromium, and does not meet the 175 ms aim.** Where it goes: finding each root's ways
(the tree, then putting its nodes in exact order and weighing the links into each: about 2.3 times a tree) at midday and
at both peaks; the ways are kept in arrays reused from month to month. Memory: 30 MB of heap and 40 MB of typed arrays
after a month. Things tried to cut it that did not pay: finding the ways once for all periods (the jams of one period
trap another's traffic), and fewer updates of the times (noisier).

## Slice 6

The state of the roads. The rules keep a condition of 0 (broken) to 100 (new) for every routing link and every zone's
minor streets and pass it each month as `CityState.surface` and `streets`; floods come as `CityState.shut`. The model
turns them into speed, capacity, deaths and bus-km on bad roads, and gives the rules the traffic that wears roads out.
Grades: good 75 and above, fair 50–74, poor 25–49, broken under 25 (`grade` in `surface.ts`).

### What repair is worth (`tools/measure-roads.ts repair`)

January 2026, the roads and streets as the first season starts them (the rules' `startWear`, 28 September: main roads
43.9 on average by length, 67% of their length poor, 30% fair; streets 49.5); against it:

| Case | Commute, min | Main roads at the peaks, km/h | Deaths a year | Bus running cost (index) |
|---|---|---|---|---|
| As the season starts | 57.50 | 16.3 | 1,351 (878 in the wards) | +3.6% (665 of 1,251 k bus-km on poor or broken roads) |
| Every road and street at 100 | 51.20 (−6.3) | 20.1 | 1,219 (−132) | +0% |
| Every road and street at 60 (fair) | 53.70 (−3.8) | 18.1 | 1,279 (−72) | +2.0% |
| Every road and street at 40 (poor) | 59.07 (+1.6) | 15.7 | 1,394 (+43) | +5.0% |

The Outer Ring Road alone (243 links, 125 zones with their centre within 1.5 km of it) from 40 to 100:

| The rest of the roads | The ring road at the peaks | Vehicles a weekday on it (average link) | Zones along it, commute | City commute | Deaths |
|---|---|---|---|---|---|
| As the season starts | 11.5 → 14.3 km/h (+24%) | 64.3 k → 73.0 k (+14%) | 52.93 → 50.75 (−2.2 min, −4%) | 57.90 → 56.00 (−1.9) | 1,351 → 1,341 |
| All at 100 | 12.5 → 14.5 km/h | 60.7 k → 70.5 k | 49.91 → 49.39 (−0.5) | 53.98 → 53.67 (−0.3, noise) | 1,252 → 1,236 |

Smooth in the ring road's condition (the rest as it starts): 30 → 58.30, 40 → 57.90, 41 → 57.85, 50 → 56.78, 70 → 56.12,
99 → 56.20, 100 → 56.00 minutes: the steps above 70 are within the noise (±0.3).

- **A quiet road is not worth mending:** the 243 main-road links carrying least (of those with 1,000 vehicles a weekday
  or more) from 40 to 100: their peak speed 20.9 → 21.8 km/h, traffic drawn to them 2.3 k → 3.8 k a weekday, the city
  −0.28 minutes (noise), deaths −2.
- **A zone's streets** from 30 to 90, the rest as they start: Marathahalli (a ward of 29,000, in a group of wards) 45.20 →
  44.58 minutes (−0.6); Bommasandra (189,000, a zone of its own beyond the wards) 38.72 → 37.48 (−1.2). The city does
  not move. A ward's streets count in its group by its people, so a small ward's are diluted (see "Zones").
- **The report's figure:** `surfaceDelay` gives the vehicle-minutes each link's surface costs at the traffic it
  carried: the ring road at 40 loses 156,000 vehicle-hours a weekday to its surface. It is at the traffic the link
  kept, not counting the traffic that went round it, and it does not count queues before the link.

### 1. What a poor surface does (PRD ROAD-3; `surface.ts`, `graph.ts`)

Speed and capacity kept, straight between marks at the middle of each grade and at 100 and 0, so that a point is
always worth something and 100 is exactly as built:

| Condition | 100 | 87 (good) | 62.5 (fair) | 37.5 (poor) | 12.5 (broken) | 0 |
|---|---|---|---|---|---|---|
| Speed lost | 0 | 1.7% | 5% | 20% | 40% | 50% |
| Capacity lost | 0 | 1% | 3% | 10% | 25% | 32.5% |

The PRD's marks (fair −5% speed; poor −20% speed, −10% capacity; broken −40%, −25%) are met at the middle of each
grade; fair's capacity (−3%) is judgement. Free time ÷ speed kept, capacity × capacity kept, both on top of the older
`condition` (still the share of free speed for anything else). A road's "share of free speed" in the result is measured
against the road in good repair, so a broken road shows slow on the map even at night. Buses slow as cars do, in bus
lanes too (their free speed is the road's). A published figure for comparison: on Indian two-lane roads each 1,000 mm/km
of roughness cuts capacity by about 300 PCU an hour of 3,200 (Chandra 2004).

### 2. Minor streets (`index.ts` `streetShare`, `graph.ts`, `modes.ts`, `transit.ts`)

By zone. A model zone takes the people-weighted average of what its wards' streets keep (the same curve as roads). It
slows: the side streets that join a zone to the main roads (the first and last stretch of every trip by car,
two-wheeler, auto and the city's buses, both ends); a trip within a zone; the walk to a bus stop and to a station, by
half as much as a vehicle (`SURFACE.walkShare`, judgement); and the ride by auto or two-wheeler to a station.

### 3. Road deaths (PRD ROAD-4; `safety.ts`)

**Keeping a broken road from looking safe.** The model's risk rises with the speed of traffic (a jam kills almost no
one). A road's surface both slows it and makes it more dangerous; were the risk read at the speed it has, a broken road
would come out safer. So on every link the risk is read at the speed its traffic **would have with its surface in good
repair and open all month** (`goodMovingTime`, `goodLightTime` in `assign.ts`: the same flow, the free time without the
surface's loss, the capacity without its cut), and the surface's own danger is a factor on top: two-wheeler riders ×
(1 + 1.0 × speed lost), everyone else riding × (1 + 0.3 × speed lost), the same factors as the older `condition`. So a
link's deaths per vehicle-km can only rise as its surface worsens; checked: every road at 40 kills 43 more a year than
as the season starts, at 100 132 fewer; mending the ring road saves 10 (two-wheeler riders 6 of them). Traffic that a
broken road sends onto other roads is counted where it goes.

**The size.** At the season's start the surface accounts for about 10% of road deaths (1,351 against 1,219 with every
road and street at 100), 15% of two-wheeler riders' (767 against 655), 7% of the rest riding. What is published:

- The ministry's *Road Accidents in India*: deaths put down to potholes 1,555 (2020), 1,481 (2021), 1,856 (2022), 2,161
  (2023), 2,385 (2024), 1.0 to 1.35% of all road deaths; with "ongoing road works" added, 3.5% (2022, 2023) and 4.4%
  (2024). Uttar Pradesh records over half the pothole deaths and several states none: a recording artefact.
- Karnataka: 16, 19, 68 and 24 pothole deaths in 2021–24, 0.2 to 0.55% of the state's 12,300 (Bangalore Mirror, 5 Nov
  2025). No yearly count for Bengaluru; NCRB's deaths from "civic negligence" (potholes, open drains) 20–49 a year.
- These are widely held to be under-counted: Indian police record one cause a crash and blame usually falls on the
  driver; the Supreme Court (6 Dec 2018) called 14,926 pothole deaths in five years "probably more than those killed in
  terrorist attacks"; IIT Delhi's TRIPP (2023) finds road deaths overall about 40% above the official count.
- Studies that look for it find the surface a contributing factor far more often: road defects in 30% of motorcycle
  crashes (MAIDS, Europe); potholes or gravel in 20% of single-vehicle motorcycle crashes (New South Wales 2006–10); road
  condition the cause of 8.5% of urban motorcycle crashes (NZTA); the road environment a factor in about 28–34% of
  crashes, the sole cause in 2–3% (Treat 1977–80; Sabey and Staughton 1975).

So the size is set above the ministry's 1–4% and within the 8–30% the studies find for two-wheelers: judgement.

**Calibrated with the roads as they are:** the three rates were fitted again (`tools/calibrate.ts --deaths`) so that
January 2026, its roads as the season starts them, has BTP's 878 in the wards (240 on foot, 516 on two-wheelers); a
city in perfect repair has fewer.

### 4. Buses (PRD ROAD-5)

Slowed as above. `MonthDetail.busKmByGrade`: bus-km a weekday on roads good, fair, poor and broken, the city's buses
(their riders' passenger-km over 37 a bus, spread over the roads other than expressways as the traffic is: the stand-in
has no routes) and the player's routes on their own links. 1.25 M bus-km a weekday as the season starts (BMTC runs
about 6,500 buses, some 1.3 M km a day); 53% on poor roads. **For the rules**, what a grade adds to a bus's running
cost: fair +2%, poor +5%, broken +10% (the index in `measure-roads.ts`): from BMTC on pothole-hit routes, breakdowns
+20%, tyre life −20%, spares +7.3%, fuel −0.25% (Deccan Herald, 25 Oct 2013; breakdowns 4.8% → 12.2% of the fleet
2013–19, TOI 29 Oct 2019), and repair and maintenance +10% at roughness IRI 4 and up to 50% for trucks at IRI 5
(Zaabar and Chatti 2014), over a cost that is about a fifth maintenance and tyres, a third fuel. Judgement.

### 5. What wears the roads (`MonthDetail.vehiclesByLink`, `heavyByLink`)

By routing link, vehicles a weekday (all four parts of the day, at the flow each passed) and the heavy ones among them:
buses (as above) and goods vehicles: 30% of the commercial traffic's car units (`SURFACE.goodsHeavy`; the rest are
vans, taxis and deliveries) and 30% of the traffic from beyond the map (`outsideHeavy`, highway lorries), at 2 car units
a lorry. Goods are loaded for the whole day on the midday routes, and cut on each link by the share of its day's
traffic held back. Heavy vehicles are 7.3% of the vehicle-km (judgement against classified counts, 6–8% goods vehicles
and buses on arterials). Also `surfaceDelay` (above).

### 6. Floods (`CityState.shut`; `graph.ts`)

A link shut for s thousandths of the month is taken as one month, not two: it carries the open share of what it would
(capacity × (1 − s)), and takes as long as it would on its open days stretched by the days it is shut (free time ÷ (1 −
s)), so that routes go round it in proportion and the routes are found on it as it is. Shut all month (1000 or more):
an hour to cross and next to no room, so nothing uses it that can go round. Cheap (nothing is worked out twice), smooth
in s, and exact at 0 and at 1000; between, the blend is of the link's time and room, not of two whole months, so the
queues of a road shut for a week and open for three are spread over the month. Checked: the 741 low-lying links shut
10% of the month: commute +1.75 minutes, their traffic −5%; 30%: +3.2 minutes, −20%; the 73 underpasses 30%: −0.3 (noise),
their traffic −26%. Deaths fall a little with the traffic. Road deaths read the risk at the speed of the open days.

### 7. Where the roads flood (`src/sim/lowland.ts`, `tools/measure-lowland.ts`)

`LOWLAND`: 741 routing links (14.6%, 1,278 km of 4,480), of them `UNDERPASSES` 73. There is no terrain in the game's
data. The stand-in: every underpass (a drawn stretch below ground), and every link that both runs near water (within 25
m of a storm-water drain, stream, river or canal, or 40 m of the shore of a lake of 5 ha or more: OpenStreetMap) and
dips there (its lowest ground 5 m or more below the average of the lowest ground under the links within two junctions:
SRTM, 30 m). A road on a ridge or hilltop is never marked: of the 2,554 links whose ground is above that of the links
around them, only underpasses (47). Sources and credits in DATA.md, section 8.

How good it is, against the city's published points (KSRSAC for the BBMP) and 44 road spots named by the city, the
traffic police and the press in 2023–26 (their places judged from maps, to a few hundred metres). A point is caught if
a marked link passes within 300 m; "at random" is what a list of as many links picked at random would catch (the
points lie in the dense centre, where many links pass each):

| Points | With a road within 300 m | Caught | At random |
|---|---|---|---|
| Named road spots (press) | 38 of 44 | 25 (66%) | 24 |
| BBMP flood-vulnerable locations | 150 of 200 | 94 (63%) | 87 |
| BBMP flood-prone locations | 57 of 70 | 35 (61%) | 39 |
| BBMP low-lying areas | 86 of 128 | 58 (67%) | 45 |

Link by link, in the area the points cover: 20.2% of the links near a published point are marked, 12.2% of the others
nearby: **1.66 times as likely**. So it finds the flooding roads better than chance, but not by much: SRTM is a surface
model, 30 m, whole metres, and the published points are neighbourhoods as much as roads. Caught: Silk Board, the ORR at
Bellandur and Marathahalli, Sarjapur Road at Iblur, Benniganahalli, Okalipuram, Nayandahalli, Mekhri Circle, CNR Rao
Circle, Kaveri Theatre, Cantonment, Sony World, Varthur Kodi and others. Missed: KR Puram, Hebbal, Hennur–Bagalur Road,
Manyata (Veerannapalya), KR Circle underpass (not an underpass in the routing network), Jayamahal Road, Kogilu Cross,
Peenya. Other rules tried (`--check`): water alone marks 28% of links for a ratio of 1.46; dips alone 23% for 1.52;
underpasses alone 1.4%. The rules may want to add the named spots the list misses by hand.

### 8. Calibration with the roads as they are

The published figures of 2025–26 were measured on roads as they are, not new ones, and the rules start the season with
most main roads poor. With slice 5's model and the season's start, January 2026 came to a 61-minute commute and speeds
9–16% under TomTom's. So the model is now calibrated **with the roads as the season starts them** (`tools/calibrate.ts`
reads the rules' start; `--perfect` for all at 100), and the network's speeds and capacities are those of roads in good
repair:

- `ROAD.speedScale` 1 → 1.12 and a new `ROAD.capacityScale` 1.05; the side streets' speed in good repair
  (`ROAD.joinSpeed`) 15 → 16.5 km/h, a zone's own streets (`TRAVEL.localSpeed`) 18 → 19.8.
- `DEMAND.slow` 3.216, 1.321 → 3.37, 1.33 (the usual slowness at the season's start).
- The three rates of road deaths fitted again (above). The modes' fixed bothers were **not** refitted: the shares came
  out within a point of before.

| Figure, January 2026 as the season starts | Slice 6 | Slice 5 (roads new) | Published |
|---|---|---|---|
| Speed, morning / midday / evening, all modelled roads | 14.5 / 15.8 / 13.7 | 15.8 / 16.7 / 14.8 | 14.6 / 16.6 (all day) / 13.2 |
| Commute, door to door; of it lost to traffic | 57.5; 21 | 53.6; 18.4 | 40–60 |
| Bus trips, metro trips a weekday | 4.37 M, 0.87 M | 4.58 M, 0.88 M | 4.30 M, 0.84 M |
| Deaths in the wards (on foot / two-wheeler) | 878 (240 / 516) | 878 (240 / 515) | 878 (225 + cyclists / 59%) |

TomTom's speeds are now met better than before (−1%, −5%, +4% against +8%, +1%, +13%). **This does not keep "a road at
100 is exactly as today"** in the sense of slice 5's numbers: the surface at 100 changes nothing in the model's working
(checked: every link and zone at 100 gives the same fingerprint as none), but the city in perfect repair is now 6.3
minutes faster than the city as it starts, not the same as slice 5. The other reading, keeping slice 5's scales and
letting the season start at 61 minutes, is a change of two numbers in `params.ts`; see "For the rules". **If the rules'
start changes by more than a few points, run `tools/calibrate.ts` again** (and `--deaths`).

### For the rules (D) and the screen (C)

- New optional fields of `MonthDetail`: `vehiclesByLink`, `heavyByLink` (Int32Array by link, a weekday), `busKmByGrade`
  ([good, fair, poor, broken] bus-km a weekday), `surfaceDelay` (Int32Array, vehicle-minutes a weekday lost to each
  link's surface). New exports: `surfaceSpeed`, `surfaceCapacity`, `grade` (`surface.ts`); `LOWLAND`, `UNDERPASSES`
  (`lowland.ts`); `goodMovingTime`, `goodLightTime` (`assign.ts`). `Lanes` in `graph.ts` takes `surface`, `shut`, `streets`.
- A forecast of repair is the month worked out again with the surface changed: the road's own speed and traffic and
  the zones along it answer clearly; the city's commute moves by less than 0.3 minutes for a few links (noise).
- Bus running cost by grade: fair +2%, poor +5%, broken +10% of the cost of a bus-km (above).
- The fingerprint of January 2026 with no surface is now `d6fa8e37` (slice 5: `b3db0900`); the four engines agree.

### Speed

Measured under very heavy load (load average 20 to 47, others' work): `run-month.ts --engines`: Firefox least 205 ms,
median 216; WebKit 136, 141; Chromium 167, 175 (slice 5: 199/206, 136, 156/165). Under `vite-node`, the season's start
least 196, median 223; all at 100, 194, 210 (slice 5: 205–220). The goods loaded for the heavy traffic cost about 2 ms;
the rest of the slice costs nothing measurable. Memory: 41 MB of heap in use after a month.

## Slice 5

### Where ten years went, and what was the model's fault

`npx vite-node tools/measure-years.ts --lines` plays the rules for 120 months, the player doing nothing, and prints
every month. At the end of slice 4 the commute of doing nothing ran 53.4 (Jan 2026) → 54.0 (Oct 2026) → 50.3 (Jul 2027,
Blue and Pink open) → 52.2 (2030) → 58.7 (Dec 2035): after the season's lines, **1.1 minutes a year**, the time lost
to traffic from 15 to 25.5 minutes, while metro trips stayed at 15 lakh (Blue and Purple full) and 27% more people
and 15–20% more vehicles went onto the roads. What a line is worth did **not** shrink with the years: MG Road to
Sarjapura opened at once took 1.75 minutes off in 2026 and 1.92 in 2035. So the gain was not being lost in the model;
the scripted builders built little (the metro player four lines of 7–9 stations, opening 2029 and 2033; the "both"
player ended with ₹4,100 crore unspent) and growth went to the roads. Measured one thing at a time
(`tools/measure-growth.ts`, people and jobs × 1.275 alike): ownership up 20% / 15% adds nothing to the commute (the
two-wheelers are quicker than the buses they replace); people × 1.275 add all of it, +10.1 minutes (an elasticity of
0.76: 10% more people, 3.8 minutes).

Two faults of the model's, both put right:

1. **Travellers chose on the roads of 2026, whatever the month.** The times they chose on came from the first guess,
   which is sized to the network (so that routes do not reshuffle), not to the month. So as the city grew nobody saw the
   roads fill: no one moved to the metro or bus for it, and the whole growth landed on the roads at once. Now the guess
   is loaded twice over, the traffic from beyond the map apart, and the times travellers choose on are the guess's
   pattern **at the month's own size** (`GUESS.perUnit`, the size the network gave it in January 2026) on the routes
   found at the network's size. The routes still do not move with growth; the times do, smoothly. (Never lighter than
   the network's size: the small test city, or a city that shrinks, is met as before.)
2. **Where people go did not answer to the roads.** The gravity model was on distance alone. Now, once the month's
   roads are known, work and other trips are shared out again with a further pull of e^(−0.003 × minutes of a round
   trip slower than usual), "usual" being the road time at the peak (work) or at midday (the rest) against `DEMAND.slow`
   times the free-flow time, the trip-weighted ratio of January 2026 (3.22 and 1.32). People take work and errands
   nearer home as the roads fill, and further when a road opens. January 2026 moves a little: commute 53.37 → 53.57,
   work trips 0–1 km 15.7 → 15.4%, 11–20 km 23.8 → 23.9%.

Also: the guess is sized by the **lanes of the city's own roads** (`GUESS.perLane`, those with a drawn stretch), not the
sum of capacity, so that more room at a junction or a new road does not make the guess heavier and the roads look
slower to travellers (in the small test city, more capacity everywhere lengthened the commute). January 2026 is unchanged.

After (the same tools, the rules as D had them on 28 September, growth by zone included):

| | Jan 2026 | Jan 2028 | Jan 2030 | Jan 2033 | Dec 2035 |
|---|---|---|---|---|---|
| People, lakh | 164.5 | 173.4 | 183.9 | 200.7 | 218.3 |
| Commute, min (before: 53.4, 50.8, 52.2, 55.4, 58.7) | 53.6 | 49.3 | 48.9 | 49.4 | 49.5 |
| of it lost to traffic | 18.4 | 13.7 | 14.0 | 15.6 | 16.8 |
| Metro trips, lakh a weekday (before: 8.8, 14.0, 15.0, 15.3, 15.5) | 8.6 | 15.3 | 18.1 | 21.3 | 24.6 |
| Car / two-wheeler trips, lakh | 17.5 / 61.2 | 18.4 / 64.1 | 20.1 / 69.2 | 22.9 / 77.7 | 26.0 / 87.3 |
| Peak speed, morning / evening, km/h | 15.8 / 14.8 | 17.1 / 15.2 | 16.5 / 14.5 | 14.9 / 13.7 | 13.7 / 12.9 |
| Road deaths a year (on foot / two-wheeler / other) | 1359 (400/769/189) | 1382 | 1408 | 1456 | 1509 (424/895/190) |

With people and jobs grown alike (`measure-growth.ts`, Blue and Pink open): 2026 48.97, 2028 50.07, 2035 52.75, an
elasticity of the commute to people of 0.28 (before 0.76). With the rules' growth by zone (faster where the commute is
short) the do-nothing commute is flat from 2028: the two effects together are the rational locator (people move home
or job to keep their commute) and may now be too strong; see "for the rules".

What building is worth in the model, each opened at once in the do-nothing city of the month (`--lines`):

| Opened in | Metro MG Road–Sarjapura | Bus route and lanes, Hosur–Mysore Road | Both | Three metro lines and seven bus corridors in lanes |
|---|---|---|---|---|
| 2026 | −1.78 min | −0.38 | −1.83 | −3.70 (deaths −103) |
| 2030 | −0.95 | −0.37 | −1.03 | −2.30 |
| 2035 | −1.32 | −0.53 | −1.60 | −3.82 (deaths −116) |

Bus lanes on every main road of two lanes or more (2,665 links) take about 5 minutes off in 2035. The scripted
players through D's rules at the time of writing (`tools/playthrough.ts`, commute in Dec 2035): nothing 49.6, both
48.1, everything 48.4, roads 49.7, safe-streets 51.1, metro defaulted in month 42 (before: nothing 58.7, both 57.1).

**For the rules** (D and the coordinator): the five-minute aim needs about as much building as the right-hand column
above, opened by 2030: the scripted players build far less and end with thousands of crore unspent. The suggestions
make short lines (7–9 stations); a line of 13–14 stations along a busy corridor is worth 1.3–1.8 minutes. The growth
rule that sends people where the commute is short now works on top of the model's own answer and flattens the
do-nothing commute; it also gives a builder more people, which eats part of the gain. The busiest lines are full from
2027 (Blue 99%, Purple 98% of crush): more trains on them are worth offering. Bus lanes are cheap and strong; weigh
their approval cost knowing that.

### Roads the player builds (BLD-5, BLD-6, POL-1)

`CityState.roads` may hold nodes and links the city's data does not; the model takes it as given. Checked
(`tests/sim-roads.test.ts`, `tools/measure-roads.ts`): a new link between two nodes carries traffic and routes move to
it; a flyover far from its ends; a link shut (run from its start to its start) carries nothing; a node's signal and
capacity changed. Things built from the network are kept by the object and, failing that, by a cheap fingerprint
(`fingerprint` in `bus.ts`: ends, lengths, speeds, lanes, signals, kinds, and nodes), so a network rebuilt equal each
month finds the bus ways and the links' zones already worked out. The flattened graph and the zone joins are built
each month (a few ms; the grouping of wards did not change over the ten years of growth by zone).

| Lever, January 2026 | Commute | Deaths a year | Else |
|---|---|---|---|
| Flyover carrying the ORR over Silk Board, 2 lanes each way | −0.15 min | +2 | 5,200 vehicles an hour each way on it; roads into the junction 6.3 → 10.8 km/h |
| A new road, 2.9 km, 2 lanes each way | −0.07 | +5 | 2,500 an hour each way |
| A lane more each way on all of the ORR (+1.55% of lane-km) | −1.70 | +49 | ring road 13.4 → 17.4 km/h, its vehicle-km +18%; all vehicle-km +0.07% |
| Signals, redesign, overpass at Silk Board | −0.05 to −0.15 | 0 to +2 | within noise, see below |
| Twenty new links | −0.18 | +3 | a month 223 → 207 ms (median of five; no slower) |

**More road, more driving:** at once, the elasticity of vehicle-km to lane-km is about 0.05; published short-run
figures are 0.1–0.5 and long-run 0.8–1.0 (Duranton and Turner 2011; Litman, *Generated Traffic*). Two-wheeler and car
trips rise a little, trips lengthen a little; work trips are held to both ends and cannot lengthen much. The rest of
what the literature finds comes from where people settle, over years: the rules' growth by zone. The model counts
the new road's pull on routes in full ("moves the jam along": the ring road's traffic +18% when widened).

**Noise:** any change to the network moves the routes of the whole city a little, as the first loading is chaotic.
One link added in an empty corner moved the commute by 3 seconds and metro trips by −1.3% (the Green Line −3%). Levers
on a few links (a junction, a limit on a zone's roads) are within ±0.3 minutes of noise; read their local figures.

### Speed limits (POL-3)

`CityState.limits` (km/h by link) holds traffic to the limit: a link's time is never below its length at the limit,
and never raised above what traffic makes it anyway (`least` in `graph.ts`, `linkTime` in `assign.ts`). So on a road
jammed at the peak it costs nothing, and at night it costs all. **A limit at or above a road's free speed does
nothing** (a 40 on a road whose free speed is 30). The city's free speeds: tertiary 25 km/h (median), secondary 33,
primary 47–50, trunk 60, motorway 80: so 50 does nothing on primary roads, 40 little on secondary ones, 30 nothing on
tertiary ones. The map shows a limited road at its limit as free, not jammed (speed is a share of the limited speed at
light traffic); `MonthDetail.limits` echoes them so that `linkKmh` gives km/h right.

In the 20 zones with most deaths (January 2026): 30 km/h (470 links) +0.63 minutes, deaths −152 (−11%), speed there
at the peaks 26.1 → 23.1, at night 48.3 → 29.6 km/h; 40 (249 links) deaths −75; 50 (140 links) deaths −20. (The
commute figures for 40 and 50, −0.30 and −0.20, are the noise above.)

### Footpaths (BLD-7)

`CityState.footpaths` (zone ids). For the share of a model zone's people in wards with footpaths: walking trips feel
15% less long and half as dangerous; the walk to a station weighs 1.5 not 1.8 and reaches 2.5 km not 2 (`FOOT`);
people killed on foot there fall 40%. In the 20 deadliest zones: walking trips +4.6%, deaths there 387 → 350,
commute +0.3 (more short trips walked, slower than riding). Everywhere: walking +21%, car −14%, deaths −166.
**The walk to a station hardly moves**: model zones are wider than a walk, so the ride by auto or two-wheeler is
nearly always the cheaper way to a station, and the busiest lines are full. The city's stand-in buses are left as they
were (giving them the lighter walk moved riders from metro to bus).

### Road deaths (SCORE-4)

`MonthResult.deaths` and `deathsByZone` (whole; the zones add to the total), `MonthDetail.deathsBy` (on foot or
cycling, two-wheeler riders, the rest). Deaths a year at the month's rate, in `safety.ts`:

- **Two-wheeler riders:** the month's two-wheeler km, spread over the links as the traffic is, each link weighted by
  v²/(v² + 60²) at the speed two-wheelers ride there (car speed with 70% of the delay: they filter), its junction work,
  and its repair (×(1 + share of speed lost)).
- **Everyone else riding:** each link's car-unit km × v²/(v² + 80²), junction, repair ×(1 + 0.3 × share lost).
- **On foot and cycling:** in each zone and period, √(km walked or cycled there an hour × km driven there an hour ×
  v⁴/(v⁴ + 68⁴)) (Tefft 2011: the chance a person struck at v km/h dies); expressways left out; × 0.6 with footpaths.
- Junction work (the rules' `node.work`): links into the junction × 0.85 (signals), 0.75 (redesign or overpass).

Calibrated so that in January 2026 **the 369 wards**, the city the Bengaluru Traffic Police count, have **878** deaths
a year (BTP, 2025; 894 in 2024, 910 in 2023; 614 in January to July 2026), **240 on foot** (225 pedestrians in 2025,
The Hindu 11 Jan 2026, and about 15 cyclists: judgement) and **515 on two-wheelers** (59% of the killed, BTP Road Safety
Report 2023 via Bangalore Mirror). The 42 zones beyond the wards, at the same rates, add 480 (not counted by BTP; 12 a
lakh against 7 in the wards). The deadliest zones are on the fringe, on fast roads (Hoskote, Bagaluru, Bommasandra,
Attibele, Bidadi), as BTP finds (its worst stations 2025: Yelahanka, Chikkajala, Electronic City, the airport).

Deaths fall with footpaths, speed limits, junction work, and fewer two-wheelers (a fifth fewer to hand: −124 a year,
two-wheeler deaths −19%). **They also fall as traffic slows: a road jammed solid kills next to no one**, as the risk
falls with speed. That is so in life (the fatal crashes are at night and on the free fringes), but it means that
making the roads faster costs lives in the model (a lane more on the ORR: +49 a year) and a city left to jam is shown
as a little safer than it would otherwise be. Transit takes two-wheeler km off the roads and the roads it relieves get
faster, so a metro line alone hardly changes deaths (−2); bus lanes, which slow the rest, cut them (−40 for one corridor).


## How it works, in order

### 1. Zones the model works on (`zones.ts`)

The game has 411 zones; the city's 369 wards are small (median 1.1 km²). The work of choosing modes grows with the
square of the number of zones, so the model groups wards with their nearest neighbours: the smallest group joins
the nearest other, again and again, until the wards are in 35% as many groups (130, `GROUPING.share`). The 42 zones
outside the wards are kept as they are. So the model works on 172 zones (slice 2: 227). A group's people, jobs and
area are the sums of its wards'; its centre is the people-weighted centre; its income class is the rounded
people-weighted average; its road node is that of its most populous ward. Every ward is given its group's commute and
access. The result keeps all 411. See "Speed" for what this costs in accuracy.

### 2. Demand (`demand.ts`, `index.ts`)

- **Work.** Workers by home zone: 0.3256 for each person living there (`DEMAND.workersPerPerson`: 74% of jobs
  attended, over 7.24 M jobs and 16.45 M people as the data stand). They share out among the jobs in proportion to
  each zone's jobs. So more people bring more work trips, and more jobs draw them. (Slice 2 set workers from jobs, so
  growing people alone added no work trips.) Pull between zones e^(−0.2 × km), a zone's own work × 12
  (`workNearHome`). Balanced to both ends in 12 rounds.
- **Other.** 0.3 round trips a person a weekday, drawn to jobs + 0.8 × people, pull e^(−0.35 × km), own zone × 12.
- Distance is a straight line × 1.3; within a zone, 0.45 × √area × 1.3. Pairs with under half a round trip are dropped
  and the rest of the row scaled up to keep the total.
- **Beyond the map:** 220,000 PCU a day each way at the 28 gateways on primary roads or above; 20% passes straight
  through; the rest spreads to zones by jobs + people and e^(−0.03 × km).
- **Commercial traffic:** 0.5 PCU each way for each other round trip, mostly at midday and night (slice 3: 0.3; raised
  in slice 4, a calibration term, when the data's faults were put right and the roads had become faster than TomTom
  finds them).
- **When:** work: out 80% morning, 17% midday, 3% evening; back 12% midday, 68% evening, 20% night. Other: out
  25/50/20/5%, back 5/50/35/10%. External 20/35/20/25%, commercial 10/50/10/30%.
- **Busy-hour flow:** a period's PCU over its effective hours: morning 3, midday 5, evening 2.5 (slice 2: 2.8; TomTom
  finds the evening the slower peak), night 10.

### 3. Modes (`modes.ts`, `transit.ts`)

For each pair of zones and each purpose, the cost of the round trip by each mode is, in minutes:

  felt time + rupees × weight × 60 / value of time + danger + a fixed bother per leg

- **Time.** Road times come from the assignment: each purpose's legs weighted by when it travels. Car: road time + 8
  min at the ends. Two-wheeler: free-flow time + 70% of the delay + 3 min. Auto or cab: road time + 5 min to find one.
  Bus (the city's service, a stand-in with no routes): the road time along the **midday** routes at each period's
  speeds (buses keep to their routes whatever the traffic; slice 4: along each period's own car routes before), by
  whichever of a zone's junctions is quickest for the bus, plus 0.055 s a metre for stops, at free speed on a bus lane;
  walk 300 m + 0.3 × each zone's spread at each end; wait 6 min in the wards, 12 outside, doubled beyond 12 km. The
  player's bus routes, metro and rail: below. Cycle 13 km/h; walk 4.5.
- **Weights.** Walking and waiting count 1.8 times riding; riding a bus 1.25, two-wheeler 1.15, auto 1.05, metro
  1.05, rail 1.1, cycle 1.5. Walking and cycling tire: each minute counts (1 + minutes/50).
- **Money.** Fuel ₹111 a litre; car 13 km/l, two-wheeler 45 km/l; parking at the destination (`prices.parking`, by
  zone); **tolls** on the route (below). Auto ₹36 for 2 km then ₹18 a km. Bus ₹1.6 a km, least ₹10, most ₹32, 45%
  pay (Shakti). Metro ₹4.5 a km, least ₹10, most ₹90. Rail ₹0.4 a km.
- **Fares weigh more than fuel** (`TRAVEL.fareWeight`): a rupee of bus fare counts 3 times, of metro or rail fare
  twice, what the value of time gives. Without it riders hardly answered fares (bus elasticity −0.01, metro −0.12);
  with it they answer in the published range (see "Levers").
- **Danger.** Minutes per km: two-wheeler 0.35, auto 0.05, cycle 1.2, walking 0.6, times how much each income minds.
- **Income.** Value of time ₹45, 80, 130, 210, 340 an hour for incomes 1–5. Chance of a car to hand 4, 9, 17, 30,
  46%; a two-wheeler 34, 46, 55, 55, 48%, independently, **times `ownership`** (thousandths of today's, from the
  rules; at most 100%). Travellers are in four groups by what they have, and choose only among what they have.
- **Choice.** Logit on the round-trip cost with scale 0.055 a minute. No way is ever given odds below e^(−50), so that
  every group always has somewhere to go, however dear the rest (free fares and ₹1,000 fuel came out as NaN before).
- **Fixed bother per leg** (fitted by `calibrate.ts --fit`): car 6.3, two-wheeler 16.5, auto 13.7, bus −23.1, metro
  9.4, rail 29.2, cycle 94.7, walking 0 minutes (slice 3: 5.4, 15.9, 13.4, −30.5, −12.4, −14.7, 97.0). They carry
  everything else. The bus's is large and negative: the stand-in bus is slow (91 minutes door to door for its
  commuters) and mostly carries those with nothing else. Metro and rail went from negative to positive when the ride
  to the station stopped counting as a fare (below) and got quicker: the model finds the lines as they stand more
  attractive than their riders show, and the bother holds them to the counts. Rail's 29 minutes is large: its
  published count is old and small (see "What it gets wrong").
- **Metro and rail** (`transit.ts`): the lines in service. Stations of an interchange are one place. Trains 32 km/h
  (metro) and 35 km/h (rail) between stations, stops included. Wait half the headway, at most 15 (metro) and 45 (rail)
  minutes. **Headways** (peak): Purple 4 min (3.3 on its busy central section, 5 beyond), Green 5 (BMRCL via
  Moneycontrol, 4 Dec 2025); Yellow 6, since 15 Aug 2026 with 13 of its 15 trains in service (The Hindu, 15 Aug 2026;
  it opened in Aug 2025 with 3 trains at 25 minutes, then 19, 15, 13, 10, 9, 7 and 6); other metro lines 5
  (judgement); a new metro line 4 (BMRCL's aim for every corridor, Moneycontrol, 4 Dec 2025; slice 3: 5); suburban
  rail 45 (judgement: 30 to 90 minutes, closer at the peak). Changing lines 4 min on foot plus the new wait. Each zone
  reaches the nearest station on each line, up to 4, on foot within 2 km, or by auto or two-wheeler within 5 km (at
  12 km/h after 2.5 minutes' wait, and half an auto fare: about half ride their own two-wheeler, and half find an auto
  in 5 minutes; slice 3 waited 4), or by one of the player's bus routes (below). A journey is the best over the zone's
  stations at each end, the fare counted with its weight; **the ride to the station is money, not a fare**, and weighs
  once (slice 3 weighed it as a fare, twice: a new line near a zone could then look dearer than its stations were, and
  in the small test city a new line lowered metro trips).
- **Riders by line** are boardings (a change of line boards again), as BMRCL counts.

**Trains that fill.** A line carries at most its trains an hour × a train's crush load: six-coach trains carry 2,000
at crush (1,580 at normal load; BMRCL via Deccan Herald, 5 Jul 2024), so Purple 30,000 riders an hour each way,
Green 24,000, Yellow 20,000; a suburban train 2,500 (judgement), 3,300 an hour. In order:

1. **Uncrowded** (`chooseModes` with `estimate`): who would ride between each pair of places at each peak if trains
   never filled. Only pairs with metro or rail are worked out.
2. **Crowding** (`crowdSkim`): each minute riding a link feels 0.9 × y² more at a load of y times crush (so 1.9 times
   as bad when full), and 0.9 + 8 × (y − 1) beyond. The load and the crowding it brings are found together by the
   method of successive averages (12 rounds): riders between a pair are put off as a logit puts them off, their share
   p falling to p e / (1 − p + p e), e = e^(−0.055 × extra minutes both ways), p being how firmly their groups chose
   the train. Then the best ways are worked out again with the crowding.
3. **Crowded** (`estimate` again): who would ride in that crowding.
4. **Left behind** (`boarding`): each ride passes at most its capacity; riders it cannot take are left behind before
   it, and so do not crowd the rides after it (4 rounds). A round trip gets on in the lesser of its two ways' shares.
5. **The choice for good:** crowding in the cost, and those left behind go the other ways open to them, in the shares
   their own group would choose among those. At today's figures Purple runs at 99% of crush at its busiest point,
   Yellow 100%, Green 62%.

The city's bus is still a stand-in: no routes, no frequencies, no crowding. The player's bus routes come on top of it.

### 3a. The player's lines (`transit.ts`, `bus.ts`, `index.ts`)

- **Any line.** `CityState.transit` may hold any lines and stations; a line counts when it is `open`, has two stations
  or more that exist, and has vehicles if `vehicles` gives a number. Stations that do not exist are passed over, a
  station listed twice running is one stop, a second line with the same id is ignored. A line joins another where they
  share a station or an interchange; one that joins nothing is a system of its own; stations far from any road are
  reached from zones within reach of them, or from none. `tests/sim-lines.test.ts` tries these.
- **Vehicles and headway.** `defaultVehicles(transit, lineId)` (exported) is what a line runs when `vehicles` says
  nothing: enough for its headway (published, else 4 minutes for metro, 45 for rail, 10 for a bus route) over a round
  trip at its speed with a turn of 5 minutes (rail 15) at each end. With `vehicles[id] = v`, a metro or rail line runs
  at its headway × default / v, so its default number gives exactly today's; a bus route runs every (round trip + 10) /
  v minutes. Never closer than 2 minutes (metro), 10 (rail, which shares its track), 1 (bus). 0 vehicles: not running.
  Capacity is trains an hour × 2,000 (metro), 2,500 (rail), 80 (a 12 m bus, seated and standing: judgement).
  `MonthDetail.headway` gives each line's headway to a tenth of a minute.
- **Bus routes** (kind `bus`). The route runs between its stops by the quickest way at free speed (`busSegments`,
  `busPath` in `bus.ts`: each stop at the nearest junction where a bus may stop, not a gateway or a motorway-only one;
  exported so that the rules and screen lay a route out as the model runs it). It stops about every kilometre
  (`BUS.stopSpacing`) as the city's buses do, not only where the player put a stop: further stops are made at the
  junctions on its way. It rides at the busy periods' road times, 0.055 s a metre for stopping as the city's buses, at
  free speed on a bus lane; each way averaged with the way back. People walk to its stops as to the city's buses where
  it passes through their zone, and further by as much as it passes beyond (no auto to a bus stop). A route runs where
  the city's buses run too, and riders take whichever comes first that goes their way: the wait is on both together
  (the city's taken as every 12 minutes), and the route's own buses carry their share, 12 / (12 + its headway), of
  those riding its course; its riders, fares and km count only that share. The bus mode for a pair of zones is the
  better of the city's buses and the routes; those the routes' full buses leave behind take the city's. Its buses are
  on its links in every period (3.5 car units each), but for those in a bus lane.
- **Feeders.** A zone that walks to a route's stop reaches a metro or rail station within 400 m of another of the
  route's stops by the route, paying the bus fare: a way to the station beside the walk and the auto.
- **Bus lanes** (`busLanes`, routing link ids). On a link with two lanes or more: every bus (the city's and the
  routes') runs at free speed with the signals' delay, and everyone else has a lane less (capacity × (lanes − 1) /
  lanes). Ignored on a one-lane link, or a link that does not exist.
- **Works** (`works`, routing link ids, an optional field added to `CityState` in slice 4). Each time a link is listed
  it loses a lane: capacity × lanes left / lanes; works that take every lane leave half a lane. Routes move round it:
  the first guess at traffic is sized to the roads as built, not as the month has them, so a change on a few links
  moves routes near them and not everywhere.

### 4. Roads (`graph.ts`, `assign.ts`, `index.ts`)

- **The network** is A's routing network. A link's free time is length / (speed × speedScale × condition × what its
  surface keeps); signals add 15 s each. Capacity (PCU an hour) is × capacityScale, cut by 0.6 × the speed lost to
  `condition` and by what the surface costs (slice 6), and for a share of the month shut.
- **Zones join the roads** at junctions near their centre (within 1.2 km, or 0.7 × √area): at least 4, one more for
  each 4 km² up to 8, no two closer than 0.3 of the reach where the roads allow, so that a large outer zone reaches the
  roads at several places spread over it, as its side streets do. **A junction where only motorways meet is never
  joined**: side streets do not meet an expressway between its interchanges (29 joins onto the NICE Road before). **A
  junction only of one-lane roads** (under 1,500 car units an hour) counts as 0.5 km further off, and is not taken
  first as the zone's own: Panathur's tech parks, 180,000 jobs, joined the roads first by one-lane Panathur Main Road
  and now join the Outer Ring Road side (slice 4).
- **Tolls:** every motorway link is tolled at ₹6 a km for a car (NICE Road ₹72–83 a section, the Electronic City
  flyover ₹65, the Nelamangala tollway ₹105 for 19.5 km, 2026 rates: see Sources), a two-wheeler 35% of that. Routes
  are chosen on time plus the toll at ₹200 an hour; the toll along the morning's route enters the money of a car or
  two-wheeler trip. Times reported leave the toll out.
- **Speed and flow** (`linkTimes`): time = (free + signals) × (1 + 1.5 × x⁴), x = flow / capacity, up to x = 1.5, the
  most a link passes in the busiest hour. BPR's form with α raised from 0.15 to 1.5 and applied to the signals too
  (junctions slow as they fill, PRD CITY-23), so that the curve is steep near capacity. Beyond 1.5, those who would
  enter are held back (below) and pay 20 minutes for each further 1.5 × capacity that would enter: roughly the
  average wait in a queue that builds through the busiest hour, less some who set out earlier or later instead.
- **Holding back** (`holdBack`, PRD CITY-22a): every trip's route is followed from its start; the share of it that
  gets through a link is the share that got through the links before, times the share the link lets pass (1.5 ×
  capacity over what reaches it). So the flow **shown** on every link is at most 1.5 × capacity, and the links after a
  full one carry only what it let through. The flow reaching each link is first estimated from one root in four (as a
  share of their flow that gets there), then worked out for every root. The trips held back travel in the shoulders
  of the peak, which makes the peak longer; the report still shows four parts of the day.
- **What the map shows** (`movingTime`): the speed at the flow a link passes, the queue left out, never below 5 km/h
  (`ROAD.crawl`), as a share of the speed at light traffic **with its stops at signals**. (Slice 2 measured it against
  the speed without the signals, so short signalled links in the centre and at KR Puram showed red at night with no
  traffic: 156 links under 45% at night then, 3 now.) `linkKmh` in `index.ts` gives km an hour from it.
- **Order of work:**
  1. Midday is loaded root by root on a first guess at its demand, each root on the times the roots before it left
     (the times brought up to date every 8 roots). Its trees are the midday and night routes and give the distances
     and free-flow times between zones.
  2. The busy periods are loaded the same way (`ASSIGNMENT.rounds` rounds of Frank–Wolfe after it: 0 as set).
  3. The **first guess is sized to the network, not to the month**: its pattern is the month's (residents' guessed
     car units, 0.2 a work round trip and 0.1 another, and goods), its size set to what the roads as built usually
     carry (`GUESS.load`, per unit of their capacity before repair, works or bus lanes), with the traffic from beyond
     the map as it is. So a city that grows alike everywhere keeps exactly its routes, and prices never move them;
     works and bus lanes move routes where they are. See "Small changes, small effects".
  4. The player's bus routes are timed on the busy periods' roads; the metro, rail and route systems are worked out
     (routes first, as they feed the stations). Travellers choose modes on the times read along those routes (with the
     trains' and routes' crowding, above).
  5. The chosen demand goes onto the same routes, each set carrying its share.
  6. Holding back (the routes' buses added after it, on their links), then the times the month's traffic comes to, at the flows that reach each link (queues included);
     the commute and access worked out on them with the shares chosen in 4.
- **Flow** in the result is vehicles an hour: PCU × the ratio of vehicles to PCU in residents' road trips (about 1.5).
  Capacity in the data is in car units: compare it with `flow / vehiclesPerPcu`.

### 5. What comes out (`index.ts`, `MonthDetail`)

The agreed `MonthResult`, and these further fields (`MonthDetail`, a superset; `simulate`'s type is unchanged):

| Field | What |
|---|---|
| `commuteByMode` | Work trips a weekday by mode, and their average door-to-door seconds |
| `commuteDelay` | Of the average commute, the seconds lost to traffic (queues included) |
| `costParts` | Average minutes of time, rupees, minutes of discomfort and of danger per trip, by mode |
| `tripKm` | Average km of a trip by mode |
| `workDistance` | Work trips by the census's distance bands, thousandths |
| `vehiclesPerPcu` | The ratio used to turn PCU into vehicles, by period |
| `fares` | **New.** Rupees of fares paid a weekday, by mode: bus, metro, rail; 0 for the rest |
| `passengerKm` | **New.** Passenger-km a weekday by mode; for metro and rail, km ridden on the trains |
| `lineKm`, `lineFare` | **New.** By line in service: passenger-km, and rupees of fares (a journey over several lines shares its fare by km) |
| `crowding` | **New.** By line in service: riders an hour where it is fullest at the busier peak, thousandths of crush capacity |
| `headway` | **Slice 4.** By line in service: minutes between its trains or buses at the peak, to a tenth |

Slice 4 made `lineKm`, `lineFare`, `crowding` and `riders` hold the player's bus routes too (a route's share of its
corridor, see 3a), and added to `CityState` the optional field `works` (links that lose a lane to works). Exported for the
rules and the screen: `defaultVehicles` (`transit.ts`), `busPath`, `busSegments`, `stopNode` (`bus.ts`).

`CityState` has a new optional field, `ownership: { car, twoWheeler }`, in thousandths of today's (omitted: 1000).
Prices below nothing, or not numbers, are taken as the defaults; parking below nothing as none.

## Calibration against published figures

`npx vite-node tools/calibrate.ts` prints this table; `--fit` first fits the fixed bothers to the mode shares (20
damped rounds, as the trains' crowding answers each change).

| Figure | Model | Published | Gap | Source (date of data) |
|---|---|---|---|---|
| Trips a person a weekday, walking included | 1.25 | 1.24 | +1% | CMP 2020, p.2-50 (2015 survey) |
| Share of trips: walk / two-wheeler / car / auto / bus / metro / rail / cycle | 25 / 30 / 8.5 / 8.5 / 22 / 4.3 / 0.5 / 1.1% | 24 / 28 / 8 / 8 / 21 / 4.1 / 0.5 / 1% | +4 to +6% | CMP 2015, updated (judgement, as slice 2) |
| Bus trips a weekday | 4.58 M | 4.30 M | +6% | Karnataka Economic Survey 2025-26 via Bangalore Mirror, 10 Mar 2026 |
| Metro trips (station entries) | 0.88 M | 0.84 M | +5% | BMRCL via The Hindu, 11 Aug 2026 |
| Metro boardings | 1.04 M | 1.12 M | −7% | same (record day) |
| Purple Line boardings | 533 k | 604 k | −12% | same, with half the 2.75 lakh changes |
| Green Line boardings | 305 k | 423 k | −28% | same |
| Yellow Line boardings | 202 k | 93 k | +118% | same (own-line only); about 1.5 lakh with changes, Jul 2026 (Hans India, 16 Aug 2026) |
| Suburban rail trips | 107 k | 150 k | −29% | TOI, 8 Dec 2019 (old) |
| Trip length: car / two-wheeler / auto / bus / cycle / walk | 5.0 / 7.7 / 3.4 / 10 / 4.8 / 1.8 km | 12.8 / 8.0 / 3.7 / 10.7 / 2.6 / 1.0 | | CMP 2020 Table 2-30 |
| Work trips 0–1 / 2–5 / 6–10 / 11–20 / 21–30 / 31–50 / 50+ km | 16 / 30 / 21 / 24 / 7.7 / 1.9 / 0.1% | 19.6 / 28.1 / 25.9 / 16.0 / 5.8 / 3.3 / 1.4 | | Census 2011 B-28 |
| Commute, door to door | 53 min | 40–60 | in range | The brief; Ola/OMI 2022 survey 31 min one way |
| of it lost to traffic | 19 min | — | | |
| Speed, morning, all modelled roads | 15.8 km/h | 14.6 | +8% | TomTom Traffic Index 2025 (Jan 2026) |
| Speed, evening, all modelled roads | 14.9 km/h | 13.2 | +13% | same |
| Speed, midday, all modelled roads | 16.7 km/h | 16.6 | +1% | same, all-day average (no midday figure) |
| Speed, primary and above, morning / evening | 19 / 18 km/h | 15–20 | in range | The brief; CMP |
| Silk Board / Hebbal / Tin Factory, PCU an hour entering at the peak | 16,400 / 16,900 / 13,200 | 18,180 / 18,154 / 16,919 | −10 / −7 / −22% | CMP 2020 Table 2-14 |
| Outer Ring Road, PCU a lane an hour, average of its length | 1,350 | 2,800 | −52% | Deccan Herald 19 Aug 2026, BTP (busiest sections) |

Against slice 3 (commute 55.9 min; morning, midday and evening 15.6, 23.7 and 16.7 km/h): the shares and counts are
fitted as before; the commute is 2.5 minutes shorter, and the speeds are nearer TomTom's in every period. The data's
faults put right (below) made the roads faster (Silk Board and the Outer Ring Road had less room than they have), the
city's buses became quicker (they keep to the midday routes and arrive by their quickest junction), and commercial
traffic was raised from 0.3 to 0.5 car units a round trip to bring the speeds back.

Speeds are vehicle-km over vehicle-hours on the modelled (main) roads; TomTom measures all roads. Slice 2 matched
TomTom's evening figure only through links carrying 3 to 5 times their capacity at 1 km/h; with those gone the
evening is faster than TomTom says, and midday much faster.

**Where the jams are** (share of the speed at light traffic, signals included, on primary roads and above within 1.5
km, morning / evening / night): Outer Ring Road at Bellandur 47/31/96%, at Marathahalli 42/34/97%, Silk Board
48/55/96%, Hosur Road at Bommanahalli 46/48/94%, KR Puram and Tin Factory 44/53/96%, Hebbal 52/50/98%, Bannerghatta
Road at Jayadeva 48/59/98%, Mysore Road at Nayandahalli 54/47/96%; Majestic 59/58%, MG Road 65/62%. The roads losing
the most vehicle-hours at the evening peak are the Outer Ring Road (by far), Hosur Road, Varthur Road, Sarjapur Road,
Magadi Road, Bellary Road and Bannerghatta Road: much as in slice 2. (Shares are not comparable with slice 2's one for
one: the signals are now in the light-traffic speed.)

**The slowest links at the evening peak** are at the 5 km/h crawl with 1.3 to 1.5 times capacity: Bellary Road at
Hebbal (trunk, 3,857 PCU an hour against 2,680), Jayamahal Road, Magadi Road, Whitefield Main Road, Yelahanka Road,
Lalbagh Fort Road (3,405 against 2,270), the Outer Ring Road at Ibbalur (3,708 against 2,680), and single-lane secondary
roads such as Begur Road and Devasandra Main Road (1,290 against 860).

## Levers

`npx vite-node tools/run-month.ts --levers`. Trips in millions a weekday; riders in thousands of boardings; fares in
lakh rupees a weekday; speeds in km/h, all modelled roads (primary and above in brackets).

| Case | car | 2-wh. | auto | bus | metro | rail | Purple | Green | Yellow | Fares: bus, metro, rail | Commute | Speed morning, evening |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As it is | 1.74 | 6.11 | 1.74 | 4.58 | 0.88 | 0.11 | 533 | 305 | 202 | 339.9, 383.6, 11.1 | 53.4 | 15.8, 14.9 (18.7, 17.7) |
| Metro fare halved | 1.74 | 6.06 | 1.75 | 4.52 | 0.99 | 0.11 | 567 | 373 | 210 | 335.5, 240.2, 11.1 | 53.0 | 15.9, 15.0 (18.8, 17.9) |
| Metro fare doubled | 1.76 | 6.19 | 1.75 | 4.70 | 0.66 | 0.11 | 403 | 251 | 175 | 347.9, 416.5, 11.3 | 54.5 | 15.5, 14.6 (18.4, 17.3) |
| Bus fare halved | 1.72 | 6.03 | 1.73 | 4.71 | 0.87 | 0.10 | 523 | 296 | 201 | 245.2, 376.2, 10.5 | 53.2 | 16.1, 15.1 (19.1, 18.0) |
| Bus fare doubled | 1.81 | 6.30 | 1.78 | 4.21 | 0.94 | 0.11 | 562 | 327 | 207 | 459.8, 395.3, 11.7 | 53.4 | 15.6, 14.6 (18.4, 17.2) |
| 10% more people | 1.93 | 6.74 | 1.92 | 5.05 | 0.92 | 0.11 | 555 | 315 | 202 | 375.8, 390.6, 11.3 | 57.8 | 14.1, 13.4 (16.7, 15.9) |
| 10% more people and jobs | 1.92 | 6.74 | 1.92 | 5.07 | 0.92 | 0.11 | 552 | 320 | 201 | 376.7, 390.6, 11.4 | 57.9 | 14.2, 13.4 (16.6, 15.8) |

Elasticities of trips to the fare per km (`log change in trips / log change in fare`), slice 4: metro −0.42 doubled,
−0.17 halved (slice 3: −0.34 and −0.15; the Purple and Yellow Lines are full: cheaper fares cannot put more on them);
bus −0.12 doubled, −0.04 halved, as before. Slice 3's 10% figures: metro −0.31, bus −0.09. Published short-run figures are −0.2 to −0.5 (Litman). The bus's figure
is over all its riders; 55% ride free (Shakti), so among those who pay it is about −0.2 to −0.27. (A weight of 4 on
bus fares gave −0.11 to −0.15, but then in the small test city a dearer bus earned less, against the rules' test.)
Bus fares rise less than the fare per km, as the ₹10 least and ₹32 most fares hold many trips: doubling the fare per
km earns 1.35 times as much, halving it 0.75 times.

Growth (people × 1.25, jobs alike, ownership as today): commute 55.9 → 67.0 minutes; metro trips +10% (the busy
lines are full: Purple 100% of crush, Yellow 97%); car trips +26%; bus +26%. With ownership at 1300 as well, car
trips +47%, two-wheeler +61%, bus +2%, commute 64.9 (two-wheelers are quicker than the bus they replace).

| Lever (PRD) | Where it acts in the model |
|---|---|
| REV-2 Parking charges | `prices.parking` by zone id (all 411), added to the money of a car trip to that zone |
| REV-3 Congestion charge | To add: rupees on car and two-wheeler trips whose route enters the area (as tolls are, by link) |
| REV-4 Fares | `prices.metroPerKm`, `busPerKm`, `railPerKm`, `leastFare`: the money of each transit journey, weighted by `fareWeight` |
| EVT-5 Fuel price | `prices.fuel`: the money of car and two-wheeler trips |
| CITY-15 Ownership | `ownership.car`, `ownership.twoWheeler`: the chance a traveller has one to hand |
| BLD-1 Metro line and stations | A line of kind `metro` in `transit`, `open`; its trains in `vehicles` (see 3a); the roads beneath in `works` while it is built |
| BLD-2 Suburban rail service | A rail line's trains in `vehicles`: headway 45 min × default / trains, never under 10 |
| BLD-3 Bus routes and fleet | A line of kind `bus` in `transit`, its buses in `vehicles` (see 3a); on top of the city's stand-in service |
| BLD-4 Bus lanes | `busLanes`: every bus at free speed on those links, a lane less for the rest |
| BLD-5 Roads and flyovers | New links in the routing network (a new motorway is tolled unless told otherwise) |
| BLD-6 Signals and junction redesign | A link's `signals` and its capacity |
| UPK-1–4, ROAD-3 Road condition | Slice 6: `surface` by link and `streets` by zone, 0 to 100 (see "Slice 6"); `condition` by link still: free speed × condition, capacity × (1 − 0.6 × (1 − condition)) |
| EVT-1 Monsoon floods | Slice 6: `shut`, thousandths of the month by link; `LOWLAND` lists the links that lie low |
| POL-1 One-way streets, turn bans | Removing links, or a direction, from the routing network |
| POL-2 Denser building near stations | People and jobs of zones: demand follows |

## What a line does (slice 4)

`npx vite-node tools/measure-line.ts` opens each line at once and compares the month with the city as it stands:
commute for the city and for the zones whose centre is within 1 km and 2 km of its stops (weighted by people), access
(points of the share of jobs within 45 minutes), riders a weekday (boardings; a bus route's own share of its corridor),
change in trips by mode, fares on the line, and the speed at the peaks on main roads within 600 m of its stops. The
city: commute 53.4 minutes.

| Line | City commute | Zones within 1 km | Within 2 km | Riders (k), headway, fullest | Trips (k): car, 2-wh., auto, bus, metro | Fares, lakh ₹ a weekday | Corridor speed, km/h |
|---|---|---|---|---|---|---|---|
| Metro, Outer Ring Road, Silk Board to KR Puram (13 stations, the Blue Line's course) | −4.2% | 36.0 → 31.6, **−12.4%** (16 zones, 0.57 M people) | −14.7% (39, 1.39 M) | 360, 4 min, 69% | −29, −75, −11, −116, +231 | 119 | 12.3 → 17.3 |
| Metro, MG Road to Sarjapura by Koramangala and Sarjapur Road (14) | −3.3% | 47.2 → 39.9, **−15.4%** (12, 0.39 M) | −11.9% (27, 1.02 M) | 208, 4 min, 72% | −18, −42, −10, −86, +156 | 74 | 16.0 → 18.0 |
| Metro through empty country, north-west (6) | 0.0% | no zones | 0.0% (2, 0.19 M) | 0 | 0 | 0 | — |
| The Blue Line, Silk Board to the airport, opened | −7.9% | −16.1% (30, 1.03 M) | −16.7% (74, 2.66 M) | 586, 4 min, 100% | −56, −160, −21, −230, +468 | 239 | 13.7 → 19.1 |
| The Pink Line, Kalena Agrahara to Nagawara, opened | −1.2% | −4.1% (36, 0.97 M) | −4.4% (74, 2.20 M) | 211, 4 min, 34% | −10, −13, −5, −62, +92 | 57 | 12.8 → 13.5 |
| Three times the trains, suburban line to Devangonthi | −0.9% | −1.8% (18, 0.54 M) | −2.0% (65, 1.91 M) | 102, 15 min, 93% | −4, −21, −1, −22, −21 | 9 | 17.2 → 17.5 |
| Bus route, Outer Ring Road, Silk Board to KR Puram, 40 buses | −1.0% | −3.3% | −3.8% | 33, 7.6 min, 92% | −9, −8, −5, +11, +12 | 1.5 | 12.6 → 14.0 |
| Bus lanes both ways along it, and no route | −4.5% | −9.0% | −10.3% | — | −73, −178, −32, +273, +11 | — | 12.6 → 17.3 |
| The route, 40 buses, in those lanes | −4.8% | **−12.8%** | −14.1% | 82, 2.9 min, 96% | −72, −191, −29, +248, +46 | 3.7 | 12.6 → 19.5 |
| The route, 100 buses, in those lanes | −5.1% | −14.9% | −16.1% | 144, 1.2 min, 98% | −76, −200, −31, +268, +42 | 6.7 | 12.6 → 19.8 |
| Bus lanes on the 40 emptiest main-road links | 0.0% (−0.01 min) | — | — | — | 0 | — | — |
| Feeder bus, Varthur to the Purple Line at Kundalahalli, 12 buses | −0.1% | −1.0% (3, 0.15 M) | −0.5% | 5, 9 min, 70% | 0 | 0.2 | 8.8 → 8.7 |

- **A good metro line meets the aim:** a tenth or more off the commute of the zones it serves (12 to 16% within 1 km,
  12 to 17% within 2 km), part of it from the roads, which speed up by a third or more along the corridor; a line
  through empty country does nothing. It was short of the aim at the start of the slice (8 to 9%) for four reasons,
  each put right: the ride to a station counted as a fare, twice (a new line's stations looked dearer than they were);
  the ride's wait counted every rider as waiting for an auto (half ride their own two-wheeler); a new line ran every 5
  minutes, not the 4 BMRCL aims at, and filled; and the Outer Ring Road had a lane-and-capacity fault at Silk Board.
  Grouping wards does not smear it: with no grouping (`--share=1`) the ORR line gave −8.5% within 1 km where grouped
  gave −8.3%, measured midway through these changes.
- **Buses are not weak:** a route alone on a jammed road helps a little (−3%), as the PRD says it should ("stuck in the
  same traffic unless given lanes"); bus lanes on a jammed corridor help a great deal, a route in them more, and more
  buses more again; on an empty road they do nothing. Two things made routes worth having: a route stops wherever the
  city's buses stop (not only at the player's taps), and riders take whichever bus comes first, so a route adds its
  frequency to the corridor's. **Bus lanes alone are strong** (−4.5% for the city from 20 km of lanes, more than a
  metro line): the rules should price and weigh them knowing that.
- **Feeders are weak** where an auto already reaches the station (Varthur to Kundalahalli, within 5 km).
- **Fares:** a good metro line takes ₹0.7 to 1.2 crore a weekday (₹220 to 360 crore a year of 300 weekdays); a bus
  route ₹1.5 to 7 lakh a weekday (Shakti: 55% ride free).

**Works** (`tools/measure-line.ts --works`): a lane lost both ways on the Outer Ring Road from Silk Board to KR Puram
(78 links) slows it at the peaks from 12.8 to 11.2 km/h and cuts what it carries by 31%; the main roads within 3 km carry
1.5% more and slow from 13.8 to 12.9 km/h; the commute rises from 53.4 to 54.5 minutes (two lanes: 9.3 km/h on the ring
road, 56.6 minutes). The routes move: in the first loading the ring road's car-km fall by 22% and the ways round gain.

## Small changes, small effects

The rules explain a change by working the month out again with one thing put back, so the model must answer a small
change with a small change in the same direction. Slice 2's did not: loading root by root, each root on the times the
roots before it left, is chaotic, and 0.1% more people could reshuffle the routes and move the commute half a minute
either way. Now the routes are found for the month's pattern of demand at a size set by the network (see Roads,
order of work, 3), so prices, ownership and growth that is alike everywhere never move them; on fixed routes every
step after is smooth. Measured on Bengaluru (people × 1, 1.001, 1.002, 1.005, 1.01, 1.02, 1.05): commute 55.87,
55.90, 55.95, 56.07, 56.20, 56.57, 57.95 minutes; with jobs alike the same to 0.1. `tests/sim.test.ts` checks it. Growth that
is not alike everywhere, and changes to the roads, can still move routes: that is a real change, but its size in the
report may carry some of the old noise. Slice 4: the guess is sized to the roads as built, so works or bus lanes move
routes only near them; bus lanes on the 40 emptiest main-road links change the commute by 0.01 minutes, and works on
five links of the ring road by −0.08 (the noise; on 78 links, +1.1).

## Speed

Measured on an Apple M4 Pro (14 cores), busy with other work (load average 7 to 9), 28 September 2026, slice 4.

- In the browser engines, five months after a first (`run-month.ts --engines`): WebKit least 125 ms, median 132;
  Chromium 149, 155; Firefox 188, 201. The first month in each: 260 to 280 ms. (Slice 3, at load 6 to 10: 123/125,
  134/137, 170/173.)
- With ten more metro lines and twenty bus routes of 30 buses (`run-month.ts --engines --loaded`, the city in
  `tools/measure-city.ts`): WebKit 161, 171; Chromium 196, 205; Firefox 257, 274. So about 30% more.
- Under `vite-node` (`measure-line.ts --load`): 194–207 ms as it is, 256–277 loaded. Where the loaded city's extra 60 ms
  goes: the transit systems 17 (the routes' stops and ways, three skims), the trains' and buses' crowding 16, the three
  choices 25.
- Where the time goes (as it is, `vite-node`, average of 6): demand 19 ms, midday loading 25, busy-period loading 44,
  modes (uncrowded 13, crowding 3, crowded 13, the choice 23), loading the choice 16, holding back 30, final times 9,
  the commute 6.
- What slice 4 did for speed: a route stops every kilometre, not every 500 m (the loaded city took 400 ms at 500 m);
  crowding skips places no one rides from; the ways a route takes between junctions are kept for the network, so a
  month does not look for them again.

Time against accuracy, against a reference with no grouping of wards, three rounds of assignment and the holding back
worked out for every root (1,099 ms). The fixed bothers were fitted at 35%; the other rows keep them, so part of each
gap is the shares moving. Times are `vite-node`, least to middle of five.

| Grouping | Rounds | Time | Commute (ref 62.4) | Zone commute off by | Evening main-road speed off by |
|---|---|---|---|---|---|
| none (411) | 0 | 672–690 ms | 64.0 min | 2.2 min | 5.4 points of 100 |
| half (227) | 1 | 344–371 | 56.7 | 6.0 | 9.4 |
| half (227) | 0 | 271–296 | 60.1 | 4.3 | 10.6 |
| 35% (172) | 1 | 231–260 | 55.1 | 7.8 | 13.4 |
| **35% (172)** | **0** | **185–195** | **55.9** | **7.6** | **16.0** |

The cost of the speed is real: grouping wards keeps more trips inside zones and on foot, so the grouped city is less
congested than the full one (55.9 against 62.4 minutes) and a zone's commute is off by 7.6 minutes on average against
4.3 at half. If accuracy by zone matters more than the 130 ms aim, set `GROUPING.share` to 0.5 and refit (about 60%
more time).

Memory: not measured again; a month's working arrays are of the order of 20–30 MB, and it keeps about 1 MB (the
result).

## The same everywhere

- Everything that feeds a result is addition, subtraction, multiplication, division, square root, rounding and
  comparison of 64-bit numbers, in a fixed order; e^x is read from a table built by multiplications (`fixed.ts`).
- No `Math.exp`, `log`, `pow`, `sin` and the like, no `**`, no randomness, no clock in `src/sim/` (a test checks).
- Orders of work are fixed: arrays in index order; the mixed order of the first loading is a fixed scrambling of the
  root numbers; ties are broken by number; the holding back's sample is every fourth root.
- `tests/determinism.test.ts` compares every number of the same month worked out twice, with others in between, and
  the fingerprint under V8 (Node) and JavaScriptCore (Bun). `run-month.ts --engines` adds SpiderMonkey, JavaScriptCore
  and V8 in browsers: all four gave `acd123ad` for January 2026 at the end of slice 4, `b3db0900` at the end of slice 5,
  and `d6fa8e37` in slice 6 (no surface given).

## What it gets wrong

- **The Yellow Line carries too many** (202 k boardings against 93 k own-line, perhaps 150 k with changes). Its trains
  are full at the peak in the model, as in life, so capacity is not what is missing: the demand is. Slice 4 counted
  industrial land by how full it is and single-company campuses at lower density (DATA.md): Bommasandra fell from
  161,000 jobs to 123,000, but Electronic City rose from 273,000 to 288,000 (its jobs are offices, which the change
  moved jobs towards), and Yellow did not fall. Company buses to Electronic City are not modelled.
- **The Green Line carries too few** (305 k against 423 k). Part is the Yellow Line: one fixed bother holds all lines,
  and Yellow's excess holds the others down (Purple −12%). The rest is Green's own: its southern catchment (Jayanagar,
  JP Nagar, Banashankari) has cheap buses and many who ride free, and the interchange split assumed (half of all
  changes to each of Purple and Green) may be wrong. Not found.
- **Bus lanes are strong, feeders weak** (see "What a line does"). A bus in a lane runs at the road's free speed (60
  km/h on a trunk road, with stops), which the brief asks for; in life bunching and junctions would take some of it.
- **The metro's and rail's fixed bothers are positive** (9.4 and 29.2 minutes a leg): the model finds today's lines
  more attractive than their riders show. Rail's is large because its published count is old and small.
- **A bus route's two ways are averaged:** a bus lane laid one way only helps a route's riders both ways by half.
- **Zones are grouped** (see Speed): groups of about three wards share a commute and an access figure. A new line's own
  zones still show its effect (see "What a line does").
- **Everything at the crawl looks alike:** many links sit at 5 km/h at 1.3–1.5 times capacity; the map cannot tell a
  bad jam from a very bad one there. The queue's time is in the commute but not on the map.
- **The city's bus service** is still a stand-in with no routes, frequencies or crowding, and a large negative bother.
- **Routes do not grow with the city:** they are found at today's size of traffic (so that small changes stay small).
  After years of growth the routes are those of a less congested city; the congestion itself is counted in full, and
  since slice 5 travellers choose on it (measured: routes found at 1.3 times the size moved the 2035 commute by less
  than seeing the growth did).
  Changes to a few roads move routes by a little noise as well as by their effect (a few hundredths of a minute).
- **The evening is faster than TomTom's evening** (14.9 against 13.2 km/h).
- **Car trips are too short** (5.0 km against 12.8), walking and cycling too long, too few very short work trips.
- **Metro and rail are separate:** no journey uses both. A bus route feeds both, but no journey rides two routes and a
  train.
- **Destinations answer to travel times only a little** (slice 5): work trips are held to both ends, so a new road
  induces little driving at once (elasticity about 0.05 against 0.1–0.5 published for the short run).
- **Deaths fall as traffic jams** (see "Road deaths"). The zones beyond the wards have no published figure to match.
- **Network changes are noisy**: see "Roads the player builds".
- **The fixed bothers are large** for the bus (−23), two-wheeler (17), cycle (95) and rail (29).

- **Road condition (slice 6):** the effects of a surface are the PRD's marks, not measured in Bengaluru; the flood
  list finds flooding roads only 1.66 times as well as chance; heavy vehicles and the city's bus-km by link are spread
  as the traffic is, not by route; a flood is one month blended, not days; the city is calibrated at the rules' start,
  so a change of the start moves the calibration.

**Faults in the data** (slice 3's list), and what slice 4 did:
- *Outer Ring Road near Silk Board:* westbound from Silk Board it had one lane and 1,290 PCU an hour for 680 m between
  three lanes before and two after. **Put right** in `tools/build-routing.ts`: a run of links along a main road (motorway
  to primary) of one name, at most 2 km, with more lanes before and after, takes the lesser (at most three), and
  capacity in proportion. 86 links changed, among them the Silk Board stretch (1 → 2), Dr CV Raman Road, Kanakapura,
  Bannerghatta and Hennur-Bagalur Roads (1 → 2), stretches of Tumkur, Mysore and Hosur Roads, the NICE Road and Hebbal
  flyover (2 → 3). **No link or node changed its id**, nor any link its ends, length or drawn stretches: only lanes and
  capacity (checked against the file before).
- *Electronic City and Bommasandra:* 434,000 jobs between them, now 411,000; *Jigani* 184,000, now 131,000. See DATA.md.
- *Panathur and Kempapura* reached the main roads first by one-lane roads. **Put right** in the model (`graph.ts`,
  `ROAD.joinStrong`, `joinWeak`): Panathur now joins at a trunk-road junction, Kempapura's group already joined the Outer
  Ring Road and its flyovers.
- *Tolls:* the routing network has no toll field; every motorway is taken as tolled. Most are (the NICE Road and
  Expressway, the Electronic City flyover, the Nelamangala, Mysuru and Chennai expressways, about 200 of the 226 km);
  19 km of unnamed motorway and a few short named pieces may not be.

## Why a figure changed (PRD SCORE-13, SCORE-14)

- For the commute: `commuteByMode` and `commuteDelay`. `costParts` gives what moved people between modes.
- For a zone: `delayByRoad(state, result, zone, period)` in `src/sim/reasons.ts` sends the zone's work trips over the
  month's routes and returns the links on which they lose the most time, largest first.
- Lever by lever: the rules work out the month again with each change put back (see "Small changes, small effects").

## Sources

- DULT / BMRCL, *Comprehensive Mobility Plan for Bengaluru*, 2020: https://dult.karnataka.gov.in/assets/front/pdf/Comprehensive_Mobility_Plan.pdf
- Karnataka Economic Survey 2025-26 via Bangalore Mirror, 10 Mar 2026: https://bangaloremirror.indiatimes.com/bangalore/others/power-of-a-scheme-62-of-bus-passengers-in-karnataka-are-women/articleshow/129365244.cms
- BMTC fare chart, January 2025: https://mybmtc.karnataka.gov.in/storage/pdf-files/ordinaryfarechart.pdf
- The Hindu, 11 Aug 2026 — record 11.2 lakh boardings by line: https://www.thehindu.com/news/national/karnataka/namma-metro-records-highest-daily-ridership-of-august-with-over-1119-lakh-boardings/article71332820.ece
- Moneycontrol, 4 Dec 2025 — peak headways Purple 3.3 (busiest section) / 5, Green 5: https://www.moneycontrol.com/news/india/bengaluru-metro-plans-4-minute-frequency-across-all-corridors-in-two-years-13710714.html
- Deccan Herald, 5 Jul 2024 — a six-coach train carries 1,580, 2,000 at crush load: https://www.deccanherald.com/india/karnataka/bengaluru/namma-metro-adjusts-train-timings-on-purple-line-to-address-overcrowding-issues-3094649
- Yellow Line: TOI 10 Sep 2025 (19 min); Indian Express (15 min from 1 Nov 2025; 10 min, 15 Jan 2026; 9 min, 27 Feb 2026); The Hindu (13 min, 23 Dec 2025; 7 min, 3 Jun 2026; 6 min with 13 of 15 trains, 15 Aug 2026): https://www.thehindu.com/news/national/karnataka/bengaluru-namma-metro-inducts-15th-yellow-line-train-peak-hour-services-down-to-six-minutes/article71349951.ece
- Hans India, 16 Aug 2026 — Yellow Line about 1.5 lakh a day in July 2026: https://www.thehansindia.com/news/cities/bengaluru/yellow-line-carried-38-crore-passengers-in-its-first-year-1110074
- NewsDive, 1 Jul 2026 — NICE Road car tolls ₹72–83 a section, Electronic City flyover ₹65 (secondary source): https://newsdive.net/2026/07/01/revised-toll-rates-announced-for-nice-road-and-electronic-city-flyover-in-bengaluru-check-the-updated-price-list/
- Bengaluru Traffic Police, accident statistics 1976–2026 (killed: 2023 910, 2024 894, 2025 878, 2026 to July 614): https://btp.karnataka.gov.in/231/accident-statistics/en
- The Hindu, 11 Jan 2026 — 225 pedestrians killed in 2025 (233 in 2024); worst stations on the fringe: https://www.thehindu.com/news/cities/bangalore/tracing-traffic-violations-road-deaths-fall-for-second-straight-year-in-bengaluru-despite-rise-in-accidents/article70494814.ece
- Bangalore Mirror, Feb 2025 — BTP Road Safety Report 2023: 921 deaths, 824 pedestrians and two-wheeler riders, two-wheelers 59%: https://bangaloremirror.indiatimes.com/bangalore/others/death-on-the-road/articleshow/118609944.cms
- Deccan Herald, 12 Jul 2026 — MoRTH 2024: 246 pedestrians killed in Bengaluru: https://www.deccanherald.com/india/karnataka/bengaluru/bengaluru-records-second-highest-pedestrian-deaths-among-million-plus-cities-in-2024-4071330
- Tefft, *Impact Speed and a Pedestrian's Risk of Severe Injury or Death*, AAA Foundation, 2011. Nilsson, *Traffic Safety Dimensions and the Power Model*, Lund, 2004. FHWA CMF Clearinghouse (sidewalks, signals, junction redesign).
- Duranton and Turner, *The Fundamental Law of Road Congestion*, AER 2011; Litman, *Generated Traffic and Induced Travel*, VTPI.
- TomTom Traffic Index 2025: 36 min 9 s for 10 km, 168 hours lost at the peaks, 12 h 46 min more than in 2024.
- Deccan Herald, 22 Jul 2026 — Bengaluru–Nelamangala, ₹105 one way for 19.5 km: https://www.deccanherald.com/india/karnataka/bengaluru/toll-rates-hiked-on-bengaluru-chennai-e-way-nelamangala-highway-4083822
- Litman, *Transit Price Elasticities and Cross-Elasticities*, Victoria Transport Policy Institute — short-run −0.2 to −0.5.
- TomTom Traffic Index 2025, Bengaluru (Jan 2026): https://www.tomtom.com/traffic-index/city/bengaluru/
- Census of India 2011, B-28: https://censusindia.gov.in/nada/index.php/catalog/13983
- Deccan Herald, 19 Aug 2026 — Outer Ring Road lane flows: https://www.deccanherald.com/india/karnataka/bengaluru/bengaluru-orr-chokes-during-rush-hours-morning-jams-stretch-135-km-4117404
- Times of India, 8 Dec 2019 — suburban train commuters.
- US Bureau of Public Roads, *Traffic Assignment Manual*, 1964 — the speed–flow form.
- Draft revision of IRC:106 (2022) — PCU on divided urban roads.

Slice 6:
- MoRTH, *Road Accidents in India* 2022 (30 Oct 2023): https://morth.gov.in/backend/documents/uploaded/1755600426_RA_2022_30_Oct.pdf ; 2023: https://morth.gov.in/backend/documents/uploaded/Road-Accident-in-India-2023-Publications.pdf ; 2024: https://morth.gov.in/backend/documents/uploaded/1781177676_V1gUW8tJWT.pdf
- Pothole deaths 2020–24 (MoRTH in the Lok Sabha): Indian Express, 13 Feb 2026: https://indianexpress.com/article/business/pothole-related-road-fatalities-increase-by-53-per-cent-in-5-years-10529465/
- Karnataka pothole deaths 2021–24: Bangalore Mirror, 5 Nov 2025: https://bangaloremirror.indiatimes.com/bangalore/civic/dodge-the-pits/articleshow/125093390.cms
- NCRB deaths from civic negligence in Bengaluru: The South First, 8 Oct 2025: https://thesouthfirst.com/karnataka/brand-bengalurus-fatal-reality-highest-deaths-due-to-civic-negligence-poor-infra/
- Supreme Court on pothole deaths, The Hindu, 6 Dec 2018: https://www.thehindu.com/news/national/sc-expresses-concern-over-large-number-of-deaths-due-to-potholes-in-last-5-years/article25678155.ece
- IIT Delhi TRIPP, *Road Safety in India Status Report 2023*: https://tripc.iitd.ac.in/assets/publication/RSI_2023_web.pdf
- FEMA, *Safer Roads for Motorcycles*, ch. 2 (MAIDS, NSW, NZTA figures): https://www.femamotorcycling.eu/safer-roads-for-motorcycles/safer-roads-chapter-2/
- Chandra, *Effect of Road Roughness on Capacity of Two-Lane Roads*, J. Transp. Eng. 130(3), 2004. Zaabar and Chatti, TRR 2455, 2014.
- BMTC and potholes: Deccan Herald, 25 Oct 2013: https://www.deccanherald.com/india/karnataka/bengaluru/potholes-hurt-bmtc-many-ways-2290907 ; TOI, 29 Oct 2019: https://timesofindia.indiatimes.com/city/bengaluru/potholes-bleed-bmtc-coffers-give-drivers-harrowing-time/articleshow/71798976.cms
- Flood points: KSRSAC/BBMP via OpenCity: https://data.opencity.in/dataset/flooding-locations-in-bengaluru-urban ; the city's lists: Bangalore Mirror 15 Jun 2023 (198 points), TOI 12 May 2024 (198), TNIE 5 May 2025 (209), TNIE 10 Apr 2026 (101 across the five corporations): https://www.newindianexpress.com/cities/bengaluru/2026/Apr/11/52-of-101-flood-prone-locations-in-bengaluru-yet-to-be-fixed-before-monsoon ; traffic police's 180 spots, TOI 14 Aug 2024: https://timesofindia.indiatimes.com/city/bengaluru/bengaluru-traffic-police-identify-180-waterlogging-spots-seek-bbmp-intervention/articleshow/112506737.cms ; The Hindu 14 Aug 2024 and 24 May 2023 (underpass audit); DH 15 Jun 2026.
- Heights: SRTM via the AWS Terrain Tiles (Mapzen), https://registry.opendata.aws/terrain-tiles/

Judgement, not found published: values of time, ownership by income, weights for walking, waiting, comfort and fares,
danger, the logit scale, bus waits and stop time, metro and rail speeds, feeder reach, crowding weights, a suburban
train's size and the rail headway, the queue's 20 minutes, the crawl, the toll's value in choosing routes, the near-home
factors, the decays, external and commercial traffic, timing by period, effective hours; and in slice 4: a bus's size
(80), the turn at each end of a line, the closest headways, the city's buses taken as every 12 minutes on a route's
corridor, a route's stops every kilometre, the feeder walk (400 m), the half-and-half of two-wheelers and autos to a
station, the dip rule for lanes, the weight of a one-lane junction (0.5 km), the density of company campuses and the
volume of a factory's job.
