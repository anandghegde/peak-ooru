# Slice 5: roads and policy — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` in full, `docs/MODEL.md`, `docs/RULES.md` and `docs/DATA.md`. Read
`docs/SLICE1.md` for the facts and conventions, and `docs/SLICE4.md` for how building works. They still hold.

Slices 1 to 4 drew the city, made it move, made it a game of months and money, and let the player build transit:
metro lines, bus routes, bus lanes and more suburban trains. The player has looked at the map and the moving city
and said they are right. **Keep the look as it is.**

Slice 5 is the other half of building: **roads, flyovers, junctions, footpaths, one-way streets, speed limits, and
denser building near stations.** It also brings road deaths into the model, since several of these levers exist to
reduce them. And it puts right the largest fault of slice 4: over ten years, building does too little.

**The project does not compile as you start.** The new kinds of plan are in `src/rules/types.ts`, and the code that
switches over plans in `src/rules/` and `src/game/` does not yet know them. D and C: your first act is to make your
own files compile, by refusing the new kinds with "This cannot be built yet", within your first few minutes. Until
both have done so `npx tsc --noEmit` will fail in the other's files; `npx vitest run` is not affected.

## What done looks like

- The player can build a road or a flyover between two places on the main roads, put signals at a junction,
  redesign it or lift the main road over it, lay footpaths through a zone, make a road one-way, set a speed limit in
  a zone, and allow taller building near a station. Each shows its cost, its time and what it is expected to do
  before the player commits, and each can be done on a phone.
- Each lever moves at least one measure and costs another (PRD 7.5). A flyover relieves its junction and moves the
  jam along. A new road draws more driving over the years. Footpaths and speed limits save lives and cost a little
  time. Denser building near stations puts more people within reach of transit, and takes years to show.
- Road deaths are in the model, by zone and for the city, of the right order against published figures, and they
  respond to footpaths, speed limits, junction work, traffic speed and how many people ride two-wheelers.
- **Over ten years building is worth it.** A scripted player who builds sensibly ends with a commute at least five
  minutes shorter than one who does nothing, and with better access and fewer deaths. Today the best builder ends at
  57.1 minutes against 58.7.
- Playing the same actions again still gives the same game exactly.

## The agreed interfaces

`src/sim/types.ts`, `src/rules/types.ts` and `src/data/types.ts` are fixed. Build to them. You may add optional
fields, saying so in your report. New in this slice, already in the files:

```ts
// src/rules/types.ts
Plan: 'road' | 'junction' | 'footpaths' | 'oneWay' | 'speedLimit' | 'density'
Built.roads, Built.junctions, Built.footpaths, Built.limits, Built.dense, Built.oneWay
Figure.key: 'safety'

// src/sim/types.ts
CityState.footpaths, CityState.limits
MonthResult.deaths, MonthResult.deathsByZone
```

**Roads change the network.** `CityState.roads` is the routing network the month is worked out on. The rules pass a
changed copy: new nodes and links appended at the end (so that the ids of those already there never move), links
made one-way by shutting their opposite, junctions with their signals and capacity changed. The model must take it
as given.

**Turn bans are left out of this game.** The routing network folds each complex junction into one or a few nodes, so
a banned turn has nothing to act on. One-way streets and junction redesign stand in its place.

## Who owns what

| Person | Owns |
|---|---|
| **B: the model** | `src/sim/*` except `types.ts` and `worker.ts`, `tools/run-month.ts`, `tools/calibrate.ts`, `tools/measure-*.ts`, `docs/MODEL.md`, `docs/DATA.md`, tests `sim*`, `demand`, `modes`, `assign`, `determinism` |
| **D: the rules** | `src/rules/*` except `types.ts`, `src/seasons/*`, `tools/playthrough.ts`, `docs/RULES.md`, tests `rules*`, `books`, `loans`, `report`, `replay`, `skip`, `build*`, `approval`, `roads*`, `policy*` |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `src/game/*`, `src/sim/worker.ts`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, tests `screen*`, `style`, `playback`, `turns` |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `src/data/*`, `public/data/*`, `public/tiles/`, or the `tools/build-*`
and `tools/fetch-*` scripts.

## The jobs

