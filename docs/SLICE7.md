# Slice 7: the score — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` in full (sections 6, 9 and 10 above all), `docs/MODEL.md`, `docs/RULES.md`
and `docs/DATA.md`. Read `docs/SLICE1.md` for the facts and conventions, and `docs/SLICE4.md` to `docs/SLICE6.md`
for how building and upkeep work. They still hold.

Slices 1 to 6 drew the city, made it move, and gave the player every lever: tax, fares and loans; metro, buses, bus
lanes and trains; roads, flyovers, junctions, footpaths, one-way streets, speed limits and taller building; and the
state of the roads. The player has looked at the map and the moving city and said they are right. **Keep the look
as it is.**

**Slice 7 is what the game is for: the score.** The player's words, from the start: "players should be awarded
points on governance" and "goal is to get the max number of score after 2036". Until now there has been no score,
only figures. This slice adds the score, puts approval right, brings the rest of the events, and mends four faults.

## What done looks like

- A score from 0 to 1,000 on seven measures (PRD section 6), shown all through the game and fixed at the end of
  December 2035. The city as it starts scores about 400. The best plausible play scores 900 or more.
- **Every change in the score comes with its reasons** (PRD SCORE-13): for each measure, the change and its three
  largest causes in plain words and numbers. The player can ask of any zone or road "why is this bad?" (SCORE-14).
- **The score separates players.** Scripted players spread over at least 300 points, in an order a person would
  agree with: doing nothing near 400; neglect, carelessness, default and being replaced well below; building one
  kind of thing in the 500s and 600s; looking after everything highest. No plan that a person would call bad
  governance scores well.
- **Approval rewards results.** Until now doing nothing has been the best liked in every slice (69 at the end of
  slice 6, against 49 for the player who achieved most). After this slice the player who shortens the commute, saves
  lives and keeps the roads up is better liked at the end than the one who did nothing, though they were less liked
  while the works went on.
- **Money is right.** Doing nothing ends with about what it started with (PRD MONEY-7); it now ends with ₹4,555
  crore against ₹2,000.
- The events of PRD section 9 happen, the same for every player of a season, announced, marked on the map, and
  undone exactly when they end.
- Playing the same actions again still gives the same game, and the same score, exactly.

## The agreed interfaces

`src/sim/types.ts`, `src/rules/types.ts` and `src/data/types.ts` are fixed. Build to them. You may add optional
fields, saying so in your report. New in this slice, already in the files:

```ts
// src/rules/types.ts
MeasureKey, Measure, Score, Marks, EventKind, GameEvent
Game.score, Game.scores (the total at each year's end), Game.events
Report.score { now, before }, Report.events
Season.marks
Rules.score?(game, city): Score

// src/sim/types.ts
CityState.surge (trips as thousandths of the usual), CityState.busService (the city's buses, thousandths of the usual)
```

The project compiles as you start. Keep it so.

## Who owns what

| Person | Owns |
|---|---|
| **B: the model** | `src/sim/*` except `types.ts` and `worker.ts`, `tools/run-month.ts`, `tools/calibrate.ts`, `tools/measure-*.ts`, `docs/MODEL.md`, `docs/DATA.md`, tests `sim*`, `demand`, `modes`, `assign`, `determinism` |
| **D: the rules** | `src/rules/*` except `types.ts`, `src/seasons/*`, `tools/playthrough.ts`, `docs/RULES.md`, tests `rules*`, `books`, `loans`, `report`, `replay`, `skip`, `build*`, `approval`, `roads*`, `policy*`, `upkeep*`, `wear*`, `monsoon*`, `score*`, `events*` |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `src/game/*`, `src/sim/worker.ts`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, tests `screen*`, `style`, `playback`, `turns` |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `src/data/*`, `public/data/*`, `public/tiles/`, or the `tools/build-*`
and `tools/fetch-*` scripts.

## The jobs

### B: the model
1. **A mended road must not come out slower.** In slice 6 the screen forecast, for concrete laid on 1.8 km of the
   Outer Ring Road at Marathahalli, that the road would go from 12.2 to 7.5 km/h once done; patching 1.3 km near
   Madiwala gave 13 km/h against 14 had it been left. A mended short stretch draws traffic and fills. Some of that
   is true to life, but a player who mends a road and is told it got slower will not believe the game. Find what
   happens: whether the stretch's own speed falls, or only the average over a longer run that now carries more;
   whether routes reshuffle far more than they should for a small change; whether the forecast compares like with
   like. Put right what is the model's fault, and tell C how to report the rest honestly (more vehicles carried, and
   the time each takes, rather than one speed).
