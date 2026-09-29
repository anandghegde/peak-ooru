# Slice 4: transit — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` in full, `docs/MODEL.md`, `docs/RULES.md` and `docs/DATA.md`. Read
`docs/SLICE1.md` for the facts and conventions, which still hold.

Slices 1 to 3 drew the city, made it move, and made it a game of months and money with three levers: the tax rate,
fares and loans. The player has looked at each and said the map and the moving city are right. **Keep the look as
it is.**

Then the player asked: "can i not lay roads or metro lines? how do i play?" They cannot, and without building
there is little to play. **Slice 4 is building transit: metro lines and stations, bus routes and their buses, bus
lanes, and more trains on the suburban railway.** It is the heart of the game. Roads come in slice 5.

Two things ride along. A simple approval, because without it raising taxes and fares is the best move in every
game. And three faults in the city's data.

## What done looks like

- The player can plan a metro line by tapping places on the map, see exactly where it would run, what it would cost,
  how long it would take and what it is expected to do, and order it. It is built over months, disrupting the roads
  beneath, and opens. People ride it. The report says what it did.
- The same for a bus route, a bus lane, and more trains on a suburban line. Buses and trains can be added to a
  line and taken away; a line can be closed.
- All of it can be done on a phone, by touch, without dragging a line under a finger (PRD UI-7a to UI-7e).
- A well-placed metro line cuts the commute in the zones it serves by a tenth or more within a year of opening.
  A badly placed one does little. A bus route in a bus lane on a jammed corridor is clearly worth having.
- Transit is not a machine for making money: fares cover the running of a good line and never repay its building
  within the ten years (PRD MONEY-8).
- The Pink and Blue lines, under construction when the game starts, open on the season's dates.
- Approval moves with what the player does, and a year's review says where it stands.
- A scripted player that builds sensibly ends the ten years with a shorter commute than one that does nothing,
  and one that builds carelessly goes broke.
- Playing the same actions again still gives the same game exactly.

## The agreed interfaces

`src/sim/types.ts`, `src/rules/types.ts` and `src/data/types.ts` are fixed. Build to them. You may add optional
fields, saying so in your report. New in this slice, already in the files:

```ts
// src/rules/types.ts
Stop, Plan, Quote, Project, Built, Pressure
Action: 'build' | 'cancel' | 'vehicles' | 'close'   (beside 'tax' | 'fare' | 'borrow' | 'repay')
Game.projects, Game.built, Game.majors, Game.approval, Game.pressures
Rules.quote(game, city, plan): Quote
Rules.suggest(game, city, kind): Plan[]

// src/sim/types.ts
CityState.busLanes, CityState.vehicles
```

`rules.quote` and `rules.suggest` are placeholders now, and `may` refuses the four new actions: D replaces them.
The transit a month's traffic is worked out with is `CityState.transit`: the city's own lines, those of the
season's that have opened, and the player's, put together by `rules.state`.

## Who owns what

| Person | Owns |
|---|---|
| **B: the model** | `src/sim/*` except `types.ts` and `worker.ts`, `tools/run-month.ts`, `tools/calibrate.ts`, `tools/measure-*.ts`, `tools/build-zones.ts`, `tools/build-routing.ts`, `tools/build-network.ts`, `public/data/zones.*`, `public/data/routing.json`, `public/data/network.json`, `docs/MODEL.md`, `docs/DATA.md`, tests `sim*`, `demand`, `modes`, `assign`, `determinism`, `zones`, `routing`, `network` |
| **D: the rules** | `src/rules/*` except `types.ts`, `src/seasons/*`, `tools/playthrough.ts`, `docs/RULES.md`, tests `rules*`, `books`, `loans`, `report`, `replay`, `skip`, `build*`, `approval` |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `src/game/*`, `src/sim/worker.ts`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, tests `screen`, `style`, `playback`, `turns`, `tools-*` |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `src/data/*`, `public/data/transit.json`, `public/tiles/`,
`tools/build-transit.ts` or `tools/fetch-*`.

## The jobs

### B: the model
1. **Lines the player builds.** `CityState.transit` may now hold lines and stations that were not there at the start,
   of kind `metro`, `bus` or `rail`, with status `open`. A line may join the city's lines at a shared station or at
   an interchange. The model must take any well-formed transit without breaking, including a line that joins
   nothing, a line of two stations, and stations far from any road. Test these.
2. **Bus routes as lines.** A line of kind `bus` runs on the roads between its stops, at the speed of the traffic
   there, slowed by stopping. It carries what its buses can (`CityState.vehicles`), at the fare for buses. It comes
   on top of the city's existing bus service, which stays as the coverage it is now. People choose a player's bus
   route as they choose a metro line: by time, money, comfort and safety, with waiting from how often it runs.
