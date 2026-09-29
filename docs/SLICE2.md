# Slice 2: the city, moving — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` in full, and `docs/DATA.md`. Read `docs/SLICE1.md` for the facts and
conventions, which still hold.

Slice 1 drew the city: the base map designed by zoom, 411 zones with people and jobs, the main roads (17,362 stretches),
and the metro and suburban rail. The player has looked at it and said it is right. **Keep the look as it is.**

Slice 2 makes the city move. It works out a weekday's traffic for a month, shows it on the map, and proves that it
is fast and gives the same answer everywhere. There is still nothing to play: no turns, no money, no levers. But the
model must be built so that levers can act on it later: fares, parking charges, road condition, new lines, new roads.

## What done looks like

- A month's traffic for the whole city is worked out in under 300 ms on a laptop and under 1 s on a phone (PRD SIM-4),
  in a background thread (SIM-5), and is identical to the last digit on every machine (SIM-3, CITY-25).
- At the evening peak the map shows jams where Bengaluru really has them: Silk Board, the Outer Ring Road between
  Marathahalli and Bellandur, Hebbal, KR Puram and Tin Factory, Mysore Road, Hosur Road, Bannerghatta Road. Nights
  are clear. Someone who drives there would nod.
- City figures are plausible against what is published: an average commute somewhere near 40 to 60 minutes door to
  door, peak speeds on main roads somewhere near 15 to 20 km/h, and mode shares of the right order (two-wheelers the
  largest share of vehicles; buses carrying several million trips a day; metro several hundred thousand). Find
  published figures, cite them, and say how far the model is from each.
- Memory is within the PRD's limits, or as near as can be reached with the reasons stated (PERF-6).
- The map shows congestion and commute as views, and plays a weekday back in about 15 seconds.

## The agreed interface

`src/sim/types.ts` is fixed. Build to it. You may add optional fields, saying so in your report.

```ts
RoutingNetwork   // A builds it: public/data/routing.json
CityState        // what decides a month
MonthResult      // what a month came to
Simulate         // B builds it: (state: CityState) => MonthResult, exported from src/sim/index.ts as `simulate`
```

## Who owns what

| Person | Owns |
|---|---|
| **A: roads for traffic** | `tools/build-network.ts`, `tools/build-routing.ts`, `tools/fetch-city.sh`, `tools/build-transit.ts`, `src/data/network.ts`, `src/data/transit.ts`, `src/data/routing.ts`, `public/data/network.json`, `public/data/transit.json`, `public/data/routing.json`, tests `network`, `transit`, `routing` |
| **B: the model** | `src/sim/*` except `types.ts` and `worker.ts`, `tools/run-month.ts`, `tools/calibrate.ts`, `docs/MODEL.md`, tests `sim*`, `demand`, `modes`, `assign`, `determinism` |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `src/game/*`, `src/sim/worker.ts`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, tests `screen`, `style`, `playback` |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `docs/DATA.md`, `src/data/types.ts`, `src/data/zones.ts`,
`public/data/zones.*`, `tools/build-zones.ts` or `public/tiles/`. If the road network is rebuilt so that junction
ids change, run `npx vite-node tools/build-zones.ts` afterwards, which is allowed, and say that you did.

## The jobs

### A: roads for traffic
1. **The routing network.** From the drawn network (17,362 stretches), build the simplified one traffic is worked out
   on: `public/data/routing.json`, to `RoutingNetwork` in `src/sim/types.ts`. Aim for about 5,000 directed links or
   fewer, and say what you got. Ways to get there: merge across junctions where only two pieces meet, whatever
   changes there (take the least lanes and a length-weighted speed); fold slip roads and the pieces of a complex
   junction into one node; drop tertiary roads that are dead ends or that only duplicate a better road nearby, but
   keep a tertiary road where it is a zone's only way to the network; treat the two carriageways of a divided road as
   the two directions of one road.
2. **Keep the link to the drawn network.** Every routing link lists the drawn stretches it stands for, so that traffic
   can be shown on the full map. Every drawn stretch of secondary class or above should belong to some routing link;
   say what share does.
3. **Sound.** Every zone's node can reach every other zone's node and every gateway, and be reached from them.
   Flyovers still do not join the roads beneath. Test it.
4. **Lanes, speeds and capacity.** The map data rarely gives lanes or speeds (44% of stretches default to one lane,
   47% to 30 km/h). Improve the defaults from what is known of Bengaluru's roads: by class, by whether the road is
   divided, by name for the roads everyone knows (Outer Ring Road, Hosur Road, Bellary Road, Mysore Road, Old Madras
   Road, Tumkur Road, NICE Road, the elevated expressways), and from `width` where tagged. Capacity in vehicles an
   hour from lanes, class and whether junctions are signalled. State every rule and its source in your report.
5. **Zone nodes.** `zoneNode` gives each zone's routing node, from the zone's `node` in the drawn network.
6. **Get a first `routing.json` into `public/data/` within half an hour**, even if rough, so that B can build on it.
   Tell B's needs apart from perfection: B needs it connected and of the right size first.

### B: the model
Pure TypeScript in `src/sim/`, with no dependence on the page, the clock or the network. Whole numbers or fixed-point
for everything that feeds a result; a seeded random source if any is needed; a fixed order of work. Typed arrays; no
allocation inside the inner loops.

