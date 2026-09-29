# Slice 6: road condition and upkeep — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` in full (section 5.4 and 7.3 above all), `docs/MODEL.md`, `docs/RULES.md`
and `docs/DATA.md`. Read `docs/SLICE1.md` for the facts and conventions, and `docs/SLICE4.md` and `docs/SLICE5.md`
for how building works. They still hold.

Slices 1 to 5 drew the city, made it move, made it a game of months and money, and let the player build transit,
roads, junctions, footpaths and policy. The player has looked at the map and the moving city and said they are
right. **Keep the look as it is.**

Slice 6 is the state of the roads. The player asked for it in these words: "we should also have a lever of fixing
roads/potholes. they slow down the traffic". Every Bangalorean knows the pothole, the monsoon that opens it, the
utility that digs up a road the week after it was laid, and the white-topped road that is closed for a year and then
lasts twenty. That is the slice.

**The project does not compile as you start.** New kinds of plan (`repair`, `streets`) and action (`upkeep`,
`digOnce`) are in `src/rules/types.ts`, and the code that switches over them in `src/rules/`, `src/game/` and
`src/ui/` does not yet know them. D and C: your first act is to make your own files compile, within your first few
minutes, by refusing the new kinds with "This cannot be done yet".

## What done looks like

- Every main road has a condition, and every zone's minor streets have one. The player can see it on the map.
- Roads wear: faster under heavy traffic, trucks and buses, in the monsoon, where drains are poor, and after a
  utility digs. Left alone, the city's roads fall about a grade in three years (PRD UPK-13).
- Poor roads slow traffic, carry less, kill more (two-wheeler riders above all), slow the buses and cost more to
  run them, and displease the people who live along them (PRD ROAD-3 to ROAD-5).
- The player can patch, resurface, or lay concrete; mend a zone's streets; set a standing budget for upkeep; and
  make utilities dig only in set months. Each shows its cost, its time and what it is expected to do before the
  player commits. Patching before or during a monsoon lasts half as long, and the game says so (PRD UPK-11).
- The monsoon comes every year from June to September: roads wear faster, low-lying roads flood and shut for days.
- The report names the worst roads and the delay each causes (PRD ROAD-6).
- Neglect visibly slows the city; repair visibly helps; the report says by how much. A scripted player who neglects
  the roads for ten years ends clearly worse than one who keeps them up, and keeping them up costs real money.
- Playing the same actions again still gives the same game exactly.

## The agreed interfaces

`src/sim/types.ts`, `src/rules/types.ts` and `src/data/types.ts` are fixed. Build to them. You may add optional
fields, saying so in your report. New in this slice, already in the files:

```ts
// src/rules/types.ts
Plan: 'repair' { links, work: 'patch' | 'resurface' | 'concrete' } | 'streets' { zone, work: 'patch' | 'resurface' }
Action: 'upkeep' { level: 'bare' | 'steady' | 'generous' } | 'digOnce' { on }
Game.condition (by routing link, 0 to 100), Game.streets (by zone), Game.concrete, Game.upkeep, Game.digOnce
Surface: 'good' | 'fair' | 'poor' | 'broken'
Figure.key: 'roads'

// src/sim/types.ts
CityState.surface (by routing link, 0 to 100), CityState.streets (by zone, 0 to 100), CityState.shut
```

The rules keep the condition and pass it to the model each month as `surface` and `streets`. The model turns it into
speed, capacity, deaths and the cost of running buses. `CityState.condition` (a share of free speed, from slice 2)
stays for anything else that slows a road.

Grades, for everyone: **good** 75 and above, **fair** 50 to 74, **poor** 25 to 49, **broken** under 25.

## Who owns what

| Person | Owns |
|---|---|
| **B: the model** | `src/sim/*` except `types.ts` and `worker.ts`, `tools/run-month.ts`, `tools/calibrate.ts`, `tools/measure-*.ts`, `docs/MODEL.md`, `docs/DATA.md`, tests `sim*`, `demand`, `modes`, `assign`, `determinism` |
| **D: the rules** | `src/rules/*` except `types.ts`, `src/seasons/*`, `tools/playthrough.ts`, `docs/RULES.md`, tests `rules*`, `books`, `loans`, `report`, `replay`, `skip`, `build*`, `approval`, `roads*`, `policy*`, `upkeep*`, `wear*`, `monsoon*` |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `src/game/*`, `src/sim/worker.ts`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, tests `screen*`, `style`, `playback`, `turns` |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `src/data/*`, `public/data/*`, `public/tiles/`, or the `tools/build-*`
and `tools/fetch-*` scripts.

