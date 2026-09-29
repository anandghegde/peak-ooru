# Slice 3: months and money — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` in full, `docs/MODEL.md` and `docs/DATA.md`. Read `docs/SLICE1.md` for the
facts and conventions, which still hold.

Slices 1 and 2 drew the city and made it move. The player has looked at both and said they are right.
**Keep the look as it is.** A month's traffic is worked out by `simulate` (in `src/sim/`), in a background thread, in
about 200 ms, and is identical on every machine.

Slice 3 makes it a game that can be played from January 2026 to December 2035, with money and three levers: the
property tax rate, fares, and loans. There is no building yet, no road condition, no score, no events. But a
scripted player must be able to play all 120 months, the books must balance, and the player must be told why
things changed. Alongside, the traffic model's known faults are being put right.

## What done looks like

- A player can take the city from January 2026 to December 2035: act, end the month, read the report, skip ahead.
- A scripted player plays 120 months without a screen in under two minutes, and playing the same actions again
  gives the same game, to the last figure.
- Changing the metro fare, the bus fare or the tax rate changes what people do and what the city earns, in a
  direction and by an amount that a person would believe, and the report says so with reasons.
- The model no longer puts 14,000 vehicles an hour on a road built for 2,500.
- Everything the player does can be done on a phone.

## The agreed interfaces

`src/sim/types.ts` and `src/rules/types.ts` are fixed. Build to them. You may add optional fields, saying so in
your report.

```ts
Rules      // D builds it: exported from src/rules/index.ts as `rules`
Simulate   // B keeps it: exported from src/sim/index.ts as `simulate`
```

Money is whole lakh rupees inside the game, and crore on the screen (100 lakh to the crore).
Months count from January 2026 as 0; December 2035 is 119.

## Who owns what

| Person | Owns |
|---|---|
| **B: the model** | `src/sim/*` except `types.ts` and `worker.ts`, `tools/run-month.ts`, `tools/calibrate.ts`, `docs/MODEL.md`, tests `sim*`, `demand`, `modes`, `assign`, `determinism` |
| **D: the rules** | `src/rules/*` except `types.ts`, `src/seasons/*`, `tools/playthrough.ts`, `docs/RULES.md`, tests `rules*`, `books`, `loans`, `report`, `replay`, `skip` |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `src/game/*`, `src/sim/worker.ts`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, tests `screen`, `style`, `playback`, `turns` |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `docs/DATA.md`, `src/data/*`, `public/data/*`, `public/tiles/`,
or the `tools/build-*` and `tools/fetch-*` scripts.

## The jobs

### B: the model
1. **The peak spreads (PRD CITY-22a).** At the evening peak the model puts 14,099 vehicles an hour on a stretch of
   Hosur Road that holds 2,520, and the road falls to 1 km/h; twenty links are at 1 to 3 km/h. In life, when a road
   is full, people set out earlier or later, take another way, or travel another way. Make the model do so: no link
   should carry much more than about one and a half times what it holds, and the slowest main roads at the peak
   should move at something like 5 to 10 km/h, not 1. Trips that move out of the peak must go somewhere: into the
   shoulders of the peak, which makes the peak longer. If that calls for more than four parts of the day inside the
   model, the result may still report four. Say what you did.
2. **What is wrong on the map.** The NICE Road is jammed at both peaks and is not so in life. Single-lane outer
   roads to the north and east and around Jigani are jammed. Short links in the centre and near KR Puram are red at
   night. Find the cause of each (too many jobs in an outer zone, a zone joined to an expressway, a link with too
   little capacity, tolls not counted) and put it right in the model where it is the model's fault. Where it is the
   data's fault, say exactly what is wrong and where, for the coordinator. The NICE Road is tolled: the money part
   of the cost should know it.
3. **Fast enough on an ordinary laptop.** A month takes about 200 ms on this machine, which is fast; the estimate
   for a mid-range laptop is 400 to 450 ms against a limit of 300, and 700 to 860 ms was measured with the processor
   slowed four times against a limit of 1,000 on a phone. Bring the time here to about 130 ms or less without
   losing what matters. Report time against accuracy as you did before.
4. **Levers.** The rules (person D) will change `prices` (fares, fuel, parking), the number of people, and later
   `condition`. Check that each does what a person would expect, and give D and the coordinator a table: halve the
   metro fare, double it, the same for the bus; raise people by 10%. For each: trips by mode, riders by line, fare
   income, commute, speed at the peaks.
5. **Fare income and distance.** The rules need to know what each line earned. Add to the result, as optional
   fields: fare paid by mode, and passenger-kilometres by mode and by line.
6. **Trains that fill.** The Yellow Line carries 235,000 a day in the model against 93,000 in life, because the
   model does not know a train can be full. Give each line a capacity from its trains and how often they run
   (published, or judged and marked so), and let crowding enter the comfort part of the cost, and refusal beyond
   that. Green carries 30% too few: look for why.
7. **Keep it the same everywhere.** The determinism test and the six-engine check must still pass.
8. D and C build on your `simulate` as it stands. Keep its shape, keep it working at every moment, and say in your
   report how the city's figures moved (commute, speeds, shares), since D's books and C's panels depend on them.

### D: the rules
Pure TypeScript in `src/rules/`, with no dependence on the page, the clock or the network. Whole numbers for
everything that feeds a result. It runs in the browser, and will run on the server to check scores, so it must be
exact and must never trust what it is given.

