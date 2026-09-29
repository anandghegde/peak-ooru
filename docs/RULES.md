# Peak Ooru — the rules of the game

The rules for slices 3 to 7: months, money, property tax, fares, loans, growth, reports with reasons, skipping, the
daily allowance, the ending and replay (slice 3); building transit, the season's lines opening, and a simple approval
(slice 4); roads, flyovers, junctions, footpaths, one-way streets, speed limits, taller building near stations,
growth by zone, the network the model is given, and the balance of the ten years (slice 5); the state of the
roads: how they start, wear, flood and are dug up, and how the player mends them and at what cost (slice 6); and the
score, approval by zone that answers to results, the season's events, and money that comes out right (slice 7).
Slice 8 (online) changed the score to one of ten years, added the game's fingerprint, a quick replay for the server,
and the open season (see "In short"); slice 9 (fit to play) added "What could I do now?", the order the levers arrive in
a first game, resurfacing stretch by stretch, and money scored in full from ₹1,000 crore (see "Slice 9"). Brought up to
date 29 September 2026 (slice 9). Code: `src/rules/` (slice 5 mostly in `roads.ts` and `growth.ts`,
slice 6 in `upkeep.ts`, with `names.ts` made by `tools/playthrough.ts names`; slice 7 in `score.ts`, `reasons.ts`,
`events.ts`, `why.ts`, `areas.ts` and `approval.ts`), `src/seasons/first.ts`. Tool: `tools/playthrough.ts`. Tests:
`tests/rules*.test.ts`, `books`, `loans`, `report`, `replay`, `skip`, `build`, `approval`, `roads`, `policy`, (slice 6)
`wear`, `upkeep`, (slice 7) `score`, `events`, and (slice 8) `score-years`, `digest`, `long-lived`.

Every amount here is a game value. Where a real figure lies behind one, it is cited with its date; where it is
judgement, it says so.

## In short

- **Slice 9: fit to play** (see "Slice 9"). `rules.advise(game, city, options)` answers "What could I do now?": three
  things the city can afford now, expected to raise the score most within a year, each with its cost, its estimate and
  the actions that begin it; about 20 to 70 ms on estimates, half a second with the best checked by the model. A player
  who does only the first of them each month scores **651** (doing nothing 426). `src/rules/unlock.ts` gives the order
  the levers arrive in a first game (mending, buses and fares first; metro in July; everything by November). Resurfacing
  is done stretch by stretch, each stretch losing a lane only for its month and good from its end (resurfacing the ten
  worst roads cost 98 points of the year's score after three months; now 15, and +32 by twelve). Money scores in full
  from ₹1,000 crore, not ₹3,000 crore: the city as it starts scores **561**, not 547; the other marks and the opening
  figures are as they were. `version` is 7.
- **Slice 8: the score of ten years.** Each year is scored as its December stood (its twelve months; approval its
  thirty-six), and the game's score weighs the years, each counting a quarter more than the one before: 2026 3%, 2035
  22.5% (`Season.years`). During the game the score is the same weighing of the years so far, so it does not jump at
  the end. For the score page, in one sentence: **"Your score is the average of your years so far, each year scored on
  its own twelve months, and each counting a quarter more than the year before: 2026 counts 3% of the final score,
  2035 counts 22%."** Sitting on the money for seven years and then spending it on what shows no longer pays: the late
  spender falls from 647 (third) to 576 (sixth). See "The score of ten years". `version` is 6.
- **Slice 8: the game's fingerprint,** `gameDigest(game)` in `src/rules/digest.ts`, which the server and the screen
  compare after each month; **a quick replay** for the server (`rules.replay(…, until, false)`: no reports); **the open
  season**, `src/seasons/open.ts` (the first season with the daily allowance on).
- **Slice 7: the score.** The player is scored from 0 to 1,000 on seven measures (PRD section 6): access 25%, commute
  20%, clean travel 15%, safety 10%, fairness 10%, money 10%, approval 10%. Each is the average of its last twelve
  months (approval thirty-six), turned into points from 0 to 100 against the season's published marks. Whole numbers
  throughout; the server gets the same score from the list of actions. Every change comes with its three largest
  causes, or "no measurable change" where the model cannot tell; any zone or road can be asked "why is this bad?". See
  "The score".
- **Slice 7: approval by zone, that rewards results.** Each zone's approval settles where the change since January 2026
  in its commute, road deaths, roads and reach puts it, counting more as the years pass; works, charges, floods, land
  taken and bus lanes push it about, and fade. See "Approval".
- **Slice 7: events** (PRD section 9): the monsoon, the season's lines, the festival season, a big match, cave-ins and
  burst mains, new employers, the price of fuel, two corporation elections, and strikes when a fare is raised sharply.
  The same for every player of a season; at most three at once; undone exactly. See "Events".
- **Slice 7: money.** Property values rise 2% a year, not 4%: doing nothing ends with about what it began with
  (₹2,358 crore against ₹2,000, PRD MONEY-7), and the first month is about level (−₹2.5 crore on B's final model).
- **Slice 7: the city as it starts scores 547; doing nothing ends at 308; the best scripted player 908.** See "The
  marks" for why the start is not 400.
- A game is a season and a list of actions, each with its month (PRD MP-30). Everything else follows from those.
- Each month the player may change the property tax rate (once a calendar year), the metro, bus and suburban rail
  fares, borrow or repay, and **build**: a metro line, a bus route, bus lanes, more trains on a suburban line; cancel
  work; add or take away buses and trains; close a line of their own. Then the month ends: the model works out its
  traffic, the books settle, work is paid for and what is finished opens, the city grows, approval moves, and a
  report says what changed and why.
- Money is kept in whole lakh and shown in crore. Rates in hundredths of a percent. Approval in tenths of a point.
  Places in millionths of a degree, lengths in whole metres. Nothing kept from month to month is a fraction, but for
  the fares handed to the model in rupees (paise ÷ 100) and the places the player tapped, which are kept as given.
- The city starts with ₹2,000 crore and (slice 6) a level first month; a player who does nothing ends with about what
  they started with (slice 7); the levers are there to keep up.
- A good metro line of 15 km costs the city about ₹1,700 crore over four years, covers its running from its fares,
  and never repays its building. A careful player can afford three or four; one who orders everything at once is
  broke inside two years.
- The Pink and Blue lines open in phases on the dates BMRCL published in August 2026.
- Approval starts at 55, in every zone. How lives changed (commute, deaths, roads, reach) sets where it settles; tax,
  dear fares, works and bus lanes push it down; openings push it up. Under 30 at two December reviews running and the
  player is replaced.
- The game ends in December 2035, or earlier on a default (three months below nothing) or on being replaced.
- **Slice 6.** Every main road and every zone's streets has a condition from 0 to 100 (good from 75, fair from 50,
  poor from 25, broken below). The city starts poor on the whole. Roads wear each month by their traffic, heavy
  vehicles above all, faster in the monsoon (June to September, each year's rain from a real year chosen by the
  seed), where drains are poor, and after a utility digs them up. Low roads flood and shut for days. The player sets
  a standing upkeep budget (bare, steady, generous), patches potholes, resurfaces, lays concrete, mends a zone's
  streets, pays to make good the roads a work digs up, makes utilities dig only in set months, and can order potholes
  patched wherever a zone's roads fall below a mark. Poor roads slow the city and its buses, kill more and displease
  those who live along them; the report says how much and names the worst roads. See "The state of the roads".
- **Slice 5.** The player may also build a road or a flyover between places on the main roads, work on a junction
  (signals, a redesign, or lift the main road over it), lay footpaths through a zone, make a road one-way, set a speed
  limit in a zone, and allow taller building in a zone near a station. Each costs something besides money (PRD 7.5):
  see "Roads and policy". A metro line now opens in two stretches. People grow by zone, not alike. The state pays for
  free bus rides at the usual fare; a high property tax slows the rise in property values; fares above the usual slow
  the city's growth.

## Slice 9: fit to play (SLICE9, B)

### What could I do now? (`rules.advise`, `src/rules/advise.ts`)

`rules.advise(game, city, { levers?, count?, simulate?, result? })` gives up to `count` (3) things, best first, each an
`Advice` (added to `src/rules/types.ts`): `title` and `text` for the player, the `lever` (as `unlock.ts` names them),
the `actions` that begin it (one press: pass each to `act` in order; a build's plan may be quoted and shown first),
`cost` and `running` (lakh), `score` (points of 1,000 it is expected to add within a year, against not doing it), whether
that was `checked` with the model, and where it is (`links`, `zone`, `at`). It changes nothing.

**What it looks at**, from the city's own state, last month's traffic (before the first month: this month's, given as
`result` or worked out once):
- the named roads whose poor surface costs most time (the model's `surfaceDelay`): patch the worst, patch the ten
  worst, resurface the three worst;
- the ten zones where most people live on broken streets: patch their streets;
- the busiest corridors no bus route of the player's serves (`suggest`'s own), not the same corridor both ways, less
  where metro stations open now stand along them;
- bus lanes along the player's running routes; a redesign of the three most jammed junctions; 40 km/h in the ten zones
  where most were killed; footpaths in the three deadliest zones;
- the upkeep budget (to generous; back to steady from bare), the standing order to patch below 30;
- three more trains on a metro line fuller than its trains carry;
- when money would run low: the fares back up with costs (which costs no approval: the usual fare rises each January),
  and only when it would run really low the tax up five points, or the budget back from generous.

**Affordable** means allowed now (`may`), and its cost and two years of its running within what the city is expected to
have at its lowest over the next twelve months (`forecast`, the work in hand paid as it falls due), less ₹500 crore.

**The estimate.** The change in the score as the year in hand scores it: each measure's average over the next twelve
months (approval over thirty-six) against the marks, from where the measure stands, so that a measure at 0 or 100
points gains nothing. Money: the cost at once and the running as it accrues. Approval: its pushes (roads mended, a
route opening, drivers losing a lane, a limit), as `pressures` has them, run through twelve months of drift. The traffic:
for a road's surface, the rules' own arithmetic of the time it saves (`surfaceMinutes`) times 0.5 points a second,
for the months it is in effect (a patch wears off evenly over its months; resurfacing is done over its months); for the
rest, what the model was measured to do with each kind of thing (`tools/measure-advice.ts calibrate`, docs/MODEL.md
"Slice 9": the ten worst roads patched, est. 16 against 12 to 20 measured; streets 7 against 7 to 10; generous 28
against 24 to 39; trains 9 against 9 to 10; the bus corridor 7 against 1 to 14). **Judgement**, fitted. The three are
chosen best first, one of each lever before a second of any, and only those worth a point or more.

**Checked.** Given `simulate`, the best that the model can see at once (not the budget, whose worth is in the months of
wear to come) is done on a copy of the game, opened at the month's end whatever its months, and the month after worked
out with it and without: two runs. Its traffic part is then the model's, for the months it is in effect; if it falls
below the next, the three are chosen again. Not before the first month unless `result` is given (a third run would pass
a second).

**Speed** (Node, `vite-node`, the machine shared, load 7 to 13): estimates alone 15 ms in January 2026 and 63 to 70 ms
later (the money forecast is 35 of it); with the check 500 to 650 ms. F measured about 0.78 s in the game in a
browser. Before the first month without `result`, about 1.1 s with the check, so it is skipped then.

**Does following it raise the score?** `tools/measure-advice.ts player [n]` (and `playthrough.ts advised`) plays a
player who does only the first `n` suggestions each month, nothing else, for ten years: **651 with one a month, 619 with
all three**, both finished, against 426 for doing nothing (ten-year scores, the final marks). One a month: generous
upkeep, the ten worst roads patched, the standing order, streets patched in turn, two bus routes with lanes, more trains
on the fullest lines, the fares kept up with costs when money ran low, now and then five points of tax; money never
under ₹430 crore at a year's end. The score as the years go: 604, 717, 763, 780, 781, 765, 747, 717, 684, 651: the early
years are those of the best plans; the later fall as the city grows and the suggestions (none of them a metro line)
cannot keep up. `playthrough.ts advised --check`: the same game again from its list of actions. Before its money was
taken into account properly the same player went bankrupt in 2028 buying trains, and then raised the tax every year and
was replaced; before the same thing was kept from being first month after month (below) it scored 680.

**Not the same thing twice.** What the player did in the last two months ranks at 0.6 of its worth among the three (the
score shown is still its worth); trains are not offered for a line given trains in the last six months; work under way,
roads patched (now fair), routes run and upkeep set are not offered at all. The text is one or two short sentences and
never says a cost: the screen shows `cost` and `running` beside it.

**Not suggested:** metro lines, roads and flyovers, taller building and more suburban trains: each takes years, and
within a year only costs. The screen's own suggestions (`suggest`) are for those.

### The order the levers arrive in a first game (`src/rules/unlock.ts`)

`unlocked(month)` gives the levers the screen offers in a first game; `arriving(month)` those that arrive then with the
line that announces them; `ARRIVALS` the whole order; `leverOf(action)` an action's lever. The rules and the server know
nothing of it: a metro line is allowed in the first month. The screen gives a returning player everything.

| Month | Levers | The line |
|---|---|---|
| January (0) | repair, streets, busRoute, fare | Mend roads, run bus routes and set the fares. |
| February (1) | busLane, upkeep | New: bus lanes, which let buses run free of the traffic, and the budget for keeping roads up. |
| March (2) | junction, footpaths | New: work on junctions where traffic jams, and footpaths that make streets safer to walk. |
| April (3) | vehicles, speedLimit | New: more buses or trains on a line, and speed limits that save lives. |
| May (4) | tax, borrow | New: the property tax rate, and loans. |
| July (6) | metro | New: metro lines. They are dear and take years, and carry more than anything else. |
| September (8) | road, railService | New: roads and flyovers, and more suburban trains. |
| November (10) | density, oneWay, digOnce | New: taller building near stations, one-way streets, and making utilities dig only in set months. |

**Judgement**: cheap and quick first, what the introduction teaches in the first month; what takes years later, but
within the first year, so that a player who stays a first day meets them all.

### The first year: resurfacing stretch by stretch

What each cheap first act does to the score after 3, 6 and 12 months, before and after, is in docs/MODEL.md ("Slice
9"), with why doing nothing's own score falls through 2026 (growth, the monsoon, the festival month). Every sensible
cheap act holds the score above that line within three months but one: **resurfacing**, which shut a lane of every
stretch for all its months (up to three) on the city's busiest roads and mended nothing until the end: the ten worst
roads resurfaced cost 98 points after three months, 29 after six, and were worth 8 by twelve.

Now (`resurfacedIn` in `upkeep.ts`) a resurfacing project does its stretches in turn, an equal share each month, in the
order of their ids: each loses a lane only for its month (`works`) and is good from the end of it. The city's
contracts are let and done this way, a reach at a time. The quote's note says so ("It is done stretch by stretch over 3
months, each stretch with a lane shut for the month it is done"). The ten worst roads now: −15, +14, +32. The cost and
the months are as before; concrete, and a work's roads made good, are as before.

**Footpaths in one ward** still do nothing measurable to the city's score in a year (one ward of 369, five months to
build, a life or two a year): right for the city, and advice does not offer them alone.

### Plans that ought to do well (SLICE9 B4)

The scripted players, ten-year scores, before (slice 8: its rules and marks) and after (slice 9's), best first, with
how each ended (`npx vite-node tools/playthrough.ts <plans> --save=file`):

| Plan | Before | Ends, before | After | Ends, after | After: access, commute, clean, safety, fairness, money, approval |
|---|---|---|---|---|---|
| `good-governance` | 871 | finished | **841** | finished | 85 86 85 81 77 82 89 |
| `everything` | 776 | finished | **819** | finished | 83 85 82 82 77 85 74 |
| `advised` | (new) |  | **651** | finished | 70 64 44 83 58 91 50 |
| `lanes-everywhere` | 609 | finished | **635** | finished | 44 70 92 72 53 100 22 |
| `lean-start` | 588 | finished | **621** | finished | 45 70 91 77 53 77 26 |
| `generous` | 596 | finished | **607** | finished | 68 55 23 66 53 100 74 |
| `both` | 502 | finished | **525** | finished | 46 53 47 60 42 89 43 |
| `keep-roads` | 492 | finished | **525** | finished | 53 48 21 67 44 100 54 |
| `every-lever` | 486 | finished | **507** | finished | 48 49 27 63 40 99 47 |
| `metro` | 483 | finished | **506** | finished | 44 53 38 59 43 81 50 |
| `buses` | 464 | finished | **466** | finished | 36 46 40 60 35 100 28 |
| `roads` | 408 | finished | **434** | finished | 40 42 22 57 33 100 26 |
| `nothing` | 423 | finished | **426** | finished | 33 35 31 59 27 100 42 |
| `borrow-and-hold` | 420 | finished | **426** | finished | 33 35 31 59 27 100 42 |
| `careless` | 408 | finished | **426** | finished | 33 35 31 59 27 100 42 |
| `concrete` | 424 | finished | **426** | finished | 37 40 22 62 36 100 23 |
| `safe-streets-40` | (new) |  | **411** | finished | 25 30 41 78 23 100 25 |
| `keep-up` | 394 | finished | **395** | finished | 32 35 23 58 27 100 26 |
| `safe-streets` | 386 | finished | **391** | finished | 20 27 41 86 20 100 20 |
| `steady` | 384 | finished | **385** | finished | 31 36 22 57 28 100 18 |
| `dear-fares` | 382 | finished | **383** | finished | 32 38 17 54 34 100 14 |
| `slow-everywhere` | 326 | finished | **327** | finished | 14 20 23 100 14 100 4 |
| `cheap-fares` | 290 | default in 2028 | **297** | default in 2028 | 64 55 67 46 49 58 71 |
| `populist` | 274 | default in 2031 | **280** | default in 2031 | 55 54 54 52 44 44 93 |
| `late-spender` | 576 | finished | **276** | default in 2035 | 50 56 53 71 45 70 51 |
| `last-year` | 250 | default in 2035 | **250** | default in 2035 | 43 49 49 73 42 72 35 |
| `hoard` | 221 | replaced in 2027 | **221** | replaced in 2027 | 55 42 22 37 51 100 0 |
| `high-tax` | 217 | replaced in 2034 | **217** | replaced in 2034 | 41 43 36 55 34 100 2 |
| `neglect` | 197 | replaced in 2033 | **201** | replaced in 2033 | 5 39 98 48 12 99 6 |
| `careless-builder` | 172 | default in 2027 | **172** | default in 2027 | 44 30 52 45 42 0 10 |

The marks are as before but money's (below); "after" is on the final rules (resurfacing stretch by stretch) and marks.
No plan's ending changed but `late-spender`'s: it spent to the edge of what it could borrow before and now runs out
in its last year (it ended owing ₹2,907 crore with −₹303 crore in hand before), which is the right place for a plan
that hoards for seven years.

**Why the sensible plans that stay low stay low:**
- **Every plan built on `keep-up`** (metro, buses, both, roads, safe-streets, keep-roads, concrete, generous,
  lanes-everywhere, slow-everywhere) raises the property tax a point each January, which a city with ₹2,000 to ₹8,000
  crore in hand does not need, and people resent for as long as it stands; and keeps fares up with costs, which loses
  riders while doing nothing lets fares fall in real terms. Against doing nothing that costs about 30 points (keep-up
  395 against 426): 10 from the tax (`--no-tax-rise`: keep-up 405), the rest clean travel. So `keep-up` and `steady`
  below doing nothing are right: they tax and charge what the city does not need, and the money scores nothing more.
  Against `keep-up`, every single-minded plan gains.
- **Safe streets**: its limit of 30 km/h on the main roads of the forty deadliest wards (mostly on the fringe, where
  they run fast) saves about 160 lives a year and costs 8% of the jobs within reach and 2 minutes of commute: by the
  score's weights (lives 10%, reach and time 45%) the limit costs about 40 points more than it gives (docs/MODEL.md,
  "Slice 9"). At 40 km/h (`safe-streets-40`) it is 411, and 421 without keep-up's tax rise. Its footpaths in 150
  wards are about even too: their 5% of each road's capacity costs about what the walking and the lives gain. Tried: footpaths at 2%, not kept
  (docs/MODEL.md).
- **Concrete** ties doing nothing: laying the ring road and radials in concrete takes half the road for up to a year
  at a time, and the steady budget holds those roads anyway; it pays over twenty years, the game is ten.
- **Roads** (flyovers and overpasses) are the PRD's own catch: they draw driving and move the jam.

**Money in hand.** Doing nothing ended with ₹2,358 crore and scored 97 of 100 on money for ten years; a plan that spent
on the city was marked down for spending what doing nothing sat on (metro 59, both 65, everything 45). The PRD's aim for
money is a city that pays its way (MONEY-7: "comfortable but never idle-rich"). So money now scores in full from ₹1,000
crore (half the start), nothing at −₹4,000 crore as before: sitting on the grant earns nothing above a reserve, and a
careful builder is no longer marked down for spending down to it: metro +23, both +23, roads +26, everything +19, good
governance +23 on the same games; doing nothing +3. **Judgement.** The city as it starts scores 100 on money, not 85.

### The marks and the opening figures

The model did not change (fingerprint `faafa5f0`), so the opening figures stand. The marks but money stand: `marks
--quick` on slice 9's rules (run while footpaths were tried at 2%) would have moved them (access full 160 → 155, commute 2795 → 2900, safety 565 → 585,
fairness 545 → 520, approval 765 → 780), but only because the best plan's own path moved: resurfacing stretch by stretch
changed good-governance's second bus route in its third month, and every choice after (its junctions, footpaths, metro
lines) followed from that; it had less money in hand each February, resurfaced twice rather than five times, and ends
lower (841, against 894 for its slice 8 game on the same marks) on rules that raise the other plans that resurface. Marks that follow one scripted game's chaos are not better marks. Money's are set by hand in `fitMarks` as
before, now `{ none: −400,000, full: 100,000 }`. **The city as it starts: 547 → 561** (money 85 → 100 points).

### Games kept under version 6