2. **Noise.** Any change to the network reshuffles routes across the city, and changes in the city's commute under
   0.3 minutes are noise. The score will be read to the point: a player who makes a small good change must never
   lose points for it. Reduce the noise at its source if you can (routes that move only where the change gives
   reason to), and measure it: make fifty small changes of different kinds, one at a time, and give the spread of
   the change in each of commute, access, deaths and clean trips. Tell D the size below which a change is noise for
   each.
3. **Fairness.** The score measures the access and commute of the worst-served fifth of zones against the average
   (PRD SCORE-5). The model groups wards for speed (369 into about 130), which smears the difference between a
   ward and its neighbours. Check that the worst-served fifth is real and not an effect of grouping, and that a
   line or a bus route built to serve poor outer zones raises their figures and the measure. If grouping defeats
   it, find a way.
4. **Events.** `CityState.surge`: a month with more trips than usual, as at a festival. `CityState.busService`: the
   city's own buses at a share of the usual, as in a strike, when their riders go another way or not at all.
   A line on strike is a line with no vehicles, which the rules pass through `vehicles`. A change in the price of
   fuel is in `prices.fuel` already: check that it moves people as published figures say it should. A road shut by
   a cave-in is in `shut` already.
5. **The flood list.** It misses KR Puram, Hebbal and Manyata, which flood every year. Add the well-known spots by
   name from the published lists, beside the ones found from the terrain.
6. **Where the ten years stand.** Run D's scripted players on your final model and report the commute, access,
   deaths and clean trips at the end for each. If anything is odd (a plan that a person would call good coming out
   worse than doing nothing on a measure it should help), find out why.
7. **Speed and sameness.** A month in about 175 ms in Chromium. The determinism test and the engines check still
   pass. If the score needs the model run more often, it will be felt: look for a saving.
8. Keep `simulate` working at every moment. D and C call it constantly.

### D: the rules
1. **The score (PRD section 6).** `rules.score`, and `Game.score` kept up each month. Seven measures with their
   weights: access 25%, commute 20%, clean travel 15%, safety 10%, fairness 10%, money 10%, approval 10%. Each
   turned into points from 0 to 100 against the season's marks, so that the city as it starts scores about 40 and
   the best plausible result 100 (SCORE-10). Each is the average of the last twelve months (SCORE-11). Works still
   under way in December 2035 count for nothing, and their debt in full (SCORE-12). Whole numbers, exact on replay.
2. **The marks.** Set them for the first season from what the scripted players can reach: the best of them, on
   each measure, a little short of 100. Publish them in `src/seasons/first.ts` and `docs/RULES.md` (SCORE-15).
   Money: cash less debt at the end, and whether the city ever defaulted; being rich should not score beyond a
   point, since hoarding is not governance. Safety: deaths per lakh people. Clean travel: the share of trips by
   bus, metro, rail, cycle or on foot.
3. **Reasons (SCORE-13, SCORE-14).** For each measure, the change since the last report and its three largest
   causes, by the method the report already uses (the model run again without each thing). Below the size B gives
   as noise, say "no measurable change" and give no cause. "Why is this bad?" for a zone: its commute, access and
   deaths against the city's, and the roads its delay comes from (`src/sim/reasons.ts` has `delayByRoad`); for a
   road: its traffic against what it holds, its surface, its junctions.
4. **Approval that rewards results.** Rework it. People judge a government by how their lives changed over its
   term as well as by this month's annoyance. Let approval answer to the change since January 2026 in each zone's
   commute, deaths, state of roads and access, growing in weight as the years pass, beside the monthly pushes of
   works, charges and floods, which fade. It must still be possible to be replaced for governing badly, and
   disruption must still cost something while it lasts. Set it so that at the end of 2035 the scripted players
   stand in an order a person would agree with.
5. **Money (PRD MONEY-7).** Doing nothing ends with ₹4,555 crore against ₹2,000 at the start. It should end with
   about what it started with. But the first month must not run far short either, or a new player is in trouble
   before they have done anything. Both can hold if income and costs grow at the right rates: find them.