## The jobs

### B: the model
1. **What a poor road does (PRD ROAD-3).** From `CityState.surface`, by link: speed and capacity fall with
   condition. The PRD's marks: fair −5% speed; poor −20% speed and −10% capacity; broken −40% speed and −25%
   capacity. Make it smooth between the marks, not steps, so that a point of condition is always worth something.
   A road at 100 is exactly as today, so that nothing moves for a city in perfect repair.
2. **Minor streets.** From `CityState.streets`, by zone: poor streets slow the first and last stretch of every trip
   that starts or ends there, by road, by bus and on foot to a station.
3. **Deaths (ROAD-4).** Poor surfaces kill more, two-wheeler riders above all. Find what is published on potholes
   and road deaths in Bengaluru and India (the ministry's yearly report gives deaths by road defect), cite it, and
   set the size. Remember the model's known property: slower traffic kills fewer. A broken road must not come out
   safer than a good one because it is slow; say in `docs/MODEL.md` how you made sure.
4. **Buses (ROAD-5).** Poor roads slow buses as they slow cars, and wear them: give the rules what they need to
   charge more for running buses over poor roads (bus-kilometres by surface grade, as an optional field of the
   result).
5. **Wear needs traffic.** The rules wear each road by what it carried. Give them, as optional fields of the
   result: for each link, vehicles a day, and of those the heavy ones (buses, and goods vehicles from your
   commercial traffic term).
6. **Flooding.** `CityState.shut`: links shut for a share of the month. A link shut for 100 thousandths of the
   month carries nothing for that share and as usual for the rest: work it out as a blend of two months, or another
   way that is sound and cheap, and say which. Routes must move round a shut road.
7. **Where the roads flood.** The rules need to know which links lie low. There is no terrain in the data. Find a
   sound stand-in: links within some metres of a lake or a drain (the base map's tiles carry water, and
   OpenStreetMap carries `waterway=drain` and `waterway=stream`), and the underpasses (links with a level below 0).
   Bengaluru's flood-prone spots are published yearly by the city (the BBMP's list of vulnerable points): find it,
   cite it, and check your stand-in against it. Write the list of flood-prone links to a file the rules can read
   (`src/sim/lowland.ts`, a list of link ids, built by a tool of yours from data you fetch), and say how good it is.
8. **What repair is worth.** Extend `tools/measure-roads.ts`: the city with every road at 100, at 60, at 40; the
   Outer Ring Road alone taken from 40 to 100; a zone's streets from 30 to 90. Commute, speeds, deaths, the cost of
   running buses. Report the table. Repair of a busy road in poor condition should be clearly worth having; of an
   empty road, not.
9. **Speed and sameness.** A month still in about 160 ms in Chromium. The determinism test and the engines check
   still pass.
10. Keep `simulate` working at every moment. D and C call it constantly.

### D: the rules
1. **Compile first** (see "Where things stand").
2. **Condition at the start (PRD ROAD-8).** Every link and every zone's streets, the same for every player of a
   season: a mix, worst on the outer roads and the tech corridors, from the season's seed by exact arithmetic.
   The city as a whole starts a little under "fair".
3. **Wear (ROAD-2).** Each month each road loses condition: by what it carried and how much of it was heavy (B
   gives both), more in June to September, more where it floods, more after a utility digs. Concrete wears a
   quarter as fast. Whole numbers kept in finer units than the 0 to 100 shown, so that a month's wear is not lost
   in rounding.
4. **Utilities dig.** Each month some roads are dug up by utilities, by the season's seed: a dug road drops to
   poor. With "dig once" they dig only in two set months of the year, and restore the road to what it was.
   Dig once costs approval with utilities and slows new connections: make that a small cost in growth.