### B: the model
1. **Why building does too little over ten years.** Opened at once in the city of 2026, a metro line along the Outer
   Ring Road cuts the city's commute by 4% and that of its own wards by 12%. Yet a scripted player who builds four
   metro lines over ten years ends at 57.7 minutes against 58.7 for doing nothing, and one who builds metro, bus
   routes and bus lanes at 57.1. Find where the gain goes. Things to look at: the city grows about 25% in people and
   more in vehicles over ten years, and how the commute rises with that; whether the roads that transit relieves
   fill again at once (and whether that is right); lines that open late in the game and have little time to count;
   the Pink and Blue lines opening in every game, which may already take most of what transit can give; whether a
   line's gain in its own wards is lost in the city's average; trains that are full and turn riders away. Measure
   each. Then put right what is wrong in the model, and tell D and the coordinator what is a matter of the rules
   (costs, times, growth) and not of the model. `tools/playthrough.ts` is D's, and you may run it.
2. **Roads the player builds.** The model takes `CityState.roads` as given, with links and nodes that were not there
   at the start. Check that it copes: a new link between two nodes; a flyover from one node to another far off; a
   link shut to make its opposite one-way; a node whose signal and capacity changed. Routes must move to use a new
   road. A month must not slow by more than a few percent for twenty new links.