`version` is 7: a game kept under 6 plays out differently. M found good-governance's list of actions from slice 8
defaulting at month 62 when played again: that was with footpaths at 2%, since reverted; under the rules as they stand
the same list finishes (902 under the new marks). Under the 2% rule it ran out because the traffic differed from month
3 on (more room on the roads of the footpath zones, a little more driving, fewer fares) by about ₹380 crore over five
years, and the list's January purchase of trains (bought in slice 8 with that money in hand) then took it below
nothing. A player is told at once ("Money is below nothing, at −₹19 crore. If it is still below nothing at the end of
March 2031, the state takes over.") and has two months to borrow or raise fares; the list, being a record, could not.
Played live under version 7 good-governance never ran short.

## Whole numbers, and the same game everywhere

The server will play every game again from its list of actions to check the score (PRD MP-31). If the browser and the
server differ by one lakh, a score is disputed. So:

- Money is whole lakh. Every step of the books is a product of whole numbers divided and rounded
  (`div(a, b) = Math.round(a / b)`), with every intermediate below 2^53, so it is exact on every machine.
- The tax rate is in hundredths of a percent of the standard rate (10,000 is the standard). People are in
  ten-thousandths of those at the start (10,000 at the start). Loan rates in hundredths of a percent a year.
- Fares are whole paise a km (450 is ₹4.50). The model is given rupees (paise ÷ 100), a single division.
- **Places.** A plan keeps the places the player tapped, in degrees as given (a JSON number goes to and fro exactly).
  Planning turns each into whole millionths of a degree (`Math.round(deg × 10⁶)`), and those into whole metres east
  and north of 77°E 12.5°N with a fixed scale (0.10848 m east and 0.11057 m north for each millionth). Distances are
  the rounded square root of a sum of squares of whole metres. Square roots are exact in IEEE arithmetic on every
  engine; `sin`, `cos`, `atan2` and the like are never used. Shortest paths use a heap with ties broken by node id.
  So the same taps on the same city data give the same line on every machine (`src/rules/geo.ts`).
- The one place a fraction is computed is a loan's payment, `(1 + r)^60`, which is done by sixty multiplications (never
  `Math.pow`), then rounded up to a whole lakh once, when the loan is taken.
- The rules use no `Math.exp`, `log`, `pow`, `**`, `sin`, `cos`, `hypot`, clock or chance; a test reads the source to
  make sure.
- `took` (how long the model ran) is set to 0 in the game's copy of the last month, so that two plays of the same game
  are equal to the last character.

**How it is known.** `tests/replay.test.ts` plays two whole games of 120 months on the small city and plays each again
from its list, comparing the two as JSON, every figure and every report: one with every lever (fares, tax rises and
cuts, three loans, an early repayment), and one with building in it (two metro lines, one cancelled after five
months, a bus route with a station as a stop, bus lanes, buses added, more suburban trains, then trains taken away,
trains added to a city line, a line closed, and a season whose line opens in two phases). Every month of the second
it checks that the model is never handed a line it would drop (ids unique, two stations or more that exist, vehicles
on every line with a number). `tools/playthrough.ts both --check` does the same on the real city: see "The scripted
players".

## Never trusting what is given

A player can change the code in their browser, so `act` and `replay` refuse anything the rules do not allow. A refused
action leaves the game exactly as it was (tests compare it before and after). They refuse:

- An action that is not an object, or of an unknown kind, or once the game is over.
- A tax rate outside 80% to 150% of the standard, not in steps of 1%, not a whole number (a string, NaN, infinity or a
  fraction), the same as now, or a second change in the same calendar year.
- A fare outside its limits, not in steps of 10 paise, not whole, of a mode that does not exist, or the same as now.
- A loan that is not a whole positive multiple of ₹100 crore, or that takes what is owed past the limit.
- Repaying a loan that does not exist or is already repaid, or without the money to do it.
- **A plan** that is not an object; of an unknown kind; with fewer than two places or more than 40; a place that is not
  `{ at: [lng, lat] }` with two finite numbers within 76–79°E and 11.5–14.5°N, nor `{ station: id }` with a whole id
  of a station that exists; a bus route of other than 1 to 60 whole buses; bus lanes that are not whole ids of routing
  links, or are repeated, or more than 500; more trains that are not 1 to 6 whole, or on a line that is not an open
  suburban line, or past 12 more on one line. And any plan that `quote` refuses (below).
- **Building** a major work when three have been started this month; work that would not be done before the term
  ends; work the city cannot pay for (below).
- **Cancelling** work that is not under way. **Vehicles:** a change that is not a whole number from −50 to 50 and not
  0, on a line that is not open, past a line's limits, or dearer than the money there is. **Closing** a line that is
  not the player's own.
- In `replay`: an action dated in a month that has already passed, dated in a month never reached, with a month that is
  not a whole number, or not an object at all; and a season that is not whole, longer than 120 months, or with
  openings that are not proper.
- **Slice 5 plans:** a road of other than 2 to 10 places, other than 1, 2 or 3 lanes each way, or without a true or
  false `flyover`; a junction that is not a whole node id, or work other than `signal`, `redesign`, `overpass`; a zone
  that is not a whole id of a zone; a speed limit other than 30, 40 or 50 km/h or `null`; a one-way or taller-building
  order without a true or false `on`; a link that is not a whole id of a routing link. And whatever `quote` refuses
  (below): a road through the same junction twice, too short or long, far from the roads; signals where there are
  some, work where fewer than three roads meet or at the map's edge, a second redesign, anything after an overpass,
  work at a junction already under way; footpaths twice; a limit the same as now, or on a zone with no road faster; a
  one-way street on an expressway, on a road one-way already, or that would leave a junction that cannot be reached or
  left; taller building away from a station, in a zone with no people, or twice.

- **Slice 6:** an upkeep level other than `bare`, `steady`, `generous`; a standing order other than a whole 10 to 70 or
  `null`; an upkeep action that changes nothing. Dig once without a true or false, the same as now, or a fourth major
  action. A repair plan of no links or more than 2,000, links not whole, repeated, not in the network, or shut, work other
  than `patch`, `resurface`, `concrete`; a streets plan of a zone that does not exist or has no people, or work other
  than `patch`, `resurface`; a plan with nothing to do (every stretch fair already for a patch, good or concrete for
  resurfacing, concrete for concrete), or a stretch or zone being mended already; a `makeGood` not true or false.

The action recorded is a clean copy: fields that rode along with it (on the action, the plan or a place) are dropped.

## A month, in order

`endMonth(game, city, result)`:

1. **The books** of the month, from its traffic: income, running, upkeep, loans, and each project's payment for the
   month. Then (slice 6) **the roads**: they wear by the month's traffic and rain, patches wear off, utilities dig,
   works hand their roads back, mending finishes, the upkeep budget mends the worst, and the standing order patches
   (its cost a line of the books). Money moves by exactly the books' sum.
2. **Loans:** each loan taken before this month pays its interest and the rest of its payment off what is owed; the
   last payment clears it. Loans repaid early this month are removed.
3. **The score's traffic measures** (slice 7): access, commute, clean travel, road deaths for each ten million people,
   and fairness, from the month's result and the people it was worked out for; in the first month, each zone's
   figures, against which approval judges how lives changed.
4. **Growth** (below): people grow, and the part the tax rate played is noted for the reasons; the growth is shared
   among the zones (slice 5).
5. **Openings:** a metro line's first stretch at half its months; work whose last month this was opens, and the
   season's lines open as the season has them. All are in the city from next month.
6. **Approval** moves in every zone (below), and the city's is their average by people. In an election month, the
   election (slice 7). In December, the yearly review, and the value of property for next year.
7. **Money below nothing:** the count of months running below nothing goes up, or back to 0.
8. **The month moves on.** Three months below nothing is a default; two warnings running at the review, the player
   is replaced; the end of month 119 (December 2035) finishes the game. The count of major works goes back to 0.
9. **The score** (slice 7): the month's money and approval join its traffic measures in `game.measured`; the score is
   worked out again (with the penalty, if the game has just ended early); at each year's end, and at the end, its
   total is kept in `game.scores`. The events in force in the month now beginning go into `game.events`.
10. **The report**, kept in the game: with the score now and before, the events that began or ended, and (slice 7) in
   December a warning about the roads if they are falling.

## The score (slice 7; PRD section 6; `src/rules/score.ts`, `src/rules/reasons.ts`)

The player's words: "players should be awarded points on governance", and "goal is to get the max number of score
after 2036". The score is what the game is for.

### The seven measures

Each month the rules keep the month's figure for each measure as a whole number (`Game.measured`, an optional field
added to `Game`, type `Measured`). The score of a year takes each measure's **average over its twelve months** (PRD
SCORE-11; approval over thirty-six, as SCORE-7 has it, so that a player cannot buy the last year's approval), turns it
into **points from 0 to 100 against the season's marks**, and weighs them. Slice 8: the game's score weighs the ten
years' scores, later years counting more (see "The score of ten years"); SCORE-11's last twelve months are now the last
year's share.

| Measure | Weight | The month's figure, as kept | Shown as | Marks, first season: 0 points / 100 points |
|---|---|---|---|---|
| Access (SCORE-1) | 25% | the model's `access`: thousandths of the city's jobs the average resident reaches within 45 minutes | % of jobs | 9.5% / 16.0% |
| Commute (SCORE-2) | 20% | the model's `commute`: seconds door to door, over travellers | minutes | 66.8 / 46.6 |
| Clean travel (SCORE-3) | 15% | thousandths of trips by bus, metro, rail, cycle or on foot | % of trips | 49.0% / 57.0% |
| Safety (SCORE-4) | 10% | the model's road deaths a year for each ten million people then | deaths a year a lakh people | 9.85 / 5.65 |
| Fairness (SCORE-5) | 10% | thousandths: the worst-served fifth's access and commute against the average, the two averaged (below) | % | 35.5% / 54.5% |
| Money (SCORE-6) | 10% | lakh: money, less what is owed, less what is still to pay on work under way | ₹ crore | −₹4,000 crore / ₹3,000 crore |
| Approval (SCORE-7) | 10% | tenths: the city's approval at the month's end | of 100 | 40.5 / 76.5 |

**Whole numbers throughout.** An average is the sum of whole figures over a whole count, rounded half up (`div`,
`Math.round(a / b)`); points are kept in tenths, `max(0, min(1000, round((average − none) × 1000 ÷ (full − none))))`,
which works either way round (a commute scores more as it falls); the total is `round(Σ points × weight ÷ 1000)`, 0 to
1,000. Every product stays below 2^53. `tests/score.test.ts` checks the averages, the points, the total, and that a game
played again from its list of actions has the same score to the last figure.