5. **The monsoon (PRD EVT-1).** June to September, every year, with a strength set by the season for each year.
   Roads wear faster. Flood-prone links (B's list) shut for some days in a heavy month, passed to the model as
   `shut`. Poor drainage is a property of the link for now; drains themselves are a later lever.
6. **Repair (`repair`, `streets`).** Patching: within the month, very low cost, raises to fair, and wears off in
   about a year, in half that if done from May to September (say so in the quote's words). Resurfacing: 1 to 3
   months, medium cost, raises to good, lasts 4 to 6 years, shuts a lane while done. Concrete: 6 to 12 months, high
   cost, a major action, raises to new and wears a quarter as fast, shuts half the road while done. Streets of a
   zone likewise, without concrete. Costs by lane-kilometre, from what is published for Bengaluru (the
   white-topping programme and the yearly pothole and resurfacing budgets), cited with dates.
7. **The upkeep budget (UPK-4, UPK-13).** Bare, steady, generous: a monthly sum. It slows wear everywhere and
   patches the worst automatically. At bare the city's roads fall about a grade in three years; at steady they
   hold; at generous they slowly improve. The road upkeep already in the books becomes this.
8. **What building does to roads (UPK-12, UPK-14).** A road dug up for a metro or another work returns at poor
   unless the project paid to make good, a choice when it is ordered (add an optional field to the plan). New roads
   add to the upkeep bill.
9. **Approval and the report.** Poor roads displease the people of the zones they run through. The report gives
   the state of the roads as a figure (the share of main-road length that is good or fair), names the five worst
   roads that matter most with the delay each causes, and gives causes like any other.
10. **Standing order (PRD TIME-10).** "Patch the potholes in a zone when its roads fall below a set condition", as
    a rule the player sets once.
11. **Scripted players.** `tools/playthrough.ts`: `neglect` (upkeep at bare, no repair, otherwise as `everything`),
    `keep-roads` (steady, and resurfaces the busiest poor roads each year), `concrete` (lays concrete on the ring
    road and the main radials), and `everything` brought up to date to look after its roads. Report them side by
    side: money, commute, deaths, state of the roads and approval at the end.
12. **The balance.** At the end of slice 5: nothing ends 2035 with a commute of 52.4 minutes and ₹1,652 crore;
    `everything` with 45.8 minutes, ₹340 crore in hand and ₹1,842 crore owed. Road condition is a new drain on
    money and a new drag on the commute. After this slice the player who does nothing should end worse than 52.4,
    the one who neglects roads but builds should lose part of what building gained, and the one who looks after
    everything should still end at least five minutes ahead of doing nothing, without defaulting. Retune and say
    what you changed.
13. **Replay and refusal**, as before, with a whole game that uses every new lever.
14. B is changing the model while you work. Until B's fields appear (vehicles by link, heavy vehicles, the list of
    flood-prone links), use stand-ins of your own, and switch when they do.

### C: screen
1. **Compile first** (see "Where things stand").
2. **The road condition view (PRD ROAD-6, UI-3).** A map view that colours every main road by its grade, and shades
   zones by their streets, in colours that cannot be mistaken for traffic: traffic is amber, orange and red, so road
   condition needs a scale of its own that sits in the look (consider greys to a dark brown, or a cool scale). With
   a key. Roads laid in concrete are marked.
3. **The tools.** In the Build page, a third group, "Upkeep": Patch potholes, Resurface, Lay concrete, Mend a
   zone's streets. Roads are chosen by tap, stretch by stretch, as bus lanes are; a tap on a named road offers the
   whole of that road in poor or broken condition at once ("All 14 km of Hosur Road that is poor"), since nobody
   wants to tap forty stretches. While an upkeep tool is chosen the map shows the road condition view.
4. **The proposal and forecast:** what it costs, how long, how long it will last, what it shuts while done, and
   what it is expected to do for the road and for the city. The warning about patching in the monsoon where it
   applies.
5. **The upkeep budget and dig once** in the Levers page, with what each level costs and is expected to do.
6. **Standing orders** in the Levers page: the one for potholes from this slice, shown with the two from earlier
   slices if the rules have them.
7. **The monsoon on the map.** In a monsoon month: roads that flooded are marked in the traffic view in a blue
   that reads as water, with the days shut. The news says what flooded. Keep it quiet: it is weather, not an alarm.
8. **The report:** the state of the roads as a figure with its causes; the worst roads named, each with its delay
   and a way to go to it on the map and mend it.
9. **The flyover that cannot be seen (from slice 5).** A flyover the player builds along the line of a metro line
   is hidden beneath it. Draw the player's flyovers so that they can be seen where they share a line with transit:
   a small offset to one side, as the base map draws a road beside a railway.
10. **Road deaths per person.** The road deaths view shades by the number of deaths in a zone, so large outer
    zones look darkest whatever their people. Shade by deaths per lakh people, and say so in the key.
11. **Look at everything.** `tools/look-upkeep.mjs`: by script, at laptop and phone size: the road condition view;
    patch a road, resurface a named road, lay concrete; set the budget; skip through a monsoon and see what
    flooded; read the report's worst roads and go to one. Screenshots of each. Open each with the Read tool and
    look.
12. Until D's rules take the new plans and actions, build against stand-ins of your own in the agreed shape.

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: what each lever does, costs and times, the plans against each other, timings, memory.
- Each screenshot you opened and what you saw (C).
- The three checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