6. **Neglect.** A player who leaves the upkeep budget at bare for ten years is replaced in 2030. That may be too
   harsh for one who simply did not know. Make sure the game warns in good time and in plain words, through the
   report and the review: the state of the roads, where it is heading, and what it will cost to put right.
7. **Events (PRD section 9).** Set for the season by its seed, the same for every player: a cave-in or burst main
   shuts a stretch of road for one to three months; a new employer adds jobs to a zone for good; a festival or a
   big match brings a surge of trips for the month; the price of fuel changes for a time; an election, at which
   approval below a mark cuts the state's grant and above it raises it; a strike, when fares or drivers' terms
   change sharply, stops a line or the city's buses for some days. The monsoon and the lines' openings are there
   already. At most three in force at once; none in the first three months; each announced, with a place where it
   has one; each undone exactly when it ends (EVT-10 to EVT-12).
8. **Small faults from slice 6.** The proposal for resurfacing Sarjapura Road says "20 km chosen" and then
   "Resurfaces 37.2 km": one counts the road and the other both directions. Give kilometres of road everywhere, and
   lane-kilometres only where the price is explained. Roads in the report are named "Outer Ring Road,
   Shivanasamudra Ward": a road should be named by the places it runs between or the area it is in, by names
   people know. The generous budget shows ₹147 crore in one place and ₹124 crore in another.
9. **Scripted players.** Bring them all up to date, add the score to what they print, and add two: `good-governance`
   (what you would do, playing to win) and `populist` (cheap fares, no charges, roads before transit, borrowing to
   pay for it). Report every plan with its score and its seven measures.
10. **Replay and refusal**, as before. The score must replay exactly.
11. B is changing the model while you work. Its shape will not change. Rerun your figures at the end.

### C: screen
1. **The score in the top bar** (PRD 13.1): the total, and which way it is going. The bar is full: it has the
   month, money, commute and approval. Decide what stays. The score is what the game is for and must be seen
   always; the commute and approval are two of its seven measures and can live in the score panel.
2. **The score panel.** The seven measures, each with its points, its figure in its own unit, which way it is
   going, and its weight. Tapping one shows why: the change and its causes, and the map view that belongs to it
   (commute, job reach, road deaths, and so on). On a laptop the PRD's sketch puts it at the left; on a phone it is
   a page of the dock.
3. **The report** leads with the score: what it was, what it is, and the measure that moved it most, with the
   reason. Then the rest as now.
4. **Why is this bad?** On a zone's card and a road's card.
5. **Two new map views:** fairness (the worst-served fifth of zones marked) and clean travel (the share of trips
   not by car, two-wheeler or auto, by zone).
6. **Events.** A pin on the map where an event has a place, a line in the news, a card when it begins if it needs
   the player's attention, and a list of those in force. A road shut by a cave-in is drawn shut. Quiet: events are
   the weather of the game, not alarms.
7. **The yearly review** shows the year's score against the last, and the seven measures.
8. **The ending** (PRD UI-18): the final score, the seven measures, the ten years in one chart of the score by
   year, what the player built, and how the game ended. Made to be looked at and shown to someone: this is what a
   player will screenshot. No rank yet, since there is no leaderboard until slice 8; leave room for it.
9. **Forecasts give the score.** Every proposal's forecast says what the thing is expected to do to the score,
   beside what it does to the figures, marked as a forecast.
10. **A mended road that looks slower.** B is finding why a forecast can say a mended road will be slower, and will
    say how to report it honestly. Until then, where a road carries more vehicles after mending, say so: "Carries
    12% more vehicles, each 1.2 minutes quicker over its length", not one speed.
11. **Small faults from slice 6.** The report's "Mend it" on a phone, for a road that runs to the map's edge, may
    not show the road above the sheet. The streets tool's zone shading is faint at middle zooms. The generous
    budget shows ₹147 crore in Levers.
12. **The introduction** now begins with the score: what it is, and that it is what the game is for.
13. **Look at everything.** `tools/look-score.mjs`: by script, at laptop and phone size: the score panel and each
    measure's reasons; a proposal's forecast of the score; an event beginning and ending; a yearly review; and a
    whole game skipped to its ending. Screenshots of each. Open each with the Read tool and look.
14. Until D's `score` and events exist, build against stand-ins of your own in the agreed shape.

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: the scripted plans with their scores and measures; the size of noise; timings; memory.
- Each screenshot you opened and what you saw (C).
- The three checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