1. **The game.** `rules` to the shape in `src/rules/types.ts`: start, may, act, state, endMonth, books, replay.
2. **Money (PRD section 8).** Income: property tax, the state's grant, fares. Costs: running transit, upkeep of
   roads, loan repayments. Property tax grows with people and falls a little as the rate rises, because growth
   slows. Fares come from the model's riders and distances. Running costs by line and by bus, from kilometres run.
   All amounts are game values: choose them so that the city as it starts runs a small surplus, and say how.
3. **Levers.** The property tax rate, changed at most once a year, within limits, with a cost in growth. Fares for
   metro, bus and suburban rail, within limits. Loans: borrow in set amounts, a rate that rises with what is owed,
   monthly payments, early repayment; a limit on what may be owed.
4. **Growth.** People grow each month, faster where commutes are good, slower when the tax rate is high
   (PRD CITY-15). For this slice growth is for the city as a whole; by zone comes later. Vehicles grow with income.
5. **Reports with reasons (PRD SCORE-13, TIME-8).** At the end of a month, or of a span skipped, one report: the
   figures now and before, with up to three causes each in plain words and numbers; the books; the news; what needs
   the player. To find causes, work out what the figure would have been without each thing that changed (a fare, the
   tax rate, growth) by running the model again with that one thing put back, and give the difference. That costs
   a model run per cause: do it only for the months the player stops at, and only for things that changed.
6. **Skipping (PRD TIME-3 to TIME-6).** `skip` in `src/rules/skip.ts`: a month, a number of months, or until
   something needs the player: money running low, a loan falling due that cannot be paid, a default coming, the
   year's end. A skip never passes a moment at which the player could lose.
7. **The allowance (PRD TIME-7).** 12 game months a day, carrying over to at most 36, the day turning at midnight
   India time. The rule as a pure function of the times of the player's past months and the time now. The server
   will enforce it later; the screen shows it now.
8. **Ending.** December 2035 ends the game. Money below nothing for three months running is a default, which
   ends it (MONEY-5).
9. **Replay (PRD MP-30).** A game is a season and a list of actions with their months. `replay` plays it again and
   must give the same game exactly. Test it over a whole game.
10. **A season.** `src/seasons/first.ts`: the first season, with its seed, starting money and grant.
11. **A scripted player.** `tools/playthrough.ts [plan] [seed]`: plays 120 months without a screen and prints the
    year-end figures and books. Plans: `nothing`; `cheap-fares`; `dear-fares`; `high-tax`; `borrow-and-hold`;
    `careless` (borrows to the limit at once). Use it to set the amounts so that the plans differ in ways a
    person would believe, and none is obviously the best.
12. **`docs/RULES.md`:** every rule and every amount, in plain words, with why.
13. B is changing the model while you work. Its shape will not change; its figures will move a little. Do not
    assert exact figures from the real city in tests: test the rules on the small city in `tests/sim-fixture.ts`,
    and check the real city with `tools/playthrough.ts`. Rerun your figures at the end.

### C: screen
1. **The top bar (PRD 13.1).** The month and how many of 120; money and the month's balance; the months left in
   today's allowance. No score yet.
2. **Ending the month.** "Next month", and "Skip" with its choices: to the next thing that needs me, 3 months,
   6 months, 12 months. While months are worked out the page stays live and shows progress; a skip can be stopped.
   After a month the map shows the new traffic.
3. **The report (PRD UI-12).** After a month or a skip: what changed, with its reasons; the books; the news; what
   needs the player. Short. It must not bury the map: a card on a laptop, a sheet on a phone. It can be put away and
   brought back.
4. **The books (PRD UI-14).** Income and costs by line, loans with what is owed and the monthly payment, and the
   forecast for the next 12 months as things stand.
5. **The three levers.** Property tax rate; fares for metro, bus and rail; borrow and repay. Each shows what it is
   expected to do before the player commits, marked as a forecast (PRD UI-5): get the forecast by asking the model
   for the month with the change made. A lever that cannot be used says why (UI-6).
6. **The game keeps.** A game in progress is kept in the browser between visits (local storage, or IndexedDB if
   it is too large), as the season and the list of actions, and replayed on return. A game from an older version
   says so plainly. The server comes in slice 8.
7. **The end.** December 2035: a plain screen with the ten years in one chart (commute, money) and the choice to
   start again. Default: the same, saying what happened.
8. **Phones.** With traffic on, the controls and the closed figures sheet take about a third of a phone's screen.
   That is too much: when closed, everything together should take no more than a sixth. Every new thing in this
   slice works by touch at 390 px wide, with targets of at least 44 px.
9. **A missing image.** At street zoom the console warns of a missing `generic_shield-2char` image: the base style
   has road-shield layers and no sprite. Drop the layers or supply the image.
10. **Memory.** The limit is now the page only: 400 MB on a laptop and 300 MB on a phone after panning
    (PRD PERF-6). Check that the new panels and the kept game do not raise it, and report the figures.
11. **Look at everything.** `tools/look-turns.mjs`: plays the first year by script at laptop and phone size,
    using each lever once, skipping, reading the report and the books, leaving and returning, and then skips to
    the end. Screenshots of each. Open each with the Read tool and look.
12. Until D's `rules` exists, build against a stand-in of your own in the agreed shape. Switch over when it
    appears in `src/rules/index.ts`, and cope with it being missing.

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: timings, the model against published figures, the plans against each other.
- Each screenshot you opened and what you saw (C).
- The three checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