3. **Bus lanes.** On a link in `CityState.busLanes`, buses run at the free speed and everyone else has a lane less.
   That holds for the player's bus routes and for the city's bus service on that link. A bus lane on a jammed
   corridor with a bus route along it must be clearly worth having; one on an empty road, worth nothing.
4. **Vehicles.** `CityState.vehicles` gives the trains or buses on a line where it differs from the default. How
   often a line runs follows from its vehicles, its length and its speed. Capacity follows.
5. **Works.** While a line is built, the roads beneath lose a lane: the rules pass this through `condition` and,
   if you need it, a further optional field. Check that a lane lost on a main road shows as delay there and on the
   ways round.
6. **Is a good line good enough?** Write `tools/measure-line.ts`: open a given line at once and compare the city
   with and without it, for the whole city and for the zones within reach of its stations: commute, access, trips
   by mode, riders, fare income, road speeds along its corridor. Try at least: a metro line along the Outer Ring
   Road from Silk Board to KR Puram (the Blue Line's course); one from the centre to Sarjapur Road; one through
   empty country; a bus route with and without bus lanes along the Outer Ring Road; a feeder bus to a metro
   station. Report the table. The aim is in "What done looks like". If a good line falls short, find out why
   (who can reach it, what it competes with, how crowding and waiting count) and put it right in the model, keeping
   the city's figures as they are for the city as it stands.
7. **Three faults in the data.** (a) The Outer Ring Road near Silk Board (12.9162, 77.6171) has one lane and 1,290
   car units an hour in `routing.json`; it should be as the rest of the ring road. Find any others like it: a main
   road whose lanes drop for one link and return. (b) Electronic City and Bommasandra hold 434 thousand jobs between
   them, and Jigani 184 thousand on single-lane roads: the jobs estimate counts industrial land by area, not by
   how full it is. Revise the estimate in `tools/build-zones.ts` so that large industrial estates are not
   overcounted, keeping the city's total, and say what changed. (c) Panathur and Kempapura reach the main roads only
   by one-lane roads. After any rebuild, refit the mode constants and check the calibration table.
8. **Speed and sameness.** A month still in about 130 ms here. The determinism test and the engines check still
   pass. More lines cost more time: measure a city with ten more metro lines and twenty bus routes.
9. Keep `simulate` working at every moment. D and C call it constantly.

### D: the rules
1. **Planning (`rules.quote`).** A plan is a list of stops: places the player tapped, or stations already there.
   - **Metro.** Each new stop snaps to a junction or main road within reach, and is refused in water or beyond the
     city's reach. The line runs between stops along the roads where they lead the right way, as metro viaducts do,
     and straight (as a tunnel, at a higher cost) where they do not. Stations at least 600 m apart. The quote gives
     the stations as they would be built, with names from the nearest known place, in English and Kannada where
     the data has it; the path; the length; the cost; the months; the monthly running cost; the routing links that
     lose a lane while it is built.
   - **Bus route.** Stops snap to main roads. The route follows the roads by the quickest way between stops.
     A number of buses. Cheap and quick.
   - **Bus lane.** A list of routing links, each with at least two lanes in its direction.
   - **More suburban trains.** On a line that is there.
2. **Suggested corridors (`rules.suggest`, PRD UI-7d).** For metro and for bus routes: three to five plans along the
   corridors where most people travel and no line runs, from the last month's traffic, best first. Each must be a
   plan the player could have made by hand, and must pass `quote`.
3. **Building.** `build` starts a project: money is paid as the work goes, not all at once. Major actions are limited
   to three a month (PRD section 7): a metro line, a bus lane scheme over some size, and more suburban trains are
   major; a bus route and changing vehicles are minor. The roads beneath a metro line lose a lane for the first half
   of the work. A project can be cancelled, with part of what was paid lost. When it opens, the line is in the
   city's transit, with its vehicles, and the news says so.
4. **Running.** `vehicles` adds or takes away buses or trains on a line, within limits, with a cost to buy and to
   run. `close` closes one of the player's lines. Running costs by line in the books.
5. **Costs and times.** Game values, set in proportion to what is published for Namma Metro's phases (cost a
   kilometre for viaduct and for tunnel, years to build), for BMTC's buses, and for the suburban rail project. Cite
   sources with dates in `docs/RULES.md`; where you judged, say so. The player pays a share, as the city would.
   Set them so that in ten years a careful player can afford about three or four metro lines of 15 to 20 km, not ten.