3. **More road, more driving.** A new road or a flyover relieves traffic at first. Over the years some of that is
   taken back, as people who did not drive begin to, and as people travel further (PRD BLD-5: "draws more driving
   over the years; moves the jam along"). The model's choice of mode already answers to driving times; check that
   it is of the right order against what is published on induced traffic, and that destinations answer to travel
   time and not only to distance (a weakness listed in `docs/MODEL.md`).
4. **Road deaths.** `MonthResult.deaths` and `deathsByZone`: deaths a year at the month's rate. From the distance
   travelled by each mode, the speed of traffic, the kind of road, whether people on foot have footpaths, and how
   junctions are made. Pedestrians and two-wheeler riders are most of those killed. Calibrate the city's total and
   its split by kind of road user to the published figures for Bengaluru (the traffic police and the state publish
   them yearly), with sources and dates. Deaths must fall with footpaths (`CityState.footpaths`), with speed limits
   (`CityState.limits`), with junction work, and as people move from two-wheelers to transit; and must not fall
   simply because traffic is jammed solid without that being said plainly in `docs/MODEL.md`.
5. **Footpaths.** In a zone with footpaths, walking is safer and pleasanter: more short trips are walked, and more
   people walk to a station, which widens the reach of transit there.
6. **Speed limits.** A limit lowers the free speed of the links it is set on, and the deaths there. On a road that
   is jammed at the peak it costs little time; at night it costs more.
7. **Speed and sameness.** A month still in about 150 ms in Chromium. The determinism test and the engines check
   still pass.
8. Keep `simulate` working at every moment. D and C call it constantly.

### D: the rules
1. **Compile first** (see "Where things stand").
2. **Roads and flyovers (`quote` for `road`).** Two or more places, each snapped to a junction or a main road; a new
   junction is made where a place falls along a road. The road runs straight between them, bending at the places
   the player tapped. Refused through water is not possible yet (there is no water in the city's data): say so in
   the quote's words where the line crosses what the map shows as a lake, if you can tell; otherwise leave it. On
   the ground it meets the roads it crosses at new junctions; as a flyover it meets nothing between its ends.
   Lanes 1 to 3 each way. Cost by length, lanes and whether it is raised, with land a large part of a road on the
   ground in a built-up zone (from the zone's people per square kilometre). Time 1 to 2 years. While built, the
   roads at its ends lose a lane. Once open, it adds to the upkeep of roads for good (PRD UPK-14).
3. **Junctions (`junction`).** Signals: cheap, a month. Redesign: more capacity and fewer deaths, some months.
   Overpass: the main road lifted over, much more capacity along it, a year or two, high cost. Each changes the
   node and its links in the network passed to the model.
4. **Footpaths (`footpaths`), speed limits (`speedLimit`), one-way (`oneWay`), denser building (`density`).**
   Footpaths by zone: low cost by the zone's length of main road, months. Speed limit by zone: at once, nearly
   free, a small cost in approval among those who drive. One-way: at once, cheap; refused where it would cut a place
   off (every node must still reach and be reached). Denser building: only in a zone with a station open or being
   built within reach; a major action; from then on more of the city's growth goes to that zone, up to a limit,
   and the city earns from the building rights sold there (PRD REV-5).
5. **Growth by zone.** Until now people grew alike everywhere. Now each zone grows by its own rate: faster where
   the commute is short, where access is good, and where taller building is allowed; slower where it is long. The
   city's total stays as the rules of slice 3 give it. Whole numbers, and exact on replay.
6. **The network the model is given.** `rules.state` builds `CityState.roads` from the city's network and what the
   player has built, appending new nodes and links so that old ids never move, and caches it so that it is not
   rebuilt each month. `zoneNode` stays as it is.
7. **Approval.** Roads and flyovers please those who drive and displease those whose land is taken. Speed limits
   and one-way streets displease a little. Footpaths please. Works cost approval as in slice 4.
8. **Safety in the report.** Road deaths as a figure, with causes like any other.
9. **The ten years.** B is finding why building does too little over ten years, and will say what is the rules'
   part. Expect to change costs, times or growth. The aim: a scripted player who builds sensibly ends with a commute
   at least five minutes shorter than one who does nothing. Also still wrong from slice 4: a player who only raises
   fares ends with ₹12,232 crore and approval of 44; one who raises the tax to 125% has the shortest commute of
   all because the city shrinks. Neither should be a good way to play. Put them right.
10. **Suggestions.** `suggest` for roads: three to five flyovers or links where traffic is worst and a way round is
    missing, from the last month's traffic. And improve the metro suggestions: in slice 4 two of five carried only
    20 to 24 thousand riders. A suggestion may be checked with a model run before it is offered, if it is quick
    enough; say what you did.
11. **Scripted players.** `tools/playthrough.ts`: add `roads` (flyovers and junctions where traffic is worst),
    `safe-streets` (footpaths, limits), `everything` (a sensible mix of all levers), and keep the rest. Report them
    side by side: money, commute, access, deaths and approval at the end.
12. **Replay and refusal**, as before, with a whole game that uses every new lever.
13. B is changing the model while you work. Test the rules on the small city in `tests/sim-fixture.ts`; check the
    real city with `tools/playthrough.ts`; rerun your figures at the end.

### C: screen
1. **Compile first** (see "Where things stand").
2. **The tools.** In the Build page, a second group: Road, Flyover, Junction, Footpaths, One-way, Speed limit,
   Taller building. Keep the page short: two groups, Transit and Roads, each opening to its tools.
3. **Roads and flyovers** are placed by tap as lines are (PRD UI-7a to UI-7e): two or more places, each snapping to
   the main roads, with a choice of lanes. The proposal as for a line.
4. **Junctions.** The player taps a junction; those that can be worked on are marked when the tool is chosen. The
   choice of signals, redesign or overpass, each with its cost, time and forecast.
5. **By zone: footpaths, speed limits, taller building.** The player taps a zone. Zones where the lever would do
   most are shaded when the tool is chosen (for footpaths, where most people are killed on foot; for taller
   building, zones within reach of a station).
6. **One-way.** The player taps a stretch of road and chooses the direction. Roads already one-way show arrows
   while the tool is chosen.
7. **On the map.** Roads the player has built are drawn as roads, in the look of the map, and carry traffic colours
   like any other. Flyovers with the darker edge the map gives bridges. Junction work as a small mark. Zones with
   footpaths, limits or taller building show in the views that concern them, not on the plain map.
8. **Safety.** A map view "Road deaths" by zone, shaded like the other views. Deaths a year in the city's figures
   and in the top bar's reach (the bar is full: put it in the City page and the report, not the bar).
9. **Forecasts for the wards concerned.** As for a line: the figure for the zones a thing serves, and for the city.
10. **Left over from slice 4:** bus lanes and bus routes are not drawn on the map once open; two stations of one
    line may bear nearly the same name ("Nagavara", "Nagawara") and their labels collide; "Whitefield" is drawn
    twice at the end of a line that ends there. Put these right.
11. **Memory.** About 500 MB after panning on the laptop against a limit of 400. Every slice has missed it. Try the
    one thing not yet tried: a base map archive with the detail above zoom 13 left out for the first load, the rest
    fetched only when the player zooms in to place something. You may make a second archive under
    `public/tiles/` with `pmtiles extract` (the tool is installed); leave the first as it is. Measure. If it does
    not help, say so and stop.
12. **Look at everything.** `tools/look-roads.mjs`: by script, at laptop and phone size, use each new lever once;
    watch a flyover built and opened and the traffic change; read the report. Screenshots of each step. Open each
    with the Read tool and look.
13. Until D's rules take the new plans, build against stand-ins of your own in the agreed shape. Switch over when
    they appear.

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: what each lever does, costs and times, the plans against each other, timings, memory.
- Each screenshot you opened and what you saw (C).
- The three checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