**Fairness.** For access: the zones in order of their access, worst first (ties by id), taken until they hold a fifth
of the city's **people** (the last in part), their access over their people against **the city's average as it
starts** (January 2026's, by the people then: `fairnessReference`, from `game.firstZones`). For the commute the same,
longest first, the city's starting average against the fifth's. The two in thousandths, averaged: 1000 would be a city
where the worst-served fifth is as well served as the average was at the start. Counted five times over so that the
fifth is exact in whole numbers. January 2026: 44.8%. B found the worst fifth real, not an effect of grouping wards (80%
of its people are in the same zones with no grouping), and that a ratio to **this month's** average rewards leaving the
centre alone: a metro line to a ward in the worst fifth raised the city's average more than the fifth's, and the ratio
fell (docs/MODEL.md, slice 7, 4). So the average is held at the start's: only the worst fifth's own reach and commute
move the measure, and levelling the average down gains nothing. **Judgement**, on B's evidence. `worstServed(result,
game, city)` gives the zones in the fifth, for the screen's fairness view.

**Money** counts what the city owes and what it has still to pay on work under way in full (PRD SCORE-12), every
month: ordering a line of ₹1,700 crore takes ₹1,700 crore off money for the score that month; paying for it as it goes
changes nothing; borrowing changes nothing (money in, as much owed). So a player who builds in the last year, or
borrows so that the debt falls due after the game, gains nothing by it: `last-year` borrows to the limit in 2034 and
spends it, and scores nothing on money. Money scores no more for being above ₹3,000 crore, half as much again as the
city started with: hoarding is not governance, and the city as it starts (₹2,000 crore, nothing owed) scores 85, not
100, so that a careful player can do a little better. A city that defaulted scores nothing on money.

**An early end** (PRD MONEY-5, APP-4): a game ended by default or by the player being replaced keeps the score as it
stood, **less half** (`Score.penalty`, an optional field added to `Score`, says so in words). **Judgement**: an
early end must never be worth more than finishing, even if it comes at a moment when the score is high. Works still
under way at the end open nothing (SCORE-12): only what is open counts, and their debt is in money.

**The city as it starts.** Before the first month has been worked out, the score is that of the city as it starts:
the season publishes its figures with the marks (`Season.opening`, an optional field added to `Season`: January 2026
as the model has it, ₹2,000 crore and approval 55; `tools/playthrough.ts opening` prints them), and `rules.start` sets
`game.score` from them. So the player sees the score from the first moment, and a replay has it too. It is set again
with the marks whenever the model changes. From the first month on, the averages are over the months there are, up to
twelve. Without `opening` (the tests' season) the score is nought until then.

### The score of ten years (slice 8; `scoreOf`, `yearWeights`, `Season.years`)

**Why.** With only the last twelve months counting (PRD SCORE-11 as first written), the way to win a leaderboard was to
sit on the money for seven years and spend it all on what shows at once: `late-spender` scored 647, third of all, above
every plan that built throughout but `good-governance` and `everything` and `lean-start`. The person who conceived the
game wants to reward governing well for ten years. This is the coordinator's recommendation, not yet confirmed by the
player; the rule before is kept within reach (below).

**The rule.** Each year is scored by the rule of a year: each measure's average over its twelve months (approval over
the thirty-six to its December, as SCORE-7 has it), its points against the marks, weighed as before. A year counts
once its December has been worked out, **as that December stood**; the year in hand counts as it stands now (the last
twelve months). The game's score weighs the years reached by the season's weights (`Season.years`, ten whole numbers
in thousandths, 2026 first, summing to 1,000), **the weights of the years not yet reached left out and the rest scaled
up to the whole**. So the score shown during the game is the final score so far, by the same rule: it moves month by
month as the averages move, and in December 2035 it is the final score without a jump. Each measure's points are the
years' points so weighed (`div(Σ weight × points, Σ weight)`, tenths), and the total is their weighted sum as before;
within a point of the years' own totals weighed. `Score.years` (optional, added) gives each year reached with its own
total, its weight and whether it is done, for the score page. `Measure.value` stays the figure now (the last twelve
months): what the city is like, beside points that say how it has been run.

**The first season's weights**: 30, 38, 47, 59, 73, 92, 114, 143, 179, 225 thousandths: each year a quarter more than
the one before, 3% for 2026 to 22.5% for 2035. **In one sentence, for the score page:** "Your score is the average of
your years so far, each year scored on its own twelve months, and each counting a quarter more than the year before:
2026 counts 3% of the final score, 2035 counts 22%." **Judgement.** The coordinator suggested about 3% rising to about
30%; with ten weights summing to 1,000, a last weight of 30% forces the first five years to about 3% each, and on the
scripted players (below) the late spender then scores above `generous` (589 against 573). A steady quarter a year puts
it below every plan that governs well throughout, and is a rule a player can say back.

**An early end** (default, or replaced): the years reached, the year in hand as it ended; money scores nothing in that
last year on a default; then half is lost, as before.

**The rule before, within reach:** a season with `years: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1000]` scores the last year
alone, exactly as slice 7 did (while every year reached weighs nothing, the year in hand is the score).
`tests/score-years.test.ts` checks both, and that a game that governs well throughout beats one that sits for seven
years and then does the same, that the score as the game goes does not jump, and that a replay has the same score.

**What it does to the board** (the scripted players, below): every score moves toward the middle, since the early
years of every game are alike (the city as it starts, and the Pink and Blue lines opening in 2026 to 2028 lift
everyone to about 600): doing nothing 308 → 423, the best 908 → 871. The order changes where it should: the late
spender 647 → 576 (sixth), `lean-start` (the roads left bare for three years) 710 → 588, and the plans that governed
steadily but modestly rise (`lanes-everywhere` 541 → 609, `generous` 496 → 596). **What it does not do:** the late
spender still scores above `metro` (483), `both` (502), `buses` (464) and `keep-roads` (492), which build throughout.
Its city in 2035 is better than theirs by the model's own figures (access 65 points against `metro`'s 31, commute 72
against 46): spending on buses, lanes, junctions and roads in the last three years does more for the measures in the
model than a metro programme does in ten. That is the model's view of what works, not a fault of the weighing; with
every year weighed alike it would still be so (562 against 508 and 540).

While a season is open the board ranks games in progress by their score now (MP-11): a game in 2027 or 2028, when every
city is lifted by the lines opening, shows about 600 and so stands above a finished game of a middling plan. That was
so before (doing nothing stood at 615 in 2028); the board marks each game with the year it has reached.

### The marks (PRD SCORE-10, SCORE-15)

Published in `src/seasons/first.ts` (`Season.marks`, with `Season.opening`) and in the table above. **How they are
set**, and set again whenever the model changes: `npx vite-node tools/playthrough.ts marks` plays every plan (about 25
minutes; `--quick` plays only doing nothing and the ten plans a person would call governing: `good-governance`,
`everything`, `lean-start`, `generous`, `lanes-everywhere`, `keep-roads`, `both`, `metro`, `buses`, `safe-streets`)
and prints the marks, the opening figures, and every plan's score under them. On each measure but money:

- the city as it starts scores 40 and the best of those ten plans 95;
- where that would leave doing nothing under 10 (the city as it starts is about as good as the best plan reaches by
  2035), doing nothing scores 15 and the best 90 instead: access, clean travel and fairness, on the final model;
- where the plans hardly differ (the best within ten times the noise of the start), ten times the noise, the start at 40;
- rounded to 5 units. Money is fixed: nothing at −₹4,000 crore, 100 at ₹3,000 crore, so that the city as it starts
  (₹2,000 crore, nothing owed) scores 85, leaving a little room above, and hoarding scores nothing more.

Put the printed `marks` and `opening` into the season, and look at the order. **Judgement**, all of it.

**What they give on the final model:** the city as it starts **547** (access 64, commute 40, clean travel 60, safety
40, fairness 48, money 85, approval 40); the best plan, `good-governance`, 908 (92, 95, 86, 95, 91, 78, 95); doing
nothing 308. The start is not near 400, and cannot be without harm: in the model the city left alone gets worse as it
grows on every measure but road deaths for each person (access 13.7% → 10.6%, clean travel 53.8% → 50.4%, fairness
44.8% → 38.2%), while the best plan ends only a little above where the city starts (access 15.5%). Marks with the city
as it starts at 40 on access, clean travel and fairness would leave doing nothing, and most plans, at nought on a
quarter and more of the score, where it could not tell them apart; and money at 40 would reward hoarding. So those
three start at 48 to 64, and money at 85; the others at 40.

Access and clean travel have narrow ranges: B's noise (0.2 points of access, 0.1 of clean travel) is 3 of access's
points (under 1 of the total) and 1 of clean travel's.

### Reasons (PRD SCORE-13)

Each report carries `score: { now, before }` (the score at the span's end and its start), each measure with up to
three causes, largest first:

- **Money:** the month's books (a loan's interest, not its repayment, which leaves the city no poorer; not the
  payments on work, which were counted when it was ordered), and each work ordered, whose whole cost counts at once:
  "−₹1,030 crore: ordering the Navy Line". Over a span, added up by cause.
- **Approval:** what pushed it, as before, over the span.
- **Access, commute, clean travel, safety, fairness:** at the end of a skip (`explain`, `src/rules/report.ts`), one run
  of the model for each thing that changed (a fare, growth, a line opening, the works, the vehicles, the bus lanes, a
  road, the junctions, footpaths, speed limits, one-way streets, the roads mended, and, slice 7, each event that
  began or ended), and one run gives the change in all five at once. Fairness is worked out from each run's zones.
- **"No measurable change"** (a single cause, `amount: 0`) where the figure moved by less than the model's noise over
  the month, or over the whole span of a skip (the report's `measured` keeps the figures of the month before the span
  and of its last); a cause smaller than the noise is left out; where the span moved a measure but no one cause is
  larger than the noise, "Many small changes, none large enough to name". The noise, in `NOISE` (`src/rules/params.ts`),
  is B's (fifty small changes, one at a time, docs/MODEL.md, slice 7, 3): 0.2 minutes of commute, 0.2 points of
  access, 0.1 points of clean travel (B: 0.05; the figure is kept in whole thousandths), 3 deaths a year (0.02 a lakh
  people); fairness 0.3 points (judgement: B did not measure it).

The game keeps the score as the month's end leaves it, with money's and approval's causes; the model's causes are
the report's alone, so a game played with skips and one played month by month are the same game.

### Why is this bad? (PRD SCORE-14; `src/rules/why.ts`)

- `whyZone(game, city, zone)`: the zone's commute, reach and road deaths against the city's, whether it is in the
  worst-served fifth, its approval against the city's; and the three roads its people lose the most time on in the
  morning (the model's `delayByRoad`, about 50 to 100 ms), in hours a weekday, with their links for the map.
- `whyRoad(game, city, link)`: its traffic at the busier peak against what it holds, its speed against its speed when
  clear, its surface, lanes shut for works or given to buses, a limit, a flood; and the seconds a vehicle takes over
  it, in parts: from more traffic than it holds, from its surface, at its signals, largest first.

Each is `{ title, lines, causes, links }` (type `Why`), from last month's traffic; nothing is changed.

### For a forecast (PRD UI-5)

`scoreWith(game, city, result, people?)`: the score the game would have if the traffic of `result` held for a year,
money and approval as they stand. The screen takes it for the month with a plan and without and shows the difference,
marked as a forecast.

### Ways to score well without governing well

The player's own warning: "Players will look for the plan that scores, not the plan that governs." Each temptation
known from earlier slices, and what the score makes of it (the scripted players, below):

| Temptation | Plan | What the score makes of it |
|---|---|---|
| Raise fares and tax, and hoard (once six times richer than doing nothing) | `dear-fares`, `steady`, `keep-up`, `hoard` | Money scores nothing above ₹3,000 crore; dear fares cost clean travel and approval, a dear tax approval. All end below doing nothing (292, 262, 273); `hoard` (tax and every fare at the most) is replaced in 2027 (244) |
| Shrink the city by taxing it (once gave the best commute) | `high-tax`, `hoard` | Every measure but money is for each person, so a smaller city scores better: on B's final model `high-tax` scored 367 against 308 for doing nothing. Growth now answers tax and fares a quarter as strongly (see "Growth"): `high-tax` is replaced in 2034 (169) |
| Bus lanes everywhere (cheap and strong, and they bankrupt the city) | `lanes-everywhere` | Lanes along all ten routes, fares and tax kept up with costs: not bankrupt (₹995 crore at the end), far above doing nothing on commute and clean travel (541), disliked (41). Judged good governance of one kind; see "What it gets wrong" |
| Speed limits of 30 everywhere | `slow-everywhere` | Safety at 100, but the longest commute of any plan (65.9 minutes) and approval at nought: 229 |
| Neglect the roads to pay for metro | `neglect`, `lean-start` | `neglect` is replaced in 2033 (196); `lean-start` (bare for three years) ends 75 below `everything` |
| Build only in the last year, so that the debt falls after the game | `last-year` | What is owed counts in full (SCORE-12): money scores nothing, and borrowing to the limit in 2034 ends in default in October 2035: 285 |
| Spend late: nothing for seven years, then what shows quickly | `late-spender` | Slice 7: **647, third of all**: the score saw the last year, not the ten. Slice 8: **576, sixth**, below every plan that governs well throughout; still above plans that build modestly throughout (see "The score of ten years") |
| Order works and cancel them | (none scripted) | Ordering counts the whole cost against money at once; cancelling gives back half of what was paid: nothing is gained |
| End the game by default or by being replaced while the score is high | `good-governance` before its finances were set right defaulted at 790 in 2033 | Half the score is lost: 369 |
| Cheap fares, no charges, roads before transit, borrowing | `populist` | The best liked of all (76), and bankrupt in November 2031: 237 |

## Events (slice 7; PRD section 9; `src/rules/events.ts`)

What happens to the city that the player did not order. The season's events follow from its seed and its dates alone
(`seasonEvents(season, city)`), the same for every player of the season; a strike follows the player's own actions.
Nothing an event does is kept in the game (but the grant an election sets): each month's model is given what the events
in force that month do, so when an event ends, exactly what it did is undone (PRD EVT-12).

| Kind | When | What it does | Source or judgement |
|---|---|---|---|
| Monsoon (EVT-1) | June to September, each year | announced with the year's rain; its wear and floods are the roads' (slice 6) | as slice 6 |
| A line opens (EVT-6) | the season's openings | announced; the rules open it (slice 4) | as slice 4 |
| The festival season (EVT-4) | each October: Dasara and Deepavali | 6% more trips for the month (`CityState.surge` 1060) | **judgement** |
| A big match (EVT-4) | once, by the seed: a cricket final at Chinnaswamy Stadium | 3% more trips for the month (1030), marked at the stadium | **judgement** |
| Cave-in or burst main (EVT-2) | six in the ten years, by the seed | a stretch of a named main road (not an expressway, at least 600 m, away from the map's edge) shut both ways for one to three months (`CityState.shut`, 1000), marked on the map | **judgement** |
| New employer (EVT-3) | four, by the seed | 10,000 to 30,000 jobs added for good to one of the 80 zones with the most jobs, marked at the zone | **judgement** |
| Fuel (EVT-5) | three, by the seed | petrol and diesel 20% dearer for six months, 10% cheaper for four, 15% dearer for five (`prices.fuel`) | **judgement** |
| Election (EVT-7) | October 2027 and October 2032 (`Season.elections`, an optional field added to `Season`) | at the end of the month, approval under 40 cuts the state's grant by a fifth until the next election; over 60 raises it by a fifth (`Game.grantShare`, an optional field) | **judgement**; no election has been held under the Greater Bengaluru Authority, so the season sets them |
| Strike (EVT-8) | the month after one in which the bus or metro fare ends a fifth or more above where it began | the city's buses (`CityState.busService`, 1000 less a thirtieth for each day) or the Purple Line (its trains for the share of the month) stopped for three to seven days, by the seed | **judgement** |

- **At most three at once, none in the first three months (EVT-11).** The season's are placed with at most two in force
  in any month, a fixed one (monsoon, opening, election, festival season) first, the rest moved a month later at a time
  until they fit; a strike may make a third. A strike is the player's own doing, so it may come in the first months.
  Two strikes in the same month: the second waits a month.
- **Announced (EVT-10).** The report at the end of a month tells of the events that begin with the next, in the news
  (title and text), lists them in `report.events` with those that ended in the span, and puts the cave-ins, employers,
  fuel, strikes and elections in `needs`, so that a skip stops there (PRD TIME-4). The monsoon, openings and festivals
  are only news: they are the weather of the game. An event of more than a month says when it is over ("The road is
  open again: Doddaballapur Road near Yelahanka.", "The price of fuel is back to what it was."). `game.events` lists
  those in force in the month the player is in. Each `GameEvent` has its place (`at`), links and zones, and (a
  strike) `lines`, an optional field added.
- **What they do** reaches the model through `Setup.events` (an optional field added to `Setup`, type `EventEffect`):
  a report puts each back like any other change, so a cause may be "−0.4 min from the burst main under Hosur Road
  near Silk Board". A new employer's jobs stay in `Setup.events` for good.
- **Names.** No real party or person is named. Employers are "a technology company", "a bank", "a hospital group", "a
  logistics firm"; a road is named as mapped, with the known place it is near.

The first season (seed 1): the monsoons as slice 6; the Pink and Blue lines' five openings; the festival season each
October; a cricket final in May 2028; cave-ins on Kakolu Road near Yelahanka (February 2030), Doddaballapur Road near
Yelahanka (August 2030), Shettigere Main Road near the airport (April to June 2031), Varthur Main Road near Whitefield
(November 2031 to January 2032), 80 Feet Road near Begur (March to April 2035) and Dr. Rajkumar Road near Rajajinagar
(November to December 2035); employers in Chagalatti (August 2027, 11,000 jobs), Kaveri Nagara (January 2033, 20,000),
Dodda Nekkundi near Mahadevapura (May 2033, 15,000) and Chickpete (April 2035, 14,000); fuel 15% dearer from November
2028 to March 2029, 10% cheaper from July to October 2031, 20% dearer from May to October 2035; elections in October
2027 and October 2032. `npx vite-node` a script over `seasonEvents` lists them.

The model answers each (B, docs/MODEL.md, slice 7, 5): a surge of 1100 lengthens the commute 3.6 minutes for the
month; the city's buses at 750 add 3.9 minutes; the Purple Line with no trains 6.6; fuel moves driving with an
elasticity of about −0.2; a cave-in on Hosur Road at Madiwala adds 0.8 minutes. A strike of five days is 833, about 2.6
minutes for the month.

## Building (PRD section 7.2)

### Planning: `rules.quote(game, city, plan)` (`src/rules/plan.ts`)

A plan is kept as the player gave it: the places tapped, or stations that are there. `quote` snaps and routes it,
the same way every time, and says what it would cost and do, without changing anything.

**Metro line** (`{ kind: 'metro', stops }`):

- *Snapping (PRD UI-7b).* A place within 300 m of a metro station (open, being built, or the player's) is that
  station: the line joins it. Otherwise the nearest junction of the routing network, unless a straight main road
  runs 150 m nearer (a link at most a tenth longer than the line between its ends), in which case the point on that
  road. The tap moves there, however far, up to 2 km, and the quote shows where it went, so the player sees the
  station move to the road and can move it again. Only a place with no main road within 2 km is refused ("There is
  no main road within 2 km of that place."): of 120 taps on a grid over the whole map, 8 (all at its edges).
  Junctions and roads are never in water, so a station is never put in a lake: a tap on a lake moves to the road.
- `rules.snap(game, city, kind, stop)` gives where a lone first tap would go, as the station or stop it would be
  (name, place, the station it joins), or why not, for the screen to show before there is a line to quote. Each of
  a quote's stations carries `stop`, the index of the plan's place it came from (absent for stations put in
  between).
- *The line (PRD BLD-1).* Between each two places, the shortest way along the roads (either way along a one-way road:
  a viaduct does not care) if it is at most 35% longer than a straight line, plus 300 m: a viaduct along the road, as
  Namma Metro builds them. Otherwise straight: a tunnel, at the tunnel's price.
- *Stations.* The places tapped, and more put in between where they are far apart: about every 1.3 km, at the junction
  along the way nearest each even spacing (in a tunnel, the junction within 600 m of it). A station put in between
  within 300 m of a metro station that is there becomes that station, an interchange. No two stations closer than
  600 m: two places tapped closer are refused; a station put in between that would be closer is left out. A line
  through the same station twice is refused. Between 1.2 and 40 km.
- *Names.* A station that is there keeps its name. A new one takes the name of the nearest zone, in English and
  Kannada; if that is taken among the metro's stations, the next nearest zone within 1.5 km whose name is free; else
  the nearest's with North, South, East or West (ಉತ್ತರ, ದಕ್ಷಿಣ, ಪೂರ್ವ, ಪಶ್ಚಿಮ) by where it lies from that zone's centre; else a
  number. The screen's list of places (`src/map/places.ts`) is not used: the rules run on a server without it.
- *Roads disrupted:* every routing link along the viaduct, both ways (and the road a station stands on part-way).
  Tunnels disrupt none.

**Bus route** (`{ kind: 'busRoute', stops, buses }`): each place snaps to the nearest junction within 2 km where a
bus may stop (on a road that is not a motorway, and not at the map's edge); a station tapped gives the junction
nearest it, and the stop takes the station's name. The route runs from stop to stop by the quickest way at free speed,
laid out by the model's own `busSegments` (`src/sim/bus.ts`), so what is drawn is what runs. The stops are those
tapped; the buses pick up about every kilometre between, as the model has it, and a shelter is paid for at each.
1 to 40 km. A minor action.

**Bus lanes** (`{ kind: 'busLane', links }`): routing links, each with at least two lanes in its direction, none with a
bus lane already or one being made. Major if longer than 5 km in all.

**More suburban trains** (`{ kind: 'railService', line, trains }`): 1 to 6 trains at a time on an open suburban line,
at most 12 more on a line. Major.

### Costs and times (PRD BLD-1 to BLD-4; `src/rules/params.ts`)

All at 2026 prices, and rising 4% each January with the rest of the costs (a plan quoted in 2029 costs 12.5% more).

| What | Game value | In proportion to | Source (date) |
|---|---|---|---|
| Metro viaduct | ₹380 crore a km real; the player pays **30%**: ₹114 crore a km | Phase 3: 44.65 km elevated, ₹15,611 crore (₹350 crore a km), raised 4% a year from 2024 | Union Cabinet approval, 16 August 2024 (The Hindu; Wikipedia, Namma Metro) |
| Metro tunnel | ₹1,350 crore a km real; the player pays ₹405 crore a km | Phase 3A: 37.8 km, 14.28 km underground, ₹25,999 crore; less the elevated part at Phase 3's rate, about ₹1,250 crore a km underground, raised to 2026 | Revised DPR, New Indian Express 14 July 2026 |
| Stations, trains, depot | in the price a km, as the phases' costs include them | | |
| Months to build a metro line | slice 5: 20, and a month more for each 830 m of viaduct or 400 m of tunnel; 24 to 40 (slice 4: 30, 36 to 60); the first stretch opens at half | PRD BLD-1 (3–5 years); Namma Metro's phases have taken 5–10 years. Shortened so that lines built in the first half of the term count for most of it (B, slice 5: a line's value does not fade over the years, MG Road to Sarjapura saving 1.75 minutes opened in 2026 and 1.92 in 2035) | **judgement** |
| A metro train, bought later | ₹55 crore real, the player's 30%: ₹16.5 crore | CRRC's 216 coaches for ₹1,578 crore (₹7.3 crore a coach), 2019, raised to 2026 | reported contract, 2019 |
| Trains a new line runs | enough for a train every 5 minutes at the peak | the model's default headway for a new line | |
| Running a metro line | train-km × ₹950, trains each way a day = 18 hours at 1.5 × the peak headway | slice 3's rate (BMRCL's fares covering running about a fifth over, 2024-25) | |
| A bus | ₹50 lakh | an 11 m diesel bus, about ₹40–50 lakh | **judgement**, from dealers' prices, 2026 |
| A bus stop and shelter | ₹5 lakh, one a km | | **judgement** |
| Running a bus | 220 km a day × ₹80 a km | BMTC: 12.39 lakh km a day over about 5,600 schedules; ₹76 a km in 2024-25 | BMTC, 5 September 2026; Annual Report 2024-25 |
| Months to start a bus route | 1 | PRD BLD-3 (1–2 months) | |
| Bus lane | ₹1.7 crore a km of one direction | The city's plan for 83 km more: ₹280 crore (₹3.4 crore a km both ways, with bays and signals); the first ORR lane, paint and bollards, ₹14.3 crore for 17 km | Bangalore Mirror, February 2024; The Hindu, 2022 |
| Keeping a bus lane clear | ₹1 lakh a km a month | | **judgement** |
| Months to make bus lanes | 1, or 2 over 10 km | PRD BLD-4 (1–3 months) | |
| More suburban trains | ₹150 crore of works at stations and signals, and ₹40 crore a train (the city's share) | K-RIDE: 148 km of new line for ₹15,767 crore (₹106 crore a km) | K-RIDE project page; The South First |
| Running them | 6 trips each way a day for each train added, ₹300 a train-km | slice 3's rate for the city's share | **judgement** |
| Months for more trains | 18 | PRD BLD-2 (1–3 years) | **judgement** |

The player's share of a metro line (30%) is **judgement**: Namma Metro is paid for by the state, the centre and loans
through them, and the city itself pays little; in the game the player stands for the city and the state together, and
the share is set so that a careful player affords three or four lines of 15 to 20 km in ten years, not ten (below).

### Paying, works, opening (`src/rules/build.ts`)

- **Paid as the work goes.** A project's cost is spread evenly over its months, in whole lakh that add up to the cost
  exactly, one payment at each month's end from the month it was ordered. A metro line ordered in January 2026 that
  takes 49 months pays 49 times and opens in February 2030.
- **The city refuses work it cannot pay for (PRD MONEY-4):** a project is refused if what it and all the work under
  way fall due over the next twelve months is more than the money in hand and what may still be borrowed ("The work
  in hand and this would cost ₹1,300 crore over the next twelve months. The city has ₹400 crore, and can borrow ₹0
  crore more."). So a first line of ₹1,700 crore (₹420 crore a year) can be ordered in the first month from the
  ₹2,000 crore in hand, and a second beside it; a fifth at once cannot.
- **Major actions** (PRD section 7): a metro line, more suburban trains, and bus lanes over 5 km in all. Three a month.
  A bus route, bus lanes of 5 km or less, and changing vehicles are minor and unlimited.
- **Works (PRD BLD-1):** the routing links beneath a metro viaduct lose a lane for the first half of the work (half the
  months, rounded down), given to the model as `works`. From the month ordered.
- **Cancelling:** stops the work and its payments; half of what was paid comes back (**judgement**); the lanes come
  back at once.
- **Two stretches (slice 5).** A metro line of four stations or more opens its first half of stations (rounded up),
  the path cut at the last of them, at the end of half its months, when the works on the roads beneath end; the rest
  at the end. So a line ordered in January 2026 that takes 49 months carries riders from February 2028, not 2030.
  News: "The Navy Line opens its first stretch, from Baiyappanahalli to Jagadish Nagar, 4 stations. The rest opens in
  June 2029."; approval +2 then, +4 at the end. Its trains are those for the stretch's length, and at the full opening
  those for the whole (never fewer than the player has given it). Cancelled after the first stretch, the stretch stays
  open. Namma Metro opens its lines in reaches this way; a line that opens in year five counted for five years in
  slice 4, and now counts from year three.
- **Opening:** at the end of the project's last month its line, new stations (numbered after every station there is),
  bus lanes or trains go into what is built, and are in the model's transit from the next month. News says so, and
  so does "needs", so that a skip stops there (PRD TIME-4). The player's metro lines are named and coloured in order
  as the screen names them (its list, `src/game/build.ts`): Navy, Brown, Olive, Slate, Mauve, Grey Line; bus routes
  "Bus route 1", "Bus route 2".
  Line ids are `player-metro-1`, `player-bus-1` and so on, in the order ordered.

### Running (`vehicles`, `close`)

- Buses on a route: 1 to 60, at ₹50 lakh each added. Trains on a metro line, the player's or the city's own (the
  Purple, Green, Yellow, and the season's once open): at least 2, at most one every 2 minutes at the peak, at ₹16.5
  crore each added. Nothing comes back for vehicles taken away. On a suburban line only the trains the player added
  may be taken away; more are ordered as a major work.
- `built.vehicles` holds, by line id, the buses or trains on each of the player's lines, and **the change** on a city
  line (+3 on the Purple Line; the number of trains added on a suburban line). The model is given the total:
  the player's number, or the model's own default for the line (`defaultVehicles` in `src/sim/transit.ts`) plus the
  change.
- Running by line in the books: each metro line (trains each way a day from its trains: 720 × trains ÷ the minutes
  of a round trip, both turns included), each bus route (its buses × 220 km × ₹80), the bus lanes, the suburban
  trains with those added. A city metro line the player has not touched still runs more trains when full, as in
  slice 3.
- `close` takes one of the player's lines out of service at once: its stations go unless another of the player's
  lines uses them. Nothing is paid back.

### Suggested corridors: `rules.suggest(game, city, kind)` (PRD UI-7d; `src/rules/suggest.ts`)

From the last month's traffic (before the first month, from what the roads can carry): each link's vehicles an hour
at the two peaks, both ways, weighed by how many live and work nearby (the nearest zone's people and jobs a km², as a
share of 30,000, at most whole). From the busiest links not served already (within 1.2 km of a metro station, open,
being built, the player's or ordered; for buses, along the player's routes), a corridor grows both ways along the
busiest road that carries on within about 60 degrees, until it is 18 km (bus: 10 km), the traffic falls under 15% of
where it started, or it reaches a metro station, which it joins. It is offered as the places a player would tap: its
ends and a place about every 4 km (bus: 3 km). Every one must pass `quote`. Of up to 60 such corridors, five are
offered, each not running mostly where a better one runs.

**Best first.** A bus route by the traffic along it. A metro line is harder to judge without the model, which the
rules cannot run. Measured in the model on 24 corridors (28 September 2026), riders followed above all how a line
joins the network: lines joining two lines at two stations carried 110,000 to 200,000 a weekday; lines joining none
under 40,000, however many lived along them. So a metro corridor's score is the people and twice the jobs newly
within 1.2 km of a station, times one more than the stations it shares, four times over if it joins two lines at two
places, over the square root of its cost. It is a guide, not a forecast: on the model as it stood at the end, of five
suggestions the first carried 154,000 a weekday (Baiyappanahalli to Marathahalli, covering its running), the third
and fourth 88,000 and 54,000, and two 20,000 to 24,000 (see "What it gets wrong"). The screen's forecast, the
model's month with the line open, is what the player should trust.

**Checked with the model (slice 5).** `rules.suggest(game, city, 'metro', simulate)` (an optional fourth parameter
added to `Rules.suggest`) takes the eight best corridors by that guess, opens each at once in this month's city in a run
of the model, and ranks them by the riders it would carry a weekday over the square root of its cost; the rest follow
by the guess. Eight runs: about 1.8 s on the real city in `vite-node`. Without `simulate` it is as before. The
scripted metro builders use it: in slice 4 their four lines carried 20,000 to 190,000 a weekday, two of them under
25,000; checked, the five lines of `metro` carried 67,000 to 247,000 a weekday at the end (Navy 247,000, Olive 205,000,
Mauve 153,000, Brown 135,000, Slate 67,000), and `metro` ended 2.1 minutes ahead of doing nothing, against 1.0
before. The screen may pass the worker's model, or run the check in the worker.

### The season's lines (PRD EVT-6; `src/seasons/first.ts`)

The Pink and Blue lines are in the data as `building`. The season opens them in phases: from its month, the first
`stations` stations of the line are open, the path cut at the last of them. Each opening is news ("The Pink Line opens
its first stretch, from Kalena Agrahara to Tavarekere. The city pays for running it.") and raises approval by 3
points; the city pays its running and takes its fares from then. Another season may set them later (PRD MP-4).

| Phase | Stations | Opens (game) | Published target | Source |
|---|---|---|---|---|
| Pink, Kalena Agrahara to Tavarekere (elevated, 7.5 km) | 6 | October 2026 (month 9) | September 2026, not opened by 28 September | Metro Rail News, 24 August 2026; Moneycontrol, 2 September 2026 |
| Pink, on to Nagawara (underground, 13.75 km) | 18 | March 2027 (14) | March 2027 | Metro Rail News, 24 August 2026 |
| Blue, Central Silk Board to KR Puram | 13 | January 2027 (12) | trials from October 2026; Silk Board end "December or January" | same |
| Blue, on to Nagawara | 19 | July 2027 (18) | mid-2027 | same |
| Blue, on to the airport | 29 | March 2028 (26) | the whole line, March 2028 (Hebbal to the airport "September or October 2027") | same |

All from the revised timelines the Bengaluru Development Minister gave after inspecting the Pink Line on 22–23 August
2026. Game values: the targets have slipped before (the Pink Line's elevated stretch was due in May, then August).

## Roads and policy (slice 5; `src/rules/roads.ts`)

### The network the model is given (`networkOf`)

`rules.state` gives the model `CityState.roads`: the city's routing network with what the player has built and set on
it, made from `built` in a fixed order, and the same object for the same roads (the last eight kept), so that neither
the model nor planning rebuilds its indexes each month.

1. **New roads**, in the order they opened: for each stretch between two junctions of a road, a link each way,
   **appended after the city's links**. No node is added: a road joins the network only at junctions that are there
   already. So no id the game has kept (bus lanes, one-way streets, works, the drawn stretches of the city's links)
   ever moves, and nothing that refers to a link has to follow it. The cost of this choice: a place tapped part-way
   along a road snaps to the nearer junction (the median link is 480 m, so at most a couple of hundred metres), and a
   road on the ground bends to meet a road it crosses at that road's nearer junction. The other way, splitting the
   crossed link, would need the model to honour a shut link and every kept list to follow the halves.
   A new link: on the ground `primary` (one lane: `secondary`), 50 km/h (40), 1,290 car units an hour a lane (900),
   no drawn stretch (the screen draws `built.roads`); a flyover `trunk`, 60 km/h, 1,290 a lane.
2. **Signals** where a road on the ground meets others (every junction along it, its ends included), and where the
   player put them or redesigned: the node is signalled, and every road into it counts one signal more (15 s at light
   traffic in the model).
3. **Junction work**, the strongest at each junction: the roads in carry 10% more with signals, 25% more after a
   redesign (which includes signals); with an overpass, the main road through (the road in with the most capacity,
   and the road out most nearly straight ahead of it, within 60 degrees, both ways) carries 60% more and loses the
   signal at that junction. `node.work` says which, for the model's road deaths (an optional field added to
   `RoutingNode`).
4. **Footpaths** take a little road width: every link in the zone (by the zone whose centre is nearest its middle),
   expressways and flyovers left out, carries 5% less.
5. **One-way streets:** the link left open takes its opposite's lanes and capacity; the opposite is **shut** by
   making it run from its start back to its start. A link that no route can use and that carries nothing, it keeps
   its id and its drawn stretches, and the model takes it as it is (tried: a capacity of 0 gives NaN in the model; a
   speed of 0 works but leaves infinite times about).

`zoneNode` is never changed. Speed limits are not in the network: `CityState.limits` gives, by link id, the limit on
every link of each limited zone that runs faster than it (expressways and flyovers left out). `CityState.footpaths`
lists the zones with footpaths. Upkeep counts the city's lane-km and those the player built, never the lanes a
one-way street took from its shut opposite.

### Planning (`quote`), cost, time and what each does

| Lever | Plan | Places and checks | Cost (2026 prices) | Time | Major | What it does in the network | Its catch |
|---|---|---|---|---|---|---|---|
| Road | `{ kind: 'road', stops, lanes, flyover: false }` | 2 to 10 places, each snapped to the nearest junction within 2 km; straight between them, bending to meet each road it crosses (not an expressway) at that road's nearer junction if within 400 m of the crossing; 300 m to 15 km | ₹12 crore a lane-km of works (lanes both ways), and the land: 3.5 m a lane each way and 7 m more, at ₹20,000 a m² plus ₹8 for each person or job a km² in the zone it passes, at most ₹4 lakh a m² | 12 months and one more a 800 m, at most 24 | yes | New links both ways; signals at every junction it meets | While built, every road at its two ends loses a lane. Signals where it meets roads slow them. It draws traffic, and the jam moves to its ends. Land taken costs approval. Upkeep for good |
| Flyover | the same, `flyover: true` | the same, meeting nothing between its ends; at most 8 km | ₹25 crore a lane-km, no land | 12 months and one more a 300 m, at most 24 | yes | New links both ways, no signals of its own | The same, but for land |
| Signals | `{ kind: 'junction', node, work: 'signal' }` | a junction where three roads or more meet, not at the map's edge, without signals | ₹50 lakh | 1 month | no | 10% more capacity on every road in; a signal more on each | 15 s more at light traffic on every road in |
| Redesign | `work: 'redesign'` | as above, not redesigned before | ₹5 crore | 4 months | no | 25% more capacity on every road in, with signals | as signals |
| Overpass | `work: 'overpass'` | as above, with a main road running straight through | 800 m of four-lane flyover: ₹80 crore | 18 months | yes | 60% more capacity on the main road through, and no signal there | The main road through loses a lane for 18 months; the cross roads gain nothing; the jam moves on |
| Footpaths | `{ kind: 'footpaths', zone }` | a zone with main road, once | ₹1.5 crore a km of footpath, both sides of every main road in the zone (by link-metres) | 2 months and one more a 4 km, at most 6 | no | `CityState.footpaths`; 5% less capacity on its roads | the roads narrow; ₹5 lakh for 10 km a month to keep |
| Speed limit | `{ kind: 'speedLimit', zone, limit }` | 30, 40 or 50 km/h, or `null` to lift; a zone with a road faster than the limit | ₹10 lakh (signs and cameras); lifting is free | at once | no | `CityState.limits` on the zone's links faster than the limit | slower trips, most at night; drivers' approval, for as long as it stands |
| One-way | `{ kind: 'oneWay', link, on }` | not an expressway; a road with its other way open; refused if any junction could then not be reached or left (every node counted both ways from the link's start, before and after) | ₹5 lakh; two-way again free | at once | no | the link takes its opposite's lanes; the opposite is shut | trips the other way go round; a little approval, once |
| Taller building | `{ kind: 'density', zone, on }` | a zone with people whose centre is within 1 km of a metro or suburban station, open, being built, the player's or ordered | nothing; it earns | at once | yes, to allow | none: more of the city's growth goes to the zone (see "Growth by zone"), and the city sells the right to build | a little approval, once; the zone crowds; years to show |

Everything is priced at the month's prices (4% a year from 2026), in whole lakh. The quote gives the junctions a road
meets as its `stations` (named after the nearest zone; `stop` on those tapped), its path, its length, cost, months,
upkeep a month as `running`, the links that lose a lane as `disrupted`, and for a road on the ground `land` (an optional
field added to `Quote`): what of the cost is land. The policies done at once (one-way, speed limits, taller building)
are paid at once and have `months: 0`; they make no project. News for each: "You set a speed limit of 30 km/h on 5.7
km of main road in Bharathi Nagar. It cost ₹0.1 crore."

| Amount | Game value | In proportion to | Source (date) |
|---|---|---|---|
| Road works | ₹12 crore a lane-km | Peripheral Ring Road (now the Bengaluru Business Corridor): ₹27,000 crore for 73 km of eight lanes, ₹20,511 crore of it land; so about ₹11 crore a lane-km of works | Bangalore Mirror, 2026 ("Compensation packages fast track Peripheral Ring Road project"); Facebook post of the project, 2026 |
| Land | ₹20,000 a m² + ₹8 for each person or job a km², at most ₹4 lakh a m²; 3.5 m a lane each way and 7 m of verge | the ring road's compensation, up to ₹15.6 crore an acre (₹38,500 a m²) where some 3,000 live and work a km²; the city's guidance values of ₹1.5 to 4 lakh a m² in its densest parts | reports of the compensation, 2026; the rest **judgement** |
| Flyover | ₹25 crore a lane-km | Ejipura flyover: 2.5 km of four lanes, ₹275 crore estimated (₹27.5 crore a lane-km); Indiranagar elevated corridor: 11.6 km, ₹852 crore of works and ₹448 crore of land and tax (₹18 crore a lane-km of works) | The Hindu, August 2024; NDTV, 24 June 2026 |
| Months for a road or flyover | 12 to 24 | PRD BLD-5 (1 to 2 years); the Ejipura flyover has taken nine | **judgement** |
| Signals | ₹50 lakh | adaptive signals at 110 junctions for ₹56.45 crore (₹51 lakh each); 51 new signalled junctions for ₹7.9 crore (₹15.5 lakh each) | The Hindu, 2025; Bangalore Mirror, January 2024 |
| Redesign | ₹5 crore, 4 months, 25% more capacity | | **judgement** |
| Overpass | 800 m of four lanes at the flyover's rate, 18 months, 60% more capacity along the main road | | **judgement** |
| Footpaths | ₹1.5 crore a km | the city's model footpaths, ₹0.9 to 1.5 crore a km; TenderSURE's whole-street rebuilds, ₹15 crore a km | Deccan Chronicle, 3 June 2016; Times of India, 1 November 2017 |
| Footpaths' months, upkeep, the road width they take (5%) | | | **judgement** |
| Speed limits: ₹10 lakh a zone; one-way: ₹5 lakh | | | **judgement** |
| Building rights | ₹5 lakh for each ten people who come to live in a zone allowed to build taller | Karnataka's premium FAR: 50% of the guidance value of the extra notional site area (Gazette, March 2025); about ₹1.5 lakh a person at 25 m² a person and ₹1 lakh a m², scaled by 0.4 as the game's tax is to the city's | Gazette notification via Meraqi Advisors, 18 March 2025; the scaling **judgement** |
| Upkeep of what is built | as the city's roads, at the upkeep budget's rate for a lane-km (slice 6: ₹1.2 lakh a month at steady; slice 5: ₹1.5 lakh) (PRD UPK-14) | | as slice 3 |

Water: the city's data has no lakes, so a road is not refused through one. A road's places snap to junctions, which
are never in water, but the straight stretch between two may cross a lake on the map. The quote does not say so.

### What each does in the model (28 September 2026, about 19:00, with the model as it then stood)

Opened at once in the city of month 1 (`scratchpad` script, the model's commute 53.4 minutes):

| Built | Commute | Access | Clean travel |
|---|---|---|---|
| Each of the five suggested flyovers (1.3 to 6.6 km, ₹141 to 658 crore) | −0.1 to +0.2 min | +0.1 to +0.3 points | 0 to −0.2 |
| All five | +0.4 min (the jam moves on) | +0.3 | −0.3 |
| Signals at the ten most jammed junctions | +0.1 | +0.2 | −0.1 |
| Redesign of the ten most jammed | −0.1 | +0.3 | −0.1 |
| Overpasses at the ten most jammed | −0.4 | +0.4 | −0.1 |
| Footpaths in the 40 most crowded wards | 0.0 | +0.3 | −0.1 |

Changes of ±0.3 points of access and ±0.1 minute with any change to the network are in part the model's noise: its
routes are found on a first guess sized to the network's capacity, which any change moves (see docs/MODEL.md). The
model's road deaths, footpaths and speed limits were being built while this was measured; see "The scripted players"
for the plans over ten years.

### Suggested roads: `rules.suggest(game, city, 'road')` (`src/rules/suggest.ts`)

From last month's traffic (none before the first month): the vehicle-hours lost at the two peaks on each link that is
not an expressway. From the 40 worst, not within 1.5 km of a road or junction work of the player's: a **flyover** along
the jammed road, grown ahead and behind through the most jammed link on within 30 degrees while it loses at least 30%
as much, to about 3 km (at least 600 m), two lanes each way or the road's three; and a **way round**, where two
junctions 0.8 to 3 km apart within 2.5 km of the jam, lying along it, are more than twice as far apart by road as
straight: a road on the ground, two lanes each way. Best first by the time lost on the jammed stretch; five at most,
each passing `quote`. The parameter of `Rules.suggest` now takes `'road'` (a change to the agreed type). About 15 ms.
On the city of month 1 it offered five flyovers: the Outer Ring Road at Bellandur and at Marathahalli, Tumkur Road at
Goraguntepalya, and Hosur Road towards Attibele and Jigani. Not checked with the model.

## The state of the roads (slice 6; PRD 5.4, 7.3; `src/rules/upkeep.ts`)

The player asked for "a lever of fixing roads/potholes. they slow down the traffic". The rules keep the condition of
every main road and every zone's minor streets, wear it each month, and hand it to the model as `CityState.surface`
and `streets`; the model turns it into speed, capacity, deaths and the cost of running buses (docs/MODEL.md). The
rules never run the model to wear the roads: all of it is whole-number arithmetic on the month's result.

### Condition, and where it is kept

- 0 (broken) to 100 (new). Grades for everyone: **good** 75 and above, **fair** 50 to 74, **poor** 25 to 49, **broken**
  under 25.
- Kept in **thousandths of a point** (100,000 is new), whole numbers, in `game.wear` (an optional field added to
  `Game`, type `Wear`): by routing link the surface itself (`base`), a patch on it that wears off (`patch`, with `left`
  months to go), the month a utility last dug it, the month the player last mended it; by zone the same for its
  streets. A month's wear on a quiet road is a few hundred thousandths: in whole points it would round to nothing.
- `game.condition` (by routing link) and `game.streets` (by zone id) are these in **whole points**, as agreed, for the
  screen and the model. `game.concrete` lists the links laid in concrete; `game.upkeep` the budget; `game.digOnce`;
  `game.patchBelow` the standing order (below).
- Links the player builds join at 100 when they open. `setupOf` puts `surface`, `streets` and `shut` in the month's
  `Setup` (optional fields added), so a report can put them back.

### Where the roads start (PRD ROAD-8)

The same for every player of a season, from its seed, by exact arithmetic (a 32-bit mixing hash, `Math.imul`, no
chance source):

- By class: expressway 70, trunk 58, primary 54, secondary 51, tertiary 50;
- less for lying out of the centre: nothing within 6 km of Vidhana Soudha, up to 14 points at 22 km and beyond;
- 10 less on the tech corridors (the Outer Ring Road, Hosur, Sarjapur, Whitefield, Varthur, Old Madras, Bellary,
  Bannerghatta, ITPL, Thanisandra, Hennur and Old Airport roads, by their mapped names);
- ±12 by named road (so a road is of a piece) and ±8 by stretch (both ways alike), from the seed; within 8 and 92.
- Streets: 52, less out of the centre as above, ±4 a step of the zone's income from the middle, ±10 by zone.

On the first season: main roads 43.9 on average by length, 0.1% good, 29.8% fair, 67.0% poor, 3.2% broken; streets
49.5 (46.2 weighed by people). That is "poor" on the whole, not the "a little under fair" first asked for. **B
calibrated the model to published speeds and counts with the roads exactly as this start has them** (those were
measured on the roads as they are), and the coordinator accepted it: do not move the start by more than a few points
without calibrating the model again (`tools/calibrate.ts`, B's). With it January 2026 has a commute of 57.5 minutes;
the same city with every road and street at 100 has 51.2 (B).

Names of roads: the rules run without the drawn network, so `src/rules/names.ts` (made by `npx vite-node
tools/playthrough.ts names` from `routing.json` and `network.json`) gives each routing link the name with the most
drawn length among its stretches (660 names; 850 of 5,086 links unnamed). It is used only when the network is the one
it was made from (count and total length checked). Links of the same name that meet are one road; a name used for
roads that never meet ("80 Feet Road") is told apart by the zone of its longest stretch ("80 Feet Road, Koramangala");
unnamed links are grouped by zone ("Roads in Bellandur"). `namedRoad(game, city, link)` gives the whole of the road a
link is on, both ways, for the screen's "all of Hosur Road that is poor".

### Wear (PRD ROAD-2, UPK-13)

Each month, for each link, in thousandths of a point:

| Part | Amount | Source or judgement |
|---|---|---|
| A dry month | 150, and 100 for each 10,000 of load a lane a day | **judgement**, set so that a bare budget takes the city down about a grade in three years |
| Load | vehicles a weekday, plus 9 more for each heavy one (buses and goods vehicles), from the model's `vehiclesByLink` and `heavyByLink` (heavy is 7.3% of vehicle-km, B) | a road wears with about the fourth power of axle load; 9 is **judgement**, well short of the fourth power, since the heavy vehicles' share is itself uncertain |
| Rain | as much again for each 100 mm in the month | **judgement** |
| Poor drains | the rain's part half as much again, on every low-lying link (the model's list) and a tenth of the rest, by the seed | **judgement**; drains as a lever are for later |
| Condition | below 50, up to half as much again at 0 (potholes grow) | **judgement** |
| After a dig | half as much again for 12 months | **judgement** |
| Concrete | a quarter (PRD UPK-3) | PRD |
| The upkeep budget | the rest times 1 (bare), 0.75 (steady), 0.55 (generous): drains cleared, cracks sealed | **judgement** |

A median main road (about 11,000 vehicles a lane a day, 740 heavy) wears about a third of a point in a dry month and
about 1 point in a September of 200 mm at bare; the busiest about twice that. Streets: 250 a dry month, and up to
300 more in zones of more than 30,000 people and jobs a km², with rain and the budget as above.

With one month of traffic standing for all (so growth left out), from the first season's start: **bare** 43.9 → 22.5
after three years (a grade) and 1.8 by 2035; **steady** 43.9 → 45.6 by 2035 (it holds); **generous** → 56.5 (it slowly
improves). With the city growing, as the scripted players show, steady holds within a point or two.

### Utilities dig (PRD ROAD-2, POL-4)

- Each month each road (both ways alike) is dug up with a chance of 0.8% (a fourth of that for an expressway or a road
  in concrete, whose services run in ducts), by the seed: about 40 links a month, a road about once in ten years. A
  dug road drops to 40 (poor) if it was better, loses any patch, and wears half as fast again for a year. A zone's
  streets are dug with a chance of 3% a month and lose 6 points. **Judgement**: the city's own complaint is exactly
  this ("the road relaid in March and dug up in April"; the Development Minister asked agencies to coordinate to stop
  it, New Indian Express, 19 June 2026), but no count of digs a year was found.
- **Dig once** (`{ kind: 'digOnce', on }`, a major action to bring in, PRD POL-4): utilities dig only in February and
  November, six months' digging at once, and put every road back as it was: no drop, no scar. Its costs: 0.2 points of
  approval a month while it stands ("Utilities made to dig only in set months") and 0.1% a year off the city's growth
  (new connections come more slowly). **Judgement.** Digs take no lane in the model: a trench lasts days, not a month,
  and a lane on 40 scattered links would move the model's routes for nothing.

### The monsoon (PRD EVT-1)

- June to September every year. Each year of the game takes the rain of June to September of one real year from 1996
  to 2025, chosen by the seed, from the IMD's monthly rainfall at Bengaluru (OpenCity, "Bengaluru Rainfall from
  1901", fetched 28 September 2026; normals 1991–2020: June 111 mm, July 113, August 160, September 198). The first
  season plays the monsoons of 2014, 2021, 2020, 2008, 2014, 2023, 2016, 1997, 2007 and 2007: September 2026 has
  319 mm, September 2028 300 mm.
- Roads wear faster by the rain (above).
- **Floods.** Of the model's 741 low-lying links (`LOWLAND` in `src/sim/lowland.ts`, B, with its 73 `UNDERPASSES`),
  each floods in a month with a chance, by the seed, of 0.25% for each mm above 100 for an underpass and 0.02% for each
  mm above 150 for the rest: a month of 200 mm floods about 25 links, one of 300–320 mm 48 to 65 (B asked for 30 to 80
  in a heavy month, since the list is only modestly better than chance against the city's published points). A flooded
  link is shut a day for each 30 mm above 120 (an underpass, at most 10) or each 60 mm above 180 (the rest, at most
  5), at least one: passed to the model as `CityState.shut`, in thousandths of the month. The news says it quietly:
  "The monsoon brought 319 mm of rain in September. Low-lying roads flooded and were shut for up to 6 days: 62 km of
  main road, among them …". Approval: a tenth for each 20 km-days of main road shut. `report.flooded` lists the links
  and days (an optional field added to `Report`). All **judgement**, but for the rain.

### The upkeep budget (PRD UPK-4, UPK-13)

`{ kind: 'upkeep', level: 'bare' | 'steady' | 'generous', patchBelow?: number | null }`, a minor action, any month.
The game starts at steady. It is paid monthly, by lane-km of main road (the city's and, for good, those the player
builds, PRD UPK-14) and km of street, at 2026 prices rising 4% a year, and replaces slice 5's fixed ₹1.5 lakh a lane-km:

| Level | ₹ a lane-km of main road a month | ₹ a km of street | At the start | What it does |
|---|---|---|---|---|
| bare | 60,000 | 3,000 | ₹45.8 crore a month | nothing: roads fall about a grade in three years |
| steady | 1,20,000 | 7,000 | ₹93.1 crore | wear three-quarters as fast; mends of itself the worst 1.25% of the network's lane-km a month (and 1.35% of the streets) back to 65: the city holds |
| generous | 1,60,000 | 9,000 | ₹123.6 crore | wear 0.55 as fast; mends the worst 2.1% a month: the roads slowly improve |

The worst stretches are mended worst first, whatever their traffic: the budget is blind to what matters, which is the
player's to choose. For scale: resurfacing every main road once in five years at the rate below would cost about ₹57
crore a month, and every street (about 15,300 km) ₹43 crore; the budget pays for much of that cycle and the routine besides. **Judgement**, set
by the scripted players (below) so that steady costs a little less than slice 5's ₹103 crore and looking after the roads
properly (steady and resurfacing where it counts) about the same.

### Mending (PRD UPK-1 to UPK-3, UPK-10, UPK-11; `repair` and `streets` plans)

`{ kind: 'repair', links, work: 'patch' | 'resurface' | 'concrete' }`: up to 2,000 routing links, whole, not repeated,
each a main road that is not shut. `{ kind: 'streets', zone, work: 'patch' | 'resurface' }`. `quote` gives the cost,
months, `disrupted` links, `condition` after (an optional field added to `Quote`), `lasts` (months it should stay fair
or better: a patch until it has worn off), and `note`, the words for the player: what it does, how long it takes and
lasts, what it shuts, the hours a weekday it saves at last month's traffic (by the model's own surface rule, imported
from `src/sim/surface.ts`), and the warning about patching in the rains. Stretches that need nothing (a patch on a
road fair already, resurfacing a good or concrete road) are left out of the work and said so; a plan with nothing to do
is refused. A stretch being mended cannot be chosen again. Quoting 200 links takes 1 to 2 ms on the real city.

| Work | Cost (2026 prices) | Time | Raises to | Lasts | Shuts | Kind |
|---|---|---|---|---|---|---|
| Patch potholes | ₹3 lakh a lane-km | within the month (done and paid at once) | 62, fair | wears off over 12 months, 6 if done from May to September | nothing | minor |
| Resurface | ₹50 lakh a lane-km | 1 month, and one more for each 20 lane-km, at most 3 | 90, good | on a busy road about 4 years at steady, 3 at bare, 5 at generous; a quiet road longer | a lane of each stretch | minor |
| Concrete (white-topping) | ₹2.5 crore a lane-km | 6 months, and one more for each 10 lane-km, at most 12 | 100, and wears a quarter as fast | about 19 years on a busy road, past the game's end | half the road | **major** |
| A zone's streets, patch | ₹2 lakh a km of street | at once | 62 | 12 months (6) | | minor |
| A zone's streets, resurface | ₹17 lakh a km | 1 month, 2 over 60 km | 90 | long: streets carry little | | minor |

"Lasts" is the expected time before it falls below fair: its wear, slowed by the budget as set, and a utility's dig (a
chance of about one in ten a year) taken together as rates. For example, the 57 km of links (both ways) of Hosur Road
that start poor, in February 2026: patch ₹4.7 crore, at once, a year, saving about 21,000 vehicle-hours a weekday;
resurface ₹78 crore, 3 months with a lane shut, about 4 years (3 at bare, 5 at generous), saving 27,000; concrete
₹391 crore, 12 months with half the road shut, about 19 years, saving 29,000.

| Amount | Game value | In proportion to | Source (date) |
|---|---|---|---|
| Patching | ₹3 lakh a lane-km | the BBMP's pothole machines at ₹1,500 a m² (Bangalore Mirror, May 2024) and ₹1,942 a m² (Deccan Herald, 2024), over about a twentieth of a lane-km's 3,500 m² | the rates cited; the share of the surface **judgement** |
| Resurfacing | ₹50 lakh a lane-km | the GBA's 550 km of arterial and sub-arterial roads for ₹1,100 crore (₹2 crore a km, Times of India, 10 October 2025); 350 km of 182 roads for ₹695 crore (NDTV, 21 October 2025); about four lanes | the lanes a km **judgement** |
| Concrete | ₹2.5 crore a lane-km | white-topping at ₹12–16 crore a km in 2024, up from ₹9–10 crore; ₹1,800 crore for 147.97 km (Bangalore Mirror, December 2024); ₹4,000 crore for 500 km planned (The Hindu, 2025); about five lanes | the lanes a km **judgement** |
| Concrete's months | 6 to 12 | the ORR stretch given an 11-month deadline; "nearly 70% of white-topping projects miss deadlines" (The Hindu, 2025) | **judgement** |
| Street km | 927 m for each 1,000 people, at least 5 km a zone | the GBA's 11,533 km of ward roads (Times of India, October 2025) over the 1.24 crore people of the wards | the spread by people **judgement** |
| Street resurfacing | ₹17 lakh a km | ₹2,000 crore for the city's ward roads (New Indian Express, 19 June 2026) over 11,533 km | |
| Street patching | ₹2 lakh a km | as main roads, narrower | **judgement** |
| The city's pothole budget, for scale | ₹44–50 crore a year for potholes city-wide (April 2026); the BBMP's ₹7,121 crore in three years "to fill potholes" (Times of India, February 2023) takes in much more than potholes | | |

**Patching in the rains.** From May to September a patch lasts 6 months, not 12 (PRD UPK-11); the quote's note says
"Patching in the rains, or just before, lasts half as long.", and so does the news when it is done ("It lasts about 6
months, half as long as in the dry months.").

**The choice.** Patching a lane-km every year for five years costs ₹15 lakh and holds it at fair at best; resurfacing
it once costs ₹50 lakh and takes it to good for four or five years; concrete costs ₹2.5 crore, shuts half the road for
up to a year, and lasts past the game. Patching everything poor every year (a standing order at 35 on a steady
budget) cost the `keep-roads` player ₹770 crore a year: more than resurfacing on a cycle.

### Making good after works (PRD UPK-12)

`makeGood?: boolean` (an optional field added to the `metro`, `road` and `junction` plans). The roads a work takes a
lane from (`quote.disrupted`) are handed back when its lanes are: a metro line's at half its months, a road's or
junction's when it opens. Without `makeGood` they come back at 40, poor ("The roads dug up for the Navy Line are
handed back in poor repair: 12.4 km."); with it they are resurfaced to 90, and the quote's cost includes resurfacing
each of their lanes once at the rate above (`quote.makeGood`, an optional field: ₹16.5 crore for the first suggested
line, 9 km of viaduct, against its ₹1,030 crore).
A work cancelled while its lanes are taken hands its roads back as they are.

### The standing order (PRD TIME-10)

`patchBelow` on the upkeep action: 10 to 70, or `null` to stop. Each month's end, in any zone whose main roads
(length-weighted) have fallen below the mark, every stretch below fair is patched, and any zone's streets below it;
paid in the month's books ("Patching by standing order") if the money is there, else the news says it was not done.
The two standing orders of TIME-10 from earlier slices (vehicles to a full line, repaying the dearest loan) do not
exist in the rules yet.

### What poor roads do (PRD ROAD-3 to ROAD-5)

- **Traffic, deaths:** the model's (docs/MODEL.md). Every road and street at 100 against the start: 6.3 minutes of
  commute and 132 deaths a year (B).
- **Buses:** "Buses worn by poor roads" in the books: bus-km a weekday on fair, poor and broken roads (the model's
  `busKmByGrade`) cost 2%, 5% and 10% more to run (B's suggestion, **judgement**), 30 days a month: about ₹10 crore in
  the first month.
- **Approval:** slice 6 had a standing push of 0.4 points a month for each 10 points by which the roads where people
  live stood above 50. Slice 7 replaces it: each zone's roads and streets against its own first month set where its
  approval settles (see "Approval"). Once, in a month roads are mended, a tenth for each 20 km mended and for each three
  zones' streets, at most a point ("Roads mended: 42 km"). Resurfacing and concrete take lanes, which count as works.
  **Judgement.**
- **Warnings (slice 7; SLICE7 job 6).** A player who leaves the budget at bare, or whose roads are falling, is told in
  plain words, in good time: at each December review, when the share of main roads in good or fair repair fell by 3
  points or more over the year, or the budget is bare, the news and the needs say where the roads stand against a
  year ago, where they are heading at that rate, and what putting them right would cost now ("The roads: 13.2% of main
  roads are in good or fair repair, down from 29.8% a year ago. At this rate hardly any will be in good or fair repair
  by 2028. The upkeep budget is bare: nothing is mended, and the roads fall about a grade in three years. Resurfacing
  every poor and broken stretch, and the poor streets, would cost about ₹5,212 crore now, and more each year it
  waits."); each May at bare, before the monsoon, the same; and setting the budget to bare says what it does
  (`roadsWarning`, `putRightCost` in `upkeep.ts`). Neglect for ten years is still fatal: the plan that builds and
  neglects (`neglect`) is replaced in 2033, after five warnings of this kind; one that neglects and builds nothing
  falls to 38 by 2030.

### The report (PRD ROAD-6, SCORE-13)

- A figure, `key: 'roads'`, "Main roads in good or fair repair", the share of main-road length, %, with its three
  largest causes, worked out as the month is settled, step by step, without the model: "−1.2 points: wear, and the
  monsoon rain", "−0.3 points: utilities digging", "+2.1 points: the upkeep budget mending the worst", "+0.8 points:
  potholes you patched", "roads resurfaced or laid in concrete", "roads left poor after works", "patches wearing off",
  "patching by your standing order". A span's report adds each up over its months.
- **The commute's causes** (at the end of a skip, as before): "the roads you mended": one run of the model with every
  link and street the player mended in the span (patched, resurfaced, concreted, by standing order) put back as it
  was; and "the roads wearing" (or "the roads kept up by the budget"): the rest of the change in the surface by
  arithmetic, no model run: each link's traffic, the time it took, and what its change of surface did to its speed by
  the model's rule, over the month's travellers, times 2.6 (people a car unit and the congestion lost capacity adds,
  fitted to the model: every road 5 or 10 points better or worse, within a fifth). Under 0.3 minutes is left out,
  as before.
- **The worst roads:** `report.worstRoads` (an optional field added to `Report`): the five named roads whose poor or
  broken stretches cost the most vehicle-hours a weekday, from the model's `surfaceDelay` (exactly the delay each
  link's surface causes, B), with their links (for the screen to go to and to mend), length, condition and hours.
  Slice 7: a road is named by the places people know that its poor stretch runs between (the two of its junctions
  farthest apart, each by the nearest of 46 known places in `src/rules/areas.ts`), or the one it is near; its length is
  km of road, each counted once whichever of its directions is poor. In January 2026: the Outer Ring Road, JP Nagar to
  Marathahalli (14.1 km of road at 37, 45,000 vehicle-hours a weekday), Hosur Road, Silk Board to Electronic City (11.9
  km at 40, 26,000), Sarjapura Road near Bellandur (5.0 km at 26, 20,600), Bannerghatta Road, Jigani to Koramangala
  (12.4 km at 40, 17,000), and the Outer Ring Road, Peenya to Jalahalli (2.8 km at 36, 15,600). Slice 6 named them by ward ("Outer Ring Road, Shivanasamudra Ward"), which few know.
  A span's report carries the last month's.
- **Kilometres (slice 7).** A repair quote's `length`, its note and a project's name give km of road, each road counted
  once however many of its directions are chosen; lane-km only where the price is explained: "Resurfaces 1.3 km of
  Sarjapura Road, Koramangala to HSR Layout, both ways, raising it to good. It takes 1 month, with a lane shut, and
  should stay fair or better for about 4 years. It costs ₹3.6 crore: 7 lane-km, a km of one lane, at ₹0.5 crore each."
  Slice 6 said "20 km chosen" and "Resurfaces 37.2 km" of the same work.
- **News:** digs each month; floods; roads handed back after works; mending done ("Resurfacing 3.2 km of Hosur Road
  is done: the road is good again, and its lane is open."); the standing order.

## Approval (PRD APP-1 to APP-4; `src/rules/approval.ts`)

**Slice 7: by zone, and for results.** Until slice 6 approval was one figure, pushed by what annoyed people this
month, and doing nothing was the best liked plan in every slice (69 at the end of slice 6, against 49 for the player
who achieved most). People judge a government by how their lives changed over its term as well as by this month's
annoyance. Now:

- **Kept by zone** (PRD APP-1): `game.zoneApproval`, tenths, in the order of the city's zones (an optional field
  added to `Game`); `game.approval` is their average by people. Each starts at 55.
- **Where it settles: how lives changed.** For each zone, against its own first month (`game.firstZones`, an optional
  field): its commute (1.5 points for each 1% shorter), its reach (a point for each 1% more of the jobs within 45
  minutes), its road deaths for each of its people (half a point for each 1% fewer), and its roads and streets (0.6
  points for each point of condition better). Each part at most ±30 points; together at most +40 and −20, so that a
  city that merely gets worse as it grows does not by itself bring approval under 30. It counts in proportion to the
  months gone, in full from the fourth year (month 48). Approval moves each month a twelfth of the way to 55 and this.
- **Pushed by what annoys or pleases them this month**, as before, on top; a push that stops fades at a twelfth a
  month. Some are felt most where they are:

| Push | Tenths a month, everywhere | And in the zones it touches | For example |
|---|---|---|---|
| Property tax above (or below) the standard rate | −80 × the share above | | 125%: −2.0 points a month, settling near 31 |
| Each fare above the usual in real terms (the usual rises 4% each January) | metro −10, bus −15, rail −3 × the share above | | `dear-fares`: −1.7 points a month |
| Each fare below what it was in January 2026 (slice 7; before: below the usual in real terms, so a fare left alone as costs rose was welcomed each year) | the same weights × the share below | | |
| Roads losing a lane to works | −1 for each 8 km of lane lost (slice 6: 4 km) | −1 for each 250 m of lane lost in the zone, at most −5 | a 15 km viaduct: −0.4 a month everywhere, −3 to −5 along it |
| Bus lanes | −1 for each 40,000 vehicle-km an hour driven at the peaks on the roads that gave a lane, **fading**: in full for a year after ordered, to a third after three | | 80 km of lanes along four routes: −1.2 a month at first, −0.4 after three years |
| Speed limits | −1 for each 150,000 vehicle-km an hour held to them, times the share of speed taken, fading the same way | | |
| Something opening, once | as slice 6 | | |
| Land taken for a road, once | −1 for each ₹100 crore of land, at most −5 | −1 for each ₹10 crore, at most −30, in the zones along it | |
| A road made one-way, once | −0.1 | −2 in its zone | |
| Taller building allowed, once | −0.5 | −5 in the zone | |
| Floods | −1 for each 40 km-days of main road shut | −1 for each 2 km-days in the zone, at most −5 | |
| Roads mended, once | +1 for each 20 km of road, and (slice 7) for each three zones' streets, at most +1 | | slice 6 gave a tenth for each zone's streets: a standing order to patch at 30 held approval 12 points up by itself |
| Dig once | −0.2 | | |

The commute, road deaths and the state of the roads where people live, which were standing pushes against the first
month (and roads against 50) until slice 6, are now in where approval settles, by zone. The pushes in the report's
approval figure are the city's: each local push counted over the city's people; the results' pull as "The commute
16.6% shorter than in January 2026 +1.5" (a twelfth of where it puts approval); and the rest of the pull back to 55.

**Before and after** (the scripted players at the end of 2035; slice 6's figures on the slice 6 model):

| Plan | Slice 6: approval 2035 | Slice 7: 2026 | 2030 | 2035 |
|---|---|---|---|---|
| `nothing` | 69.1 | 59.1 | 58.5 | 47.1 |
| `good-governance` | (new) | 47.5 | 73.0 | **73.3** |
| `everything` | 48.5 | 48.3 | 67.9 | **68.1** |
| `generous` | 61.3 | 59.8 | 74.2 | 57.7 |
| `lean-start` | 42.0 | 48.6 | 39.0 | 62.2 |
| `metro` | 56.7 | 56.7 | 59.6 | 50.3 |
| `both` | 51.5 | 54.3 | 60.3 | 46.9 |
| `keep-roads` | 49.5 | 55.8 | 61.7 | 44.3 |
| `lanes-everywhere` | (new) | 54.5 | 52.7 | 41.1 |
| `buses` | 45.2 | 57.9 | 54.9 | 39.4 |
| `keep-up` | 50.5 | 59.1 | 53.5 | 38.1 |
| `safe-streets` | 47.5 | 58.6 | 50.4 | 34.6 |
| `high-tax` | 43.7 | 43.6 | 35.8 | replaced 2034 |
| `neglect` | 26.9, replaced 2030 | 48.6 | 34.8 | replaced 2033 |
| `populist` | (new) | 70.3 | 77.7 | defaulted 2031 |

The builders are less liked than doing nothing while the works go on (`everything` 48.3 in 2026 against 59.1) and
better liked at the end (68.1 against 47.1); `good-governance` more so. Doing nothing is no longer the best liked.

All weights are **judgement**, set by the scripted players: the player who shortens the commute, saves lives and keeps
the roads up is less liked while the works go on and better liked at the end than the one who did nothing; neglect,
hoarding and bus lanes everywhere can still get a player replaced.

**The review (PRD APP-4).** Each December's report carries `review`: `{ year, approval, word, warning, warnings,
replaced }` (approval 0 to 100; `warnings` running; a report over a span carries the last review in it). The news
also gives "The yearly review: approval stands at 47, fair." (words:
high from 70, good from 55, fair from 40, low from 30, very low under 30; `approvalWord` in `approval.ts`). Under 30
is a warning, said so; under 30 at two reviews running and the state replaces the player: status `replaced`, and
every further action and month is refused. A review of 30 or more clears the count.

## Money (PRD section 8)

### The city's real budget, for scale

| What | Real figure | Source (date) |
|---|---|---|
| Property tax collected, 2024-25 | ₹4,930 crore (94.6% of a ₹5,210 crore target) | BBMP via The Hindu and Indian Express, April 2025 |
| Property tax, 2025-26 | about ₹4,000 crore with under a month left, against ₹6,000 crore hoped for | Indian Express, 25 March 2026 |
| State grants to the city | about ₹7,000 crore a year; the five corporations' budgets together ₹21,000 crore | same |
| BMRCL (metro) fares, 2024-25 | ₹753.6 crore; running costs (before depreciation and interest) ₹706.3 crore | BMRCL annual report via Times of India, 16 December 2025 |
| BMTC (buses), 2024-25 | spent ₹3,438.75 crore; lost ₹670.48 crore | BMTC Annual Administrative Report 2024-25 |
| BMTC traffic income expected | ₹2,977.75 crore, ₹62.65 a km run | same |
| BMTC km run | 12.39 lakh a day | BMTC at a glance, 5 September 2026 (in docs/MODEL.md) |
| Shakti, the free bus rides for women | the state pays the corporations each free ticket's value: ₹20,956 crore for 797 crore free journeys since June 2023, ₹15,305 crore of it paid | Organiser, 29 August 2026; Times of India, 20 December 2025 |
| Municipal bond rates | 7% to 8.5% a year; Nashik's five-year green bond 7.375% | BondScanner; Nashik Municipal Corporation, 2025 |

The game's city runs its buses, metro, suburban trains and main roads, which the real city does not; and it does none
of the rest of what the real city pays for (salaries, waste, water). So the game's property tax is the part that would
pay for transport and roads, set so that the city starts with a small surplus.

### Income

| Item | Rule | At the start | Source or judgement |
|---|---|---|---|
| Property tax | base × people × value of property × rate | ₹195.8 crore a month (`TAX_BASE`, 19,650 lakh) | **Judgement**: about 40% of what the city collects, as the share for transport and roads; the one amount tuned so that the first month's balance is +₹28 crore |
| Value of property | rises **2%** each January (slice 7; 4% before), **less 1% a year for each 10% the tax rate stands above the standard at the end of December** (more below it; slice 5) | | **Judgement**: set so that doing nothing ends with about what it began with (PRD MONEY-7) while the first month stays level; in the direction of tax capitalisation, a dearer property tax is paid out of what property is worth, so a tax of 125% has values falling 0.5% a year |
| Grant from the state | the season's, rising 2.5% each January | ₹32 crore a month | **Judgement**: transport's part of the state's grants |
| Free bus rides, paid by the state | the fares those who ride free would have paid: bus fares × 55 ÷ 45, **at the usual fare** (slice 5): with the bus fare above the usual in real terms, × usual ÷ fare | ₹108 crore a month | As the state pays the corporations for Shakti tickets. Until slice 4 this was inside a fixed ₹140 crore grant; now it follows the riders, so that more people on the buses bring in more (without it, bus lanes that drew a million more riders a day cost the city ₹42 crore a month and bankrupted it). Slice 5: the state does not match a dearer fare the city sets; before, dear bus fares doubled what the state paid, which made `dear-fares` the richest plan (**judgement**) |
| Building rights sold near stations (slice 5) | ₹5 lakh for each ten people who come to live in a zone allowed to build taller | | see "Roads and policy" |
| Fares | what the model says riders paid on a weekday (`fares`, `lineFare`), × 26 | about ₹190 crore a month with the state's part | Fares per km as the model has them; **26 fare days a month is judgement** |

### Costs

| Item | Rule | At the start | Source or judgement |
|---|---|---|---|
| Running the buses | bus-km × ₹80; bus-km = the model's bus passenger-km ÷ 37, less those on the player's routes | about ₹307 crore a month | ₹76 a km in 2024-25; ₹80 in 2026 (**judgement**) |
| Running each metro line | 2 × length × trains each way a day × 30 days × ₹950 a train-km | Purple ₹45, Green ₹28, Yellow ₹12 crore a month | **Judgement**, as in slice 3; the Pink and Blue lines and the player's at 144 trains each way a day unless trains are added or taken away |
| Running each bus route | buses × 220 km a day × 30 × ₹80 | ₹53 lakh a month for 10 buses | |
| Running suburban trains | 8 trains each way a day on each route, and 6 for each train added, × ₹300 a train-km | ₹4.6 crore a month | **Judgement** |
| Keeping bus lanes clear | ₹1 lakh a km a month | | **Judgement** |
| Upkeep of roads (slice 6) | the upkeep budget: lane-km of the routing network and of the roads, flyovers and overpasses the player has opened, and km of streets, at the level set (see "The upkeep budget") | ₹93.1 crore a month at steady (slice 5: ₹1.5 lakh a lane-km of main road, ₹103 crore) | **Judgement** |
| Buses worn by poor roads (slice 6) | bus-km on fair, poor and broken roads, 2%, 5%, 10% more a km | about ₹10 crore a month | **Judgement** (B) |
| Patching by standing order (slice 6) | what the order patched that month | | as patching |
| Upkeep of footpaths (slice 5) | ₹5 lakh for 10 km of footpath a month | | **Judgement** |
| Building | each project's payment for the month | | above |
| Loan payments | fixed monthly payment | | below |
| Rising costs | every running cost and every price of building rises 4% each January | | RBI's inflation target, 4% |

### The first month (real city, model as of 28 September 2026, about 21:00)

`npx vite-node tools/playthrough.ts books`:

| | ₹ crore a month |
|---|---|
| Property tax | 196.5 (slice 5: **163.0**) |
| Grant from the state | 32.0 |
| Purple / Green / Yellow Line fares | 56.2 / 18.5 / 25.0 |
| Bus fares | 88.4 |
| Free bus rides, paid by the state | 108.0 |
| Suburban rail fares | 2.9 |
| Running the Purple / Green / Yellow Line | −44.6 / −27.8 / −12.3 |
| Running the buses | −307.2 |
| Running suburban trains | −4.6 |
| Upkeep of main roads | −103.0 |
| **Balance** | **+28.0** (slice 5: **−5.5**) |

(Metro 8.84 lakh trips a weekday, bus 45.8 lakh, rail 1.07 lakh; commute 53.4 minutes.)

**Slice 6: `TAX_BASE` from 16,300 to 16,950 lakh**, so that the city starts about level: on the model and roads as
they now start, the first month has property tax ₹169.5 crore, the upkeep budget at steady ₹93.1 crore, buses worn by
poor roads ₹11.7 crore, a commute of 57.5 minutes, and a balance of **+₹0.6 crore** (at 16,300 it was −₹9.6 crore).
The cost: doing nothing now ends with ₹4,555 crore, not the ₹2,000 crore of MONEY-7 (see "What it gets wrong").

**Slice 7: property values rise 2% a year, not 4%.** Income grew faster than costs: the tax base with the people (3% a
year) and with property values (4%), costs with prices (4%) and, for the buses, with their riders. So the city piled up
a surplus. With values rising 2% a year (so that property tax grows about 5% a year, with the people), doing nothing
peaks at ₹3,185 crore in 2031 and ends with ₹2,234 crore, and the first month is as level as before (+₹0.6 crore: the
first year's values are the same). Tried on doing nothing: 4% ends with ₹4,555 crore, 2.5% with ₹2,540 crore, 2% with
₹1,903 crore (before the events, which move fares and riders), 1.5% with ₹1,286 crore. The rest of the money is as slice 6 set it.

**Slice 5: `TAX_BASE` from 19,650 to 16,300 lakh.** With the model as it stood in the evening of 28 September, the Pink
and Blue lines carry so many (metro trips 9 lakh a weekday to 25 lakh by 2035) and take so many off the buses, whose
riders cost the city more than they pay, that the city's balance stayed at about +₹560 crore a year for all ten years:
doing nothing ended with ₹7,582 crore, against the aim of no more than it started with (PRD MONEY-7). At 16,300 the
first months run about ₹5 crore short, the season's lines turn that into a surplus, and doing nothing ends with ₹1,958
crore. The aim now sets `TAX_BASE`, not the first month's balance: when the model moves, set it again so that
`nothing` ends near ₹2,000 crore (each 100 lakh of `TAX_BASE` is about ₹170 crore at the end).

### What building does to the books (PRD MONEY-7, MONEY-8)

What each costs, takes and earns, each opened at once in the city of 2026 on the model as it stood at the end
(`scratchpad` script beside `tools/measure-line.ts`; fares are the change in all fares and the state's payment
across the city, a month of 26 fare days):

| Built | Cost | Months | Running a month | Fares a month | Commute (city, 53.4 min) | Riders a weekday |
|---|---|---|---|---|---|---|
| Metro, MG Road to Sarjapur Road, 15.5 km, 12 stations | ₹1,769 crore | 49 | ₹13.1 crore | +₹12.3 crore | −1.6 min | 186,000 |
| Metro, Outer Ring Road Silk Board to KR Puram (the Blue Line's course), 19.5 km along the roads, 16 stations | ₹2,220 crore | 53 | ₹16.3 crore | +₹18.0 crore | −2.2 min | 322,000 |
| Bus route of 10 buses on the Outer Ring Road, 16.8 km | ₹5.9 crore | 1 | ₹0.53 crore | −₹2.2 crore | −0.5 min | 7,000 |
| Bus lanes both ways on 5 km of the Outer Ring Road (9.9 km of lane) | ₹16.8 crore | 1 | ₹0.10 crore | +₹9.5 crore (more bus riders, whose buses cost more too) | −1.8 min | |
| 4 more trains on the Bidadi line | ₹310 crore | 18 | ₹1.6 crore | −₹0.2 crore | nothing | |

So a good metro line's fares cover its running (the Outer Ring Road line by ₹1.7 crore a month, the Sarjapur Road line
nearly) and never repay its building: ₹1,800–2,200 crore at a surplus of at most ₹2 crore a month. A poor line (20,000
riders) earns under ₹1 crore against ₹9 crore of running, and loses money every month. Since running costs rise 4% a
year and fares stay as set, a line that covers its running when it opens does not in 2035 unless fares keep up.

## Levers

### Property tax rate (REV-1)

- 80% to 150% of the standard rate, in steps of 1%. **Judgement.**
- Once a calendar year: it may change in any month of a year in which it has not changed. The player told no is told
  when it changed and from when it can change again.
- It acts at once on the tax, through growth (each 10% above the standard takes 0.4% a year off growth), and on
  approval (above).

### Fares (REV-4)

- Metro ₹2.00 to ₹9.00 a km, bus ₹0.50 to ₹4.00, suburban rail ₹0.10 to ₹2.00, in steps of 10 paise (the action gives
  whole paise: `{ kind: 'fare', mode: 'metro', perKm: 550 }` is ₹5.50). **Judgement.**
- The least fare of ₹10 a trip is fixed, and the model caps a trip at ₹32 by bus and ₹90 by metro or rail.
- Fares may change any month, more than once. They act on the model's choice of mode, on fares paid, riders, bus-km
  run, road traffic and commute, and on approval in real terms.

### Loans (REV-6)

- Borrowed in multiples of ₹100 crore. What is owed in all may not pass twelve months of property tax, the grant and
  the state's payment for free bus rides (about ₹4,200 crore at the start). **Judgement.**
- The yearly rate is fixed when the loan is taken: 8%, plus up to 4% more as what will be owed nears the limit, in
  steps of a quarter percent. The 8% is about what Indian cities pay on bonds (7–8.5%); the rise is **judgement**.
- Repaid over five years in equal monthly payments; may be repaid early in full at any time there is the money.
- Payments are always taken. If they push money below nothing, that counts toward a default like any other cost.

## Growth (CITY-15)

- People grow each month by a yearly rate in hundredths of a percent: **3% a year** (slice 5; 2.5% before), less 0.1% a
  year (slice 7; 0.4% before) for each tenth the tax rate is above the standard (or plus, below it), and less 0.1% a
  year (slice 7; slice 5: 0.3%) for each tenth the metro and bus fares stand above the usual in real terms, on average
  (cheaper fares add nothing). **Judgement.** Slice 5 dropped the city's faster growth for a shorter commute (up to 1.5% a year): the
  model now answers congestion by itself (B: destinations and modes follow the month's road times), and the rule
  held doing nothing's commute flat from 2028 and handed a builder extra people who ate part of the gain. 3% is near
  the rate Bengaluru has grown at. In one sentence for the player: dear fares and a dear tax send people and employers
  elsewhere, and the tax base grows less.
  **Slice 7: a quarter as strong** (0.1% a year for each tenth of tax above the standard, and for each tenth of fares
  above the usual). Every measure but money is for each person, so a smaller city scores better: on B's final model,
  with growth as it was, `high-tax` (125%) scored 367 and `dear-fares` 348 against 291 for doing nothing, only because
  they had driven people away. Weakened, they score 163 (replaced) and 272. The catch of a dear tax is now approval and
  the value of property (below), as REV-1 has it; growth still slows, a little. **Judgement.**
- **By zone (slice 5; `src/rules/growth.ts`).** The city's growth is shared among the zones: each zone's share is its
  people times a weight in thousandths, 1000, plus 250 for each whole of a commute shorter than the city's (a fifth
  shorter: +50; longer: less), plus 250 for each whole of the share of jobs within 45 minutes above the city's, kept
  within 250 and 3000; plus 3000 in a zone allowed to build taller, until it has half as many people again as at the
  start. The month's commute and access by zone are the model's. Whole people: each zone's part is rounded down and
  what is left goes to the largest remainders, the lower zone first on a tie, so the zones add up to the city's total
  exactly; a city that shrinks loses people in proportion. Zones with no people stay empty. Kept in
  `game.zonePeople` (an optional field added to `Game`), in the order of the city's zones. Jobs still grow alike.
  **Judgement**: tried with the weights at 3000 (sorting three times as strong), doing nothing's commute in 2035 fell
  by 2.6 minutes and `everything`'s by 1.4: it helps the idle more than the builder, so the weights are small (250,
  first 1000).
- Vehicles grow with income: 2% more cars and 1.5% more two-wheelers a person each year, passed to the model as
  `ownership`. **Judgement.**

## Reports with reasons (SCORE-13, TIME-8)

Each month's report has six figures, and a seventh, road deaths, once the model gives them (slice 5), before and now,
each with up to three causes:

| Figure | Unit | From |
|---|---|---|
| Average commute | minutes | the model's commute, door to door |
| Speed on main roads at the peaks | km/h | vehicle-km over vehicle-hours on every modelled road, morning and evening |
| Jobs within 45 minutes | % | the model's access |
| Trips by bus, train, cycle or on foot | % | the model's trips by mode |
| Money | ₹ crore | the books; its causes the three largest items |
| Approval | of 100 | its causes the three largest pushes |
| Road deaths a year (`key: 'safety'`, slice 5) | a year | the model's `deaths`, at the month's rate; its causes like the commute's, in whole deaths a year |

**Slice 5: under 0.3 minutes is noise.** A cause of the commute smaller than 0.3 minutes is left out: any change to
the roads moves the model's routes across the city by about that much (B), and it would be reported as if real.

**Causes, and how they are found.** For each thing that changed over the months reported, the model works the last
month out again with that one thing put back as it was, and the difference is its part: each fare, the growth of the
city and the tax rate's part in it (slice 3), and now each line that opened or opened further ("the Indigo Line
opening", "Bus route 2 starting", "the Pink Line opening"), each line closed, the works as a whole ("roads losing
lanes to works" or "lanes given back after works"), the buses and trains added or taken away on lines that were there,
and the bus lanes; and (slice 5) each road or flyover opened ("the flyover from Bellanduru to Panathur opening"), the
work at junctions, the new footpaths, the change in speed limits and the change in one-way streets, each as a whole.
What the model was given each month is kept with `inputs` as `setup` (the season's lines open, the
player's lines, stations, bus lanes, vehicles and works; and, slice 5, `onRoads`: the player's roads, junction work,
footpaths, limits and one-way streets, an optional field added to `Setup`), so each can be put back exactly. Growth
put back scales each zone's people now, so the part of growth is that of its size, not of where it went. This is one model run for
each (130–200 ms each on the real city), done only where the player stops: `skip` does it for the end of the span.

**News** says what the player did, with what it was before; each project ordered ("You ordered the Indigo Line,
Baiyappanahalli to Marathahalli. It costs ₹1,300 crore, paid over 41 months, and opens in June 2029."), each
cancelled (with what came back), vehicles changed, lines closed; each opening, the player's and the season's; loans;
the yearly review; the year's end; the ending.

**Needs** says what needs the player: money below nothing, money running out within three months, something opened,
and the year's end.

## Skipping (TIME-3 to TIME-6)

`skip(game, city, simulate, how)` in `src/rules/skip.ts`: `how` is a number of months, or `'event'` (until something
needs the player, which is at the latest the year's end). It stops after any month whose report has needs: money below
nothing, money running out within three months (played forward on the books alone, with work paid and opened as due),
something opening, or the end of December. `skipAsync` does the same with a model that answers later (in a worker).

## The daily allowance (TIME-7)

`allowance(ended, now, on = true)` in `src/rules/allowance.ts`: 12 game months a day, carried to at most 36, the day
turning at midnight in India. **Off while the game is being built:** the first season has `allowance: false`, and
`allowance(…, false)` gives `{ on: false, left: Infinity }`; the screen should show nothing of it when `on` is false.

## The ending (MONEY-5, APP-4, APP-5)

- December 2035 ends the game: status `finished`.
- Money below nothing at the end of three months running is a default: status `default`.
- Approval under 30 at two December reviews running: status `replaced`.
- After any of them, every action and every further month is refused.

## Replay (MP-30)

`replay(season, city, done, simulate, until?)` starts the season, and for each month does the actions dated in it (in
order, each checked as `act` checks it) and ends it, until the game ends or month `until` is reached; then does the
actions dated in the month reached. Anything refused, or out of order, or never reached, throws with the reason.
Plans are snapped and routed again from the places kept, to the same lines.

Slice 5: `tests/policy.test.ts` plays a whole game on the small city with every new lever (a road, a flyover, signals,
a redesign and an overpass, footpaths, speed limits set, changed and lifted, a one-way street made and undone, taller
building allowed and withdrawn, a bus lane on the new road's links, and a metro line opening in two stretches), checks
every month that the network is one the model can take, and plays it again to the same game; changed plans (five
lanes, a limit of 5 km/h, taller building away from a station, one-way streets that cut a corner off) are refused. On
the real city `tools/playthrough.ts everything --check` played its game again to the same game, 1,078,765 characters
compared (28 September 2026, night, on the final model).

Slice 7: the score is part of the game (`measured`, `score`, `scores`, the zones' approval, the events and the grant an
election set), so replay checks it with everything else. On the final model and marks `good-governance --check`
(2,046,075 characters), `dear-fares --check` (a bus strike and a metro strike in its first months; 1,712,200) and
`nothing --check` (1,709,937) each play again to the same game, to the last figure, and the same score (908, 292, 308);
`every-lever --check` did the same an hour earlier (1,702,356). `tests/score.test.ts` and `tests/events.test.ts` play
again on the small city.

Slice 8, for the server, which plays whole games again to check them: `replay` runs the model once a month and nothing
else (no causes, no forecasts, no look ahead: `tests/long-lived.test.ts` counts the runs). `rules.replay(season, city,
done, simulate, until, false)` writes no reports either, and gives the same game in everything else: the same
`gameDigest`, and the same JSON but for `reports` (tested). `npx vite-node tools/measure-replay.ts [done.json]` times a
whole game both ways (the list of actions of any plan is kept by `tools/playthrough.ts plan --save=file.json`, under
`done`); see "Slice 8 results" for the figures.

## The game's fingerprint (slice 8; `src/rules/digest.ts`)

`gameDigest(game)`: eight hex digits, FNV-1a (as the model's `src/sim/digest.ts`) over the score's total and the points
of its seven measures, the money, the month, the status, and every month's figures kept for the score
(`Game.measured`: month and the seven figures). Every number is taken as a whole number and hashed as two 32-bit
words, low then high, by integer arithmetic only; a number that is not whole (none should be) is hashed by its shortest
decimal form, which ECMAScript fixes exactly. So it is the same on every engine, and through a copy by JSON. It does
not cover reports, words or timings, which the server does not keep. Since the score, money, month and status follow
from everything else, two games with the same fingerprint have, short of a one-in-four-billion accident, played the
same. `tests/digest.test.ts` pins one value, and checks that each covered field moves it and the rest do not.

## The scripted players

`npx vite-node tools/playthrough.ts [plan] [seed] [--check]` plays 120 months of the real city without a screen,
about 25 seconds a game here, and prints the year-end figures, what was built, and the last year's books. `all` plays
every plan and sets them side by side; `--check` plays each again from its list of actions and compares; `books`
shows the first month's books.

| Plan | What it does |
|---|---|
| `nothing` | Nothing |
| `cheap-fares` | In January 2026: metro ₹3.00, bus ₹1.00, rail ₹0.20 a km |
| `dear-fares` | In January 2026: metro ₹7.00, bus ₹2.50, rail ₹0.80 a km |
| `high-tax` | In January 2026: tax at 125% of the standard |
| `borrow-and-hold` | In January 2026: borrows ₹1,000 crore and keeps it |
| `careless` | In January 2026: borrows to the limit at once |
| `steady` | Each January from 2027: fares up a twentieth, tax up 2 points |
| `keep-up` | Each January from 2027: fares up 4% (with costs), tax up 1 point; builds nothing |
| `metro` | As `keep-up`, and builds the best suggested metro line whenever fewer than two are being built and half its cost is in hand; no loans |
| `buses` | As `keep-up`, and a suggested bus route a month until there are ten, with bus lanes on every stretch of two lanes or more along the first two once they run |
| `both` | As `buses`, and metro lines as `metro` but each only with its whole cost and all still owed on the work in hand in hand |
| `careless-builder` | Borrows to the limit in January 2026 and orders every suggested metro line it can, three a month |
| (slice 5) `metro`, `both` | now: the checked suggestion, ordered when all still to pay on it and the work in hand fits in the money and half the city's borrowing room with ₹300 crore to spare; borrowing ₹500 crore when money runs under ₹300 crore, up to two thirds of the limit; `metro` two lines at a time, `both` three |
| `roads` (slice 5) | As `keep-up`, and the best suggested road or flyover when fewer than two are being built and twice its cost is in hand; a redesign of the two most jammed junctions a month, and an overpass at one of the ten most jammed when three times its cost is in hand |
| `safe-streets` (slice 5) | As `keep-up`, and footpaths in the three zones a month with the most deaths last month, up to 150; a limit of 30 km/h in the 40 with the most, in February 2026 |
| `everything` (slice 5) | Metro as `metro` (two at a time, borrowing when low); ten bus routes with lanes along the first four; five more trains each January on each city metro line fuller than 90% of crush; a junction redesign a month; footpaths in the most dangerous zone each month up to 40; 40 km/h in the 20 zones with the most deaths; taller building near a station in the most populous zone that allows it, one a month up to 20. No flyovers: they cost lives and move the jam |

| `everything` (slice 6) | as slice 5, and looks after its roads: each February, ₹150 crore (2026 prices) of resurfacing on the poor stretches that cost the most time last month (the model's `surfaceDelay`), if the money is there with ₹300 crore to spare. The budget stays steady |
| `neglect` (slice 6) | as `everything`, but the upkeep budget at bare from January 2026 and no mending |
| `lean-start` (slice 6) | as `neglect` for three years, then steady and mending as `everything` from January 2029 |
| `keep-roads` (slice 6) | as `keep-up`; steady; potholes patched in any zone whose roads fall below 25; each February ₹200 crore of resurfacing where it costs most |
| `concrete` (slice 6) | as `keep-up`; lays the Outer Ring Road, then Hosur, Bellary, Tumkur, Old Madras, Mysore, Bannerghatta, Kanakapura, Magadi and Sarjapur roads in concrete, in packages of about 24 km of links (12 km of road both ways), two at a time, when the cost and ₹300 crore are in hand |
| `generous` (slice 6) | as `keep-up`, with the upkeep budget at generous |
| `every-lever` (slice 6) | every lever of slice 6 at least once, for `--check`: the budget and standing order set and changed, dig once on and off, a patch on the worst road and in a zone's streets, resurfacing, a concrete package, a zone's streets resurfaced, a metro line ordered to make good |
| `good-governance` (slice 7) | what I would do, playing to win: `everything`'s building, but metro lines ordered only until 2030; the budget steady with potholes patched below 30 and ₹250 crore of resurfacing where it costs most each February; fares up with costs; the tax left alone, and raised three points in a January only if money would otherwise run short within the year |
| `populist` (slice 7) | fares cut (metro ₹3.50, bus ₹1.20, rail ₹0.30 a km) and the tax to 90% in January 2026; roads and flyovers two at a time and an overpass where traffic is worst, until 2035; borrows ₹500 crore whenever money runs under ₹300 crore, to the limit |
| `slow-everywhere` (slice 7) | as `keep-up`, and 30 km/h in every zone in February 2026 |
| `lanes-everywhere` (slice 7) | as `keep-up`, ten bus routes, and bus lanes along every one |
| `hoard` (slice 7) | the tax and every fare at the most, from January 2026; builds nothing |
| `last-year` (slice 7) | nothing until 2034; then borrows to the limit, the budget generous, ₹600 crore of resurfacing a month, ten bus routes with lanes along all, three junction redesigns a month, 30 km/h in the sixty most dangerous zones |
| `late-spender` (slice 7) | nothing until 2033; then the budget generous with potholes patched below 30, ₹300 crore of resurfacing each February, ten bus routes with lanes along four, two junction redesigns a month, footpaths in three dangerous zones a month, 40 km/h in the twenty most dangerous; borrowing when low |

`tools/playthrough.ts` now prints each plan's score by year with its seven measures in points, and at the end the
score with each measure's figure and points; `all` sets the plans side by side, best score first.

The builders' metro lines are the suggestions checked with the model (above).

### Slice 8 results (29 September 2026, about 12:15; all 28 plans, on the model and marks of slice 7)

Every plan was played again on this slice's code: every month's figures (`Game.measured`) and every ending are the same
as before to the last figure, so only the scoring differs. The score of ten years (first season's weights), beside
the rule before (the last year alone), best first:

| Plan | Slice 8: ten years | Slice 7: the last year | Ends |
|---|---|---|---|
| `good-governance` | **871** | 908 | finished |
| `everything` | **776** | 785 | finished |
| `lanes-everywhere` | **609** | 541 | finished |
| `generous` | **596** | 496 | finished |
| `lean-start` | **588** | 710 | finished |
| `late-spender` | **576** | 647 | finished |
| `both` | **502** | 422 | finished |
| `keep-roads` | **492** | 382 | finished |
| `every-lever` | **486** | 343 | finished |
| `metro` | **483** | 432 | finished |
| `buses` | **464** | 354 | finished |
| `concrete` | **424** | 323 | finished |
| `nothing` | **423** | 308 | finished |
| `borrow-and-hold` | **420** | 304 | finished |
| `careless` | **408** | 291 | finished |
| `roads` | **408** | 291 | finished |
| `keep-up` | **394** | 273 | finished |
| `safe-streets` | **386** | 285 | finished |
| `steady` | **384** | 262 | finished |
| `dear-fares` | **382** | 292 | finished |
| `slow-everywhere` | **326** | 229 | finished |
| `cheap-fares` | **290** | 285 | default in 2028 |
| `populist` | **274** | 237 | default in 2031 |
| `last-year` | **250** | 285 | default in 2035 |
| `hoard` | **221** | 244 | replaced in 2027 |
| `high-tax` | **217** | 169 | replaced in 2034 |
| `neglect` | **197** | 196 | replaced in 2033 |
| `careless-builder` | **172** | 173 | default in 2027 |

The late spender, which sat on the money for seven years, falls from third to sixth and below every plan that governs
well throughout; it stays above `both`, `keep-roads`, `metro` and `buses`, whose cities are worse than its own in 2035
by the model's figures (see "The score of ten years"). Year by year (each year's own score): doing nothing 501, 599,
615, 584, 530, 484, 452, 395, 343, 308; the late spender the same to 2032, then 560, 643, 647; `metro` 447, 580, 608,
573, 524, 508, 492, 462, 452, 432; `good-governance` 564, 782, 831, 842, 872, 874, 893, 896, 881, 908. The marks and
the opening figures are unchanged: the model's figures did not move (docs/MODEL.md, "Slice 8"), and the marks are set
from them, not from the scores.

**Replay at speed** (`tools/measure-replay.ts`, `good-governance`'s 252 actions, `vite-node`, load 7): 120 model runs,
one a month; 285 to 295 ms a month in the model (its city has several lines and ten bus routes), 18 to 20 ms in the
rules with the reports written, 7 ms without. A whole game: 36 to 38 s with reports, 35 s without; the same game
(`03cbd1a9`, 871) both ways. The model is 97% of it; bundled for Node, as the server runs it, the model is about a
quarter quicker than under `vite-node`.

### Slice 7 results (29 September 2026, about 11:30; each plan run on its own, on B's final model of 10:39)

The score at the end of 2035 (or at the early end, with the half lost), the points of each measure, how the game
ended, money in hand and owed, and approval at the end:

| Plan | Score | Access | Commute | Clean | Safety | Fairness | Money | Approval | Ends | Money, owed (₹ crore) | Approval |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `good-governance` | **908** | 92 | 95 | 86 | 95 | 91 | 78 | 95 | finished | 1802, 40 | 73.3 |
| `everything` | **785** | 80 | 88 | 80 | 90 | 78 | 44 | 76 | finished | 608, 1256 | 68.1 |
| `lean-start` | **710** | 63 | 82 | 90 | 88 | 68 | 54 | 44 | finished | 626, 591 | 62.2 |
| `late-spender` | **647** | 65 | 72 | 71 | 94 | 61 | 23 | 57 | finished | -303, 2907 | 68.6 |
| `lanes-everywhere` | **541** | 29 | 65 | 86 | 79 | 46 | 72 | 12 | finished | 995 | 41.1 |
| `generous` | **496** | 52 | 44 | 6 | 75 | 39 | 93 | 62 | finished | 2608 | 57.7 |
| `metro` | **432** | 31 | 46 | 29 | 66 | 36 | 75 | 42 | finished | 1760, 69 | 50.3 |
| `both` | **422** | 31 | 45 | 34 | 66 | 31 | 80 | 28 | finished | 1802 | 46.9 |
| `keep-roads` | **382** | 34 | 35 | 4 | 75 | 30 | 100 | 18 | finished | 4575 | 44.3 |
| `buses` | **354** | 20 | 34 | 25 | 66 | 24 | 100 | 8 | finished | 5923 | 39.4 |
| `concrete` | **323** | 23 | 29 | 5 | 70 | 27 | 100 | 4 | finished | 6020 | 41.5 |
| `nothing` | **308** | 17 | 19 | 18 | 66 | 14 | 93 | 28 | finished | 2358 | 47.1 |
| `borrow-and-hold` | **304** | 17 | 19 | 18 | 66 | 14 | 90 | 28 | finished | 2112 | 47.1 |
| `dear-fares` | **292** | 17 | 24 | 4 | 61 | 23 | 100 | 13 | finished | 8904 | 44.4 |
| `careless` | **291** | 17 | 19 | 18 | 66 | 14 | 76 | 28 | finished | 1180 | 47.1 |
| `roads` | **291** | 25 | 30 | 4 | 62 | 23 | 80 | 0 | finished | 1879 | 41.8 |
| `last-year` | **285** (less 284) | 52 | 72 | 85 | 100 | 66 | 0 | 0 | default, October 2035 | -644, 3214 | 32.3 |
| `safe-streets` | **285** | 6 | 14 | 28 | 92 | 10 | 100 | 0 | finished | 6355 | 34.6 |
| `cheap-fares` | **285** (less 284) | 65 | 63 | 68 | 49 | 52 | 0 | 80 | default, December 2028 | -127 | 74.0 |
| `keep-up` | **273** | 15 | 20 | 6 | 64 | 16 | 100 | 5 | finished | 8246 | 38.1 |
| `steady` | **262** | 14 | 21 | 4 | 63 | 16 | 100 | 0 | finished | 9414 | 28.8 |
| `hoard` | **244** (less 244) | 60 | 54 | 25 | 37 | 55 | 100 | 0 | replaced, December 2027 | 5360 | 0.0 |
| `populist` | **237** (less 236) | 46 | 50 | 43 | 57 | 36 | 0 | 100 | default, November 2031 | -431, 3543 | 76.1 |
| `slow-everywhere` | **229** | 3 | 4 | 5 | 100 | 5 | 100 | 0 | finished | 7986 | 28.7 |
| `neglect` | **196** (less 195) | 0 | 38 | 100 | 55 | 10 | 100 | 0 | replaced, December 2033 | 10023 | 26.9 |
| `careless-builder` | **173** (less 173) | 43 | 32 | 53 | 45 | 41 | 0 | 9 | default, April 2027 | -951, 2887 | 48.1 |
| `high-tax` | **169** (less 168) | 28 | 29 | 19 | 62 | 20 | 100 | 0 | replaced, December 2034 | 4511 | 26.8 |

| Plan | Access % | Commute min | Clean % | Deaths a lakh | Fairness % | Money ₹ crore | Approval |
|---|---|---|---|---|---|---|---|
| `good-governance` | 15.5 | 47.6 | 55.9 | 5.9 | 52.8 | 1433 | 74.7 |
| `everything` | 14.7 | 49.0 | 55.4 | 6.1 | 50.4 | -923 | 67.9 |
| `lean-start` | 13.6 | 50.3 | 56.2 | 6.2 | 48.5 | -207 | 56.2 |
| `late-spender` | 13.7 | 52.3 | 54.7 | 5.9 | 47.1 | -2375 | 60.9 |
| `lanes-everywhere` | 11.4 | 53.7 | 55.9 | 6.6 | 44.3 | 1057 | 44.7 |
| `generous` | 12.9 | 58.0 | 49.5 | 6.7 | 42.9 | 2524 | 62.7 |
| `metro` | 11.5 | 57.4 | 51.3 | 7.1 | 42.3 | 1266 | 55.5 |
| `both` | 11.5 | 57.8 | 51.7 | 7.1 | 41.4 | 1576 | 50.5 |
| `keep-roads` | 11.7 | 59.8 | 49.3 | 6.7 | 41.2 | 4310 | 46.8 |
| `buses` | 10.8 | 60.0 | 51.0 | 7.1 | 40.0 | 5642 | 43.4 |
| `concrete` | 11.0 | 61.0 | 49.4 | 6.9 | 40.6 | 5675 | 41.8 |
| `nothing` | 10.6 | 62.9 | 50.4 | 7.1 | 38.2 | 2518 | 50.4 |
| `borrow-and-hold` | 10.6 | 62.9 | 50.4 | 7.1 | 38.2 | 2273 | 50.4 |
| `dear-fares` | 10.6 | 62.0 | 49.3 | 7.3 | 39.8 | 8605 | 45.0 |
| `careless` | 10.6 | 62.9 | 50.4 | 7.1 | 38.2 | 1341 | 50.4 |
| `roads` | 11.1 | 60.9 | 49.3 | 7.3 | 39.8 | 1617 | 39.8 |
| `last-year` | 12.9 | 52.3 | 55.8 | 5.0 | 48.1 | -2743 | 31.3 |
| `safe-streets` | 9.9 | 64.1 | 51.2 | 6.0 | 37.3 | 5939 | 37.3 |
| `cheap-fares` | 13.7 | 54.2 | 54.4 | 7.8 | 45.4 | 197 | 69.2 |
| `keep-up` | 10.5 | 62.7 | 49.5 | 7.2 | 38.5 | 7866 | 42.3 |
| `steady` | 10.4 | 62.6 | 49.3 | 7.2 | 38.6 | 8926 | 34.4 |
| `hoard` | 13.4 | 55.9 | 51.0 | 8.3 | 46.0 | 4465 | 7.8 |
| `populist` | 12.5 | 56.6 | 52.4 | 7.5 | 42.3 | -3416 | 79.3 |
| `slow-everywhere` | 9.7 | 65.9 | 49.4 | 4.0 | 36.4 | 7643 | 32.2 |
| `neglect` | 5.0 | 59.1 | 62.1 | 7.5 | 37.3 | 7983 | 29.9 |
| `careless-builder` | 12.3 | 60.3 | 53.2 | 8.0 | 43.3 | -10455 | 43.8 |
| `high-tax` | 11.3 | 60.9 | 50.5 | 7.3 | 39.2 | 4679 | 30.2 |

The first table's points are those of the second's figures, the averages scored (the last twelve months; approval the
last thirty-six), under the published marks. The city as it starts scores **547**; doing nothing ends at **308**.

B's model changed under these runs all morning (the commute of January 2026 went from 57.5 to 58.7 minutes, and doing
nothing now loses far more as the city grows: access 13.7% → 10.6%, commute 58.7 → 62.9 minutes). The marks were set
last, on the final model. Run `npx vite-node tools/playthrough.ts all` to see them again; `marks` to set the marks
again if the model moves.

**Against the aims** (SLICE7 "What done looks like").
- *Scripted players spread over at least 300 points:* 169 to 908.
- *In an order a person would agree with:* looking after everything highest (`good-governance` 908, `everything` 785);
  neglecting the roads for three years first costs 75 (`lean-start` 710); building one kind of thing in the 300s to
  500s (`lanes-everywhere` 541, `generous` 496, `metro` 432, `both` 422, `keep-roads` 382, `buses` 354, `concrete`
  323); doing nothing 308; raising charges, hoarding, flyovers and speed limits everywhere at or below it (`dear-fares`
  292, `roads` 291, `safe-streets` 285, `keep-up` 273, `steady` 262, `slow-everywhere` 229); default and replacement
  below (169 to 285).
- **Short of the aim.** Doing nothing ends at 308, not near 400, and the city as it starts scores 547, not about 400:
  on B's final model the city left alone gets much worse as it grows, and a score that starts near 40 on each measure
  must end low for doing nothing (see "The marks"). Building one kind of thing reaches the 300s to 500s, not the 500s and
  600s: five metro lines move the city's figures little (access 11.5% against 10.6%, clean travel 51.3% against 50.4%;
  the new lines take riders from the buses). `late-spender` (nothing for seven years, then three of the right things)
  scores 647, more than any one-kind builder: see "What it gets wrong". `safe-streets` saves about 250 lives a year and
  ends under doing nothing (285): its 150 zones of footpaths and 30 km/h in 40 cost reach, the commute and approval more
  than a tenth of the score gives for lives. `cheap-fares` and `last-year` defaulted, but at 285 are only just under
  doing nothing, because their measures were good when they broke.
- *No plan a person would call bad governance scores well:* see the temptations above. `high-tax` is now replaced
  (169): with growth answering tax and fares a quarter as strongly, driving people away no longer pays.
- *Approval rewards results:* `good-governance` 73.3 and `everything` 68.1 at the end, against 47.1 for doing nothing;
  47.5 and 48.3 against 59.1 in the first year, while the works went on.
- *Money:* doing nothing ends with ₹2,358 crore (₹2,000 at the start; ₹3,248 at its peak in 2031); the first month
  is −₹2.5 crore on B's final model (+₹0.6 on slice 6's).
- *Replay:* see "Replay".

### Slice 6 results (28 September 2026, night; each plan run on its own, the model as B finished it)

At the end of 2035: money and owed in ₹ crore; commute in minutes, December 2026 → December 2035; road deaths a year at
December 2035's rate; main-road length in good or fair repair, %, and the average condition of main roads by length;
approval. Slice 5's figures (money, commute 2035, deaths, approval) for comparison: the model has changed under them.

| Plan | Slice 5 | Ends | Money (owed) | Commute | Deaths | Roads good or fair (average) | Approval |
|---|---|---|---|---|---|---|---|
| `nothing` | 1,652, 52.4, 1,553, 71 | finished | 4,555 | 57.9 → **54.9** | 1,601 | 40% (44) | 69.1 |
| `keep-up` | 7,251, 52.0, 1,545, 54 | finished | 10,168 | 57.9 → 55.6 | 1,590 | 41% (44) | 50.5 |
| `keep-roads` | (new) | finished | 6,823 | 57.5 → **53.4** | 1,503 | 72% (56) | 49.5 |
| `generous` | (new) | finished | 4,197 | 56.7 → **52.7** | 1,489 | 90% (56) | 61.3 |
| `concrete` | (new) | finished | 8,380 | 58.0 → 54.5 | 1,548 | 48% (48) | 47.7 |
| `everything` | 340 (1,842), 45.8, 1,339, 52 | finished | **1,136 (477)** | 52.9 → **48.0** | 1,327 | 45% (47) | 48.5 |
| `lean-start` | (new) | finished | 810 (340) | 58.2 → 49.4 | 1,334 | 61% (51) | 42.0 |
| `neglect` | (new) | **replaced, month 60** | 5,038 (Dec 2030) | 58.2 → 58.1 (2030) | 1,527 (2030) | 0.3% (11) (2030) | 26.9 (2030) |
| `metro` | 1,744 (60), 49.7, 1,531, 59 | finished | 2,863 | 58.9 → 53.1 | 1,580 | 40% (44) | 56.7 |
| `both` | 1,257 (360), 49.1 | finished | 1,878 | 55.9 → 52.1 | 1,544 | 40% (44) | 51.5 |
| `buses` | 5,638, 51.1 | finished | 7,918 | 55.7 → 54.0 | 1,564 | 41% (44) | 45.2 |
| `roads` | 1,899, 51.7 | finished | 3,622 | 58.1 → 56.5 | 1,587 | 41% (44) | 43.8 |
| `safe-streets` | 5,310, 54.1, 1,315 | finished | 8,412 | 61.0 → 56.1 | 1,348 | 40% (44) | 47.5 |
| `dear-fares` | 6,023, 51.5 | finished | 9,185 | 58.5 → 55.0 | 1,554 | 41% (45) | 54.6 |
| `high-tax` | 2,238, 50.9 | finished | 5,105 | 58.1 → 54.8 | 1,539 | 41% (45) | 43.7 |
| `steady` | 8,190, 51.5 | finished | 11,158 | 57.9 → 55.4 | 1,580 | 40% (44) | 41.3 |
| `borrow-and-hold` | 1,406 | finished | 4,310 | as `nothing` | | | 69.1 |
| `careless` | 507 | finished | 3,378 | as `nothing` | | | 69.1 |
| `cheap-fares` | default, month 29 | **default, month 36** | | 57.3 → | | | |
| `careless-builder` | default, month 16 | **default, month 17** | | 59.4 → | | | 23.7 (Dec 2026) |

**Against the aims.**
- *Doing nothing ends worse than 52.4* (slice 5's): 54.9. The start's poor roads cost 6.3 minutes against perfect ones
  (B); the steady budget holds them; the city grows 3% a year.
- *The player who looks after everything ends at least five minutes ahead of doing nothing, without defaulting:*
  `everything`, 48.0 against 54.9, **6.9 minutes**, with ₹1,136 crore in hand and ₹477 crore owed (slice 5: 6.6
  minutes, ₹340 crore and ₹1,842 crore owed). Its ₹150 crore of resurfacing each year, where it counts, is part of
  that: its commute in December 2026 is 52.9 against doing nothing's 57.9.
- *Neglect costs the player:* `neglect` (everything's building, the budget at bare, no mending) has its roads broken by
  2030 (0.3% good or fair, 10.7 on average), a commute of 58.1 in 2030 against `everything`'s 48.5 (worse than doing
  nothing's 54.6: it loses all that building gained, and more), and approval 26.9: warned in 2029, replaced at the
  review of December 2030. It had ₹5,038 crore unspent. `lean-start` (bare for three years to pay for building, then
  steady and mending) is the real temptation: it ends 1.4 minutes behind `everything`, with less money, and approval
  that fell to 30.6 in 2030.
- *Upkeep is a real choice:* against `keep-up` (the same fares and tax, a steady budget, nothing mended), a generous
  budget buys 2.9 minutes, 101 fewer deaths a year and 10.8 points of approval for ₹5,971 crore over ten years;
  resurfacing ₹200 crore a year where it costs most (`keep-roads`) buys 2.2 minutes and 87 fewer deaths for ₹3,345
  crore (it pays for its standing order too, and for more bus riders); concrete on the ring road and radials buys 1.1
  minutes for ₹1,788 crore and months of half-shut roads. For comparison, `metro` buys 2.5 minutes against `keep-up`
  with six lines. B: every road and street at 100 is worth 6.3 minutes against the start, the Outer Ring Road alone
  from 40 to 100 1.9 minutes.
- *The opening is about level:* +₹0.6 crore in the first month.
- *Careless building runs short within two years:* `careless-builder` defaults in month 17.
- *Replay:* `every-lever --check` (every lever of slice 6 on the real city) plays again to the same game, 1,290,218
  characters compared; `tests/upkeep.test.ts` does the same on the small city with every new lever and refuses changed
  plans and actions.

About 30–40 s a game for the plans without metro suggestions (250–330 ms a month, nearly all the model; the rules' month
of roads is 6–10 ms), 95–135 s for those that check metro suggestions with the model.

### Slice 5 results (28 September 2026, night; `all`, the model as B finished it)

Money in ₹ crore at the end of 2035 (and owed); commute in minutes, December 2026 and December 2035; access, the share
of jobs within 45 minutes, %; road deaths a year at December 2035's rate; approval at the end; people in lakh. Seeds 2
and 3 gave the same figures to the last digit for the eight plans tried (the model draws nothing from the seed).
"Slice 4" is the table below, on that afternoon's model: compare within a column.

| Plan | Slice 4: money, commute 2035, approval | Ends | Money (owed) | Commute 2026 → 2035 | Access | Deaths | Approval | People |
|---|---|---|---|---|---|---|---|---|
| `nothing` | 1,712, 58.7, 59 | finished | **1,652** | 54.0 → **52.4** | 14.9 | 1,553 | 71.3 | 222 |
| `cheap-fares` | default, month 42 | **default, month 29** | | 53.7 → | | | | |
| `dear-fares` | 12,232, 60.2, 44 | finished | 6,023 | 54.7 → 51.5 | 15.5 | 1,520 | 57.6 | 202 |
| `high-tax` | 8,926, 54.4, 40 | finished | 2,238 | 54.0 → 50.9 | 16.1 | 1,505 | 47.3 | 201 |
| `borrow-and-hold` | 1,466 | finished | 1,406 | as `nothing` | | | 71.3 | 222 |
| `careless` | 436 | finished | 507 | as `nothing` | | | 71.3 | 222 |
| `steady` | 10,577, 58.2, 33 | finished | 8,190 | 54.0 → 51.5 | 15.3 | 1,537 | 44.5 | 211 |
| `keep-up` | 8,938, 58.8, 41 | finished | 7,251 | 54.0 → 52.0 | 15.1 | 1,545 | 54.4 | 216 |
| `metro` | 2,303, 57.7, 43 | finished | 1,744 (60) | 54.7 → **49.7** | 16.0 | 1,531 | 58.7 | 216 |
| `buses` | 7,013, 57.6, 34 | finished | 5,638 | 52.1 → 51.1 | 15.2 | 1,518 | 47.2 | 216 |
| `both` | 4,113, 57.1, 35 | finished | 1,257 (360) | 52.3 → **49.1** | 16.1 | 1,501 | 52.2 | 216 |
| `roads` | (new) | finished | 1,899 | 54.0 → 51.7 | 15.5 | 1,558 | 53.3 | 216 |
| `safe-streets` | (new) | finished | 5,310 | 55.8 → 54.1 | 13.8 | **1,315** | 50.1 | 216 |
| `everything` | (new) | finished | 340 (1,842) | 50.3 → **45.8** | **17.1** | 1,339 | 51.8 | 216 |
| `careless-builder` | default, month 18 | **default, month 16** | | 55.1 → | | | 37.4 | |

**Against the aims.**
- *A sensible builder ends five minutes ahead of doing nothing:* **met by `everything`: 45.8 against 52.4, 6.6
  minutes**, with more access (17.1% against 14.9%) and fewer deaths (1,339 against 1,553). `both` ends 3.3 minutes
  ahead, `metro` 2.7, `roads` 0.7. It spends everything: ₹340 crore in hand and ₹1,842 crore owed at the end.
  What did it, besides B's model: metro lines built in 24 to 40 months and opened in two stretches; the builders
  spending by what is still to pay and borrowing, not waiting for whole costs in hand (in slice 4 they ended with
  ₹1,700 to 5,000 crore unspent); longer, checked metro suggestions; bus lanes along four routes; the city's faster
  growth for a shorter commute dropped. Bus lanes along seven routes, as B suggested, cost too much to run (every bus
  rider costs the city more than they pay) and `everything` defaulted in month 54.
- *Doing nothing gets worse:* its commute falls to 49.6 by 2028 as the Pink and Blue lines open, then rises to 52.4 by
  2035 as the city grows 3% a year. B's aim was about 55; it ends short of that.
- *Dear fares and high tax are not good ways to play.* `dear-fares` ends poorer than `keep-up` (₹6,023 against
  ₹7,251 crore) with 7% fewer people and approval 58. `high-tax` ends with about what doing nothing does (₹2,238
  against ₹1,652 crore) with approval 47 against 71; its commute is 1.5 minutes shorter only because it has 21 lakh
  fewer people, and every builder beats it.
- *Doing nothing ends with no more than it started with (MONEY-7):* ₹1,652 crore.
- *Careless building runs short within two years:* `careless-builder` defaults in month 16.
- *Every lever costs something:* `roads` has the most deaths (1,558); `safe-streets` saves 15% of deaths and costs 1.7
  minutes; `everything`'s bus lanes cost approval and money to run.
- *Replay:* `everything --check` plays its whole game again to the same game (see "Replay").

Slice 4's results, kept for comparison: 28 September 2026 at about 21:30 (`all`, seed 1, the model as B finished it then). Money in ₹ crore at the end of
the year; commute in minutes, December 2026 and December 2035; approval at the end; people in lakh. "Before" is the
slice 3 rules on the model of that afternoon (a different model: its commute started at 56.8, this one at 54.1).

| Plan | Before: ends, money 2035, commute | Ends | 2026 | 2030 | 2035 | Commute 2026 → 2035 | Approval 2035 | People 2035 |
|---|---|---|---|---|---|---|---|---|
| `nothing` | finished, −67, 56.8 → 65.3 | finished | 2,346 | 3,389 | **1,712** | 54.1 → 58.7 | 58.7 | 210 |
| `cheap-fares` | default, month 57 | **default, month 42** | 1,464 | | | 53.8 → | | |
| `dear-fares` | finished, 6,189, 57.4 → 66.0 | finished | 3,204 | 8,291 | 12,232 | 55.1 → 60.2 | 43.7 | 210 |
| `high-tax` | finished, 7,413, 56.4 → 60.7 | finished | 2,932 | 6,555 | 8,926 | 53.7 → 54.4 | 40.0 | 194 |
| `borrow-and-hold` | default, month 118 | finished | 3,118 | 3,164 | 1,466 | as `nothing` | 58.7 | 210 |
| `careless` | default, month 101 | finished | 5,297 | 2,199 | 436 | as `nothing` | 58.7 | 210 |
| `steady` | finished, 6,335, 56.8 → 64.0 | finished | 2,346 | 5,263 | 10,577 | 54.1 → 58.2 | 32.6 | 203 |
| `keep-up` | (new) | finished | 2,346 | 4,974 | 8,938 | 54.1 → 58.8 | 41.1 | 206 |
| `metro` | (new) | finished | 1,767 | 1,423 | 2,303 | 54.7 → 57.7 | 43.4 | 207 |
| `buses` | (new) | finished | 2,134 | 4,046 | 7,013 | 52.4 → 57.6 | 33.7 | 208 |
| `both` | (new) | finished | 1,826 | 1,811 | 4,113 | 52.5 → 57.1 | 35.0 | 210 |
| `careless-builder` | (new) | **default, month 18** | 1,501 | | | 56.4 → | 11.8 (Dec 2026) | |

What was built:
- `metro`: four lines, 43 km, ₹5,275 crore in all: Navy (Baiyappanahalli to Marathahalli, 9 km, ₹1,030 crore,
  ordered January 2026, open from June 2029), Brown (Mysore Road to Dr. Puneeth Rajkumar Ward, 9.8 km, ₹1,120 crore,
  August 2029), Olive (Beratena Agrahara to Silk Institute, 16.8 km, ₹2,153 crore, ordered June 2029, August 2033)
  and Slate (Kottegepalya to Sulikere, 7.6 km, ₹972 crore, November 2032). Two good lines, two weak (the suggestions'
  fault, above).
- `buses`: ten routes of 9 to 12 buses in the first ten months, and bus lanes along the first two.
- `both`: the same routes and lanes, and two metro lines (Navy, from June 2029; Brown, ordered April 2027, from
  October 2030).
- `careless-builder`: borrows ₹3,900 crore and orders 17 metro lines in its first months; broke in month 18, approval
  11.8 at its first review.

Each game took 24–29 seconds (about 200 ms a month, nearly all the model; the building plans 210–240 ms with their
suggestions). `--check` replayed `both` (120 months, two metro lines, ten bus routes, bus lanes, 36 fare and tax
changes) from its list of actions: the same game to the last character, 900,228 characters compared.

**Against the aims.**
- *Doing nothing ends with about what it started with (MONEY-7):* ₹1,712 crore against ₹2,000, having peaked at
  ₹3,389 crore in 2030. Before: −₹67 crore. The fix: the state's payment for free bus rides follows the riders, the
  grant rises 2.5% a year, and `TAX_BASE` was set again on B's final model.
- *A careful player can afford three or four lines of 15 to 20 km, not ten:* `metro`, keeping fares up with costs
  and the tax a point a year, built 43 km in four lines without borrowing and ended with ₹2,303 crore: room for one
  more of 15 km, or for borrowing. `keep-up` alone ends with ₹8,938 crore; a 15 km line is about ₹1,700 crore, plus
  its running less its fares.
- *Building carelessly runs short within two years:* `careless-builder` defaults in month 18.
- *Building sensibly ends with a shorter commute than doing nothing:* `both` 57.1 and `buses` 57.6 and `metro` 57.7
  against 58.7 (and 58.8 for `keep-up`, which raises the same money). Modest, as the suggested metro lines are.
- *No plan best on every count:* `high-tax` has the shortest commute still (54.4, because it has 16 lakh fewer
  people) and much money, but approval 40 against 59 for doing nothing, and fewer people. `dear-fares` has the most
  money and the longest commute. `nothing` has the best approval and the least to show. The builders have shorter
  commutes and less money.
- *Transit is not a money machine (MONEY-8):* see "What building does to the books". No line repays its building.

## What is judgement, not from a source

**Slice 7, all judgement** (the weights are the PRD's; the noise sizes are B's but for fairness and approval): every
mark, and the rule that sets them (40 at the start, 95 for the best of ten plans, or 15 for doing nothing and 90 for the
best); averaging approval over thirty-six months (SCORE-7) and the rest over twelve (SCORE-11); money scoring nothing
more above ₹3,000 crore and nothing at −₹4,000 crore, and counting work still to pay for; half the score lost on an
early end; fairness as the mean of the worst fifth's access against the city's average as it starts and that average
commute against the worst fifth's; growth answering tax and fares a quarter as strongly as before; approval's results (1.5 points for each
1% of commute, a point for each 1% of reach, half a point for each 1% of deaths a person, 0.6 for each point of roads;
each ±30 at most, together +40 and −20; in full from month 48); the local pushes (works −1 for each 250 m of lane in a
zone, at most −5; land −1 for each ₹10 crore, at most −30; one-way −2; taller building −5; floods −1 for each 2 km-days,
at most −5) and the halved city-wide ones (works a tenth for each 8 km of lane, land a tenth for each ₹100 crore at most
−5, one-way −0.1, taller building −0.5, floods a tenth for each 40 km-days); fares below the start welcomed and fares
left alone not; bus lanes and speed limits felt in full for a year, falling to a third after three; a tenth for each
three zones' streets mended; property values rising 2% a year; every event's frequency, size, length and place (the
festival 6%, a match 3%, six cave-ins of one to three months on roads of 600 m or more, four employers of 10,000 to
30,000 jobs, fuel +20% for six months, −10% for four, +15% for five, at most two of the season's at once); the election
dates (October 2027 and 2032), marks (40, 60) and change (a fifth); a strike after a fare a fifth up in a month, three to
seven days, on the Purple Line for a metro fare; the roads' warning after a fall of 3 points in a year; the 46 known
places and the positions of the nine added to the screen's list.

**Slice 6, all judgement** (the sources are for the costs of patching, resurfacing, concrete and street work, the
rain, the ward roads' length, and the model's lists and rules): where the roads start (by class 50 to 70, 14 off for
the outer roads, 10 off the tech corridors, ±12 by road, ±8 by stretch; streets 52, ±4 an income step, ±10), and that
it stays so because the model is calibrated to it; every amount of wear (150 a dry month, 100 for each 10,000 of load a
lane a day, heavy vehicles 9 more, rain as much again for each 100 mm, poor drains half again on a tenth of links by the
seed and every low-lying one, up to half again below 50, half again for a year after a dig, concrete a quarter;
streets 250 and up to 300 more in dense zones); utilities' digs (0.8% of roads a month, a fourth for expressways and
concrete, to 40; streets 3% a month, 6 points) and dig once's months, approval (0.2 a month) and growth (0.1% a year);
floods (the chances by mm, the days by mm, at most 10 and 5); the upkeep budget's levels, prices and what each does
(0.75 and 0.55 of the wear; mending 1.25% and 2.1% of the lane-km a month, 1.35% and 2.2% of the streets, to 65); how
far a patch raises a road (62) and how long it lasts (12 months, 6 from May to September); what resurfacing (90) and
concrete (100) raise to and their months (1 to 3 for each 20 lane-km, 6 to 12 for each 10); the shares of a
lane-km patched and the lanes a km behind the prices; a road handed back after works at 40; the standing order's range
(10 to 70); approval for roads (0.4 a month for each 10 points from 50), for mending (a tenth each 20 km, at most a
point), for floods (a tenth for each 20 km-days); the 2%, 5% and 10% more to run a bus; 2.6 in turning vehicle-hours into
minutes (fitted to the model); 2,000 links a plan; `TAX_BASE` of 16,950.

**Slice 5, all judgement:** the land price's rise with density (₹20,000 a m² plus ₹8 a person or job a km², at most ₹4
lakh) and the width of land a lane takes (3.5 m, and 7 m of verge); months for roads, flyovers, junction work and
footpaths; the redesign's cost (₹5 crore) and capacity (25% more), the signals' 10% more, the overpass's length (800 m),
lanes (two each way) and 60% more; the road width footpaths take (5%) and their upkeep; the speed limits allowed (30,
40, 50), their price (₹10 lakh) and the one-way's (₹5 lakh); the new links' speeds and capacities (the city's roads of
their class); snapping (2 km to a junction, 400 m to meet a crossed road); road lengths (300 m to 15 km, flyovers 8
km); taller building's reach (1 km), pull (+3000) and cap (half as many people again), and its ₹5 lakh for ten people
(scaled from the premium FAR terms by 0.4); growth by zone's weights (1000, 1000, 250 to 3000); every approval weight
for the new levers (land −1 a ₹50 crore, at most −10; one-way −0.3; taller building −1; limits −1 a 150,000 vehicle-km
an hour; openings of roads +2, overpasses +1.5, footpaths +0.2, redesign +0.2, signals +0.1; a first stretch +2); the
stretch at half the months; the state paying free rides at the usual fare; the tax's 1% a year off property values
for each 10% above; fares' 0.3% a year off growth for each 10% above; `TAX_BASE` of 16,300; eight model runs to check
metro suggestions, ranked by riders over the square root of cost; the road suggestions' 30 degrees, 30%, 3 km, 2.5 km
and twice as far by road; growth of 3% a year and no faster growth for a shorter commute; metro lines built in 20 months
and one more for each 830 m of viaduct, 24 to 40; approval −30 for each whole of road deaths a person above the first
month's; commute causes under 0.3 minutes left out as noise; suggested metro corridors grown to 24 km.

Every amount in `src/rules/params.ts` and `src/seasons/first.ts` but the costs a km of Namma Metro's phases, the
suburban rail project's, the bus lanes', BMTC's cost a km and the opening dates is judgement, checked against the
real budget and then by the scripted plans:

- property tax at the start (₹195.8 crore a month), the grant (₹32 crore), its rise (2.5% a year), the starting money
  (₹2,000 crore); the value of property rising 4% a year; every cost rising 4%;
- the state paying the fares of those who ride the bus free (the scheme is real; paying it by the rider is a choice);
- 26 fare days and 30 running days a month; 37 passenger-km a bus-km; ₹950 a metro train-km; rail 8 trains and ₹300 a
  km; ₹1.5 lakh a lane-km a month of upkeep (slice 6: the upkeep budget, above);
- **building:** the player's share of a metro line (30%); months to build (30 + 1.2 a km of viaduct + 2.5 a km of
  tunnel, 36 to 60); a new line's trains (a train every 5 minutes); ₹50 lakh a bus, ₹5 lakh a stop, 220 km a bus a
  day; ₹1 lakh a km a month for bus lanes; more suburban trains at ₹150 crore + ₹40 crore a train, 18 months, 6 trips
  each way a day; half of what was paid back on cancelling; three major works a month; bus lanes over 5 km being
  major; twelve months of payments in hand to start work;
- **planning:** 300 m to join a station, 2 km to a junction or road, 150 m to prefer a road, 2 km for a bus stop; a road
  "leads the right way" at 35% longer than straight plus 300 m; stations every 1.3 km and at least 600 m apart; lines
  1.2 to 40 km; names from zones within 1.5 km;
- **suggestions:** the weighing by people and jobs a km² (30,000), the corridor's growth (60 degrees, 15%, 18 km, taps
  every 4 km), and the score (fitted by eye to 24 corridors measured in the model);
- **approval:** every weight in the table above, the drift of a twelfth a month, and the review's 30;
- the loan limit, the rates and terms; growth; money running low within three months; a default after three months.

## What it gets wrong, or leaves out

**Slice 7.**
- **The score sees the last year, not the ten.** SCORE-11 averages the last twelve months (approval thirty-six), so a
  player who does nothing for seven years, saving, and then spends on what shows within three (the upkeep budget,
  resurfacing, bus lanes, junctions, footpaths, limits) scores well: `late-spender` 647, more than any plan that built
  one kind of thing for ten years (`lanes-everywhere` 541, `generous` 496). The people lived seven poor years that the
  score does not count; only approval's three years and money hold it back. It cannot build metro that late. A remedy
  is the coordinator's to choose: the final score could take every year, the last counting most (a change to
  SCORE-11), or approval could count the whole term.
- **Metro barely moves the city's measures** in the model: five lines take `metro` from 308 to 432, access from 10.6%
  to 11.5% and clean travel from 50.4% to 51.3%, since the new lines take their riders from the buses. So transit alone
  does not reach the 500s, and the upkeep budget (`generous`, nothing built) scores more than metro and buses (`both`).
  The score reports what the model says.
- **The city as it starts scores 547, not 400**, and doing nothing ends at 308: see "The marks".
- **Access has a narrow range** at the top: the best plan ends at 15.5%, a little above the 13.7% the city starts with.
- **Clean travel rewards misery a little:** broken roads push people onto buses and on foot, so `neglect` scores 100 on
  clean travel and `generous` 6. The other measures outweigh it.
- **Safety favours slow roads:** 30 km/h everywhere scores 100 on safety; the commute and approval pay for it
  (`slow-everywhere` 229).
- **A smaller city scores better**, since every measure but money is for each person. Growth now answers tax and fares
  a quarter as strongly as before, so driving people away does not pay; any other lever that slowed growth would.
- **Bus lanes everywhere is judged good governance** (`lanes-everywhere` 541): with fares and tax kept up with costs it
  does not go broke in the model, and it takes 9 minutes off doing nothing's commute. Drivers' resentment now fades; at
  full strength for ten years it would be replaced.
- **Defaulting late is not much worse than doing nothing:** `cheap-fares` and `last-year` default and score 285, just
  under doing nothing's 308, because their measures were good when they broke. Half the score is lost; a harsher
  penalty is a choice for the coordinator.
- **Events are few and small** by design (the weather of the game); all players of a season meet the same. The fuel
  price rise of May to October 2035 falls in the last year scored, alike for everyone.
- **Approval's noise** (half a point, for the marks tool) and **fairness's** (0.3 points) are judgement; B measured the
  rest.

**Slice 6.**
- **The city starts poor, not "a little under fair"** (43.9 by length, two-thirds of it poor). The model is calibrated
  to it; moving it means calibrating again. The coordinator accepted it: it gives the player more to mend.
- **Doing nothing ends richer than it started** (₹4,555 crore against ₹2,000, PRD MONEY-7), because the opening was
  set level as asked. Setting `TAX_BASE` back to 16,300 gives about ₹3,500 crore less at the end to every plan and a
  first month ₹9.6 crore short. The score slice should decide which aim wins.
- **Neglect for ten years is fatal, not a partial loss.** The PRD's "a grade in three years" at bare, kept up for ten,
  is three grades: the roads are broken by 2030, the commute is worse than doing nothing, and approval brings a
  replacement in year five. A bare budget for the first three years and then steady (`lean-start`) is the real
  temptation: it pays for building, and costs 1.4 minutes at the end against `everything`.
- **Mending the busiest roads costs approval while it is done**: resurfacing takes a lane for its one to three months,
  which counts as works (88 km of links of the Outer Ring Road and Hosur Road at once: 2.7 minutes of commute and 6.6
  points of approval for three months). `keep-roads` ends no better liked than `keep-up` for that reason; `generous`,
  which mends without closing lanes, ends 11 points better liked. The PRD asks for the lane (UPK-10); night work is not
  in the game.
- **The upkeep budget is blind to traffic**: it mends the worst stretches first, however few use them. The player's
  lever is to mend where it counts. A real budget is not so blind.
- **Utilities dig at random.** Where they dig does not follow the city's growth or the season's works.
- **Doing nothing is still the best liked** of the plans that finish (69), as in slice 5; left for the score slice.
  (Slice 7: no longer; see "Approval".)
- **Floods do not follow the rain within a month** (a day's cloudburst); the days shut are from the month's total.
- **Names are by map name**: the Outer Ring Road is in pieces where flyovers and service roads break it, and the worst
  roads may name "Outer Ring Road, Shivanasamudra Ward" and "Outer Ring Road, J.P. Park" apart. (Slice 7: named by the
  places they run between.)
- **Better roads bring more bus riders, who cost the city money** (slice 5's known problem): keeping roads up raises the
  bus bill.

**Slice 5.**
- **Only a builder who does nearly everything reaches five minutes**, and ends in debt: `both` ends 3.3 minutes ahead,
  `metro` 2.7. Doing nothing ends at 52.4, not the 55 B aimed at.
- **Bus riders cost the city money**, so the strongest lever in the model (bus lanes) is held back by the books as
  well as by drivers: lanes along seven routes bankrupted `everything`.
- **The seed changes nothing** in the model: seeds 1 to 3 gave identical games.
- **Growth sorting helps the idle as much as the builder.** Stronger weights by zone shortened every plan's commute,
  doing nothing's most. Kept modest.
- **Flyovers move the jam, and do little else**, in the model: the five suggested, opened at once, changed the commute
  by −0.1 to +0.2 minutes each. That is the PRD's catch (BLD-5), but it leaves roads a weak lever; the `roads` player
  ends 0.8 minutes ahead, with more deaths. Suggested roads are not checked with the model.
- **Any change to the network moves access by up to ±0.3 points as noise**, since the model's routes are found on a
  guess sized to the network's capacity (docs/MODEL.md).
- **No new junction part-way along a road.** Places snap to junctions that are there; a road on the ground meets a
  road it crosses only at that road's nearer junction within 400 m, and passes others as if over them. Chosen so that
  no kept id moves (see "The network the model is given").
- **No water.** A road may be drawn straight across a lake between two junctions; nothing refuses it.
- **Taller building is a policy, not a project:** it acts from the month it is allowed, and its income follows growth
  alone; it does not raise jobs, and the zone's crowding is only what the model makes of more people there.
- **Footpaths narrow every main road in the zone by 5%**, a judgement that, with the model's slower walking and
  limits, makes `safe-streets` 1.4 minutes slower over ten years.
- **Deaths moved while this was written:** 978 a year in 2035 for doing nothing in one run, 1,510 in the next, as the
  model's road deaths were calibrated.

- **Suggested metro lines are uneven.** The score is a guess at what the model will do, and two of five suggestions
  on the final model carried 20,000 to 24,000 a weekday: lines through dense western suburbs that join one line, for
  which the model finds few riders. The model cannot be run inside `suggest` (it takes 130–200 ms a run, and the
  rules' `suggest` has no model to call). The screen's forecast should be the guide; a slice could let `suggest` take
  a model and check its best few.
- **Bus routes do little on their own** in the model (7,000 riders for 10 buses on the Outer Ring Road; fares across
  the city fall slightly as riders leave the metro), while bus lanes do much, since they speed the city's own buses on
  those roads: 5 km each way on the Outer Ring Road took 3.3% off the city's commute for ₹17 crore. Approval is what
  holds them back, and its weight is a fine balance: with lanes along all ten of its routes (about 200 km of lane)
  the `buses` player took 4.2 minutes off the commute and was replaced in month 36 at a drivers' weight of 18,000,
  kept 46.5 approval at 36,000; the scripted player now lays lanes along two routes, at 40,000. More riders on the
  city's buses also cost money (₹21.6 a trip to run, ₹16.7 a trip in fares and the state's payment).
- **More suburban trains do almost nothing** for their ₹310 crore: the model's suburban rail is small (1.07 lakh trips)
  and slow to answer. The prices are in proportion to K-RIDE; the model decides the effect.
- **Lakes and the city's edge are not in the city data.** A station snaps to a junction or road, which are never in
  water, and a tap far from any road is refused; but a tunnel may pass under a lake (as tunnels do). To refuse water
  itself, the city data would need water polygons (asked below).
- **A station ordered but not yet built cannot be joined:** a second line tapped at a station of a line still being
  built gets a station of its own there (it will be named apart, "North" and so on), not an interchange.
- **The Pink and Blue lines open on today's targets,** which have slipped before; a season may make them late.
- **Approval is one figure for the city,** from a handful of pushes; by zone, roads, floods and deaths come in slice 7.
- **The balance rests on the model's figures,** which moved all day. `TAX_BASE` was last set at +₹28.0 crore.
- **The bus hardly answers its fare,** as slice 3 found; dear fares still earn much (now more, since the state pays
  the free riders' fares too). Approval is now their cost.

## For the screen and the server

- **Slice 9.** `version` is 7 (resurfacing stretch by stretch; money scored in full from ₹1,000 crore): games kept under
  6 play out differently, and the server must be restarted. `rules.advise(game, city, { levers?, count?, simulate?,
  result? })` (optional in `Rules`) and the `Advice` type: call it in the worker with the worker's model, and in a first
  game with `levers: unlocked(game.month)`; before the first month pass the month's result if the worker has it.
  `src/rules/unlock.ts`: `unlocked`, `arriving`, `ARRIVALS`, `leverOf`, type `Lever`. `Report.urgent` (optional): what
  of `needs` the player must act on, for "Needs you"; `needs` still says why a skip stopped. `resurfacedIn(project,
  month)` in `upkeep.ts`: the stretches a resurfacing does in a month (the rest of its `disrupted` are open). The
  city as it starts scores 561. A report's causes may now say "roads shut by the monsoon floods".

- **Slice 8.** `version` is 6 (the score of ten years). `gameDigest(game)` from `src/rules/digest.ts` is the
  fingerprint both sides compare (above). `Score.years` (optional, added): each year reached with its own total, its
  weight in thousandths and whether it is done, for the score page; the total and each measure's points are the years
  weighed. `Season.years` (optional, added): the weights; omitted, the first season's. `scoreWith` (a forecast) is the
  score of a year: the score a year on if this month's traffic held, as before; the difference it shows is to one
  year's score, which counts in the game by that year's weight. `rules.replay(season, city, done, simulate, until?,
  reports = true)`: with `reports` false, for the server's checks, no reports. `openSeason` from
  `src/seasons/open.ts`: the first season with the daily allowance on, id `first-open`, scored exactly alike.
  Everything the rules keep is plain JSON, and nothing is kept between calls but caches of what is built from the
  city's data (tested: games worked out in turn, and each from a JSON copy, come out as each does alone).
- **Slice 7.** `version` is 5. `rules.score(game, city)` gives `game.score`; before the first month, the score of the
  city as it starts, from the season's `opening` figures (set by `rules.start`).
  `Game.score`, `Game.scores` (the total at each year's end, and at an early end), `Game.events` (in force in the
  month the player is in); `Report.score` `{ now, before }` and `Report.events` (those beginning with the next month and
  those that ended in the span), as agreed. A measure's `causes` are money's and approval's from the month, the traffic
  measures' from a skip's `explain`; `{ text: 'No measurable change', amount: 0 }` where the change is within the noise.
  Added, all optional: `Season.opening` (the city as it starts), `Report.measured` (the figures of the month before
  the span and of its last month: a span's causes are judged over the whole span), `Game.measured` (each month's
  figures, type `Measured`), `Game.zoneApproval` (tenths, in the order
  of the city's zones: the approval map view), `Game.firstZones`, `Game.grantShare`; `Score.penalty`; `Season.elections`;
  `Setup.events` (type `EventEffect`); `GameEvent.lines`; the first season's `marks`. `WorstRoad.length` is now metres
  of road, each road once.
- From `src/rules/score.ts`: `MEASURES`, `measureName`, `measureUnit`, `shownValue`, `marksOf`, `pointsFor`,
  `fairness`, `worstServed(result, game, city)` (the zones in the worst-served fifth by access and by commute, for the
  fairness view), `scoreWith(game, city, result, people?, money?)` (for a forecast: the score a year on if this
  month's traffic held, with money for the score as given: take it with and without a plan, one model run a side and no
  months played, where playing twelve months on copies costs about 0.2 s a side), `averageOf`.
- From `src/rules/why.ts`: `whyZone(game, city, zone)` and `whyRoad(game, city, link)` (type `Why`: title, lines,
  causes, links). A zone's runs `delayByRoad` (50 to 100 ms); call it in the worker.
- From `src/rules/events.ts`: `seasonEvents(season, city)` (the season's, for a calendar), `eventsIn(game, city,
  month?)`, `allEvents`, `strikes(game)`. Each event's `at`, `links` and `zones` are for the map; a cave-in's `links`
  are shut (in `rules.state(...).shut` at 1000).
- From `src/rules/upkeep.ts`: `roadsWarning`, `putRightCost`, `placesOf`, `stretchName`, `nameOf`, `roadsByZone`.
- The generous budget: the rules give ₹124 crore a month in January 2026 both in the news when it is set and in the
  books (checked); ₹147 crore is what it costs in a later year (4% a year, and the roads the player built). Where the
  screen shows a figure beside a level, it should say for which month.

- `rules` (the agreed `Rules`) and `version` (now 4, slice 6: a kept game of an earlier version plays differently) are exported from
  `src/rules/index.ts`; `firstSeason` from `src/seasons/first.ts`.
- `rules.quote` and `rules.suggest` are pure and quick: a quote takes about 1.5 ms on the real city, the suggestions
  about 50–150 ms (they quote up to 60 corridors).
- `rules.state(game, city)` gives the model everything: the grown people and jobs, the transit with the season's and
  the player's lines, `busLanes`, `vehicles` (totals, as the model wants them), and `works`.
- `game.built` is kept by the rules: `lines` and `stations` the player has open, `busLanes`, and `vehicles` by line id
  (the player's lines: their number; the city's lines: **the change**; suburban lines: the trains added). The
  screen's stand-in `openInto` should add a suburban order's trains to that change, not to a default of 8.
- `game.projects` holds work under way: its plan, name, month started, month it opens, cost, quote (stations, path,
  disrupted links) and the line id it will open as. What it pays each month is `installment(p, month)` in
  `src/rules/money.ts`; what it has paid, `paidBy(p, month)`.
- `game.approval` (tenths), `game.pressures` (words and points, largest first), `game.warnings`; `approvalWord` in
  `src/rules/approval.ts`; a December report's `review`. Status may now be `replaced`.
- `rules.snap(game, city, kind, stop)` for a lone tap (an optional member of `Rules`).
- Added to the agreed types, all optional: `Season.openings` and `Season.allowance`; `Project.line`; `Game.warnings`
  and `Game.told`; `Game.inputs.setup` and the `Setup` type; `Quote.stations[].stop`; `Report.review` and the
  `Review` type; `Rules.snap`; and the status `replaced`.
- **Slice 5.** Added, all optional: `Quote.land` (what of a road's cost is land); `Built.roads[].nodes` (the routing
  nodes a road runs through, in order: the network is made from them); `Setup.onRoads`; `Game.zonePeople` (people by
  zone, in the order of the city's zones) and `Game.value` (the value of property, ten-thousandths); `RoutingNode.work`
  in `src/sim/types.ts` (the player's work at a junction, for the model's road deaths). Widened: `Rules.suggest` takes
  `'road'`, and an optional `simulate` to check metro suggestions.
- `rules.state(game, city).roads` is the network with the player's roads: draw traffic on the city's links by their
  `drawn` stretches as before; links from `city.roads.links.length` on are the player's (both ways, in the order of
  `built.roads` and its stretches between `nodes`), with no drawn stretch: draw `built.roads[].path`. A shut link (the
  far side of a one-way street) runs from its start to its start and carries nothing; `built.oneWay` lists the links
  left open, for arrows.
- `rules.quote` for the new plans; `months: 0` means it is done and paid at once (one-way, speed limits, taller
  building): no project is made. A road's `stations` are the junctions it meets, `stop` on those tapped.
- Deaths: `result.deaths` and `deathsByZone` are the model's; the report's `safety` figure comes when they do.
- **Slice 6.** `version` is 4. New plans `repair` and `streets`, actions `upkeep` and `digOnce`, as agreed. The game
  starts with `condition` (by routing link), `streets` (by zone id), `concrete: []`, `upkeep: 'steady'`,
  `digOnce: false`; `condition` grows as the player's roads open (they join at 100). Added, all optional:
  `Game.wear` (the finer figures, type `Wear`) and `Game.patchBelow` (the standing order); `Plan.makeGood` on `metro`,
  `road`, `junction`; `Action.patchBelow` on `upkeep` (absent leaves the order as it is, `null` stops it);
  `Quote.condition`, `lasts` (months), `note` (words for the player) and `makeGood` (lakh); `Setup.surface`,
  `streets`, `shut`; `Report.worstRoads` (type `WorstRoad`: name, links in poor or broken repair, length, condition,
  vehicle-hours a weekday) and `Report.flooded` (links and days, a span's added up); the figure `roads` (last in the
  list). `rules.state(game, city).shut` is the month's floods.
- From `src/rules/upkeep.ts` for the screen: `namedRoad(game, city, link)` (the whole of a named road, both ways, for
  "all of Hosur Road that is poor"; filter by `game.condition` for the grade), `grade(points)`, `roadsFigure`,
  `rainIn(season, month)` and `floodsIn(season, city, month)` (what the monsoon will do, for the news or a warning),
  `patchMonths(month)` (6 from May to September, else 12), `monsoonYear`. A patch plan is done and paid at once
  (`months: 0`); resurfacing and concrete are projects like any other, their `disrupted` links in `works` while they
  last; a resurfacing project's name is "Resurfacing 3.2 km of Hosur Road".
- The quote's `note` gives hours a weekday saved at last month's traffic by arithmetic; for the city's commute and the
  zones along the road, the screen should run the model with the changed surface (B), as for other forecasts.