1. **Demand.** Trips between zones, and to and from the gateways, for the four parts of a weekday. Commuting from
   people and jobs by a gravity model, with the evening the morning reversed; other trips at midday and in the
   evening. Totals scaled to published figures for the city.
2. **Modes.** Each group of travellers chooses among car, two-wheeler, auto, bus, metro, rail, cycle and walking by a
   cost of four parts: time, money, comfort and safety (PRD CITY-12). Income (the zone's 1 to 5) changes the weights
   and what vehicles people own. Fares, fuel and parking enter the money part (CITY-13). People reach a station on
   foot, by cycle, or by auto or two-wheeler, each with its own reach (CITY-14). Buses at this stage: there are no
   bus routes in the data, so treat the existing bus service as a coverage that follows the main roads, slowed by
   the traffic on them, and say plainly that this is a stand-in.
3. **Assignment.** Vehicles spread over routes until nobody could save much by changing, in a fixed number of rounds
   (CITY-22). Speed falls as flow nears capacity (CITY-20). Two-wheelers take less road than cars, buses more
   (CITY-24). `condition` scales a link's free speed and capacity.
4. **What comes out:** `MonthResult`. Commute door to door, by zone and for the city; access to jobs within 45 minutes;
   trips by mode; riders by line; flow and speed by link and period.
5. **Speed.** Under 300 ms for a month on a laptop. Measure it in `tools/run-month.ts`, which works out a month
   without a screen and prints the figures. If 411 zones by 411 zones by four periods is too much, say what you did
   about it (nearby zones grouped for far destinations, fewer rounds at night, and so on) and what it cost in accuracy.
6. **The same everywhere.** A test that works out the same month twice and compares every number. Avoid anything
   whose result can differ between machines or engines: `Math.pow`, `Math.exp`, `Math.log`, `Math.sin` and the like
   are not guaranteed identical across JavaScript engines, so use tables, whole-number arithmetic, or your own
   fixed routines for anything that feeds a result. Say how you handled it.
7. **Calibration.** `tools/calibrate.ts` compares the model with published figures and prints the gaps. Tune until
   the jams are where they really are and the city figures are plausible. Write `docs/MODEL.md`: how the model
   works in plain words, every constant with its value and source, what it gets wrong, and how each lever of the
   PRD will act on it.
8. **Reasons.** PRD SCORE-13 will ask why a figure changed. Keep what is needed to answer: for the commute, the
   contribution of each mode and of congestion; for a zone, which roads its delay comes from. It need not be shown
   yet, but the model must not make it impossible.
9. Until A's `routing.json` exists, build against a small network of your own making in the agreed shape.

### C: screen
1. **Memory first.** The page uses 580 to 1,100 MB after 40 seconds of panning, against limits of 400 MB on a laptop
   and 250 MB on a phone. Most of it is MapLibre drawing the base map: with our layers removed it was still about
   520 MB. Find where it goes (Chrome's memory tools, by tile count, by layer, by zoom) and cut it. Things to try:
   a lighter base map with fewer layers and no buildings when zoomed out; a smaller tile archive cut to fewer zooms
   with overzooming; tile size; `maxTileCacheSize` and `maxTileCacheZoomLevels`; pixel ratio capped at 2 on phones;
   dropping sources when not in view; the fade and veil layers. Measure each change on its own. Report what each
   saved. Do not change how the map looks beyond what a person would not notice; where a saving needs a visible
   change, show before and after and leave the choice to the coordinator.
2. **The model in a background thread.** `src/sim/worker.ts` runs B's `simulate` in a worker, and `src/game/` holds
   the city's state and asks for a month. Results come back without copying (transferable arrays). Until B's
   `simulate` exists, use a stand-in of your own that returns plausible numbers in the agreed shape.
3. **Congestion on the map.** A view that colours the drawn roads by speed, for a chosen part of the day, in the
   amber, orange and red of the accepted look (slow `#f2a531`, very slow `#e4592b`, jammed `#a51d1d`; roads moving
   well keep their own colour). From routing links to drawn stretches by A's mapping. Zoomed out, only the main
   roads that are slow should show, so that the city's jams read at a glance.
4. **Commute and access on the map.** Two more zone views, shaded like the people and jobs views: commute in
   minutes, and jobs within 45 minutes.
5. **The day played back.** About 15 seconds: the four parts of the day in turn, the congestion colours changing,
   and vehicles as small dark dots moving along the main roads, more where flow is heavier, slower where it is slow,
   drawn in one batch by the graphics card. They are for the look of a living city, not a simulation. It can be
   skipped. At 60 frames a second on a laptop and 30 on a slowed phone, with the whole city in view.
6. **The city's figures.** A small panel: average commute, average peak speed, trips by mode, riders by line. On a
   phone, a sheet. Plain words.
7. **Measure again.** `tools/look-perf.mjs`, extended: the memory figures, the time from asking for a month to the
   map showing it, and frames a second during playback. At laptop size, and at phone size with the processor slowed
   four times.
8. **Look at everything.** Screenshots at both sizes of each view at the whole city, at Silk Board, the Outer Ring
   Road at Marathahalli, Hebbal and KR Puram, at the morning and evening peaks and at night, and of the playback
   mid-way. Open each with the Read tool and look. Ask of each: would someone who drives there nod?

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: counts, sizes, timings, and the model against published figures with sources.
- Each screenshot you opened and what you saw (C).
- The three checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