6. **Money (PRD MONEY-7, MONEY-8).** Fares cover the running of a good line, and never repay its building within
   the ten years. Check it with `tools/measure-line.ts` (B's) and your playthroughs.
7. **The season's lines.** The Pink and Blue lines are in the data as `building`. Give the first season their
   opening dates (published targets, with sources, as game values), in phases if published so. They open as events
   the player did not order, cost the player their running, and are announced.
8. **Approval (a simple one; the full one comes with the score).** 0 to 100, starting at 55, kept in tenths. It
   falls with a rise in the tax rate or a fare, with roads losing lanes to works, and with a longer commute. It
   rises with a cut, with something opening, and with a shorter commute. It drifts back towards 55. Each month's
   pressures are kept, in words, for the report. Each December a review: under 30 brings a warning; two warnings
   running end the game (PRD section 10). Set it so that high tax is no longer the best plan on every count.
9. **Doing nothing.** A scripted player who does nothing now ends with nothing left (−₹67 crore), because costs
   rise 4% a year and income does not keep up. It should end with about what it started with (PRD MONEY-7). Put
   it right.
10. **The allowance is off** while the game is being built (PRD TIME-7): `allowance` takes a switch, off in the
    first season's set-up for now, and the screen shows nothing of it when off.
11. **Reports.** A line opening, a project started, a line closed and a change of vehicles are causes like any
    other: the report says what each did, by running the model without it.
12. **Replay and refusal.** Every new action is refused if the rules do not allow it, and leaves the game
    untouched. Plans are kept in the list of actions as the player gave them; `replay` must snap and route them to
    the same result every time. Test a whole game with building in it.
13. **Scripted players.** `tools/playthrough.ts`: add `metro` (builds the suggested lines as money allows),
    `buses` (routes and lanes), `both`, `careless-builder` (orders everything at once, on loans). Report them side
    by side with the old plans.
14. B is changing the model while you work. Its shape will not change. Test the rules on the small city in
    `tests/sim-fixture.ts`; check the real city with `tools/playthrough.ts`; rerun your figures at the end.

### C: screen
1. **The tools.** A "Build" page beside Report, Books, Levers and City: Metro, Bus route, Bus lane, More trains.
   Choosing one puts the map in placing mode, says what to do in one line, and can be left at any moment.
2. **Placing a line (PRD UI-7a to UI-7e).** The player taps places in turn. Each tap shows at once where the stop
   would snap to. The line so far is drawn in the look of a line being planned. A stop can be moved, taken out, or
   put in between two others. Tapping a station that is there joins the line to it. On a phone, choosing a spot
   opens a magnified view with a crosshair that the player nudges before confirming. Nothing depends on dragging a
   line, on hover, or on a keyboard. Targets at least 44 px.
3. **Suggested corridors.** Before placing anything the player is offered the game's suggestions, drawn faintly on
   the map, each with its cost and what it is expected to do. Accepting one makes it the plan, which the player may
   then change.
4. **The proposal.** Once there are two stops: the stations by name, the length, the cost, the months, the running
   cost, the roads that will lose a lane and for how long, and the forecast (PRD UI-5): what the line is expected
   to do to the commute, riders and the books once open, marked as a forecast. Get it by asking the model for the
   month with the line open. It must say plainly when the player cannot afford it, and what borrowing would make up.
5. **Bus lanes.** The player taps stretches of road; those that can take a lane are marked as the tool is chosen.
6. **Works and lines.** Work under way shows on the map along its course, and in a list with the months left and
   what it is costing in disruption. The player's lines are drawn as the city's are, in colours that do not clash
   with them. Each line in the City page: riders, how full, vehicles with add and take away, close.
7. **Approval.** In the top bar, beside the money: the figure, a word for it, and which way it is going. In the
   report, what moved it. The yearly review as a card.
8. **The allowance is off** for now: show nothing of it.
9. **A first game.** A player arriving for the first time is shown, in four or five short steps beside the things
   they describe, how to read the city, how to build a first line, how to end the month, and where the money is.
   It can be skipped and brought back. The test: "how do i play?" should not need asking.
10. **Narrow laptops.** At 900 px wide the top bar wraps onto three lines. Make every width from 360 to 1920 work.
11. **Look at everything.** `tools/look-build.mjs`: by script, at laptop and phone size, build a metro line from a
    suggestion and one by hand, a bus route, a bus lane, add trains; watch them built and opened; read the report;
    close a line; be refused for want of money. Screenshots of each step. Open each with the Read tool and look.
12. Until D's `quote`, `suggest` and the new actions exist, build against stand-ins of your own in the agreed
    shape. Switch over when they appear.

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: what each kind of line does, costs and times, the plans against each other, timings.
- Each screenshot you opened and what you saw (C).
- The three checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
