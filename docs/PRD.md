# Peak Ooru — Product Requirements Document

| | |
|---|---|
| **Status** | Draft v1.0, for review. Nothing in this document is built yet. |
| **Date** | 2026-09-28 |
| **Replaces** | NamDaari (`docs/PRD.md`), the five-district single-player game. Its code is the starting point. |
| **Platform** | Browser, desktop and phone. No install. |
| **Name** | *Peak Ooru* (ಪೀಕ್ ಊರು). "Ooru" is Kannada for town, and sounds like "hour". Kannada spelling to be checked by a native speaker. |
| **Tagline** | Bengaluru, 2026–2036 |

All money, prices, populations and dates in this document are game values to be tuned. None is a real figure.

---

## 1. Summary

The player is handed Bengaluru in January 2026 with a budget and ten years. Each turn is one month. The player
raises money, builds transit and roads, keeps the roads in repair, and sets policy. In December 2035 the term ends,
and the player's governance score goes on a leaderboard.

Everyone in a season starts with the same city and meets the same events. Players do not share a city and need not
play at the same time. A full game is two to ten hours of play, spread over at least ten days.

### What makes it different
- **A real city.** The map is Bengaluru from OpenStreetMap, with its real roads, metro lines and lakes.
- **The whole job.** Revenue, building, upkeep and policy, not only metro lines.
- **A score that can be explained.** Every change in the score comes with its reasons.
- **A fair contest.** Same city, same events, and a server that checks every score.

## 2. Goals and non-goals

### Goals
| ID | Goal | Measure |
|---|---|---|
| G-1 | People finish a game | 40% of players who end their first day finish the ten years |
| G-2 | People come back daily | Median player plays on 8 or more days of a season |
| G-3 | The score feels fair | Under 5% of finished games disputed; no verified score is wrong |
| G-4 | It runs well everywhere | Targets in section 14 met on a mid-range laptop and a mid-range phone |
| G-5 | A Bangalorean recognises the city | Tested with five people who live there, before the first season |

### Non-goals
- Not a 3D city builder. The player does not zone land or place buildings.
- Not a shared world. Players never change each other's city.
- Not a real-time game. Nothing happens while the player is away.
- Not a planning tool. The model is plausible, not predictive, and says so.
- No paid items that affect the score.

## 3. Players

| Player | What they want | What we give them |
|---|---|---|
| **The Bangalorean** | To fix the commute they sit in every day | Their own road, junction and ward, by name |
| **The strategy player** | A hard optimisation with a clear score | Trade-offs, a leaderboard, other players' cities to study |
| **The transit enthusiast** | To draw the network the city should have | Precise station and line placement at street level |
| **The casual visitor** | Ten minutes of something interesting | A first month that teaches by doing, and "skip ahead" |

## 4. Time

| ID | Requirement |
|---|---|
| TIME-1 | The game runs from January 2026 to December 2035: 120 months. |
| TIME-2 | One turn is one month. The player acts, then ends the month. |
| TIME-3 | **Next month** advances one month. |
| TIME-4 | **Skip to next event** advances until something needs the player: a project opens, money runs low, an event starts, a grant condition falls due, or a yearly review. |
| TIME-5 | **Skip ahead** advances 3, 6 or 12 months, and stops early for anything in TIME-4. |
| TIME-6 | A skip never passes a moment at which the player could lose the game. |
| TIME-7 | **Daily allowance:** 12 game months a day. Unused months carry over, to at most 36. The day turns at midnight, India time. Switched off while the game is being built, and in practice games. |
| TIME-8 | After a skip the player gets one report for the whole span, not one per month. |
| TIME-9 | A month shows as a typical weekday played back in about 15 seconds. It can be skipped. After a skip of several months only the last is played back. |
| TIME-10 | **Standing orders** are simple rules the player sets once. At launch: add vehicles to a line over 90% full; repay the dearest loan when cash is above a set amount; patch potholes in a ward when its roads fall below a set condition. |
| TIME-11 | A yearly review each December reports the year, and approval decides what follows (section 10). |

### Expected length
| Style | Stops | Play time |
|---|---|---|
| Every month | 120 | 8–10 hours |
| Mostly skipping to events | 50–60 | 4–5 hours |
| Hands-off, with standing orders | 25–30 | 2–3 hours |

The shortest possible game is 10 days.

## 5. The city

### 5.1 Map
| ID | Requirement |
|---|---|
| CITY-1 | The map covers the area of the Greater Bengaluru Authority, with a margin for the roads and railways that enter it. |
| CITY-2 | The city is divided into 411 zones: the 369 wards of the Greater Bengaluru Authority, and 42 coarser zones for the rest of the map. Each has people, jobs and income level. All figures are estimates, and the game says so. |
| CITY-3 | The main roads as mapped are 17,362 stretches between 11,385 junctions: motorway, trunk, primary, secondary and tertiary. They are drawn in full. Traffic is worked out on a simplified form of about 5,000 stretches, to be built in slice 2, and shown on the full one. |
| CITY-4 | Minor streets are drawn when zoomed in, for placing things, but carry no modelled traffic. Each zone has a figure for how well its minor streets work. |
| CITY-5 | Existing transit is in the game from the start: metro lines in service, metro lines under construction with opening dates set by the season, suburban railway tracks and stations, and the main bus corridors. |
| CITY-6 | Lakes, parks, railways and place names are drawn as on the accepted NamDaari map. |
| CITY-7 | Credit "© OpenStreetMap contributors" is always visible. |

### 5.2 People and trips
| ID | Requirement |
|---|---|
| CITY-10 | Trips run between zones, and to and from the ways into the city. Commuting dominates, with morning and evening peaks. |
| CITY-11 | People travel by car, two-wheeler, auto or cab, bus, metro, suburban rail, cycle, or on foot. |
| CITY-12 | Each group of travellers chooses by a cost with four parts: time, money, comfort and safety. Income changes the weights: money matters more to the poor, time to the rich. |
| CITY-13 | Fares, parking charges, the congestion charge and fuel cost all enter the money part. This is what makes revenue levers change behaviour. |
| CITY-14 | People reach a station on foot, by cycle, by feeder, or by auto or two-wheeler, each with its own reach. |
| CITY-15 | The population grows each year, faster where commutes are good and land is allowed to be built on. Vehicle ownership grows with income and falls with good transit and high charges. |

### 5.3 Traffic
| ID | Requirement |
|---|---|
| CITY-20 | Traffic is modelled as flows on the main roads, not as single vehicles. Each stretch has a capacity; speed falls as flow nears it. |
| CITY-21 | Flows are worked out for four parts of a weekday: morning peak, midday, evening peak, night. |
| CITY-22 | Drivers spread over routes until no one can save time by changing, within a fixed number of rounds. |
| CITY-22a | When a road is full, some travellers set out earlier or later, as they do in life: the peak spreads. No road carries much more than it can hold. |
| CITY-23 | Junctions limit capacity. Signals, flyovers and redesign change the limit. |
| CITY-24 | Two-wheelers take less road than cars. Buses take more but carry far more. Bus lanes give buses free speed and take a lane from the rest. |
| CITY-25 | The result is the same for the same inputs on every machine, to the last digit (section 12). |

### 5.4 Road condition
Potholes and broken surfaces slow traffic. This is a lever in its own right.

| ID | Requirement |
|---|---|
| ROAD-1 | Every stretch of main road has a condition from 0 (broken) to 100 (new), shown as Good, Fair, Poor or Broken. Every zone has one figure for its minor streets. |
| ROAD-2 | Condition falls each month. It falls faster with heavy traffic, with trucks and buses, in the monsoon months (June to September), where drainage is poor, and after utility digging. |
| ROAD-3 | Poor condition cuts speed and capacity. Indicative: Fair −5% speed, Poor −20% speed and −10% capacity, Broken −40% speed and −25% capacity. |
| ROAD-4 | Poor condition raises road deaths, most of all among two-wheeler riders, and costs approval in the zones it runs through. |
| ROAD-5 | Poor condition slows buses and raises their running cost. |
| ROAD-6 | The map has a "road condition" view. The report names the worst roads, and the delay each causes. |
| ROAD-7 | The ways to repair are in section 7.3. |
| ROAD-8 | Roads start the game in a mix of conditions, worst on the outer roads and the tech corridors. The mix is the same for every player in a season. |

## 6. The score

The score runs from 0 to 1,000. It is shown all through the game and fixed at the end of December 2035.

| ID | Measure | Weight | How it is measured |
|---|---|---|---|
| SCORE-1 | **Access** | 25% | Share of jobs the average resident can reach within 45 minutes, by the way they would travel |
| SCORE-2 | **Commute** | 20% | Average door-to-door commute, weighted by travellers |
| SCORE-3 | **Clean travel** | 15% | Share of trips by bus, metro, rail, cycle or on foot |
| SCORE-4 | **Safety** | 10% | Road deaths per 100,000 people a year |
| SCORE-5 | **Fairness** | 10% | Access and commute of the worst-served fifth of zones, against the average |
| SCORE-6 | **Money** | 10% | Cash less debt at the end, and whether the city ever defaulted |
| SCORE-7 | **Approval** | 10% | Average approval over the last three years |

| ID | Requirement |
|---|---|
| SCORE-10 | Each measure is turned into 0–100 against fixed marks for the season: the city as it starts scores about 40, and the best plausible result scores 100. |
| SCORE-11 | The final score uses the average of the last 12 months, so that one good or bad month does not decide a game. |
| SCORE-12 | Works still under construction in December 2035 count for nothing, and their debt counts in full. |
| SCORE-13 | **Every change is explained.** Each month's report gives, for each measure, the change and its three largest causes in plain words and numbers. Example: "Commute fell 1.2 minutes: 0.7 from the Blue Line opening, 0.3 from resurfacing the Outer Ring Road, 0.2 from bus lanes at Hebbal." |
| SCORE-14 | The player can ask of any zone or road "why is this bad?" and get the same kind of answer. |
| SCORE-15 | Weights and marks are published with each season. |

Average traffic speed is left out on purpose. It is already inside commute and access, and scoring it directly
rewards flyovers over everything else.

## 7. Levers

The player has 22 levers at launch. Each costs money, time, approval, or some of each.

**Major and minor actions.** Each month the player may start up to three major actions. Minor actions are
unlimited. This keeps a month short and makes the order of building a choice.

### 7.1 Revenue
| ID | Lever | How it works | Catch | Kind |
|---|---|---|---|---|
| REV-1 | **Property tax rate** | The main income. Grows with population and land value. Set once a year. | A rise costs approval and slows growth | Minor |
| REV-2 | **Parking charges** | Set by area: none, low, high. Earns money and moves people to transit. | Unpopular with drivers and shopkeepers | Minor |
| REV-3 | **Congestion charge** | Drivers pay to enter a chosen area at peak hours. | A large cost in approval; unfair unless transit serves the area | Major to bring in, minor to change |
| REV-4 | **Fares** | Set for metro, rail and bus. | High fares cut riders and hurt poorer zones | Minor |
| REV-5 | **Building rights near stations** | Sell the right to build taller within reach of a station. | Earns only where there is a station; adds trips there | Minor |
| REV-6 | **Loans** | Borrow, and repay monthly with interest. | The rate rises with debt; missing a payment is a default | Minor |

Held for later seasons: grants with conditions, private partners, tolls, fuel cess, registration fees, bonds,
land sales, advertising, a land value levy, fines.

### 7.2 Building
| ID | Lever | Time | Cost | Effect | Catch | Kind |
|---|---|---|---|---|---|---|
| BLD-1 | **Metro line and stations** | 3–5 years | Very high | Large gains along a corridor | Roads beneath lose a lane for the first half of the work | Major |
| BLD-2 | **Suburban rail service** | 1–3 years | High | Serves outer areas on existing tracks | Only where railway exists; shares track with long-distance trains | Major |
| BLD-3 | **Bus routes and fleet** | 1–2 months | Low | Fast coverage; feeds metro | Stuck in the same traffic unless given lanes | Minor |
| BLD-4 | **Bus lanes** | 1–3 months | Low | Buses run at free speed | Takes a lane from everyone else | Minor |
| BLD-5 | **Roads and flyovers** | 1–2 years | High | Local relief | Draws more driving over the years; moves the jam along | Major |
| BLD-6 | **Signals and junction redesign** | 1 month | Low | Small, quick gains in flow and safety | Small | Minor |
| BLD-7 | **Footpaths and crossings** | 2–6 months per zone | Low | Fewer deaths; more people walk to stations | Takes some road width | Minor |

### 7.3 Upkeep
| ID | Lever | Time | Cost | Effect | Lasts | Kind |
|---|---|---|---|---|---|---|
| UPK-1 | **Pothole patching** | Within the month | Very low | Raises a road or zone to Fair | About a year, less through a monsoon | Minor |
| UPK-2 | **Resurfacing** | 1–3 months | Medium | Raises a road to Good | 4–6 years | Minor |
| UPK-3 | **Concrete surface (white-topping)** | 6–12 months | High | Raises a road to new, and slows its decay to a quarter | 20 years or more | Major |
| UPK-4 | **Upkeep budget** | Standing | Monthly | A city-wide amount that slows decay everywhere and patches the worst automatically | While it is paid | Minor |

| ID | Requirement |
|---|---|
| UPK-10 | Resurfacing closes one lane while it is done. Concrete closes half the road. |
| UPK-11 | Patching just before or during a monsoon lasts half as long. The report says so when the player does it. |
| UPK-12 | A road dug up for a metro or a drain returns at Poor unless the project's cost includes making good, which is a choice when it is ordered. |
| UPK-13 | The upkeep budget has three settings: bare, steady, generous. At "bare" the city's roads fall about one grade in three years. At "steady" they hold. |
| UPK-14 | New roads and flyovers add to the upkeep bill for good. |

### 7.4 Policy
| ID | Lever | Effect | Catch | Kind |
|---|---|---|---|---|
| POL-1 | **One-way streets** | Cheap gains in flow | Can lengthen some trips; refused where it would cut a place off. Turn bans are left out: traffic is worked out on a simplified network in which a complex junction is one point, so a banned turn has nothing to act on | Minor |
| POL-2 | **Denser building near stations** | More people within reach of transit | Takes years to show; crowds the area meanwhile | Major |
| POL-3 | **Speed limits** | Fewer deaths | Slightly longer trips | Minor |
| POL-4 | **Dig once** | Utilities may dig a road only in set months, and must restore it | Costs approval with utilities; slows new connections | Major |

### 7.5 Levers and the score
Every measure has more than one lever behind it, and every lever has a cost on some other measure.

| Measure | Helped most by | Hurt by |
|---|---|---|
| Access | BLD-1, BLD-2, BLD-3, POL-2 | Poor roads, high fares |
| Commute | BLD-1, BLD-4, UPK-2, UPK-3, BLD-6 | Works in progress, poor roads |
| Clean travel | REV-2, REV-3, BLD-3, BLD-7 | BLD-5, low parking charges, high fares |
| Safety | BLD-7, POL-3, UPK-1, BLD-6 | Poor roads, fast roads |
| Fairness | BLD-2, BLD-3, UPK-4 | REV-3 and REV-4 without transit to match |
| Money | REV-1 to REV-5 | BLD-1, BLD-5, UPK-3, debt |
| Approval | Openings, good roads | REV-1, REV-2, REV-3, works, poor roads |

## 8. Money

| ID | Requirement |
|---|---|
| MONEY-1 | Money is in crore rupees. |
| MONEY-2 | Income: property tax, a fixed state grant, fares, parking, congestion charge, building rights. |
| MONEY-3 | Costs: building, upkeep of roads, running transit, loan repayments. |
| MONEY-4 | The city refuses to start work it cannot pay for. |
| MONEY-5 | Cash below zero for three months running is a default: the state takes over, and the game ends with the score as it stands, less a penalty. |
| MONEY-6 | The books show this month, the year so far, and a forecast for the next 12 months as things stand. |
| MONEY-7 | Balance aims: a player who builds well is comfortable but never idle-rich; one who builds carelessly runs short within two years; one who does nothing ends with no more than they started with. |
| MONEY-8 | Transit must not be a money machine. Fares cover running costs on a good line, and never repay its building within the ten years. |

## 9. Events

Events are fixed for a season: every player meets the same events in the same months.

| ID | Event | When | What happens |
|---|---|---|---|
| EVT-1 | **Monsoon** | June to September, every year | Roads decay faster; low-lying roads flood and close for days; buses slow |
| EVT-2 | **Cave-in or burst main** | Any month | A stretch of road shuts for one to three months |
| EVT-3 | **New employer** | Any month | Jobs are added to a zone for good |
| EVT-4 | **Festival or big match** | Set dates | A surge of trips for the month |
| EVT-5 | **Fuel price change** | Any month | Driving costs more or less for a time |
| EVT-6 | **Metro line opens** | Set by the season | A line under construction at the start enters service, or is delayed |
| EVT-7 | **Election** | Set by the season | Approval below a mark brings a cut in the state grant; above it, a rise |
| EVT-8 | **Strike** | When fares or driver rules change sharply | A transit line or the autos stop for some days |

| ID | Requirement |
|---|---|
| EVT-10 | Every event is announced in the news, and marked on the map where it has a place. |
| EVT-11 | At most three events in force at once. None in the first three months. |
| EVT-12 | When an event ends, exactly what it did is undone. |

## 10. Approval, reviews and endings

| ID | Requirement |
|---|---|
| APP-1 | Approval runs from 0 to 100 and starts at 55. It is kept by zone and shown for the city. |
| APP-2 | It rises with shorter commutes, good roads, and things opening. It falls with works, charges, tax rises, poor roads, floods and deaths. |
| APP-3 | It drifts back towards 55 when nothing pushes it. |
| APP-4 | Each December a review reports the year. Approval under 30 brings a warning. Two warnings running end the game: the player is replaced, and the score stands as it is, less a penalty. |
| APP-5 | The game ends in one of three ways: the term completed (December 2035), replaced, or default. All three give a score, and all three go on the leaderboard, marked. |

## 11. Multiplayer

### 11.1 Seasons
| ID | Requirement |
|---|---|
| MP-1 | A season lasts four weeks. It has one starting city, one set of events, one starting budget, and one set of weights and marks. |
| MP-2 | A player may start a game at any time in a season. A game begun with too few days left to finish says so before it starts. |
| MP-3 | A player has one ranked game per season, and may restart it once. Practice games are unlimited, do not count, and have no daily allowance. |
| MP-4 | Seasons differ: a monsoon season, a lean-budget season, a season where the Blue Line is late. |
| MP-5 | Between seasons the last season's city stays open for practice. |

### 11.2 Leaderboard
| ID | Requirement |
|---|---|
| MP-10 | The board shows rank, name, score, the seven measures, how the game ended, and the date reached. |
| MP-11 | During a season the board ranks games in progress by current score, marked with the year they have reached. Final ranks are fixed at the season's end. |
| MP-12 | Boards: everyone, friends, and by home zone. |
| MP-13 | Any finished city can be opened and looked round, with a list of what the player did and when. Cities in progress can be seen only by their owner until the season ends. |
| MP-14 | A finished game gives a picture and a link to share: the map, the score, and one line such as "I cut Bengaluru's commute by 14 minutes." |

### 11.3 Accounts
| ID | Requirement |
|---|---|
| MP-20 | A player can start without an account. The game is kept on the server against the device. |
| MP-21 | To appear on a board by name, or to play on a second device, the player signs in. At launch: Google sign-in, or a link sent by email. |
| MP-22 | A player chooses a display name. Names are checked against a list of words not allowed. |
| MP-23 | We keep the email address, the display name, the games, and nothing else. No advertising. No tracking across sites. |
| MP-24 | A player can delete their account and everything kept with it. |

### 11.4 Fair scores
| ID | Requirement |
|---|---|
| MP-30 | A game is a season, a seed and a list of the player's actions with the month of each. Nothing else decides the result. |
| MP-31 | The server works out every month itself from that list. What the browser shows is a preview. |
| MP-32 | The server refuses an action that the rules do not allow: no money, too many major actions, outside the daily allowance. |
| MP-33 | The daily allowance is kept by the server's clock. |
| MP-34 | The simulation gives the same result on the server and in every browser, so that the preview and the truth agree. |

## 12. The simulation

| ID | Requirement |
|---|---|
| SIM-1 | One body of code, in TypeScript, runs in the browser and on the server. |
| SIM-2 | It has no dependence on the page, the clock or the network. |
| SIM-3 | It is exact across machines: whole numbers or fixed-point for anything that feeds the score, a seeded random source, and a fixed order of work. |
| SIM-4 | One month takes under 300 ms on a mid-range laptop and under 1 second on a mid-range phone. A skip of 12 months takes under 5 seconds on either. |
| SIM-5 | It runs in a background thread, so the page never freezes. |
| SIM-6 | Every figure in the score can be traced to its causes (SCORE-13). The simulation keeps what it needs to do so. |
| SIM-7 | A scripted player can play a whole game without a screen, for balancing, as `tools/playthrough.ts` does today. |

## 13. Screens

### 13.1 The main screen
```
┌───────────────────────────────────────────────────────────────────┐
│ Mar 2028 · month 27 of 120    ₹2,140 cr  +₹28/mo    Score 612  #48│
├───────────┬───────────────────────────────────────────┬───────────┤
│ SCORE     │                                           │ THIS MONTH│
│ Access 71 │                                           │ 2 of 3    │
│ Commute 58│             MAP OF BENGALURU              │ major left│
│ Clean   44│                                           │           │
│ Safety  63│                                           │ Transit   │
│ Fairness52│                                           │ Roads     │
│ Money   80│                                           │ Upkeep    │
│ Approval61│                                           │ Policy    │
│           │                                           │ Revenue   │
│ NEWS      │                                           │           │
│ Monsoon   │                                           │[Next month]
│ in 3 mo   │                                           │[Skip ▾]   │
└───────────┴───────────────────────────────────────────┴───────────┘
```

| ID | Requirement |
|---|---|
| UI-1 | The look is the one accepted for NamDaari: a real map in calm, pale colours, thin roads, congestion in amber, orange and red, quiet white panels. |
| UI-2 | **Zoomed out:** zones shaded by the chosen view, main roads, transit lines. **Zoomed in:** real streets, stations, works, place names. |
| UI-3 | **Map views:** commute, congestion, road condition, transit reach, safety, flooding, approval, income. |
| UI-4 | Clicking a zone or a road opens what is known about it, and "why is this bad?" (SCORE-14). |
| UI-5 | Every lever shows its cost, its time, and what it is expected to do to each measure, before the player commits. The forecast is marked as a forecast. |
| UI-6 | A tool that cannot go ahead says why, beside where the player clicked. |
| UI-7 | On a phone the side panels become sheets that slide up, and the map takes the whole screen. Every action can be done by touch. Nothing depends on hover, right-click or a keyboard. |
| UI-7a | **Placing by tap.** Stations, stops and the ends of roads are placed by tapping, never by dragging a line under a finger. The game joins them. |
| UI-7b | **Snapping.** A tap snaps to the nearest junction or main road within reach, so a tap that is a little off lands right. |
| UI-7c | **Magnified placing.** Choosing a spot on a phone opens a magnified view with a crosshair, which the player nudges before confirming. |
| UI-7d | **Suggested corridors.** For metro, rail and bus the game offers a few routes along the busiest corridors, which the player may accept and adjust. Offered on every screen size. |
| UI-7e | Every target a finger must hit is at least 44 px across. |
| UI-8 | Plain English throughout: short sentences, no jargon, no exclamation marks. Place names in English and Kannada. |

### 13.2 Other screens
| ID | Screen | Contents |
|---|---|---|
| UI-10 | **Start** | The season, its twist, days left, the player's game if one is in hand, the top of the board |
| UI-11 | **Introduction** | The first month, taught by doing: read the score, patch a road, add a bus route, end the month. Skippable. |
| UI-12 | **Monthly report** | What opened, what changed, the score with reasons, the books, what needs attention |
| UI-13 | **Yearly review** | The year against the last, approval, a warning if due |
| UI-14 | **Books** | Income and costs, loans, forecast |
| UI-15 | **Works** | Everything under way, with months left and what it is costing in disruption |
| UI-16 | **Leaderboard** | Section 11.2 |
| UI-17 | **Another player's city** | Their map, score, and list of actions |
| UI-18 | **Ending** | Final score, rank, the ten years in one chart, the share picture |

### 13.3 The map at each zoom

The base map is a general-purpose map. The game's map is designed around the city: zoomed out it shows the
city's shape, and detail fades in as the player zooms.

| What | Zoomed out (whole city) | Zoomed in (street level) |
|---|---|---|
| Ring roads and highways | Drawn boldest, so that the rings and spokes are seen first | As the base map |
| Other main roads | Thin and pale | As the base map |
| Minor streets | Hidden | As the base map |
| Metro lines | In their own colours, with stations | The same, with station names |
| Lakes and large parks | Kept, as landmarks | As the base map |
| Place names | About 25 that people know | All names |
| Village names | Hidden | Shown |
| The city's boundary | A quiet outline | Hidden |

| ID | Requirement |
|---|---|
| MAP-1 | Zoomed out, the Outer Ring Road, the NICE Road and the highways into the city are the boldest lines on the map. |
| MAP-2 | Zoomed out, the metro is drawn in its lines' own colours, and the crossing at Majestic can be picked out. |
| MAP-3 | Land outside the city is drawn paler than land inside it, so that the city stands out from the country round it. |
| MAP-4 | Zoomed out, only about 25 place names show: the areas people know, such as Whitefield, Hebbal, Jayanagar and Electronic City. The list is kept in one file and can be changed by the player's direction. |
| MAP-5 | Detail fades in with zoom. Minor roads and further names appear by degrees, never all at once. |
| MAP-6 | The view cannot be panned or zoomed past the map data. No blank ground ever shows. |
| MAP-7 | The last stretch before the edge of the data fades into the background colour, so that there is no hard line. |
| MAP-8 | The game opens framed on the city, not on the whole of the map data. The data reaches further (about 54 by 50 km, to Nelamangala, Hoskote and Bidadi) because the highways and railways that enter the city matter to the game. |
| MAP-9 | The test of the zoomed-out map: someone who lives in Bengaluru knows it for their city at a glance, without reading a label. |

## 14. Performance

The player asked for high performance in the browser. These are requirements, not hopes.

| ID | Measure | Laptop (mid-range, 2022) | Phone (mid-range Android, 2023) |
|---|---|---|---|
| PERF-1 | First sight of the map, on a 4G connection | Under 3 s | Under 5 s |
| PERF-2 | Frames a second while panning and zooming | 60 | 30 or more |
| PERF-3 | Frames a second during the monthly playback | 60 | 30 or more |
| PERF-4 | One month worked out | Under 300 ms | Under 1 s |
| PERF-5 | First download, compressed | Under 1.5 MB | The same |
| PERF-6 | Memory the page uses, after panning across the city. Graphics memory is reported but has no limit, since it depends on the device. | Under 400 MB | Under 300 MB |
| PERF-7 | Response to a tap or click | Under 100 ms | The same |

### How
| Part | Approach |
|---|---|
| Map | Drawn with WebGL through MapLibre GL. The city is cut into vector tiles, made once from OpenStreetMap and served as static files. Street detail loads only when zoomed in. |
| Overlays | Congestion, road condition and zone shading are drawn as data layers on the same map, coloured by the graphics card. |
| Playback | Vehicles are dots moved along roads from the worked-out flows, drawn in one batch. None is simulated. |
| Simulation | In a background thread. Typed arrays, no allocation inside loops. |
| Loading | The shell and the zoomed-out city first; everything else on demand. |
| Checking | Performance is measured by script on every change, on a slowed-down processor, and a change that misses a target is not accepted. |

## 15. Architecture

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript throughout | One simulation for browser and server |
| Front end | Vite, MapLibre GL, plain DOM for panels | Small, fast, already in use |
| Simulation | A package with no dependencies, shared by both sides | SIM-1 |
| Server | One Node service on the player's own Linode, behind nginx, run by systemd | The machine is there already and serves the player's other games |
| Database | SQLite in one file on the same machine, behind a small interface so that Postgres can take its place | One machine, nothing else to run or pay for; backed up by copying the file |
| Map tiles and the game itself | Static files served by nginx on the same machine, with range requests for the tiles | No server work; a content network can go in front later |
| Sign-in | Google, or an email link | No passwords to keep |
| Hosting | The player's Linode | Decided 2026-09-29 |

### What is kept from NamDaari
| Kept | Changed | Replaced |
|---|---|---|
| Map pipeline from OpenStreetMap | Extended from five districts to the whole city, and to vector tiles | |
| The visual style | Moved from Canvas 2D to WebGL layers | |
| Metro and bus planning, one-way streets, turn bans | Placed on the city-wide network | |
| Money, loans, approval, events, reviews | Retuned to months and a ten-year term | |
| Scripted play, browser checks | Extended | |
| | | Vehicle-by-vehicle traffic, by flows |
| | | Saving in the browser, by games kept on the server |
| | | Scenarios with a single goal, by seasons with a score |

## 16. Data

| Data | Source | Licence | Note |
|---|---|---|---|
| Roads, railways, metro, lakes, names | OpenStreetMap | ODbL | Credit shown. Whether built tiles must be shared alike is open question 2. |
| Zone boundaries | Open ward maps, to be found | To be checked | Boundaries changed with the new authority; open question 1 |
| People and jobs by zone | Census and published estimates, scaled | To be checked | Approximate. The game says so. |
| Metro lines under construction | OpenStreetMap, published plans | | Opening dates are game values |
| Road condition at the start | Made up, by road class and area | | Not real |

## 17. Slices

Each slice can be looked at and judged before the next begins.

| # | Slice | Contents | Done when |
|---|---|---|---|
| 1 | **The city, drawn** (built 2026-09-28; memory target not met; **player review pending**) | All of Bengaluru as vector tiles; the map designed by zoom (MAP-1 to MAP-9); zones; main roads; existing transit; pan and zoom; nothing to play | Performance targets 1, 2, 5 and 6 met on laptop and phone; a Bangalorean recognises it; **the player has looked at it** |
| 2 | **The city, moving** (built 2026-09-28; memory target not met; some roads overloaded in the model; **player review pending**) | Flow model; four parts of the day; modes; congestion and commute views; monthly playback | A month in under 300 ms; peaks jam where they really do; same result on two machines |
| 3 | **Months and money** (built 2026-09-28; raising tax or fares is too rewarding until spending and approval exist; **player review pending**) | Turns, skipping, reports with reasons, books, property tax, fares, loans | A scripted player can play 120 months |
| 4 | **Transit** (built 2026-09-28; builders shorten the commute only modestly over ten years, and raising fares still ends rich; **player review pending**) | Metro lines and stations, bus routes and fleets, bus lanes, more trains on the suburban railway; placing by tap with snapping and suggested corridors; works and their disruption; a simple approval | A well-placed line cuts the commute in its corridor by a tenth or more; the player can build a line on a phone |
| 5 | **Roads and policy** (built 2026-09-29; turn bans left out; a player who uses every lever ends 6.6 minutes ahead of doing nothing, one who builds metro alone 2.7; doing nothing is the best liked; **player review pending**) | Roads, flyovers, signals, footpaths, one-way, turn bans, denser building, speed limits, dig once | Every lever moves at least one measure, and costs another |
| 6 | **Road condition and upkeep** (built 2026-09-29; mending a short stretch can come out slower in the forecast; doing nothing ends rich; **player review pending**) | Decay, monsoon, the four upkeep levers, the road condition view | Neglect visibly slows the city; repair visibly helps; the report says by how much |
| 7 | **The score** (built 2026-09-29; the city starts at about 550, not 400; a late rush of spending scores too well; a month takes 265 ms, over the limit on a mid-range laptop; **player review pending**) | Seven measures, marks, explanations, approval, reviews, events, endings | Scripted plays: doing nothing scores about 350, building well 700 or more, carelessly under 300 |
| 8 | **Online** (built 2026-09-29, running locally on port 5210, not deployed; every year now counts towards the score, later years more; a month takes 229 ms; sign-in never tried against a real mail provider or Google; whether the ranked board needs sign-in is undecided; **player review pending**) | Accounts, games kept on the server, checking, daily allowance, seasons, leaderboard | A changed browser cannot produce a false score |
| 9 | **Fit to play** (built 2026-09-29; a scripted new player ends a first day at 612 against 515 for doing nothing; rules version 7, the city starts at 561; sound never heard; no real phone and no real player yet, so the slice's own check is not met; **player review pending**) | Introduction, phone layout, other players' cities, share picture, sound | Five new players finish a first day without help |
| 10 | **First season** | A closed season with invited players | G-1 to G-5 measured |

## 18. Risks

| Risk | Likelihood | Effect | What we do |
|---|---|---|---|
| The map or the traffic does not look right to the player | Medium | High: it has sunk two earlier versions | Slice 1 is the map alone, judged before anything is built on it |
| One strategy wins every season | High | High | Seasons differ; scripted players search for it before each season; weights can change between seasons |
| The flow model feels dead next to moving vehicles | Medium | Medium | The monthly playback; judged in slice 2 |
| Results differ between browser and server | Medium | High | Whole-number arithmetic; a test that plays the same game on both, on every change |
| The score is not believed | Medium | High | Every change explained; weights published; any city can be opened |
| Too many levers for a new player | Medium | Medium | The introduction; levers unlock over the first year |
| Ward and census data are missing or out of date | High | Medium | Build zones from what exists; say plainly that figures are approximate |
| Phones cannot hold the city | Medium | Medium | Tiles and loading on demand; measured from slice 1 |
| Running costs grow with players | Low | Medium | Static tiles; a month costs the server milliseconds; one ranked game per season |
| Real politics: the game reads as an attack on real officials | Low | Medium | No real people or parties are named; the player is "the commissioner" |
| Scope: this is a large game | High | High | Ten slices, each judged; the first season can run without slices 6 and 9 in full |

## 19. Open questions

1. **Zones.** Settled in slice 1: the Greater Bengaluru Authority's 369 wards as notified on 19 November 2025, from OpenCity, plus 42 coarse outer zones, 411 in all. People, jobs and income are estimates; see `docs/DATA.md`. Still open: corporation elections have not been held, so the boundaries could change.
2. **OpenStreetMap share-alike.** Whether the vector tiles and the built network must be published under the same licence.
3. **Hosting.** Settled: the player's Linode. Still open: how many players one machine carries, since the server works out every month of every game; measured in slice 8.
4. **Kannada.** The name, place names we write ourselves, and interface text need a native speaker's check.
5. **Name.** On 2026-09-28 a registry lookup found `peakooru.com`, `peakooru.in` and `peakooru.game` unregistered; `peakooru.app` gave no answer. None has been bought. Social handles and trademarks are not checked.
6. **The five districts.** Whether any of the NamDaari scenarios stay as a practice mode.
7. **Money.** Whether the game ever earns anything, and how, given that nothing paid may touch the score.
8. **Moderation.** Who handles names and reports, once there are players.

## 20. Decisions made

| Date | Decision | By |
|---|---|---|
| 2026-09-28 | The whole of Bengaluru, not districts | Player |
| 2026-09-28 | Multiplayer by leaderboard; players need not play together | Player |
| 2026-09-28 | The term is 2026 to 2036 | Player |
| 2026-09-28 | Scored on governance | Player |
| 2026-09-28 | Browser, built for performance; not a native Mac game | Player |
| 2026-09-28 | Monthly turns, with ways to skip ahead | Player |
| 2026-09-28 | Daily allowance of 12 game months | Player |
| 2026-09-28 | The starting sixteen levers | Player |
| 2026-09-28 | A lever for fixing roads and potholes, which slow traffic | Player |
| 2026-09-28 | The name is Peak Ooru | Player |
| 2026-09-28 | The map is designed by zoom: the city's shape when zoomed out, detail fading in (section 13.3) | Player |
| 2026-09-28 | The view is limited to the map data, and opens framed on the city | Player |
| 2026-09-28 | The memory limit counts the page only: 400 MB on a laptop, 300 MB on a phone | Player |
| 2026-09-28 | The look of the map is not traded for memory | Player |
| 2026-09-28 | Building comes before road upkeep: transit is slice 4, roads and policy slice 5, upkeep slice 6 | Player |
| 2026-09-28 | The daily allowance is switched off while the game is being built | Player |
| 2026-09-29 | Turn bans are left out; one-way streets and junction redesign stand in | Proposed; the player did not object |
| 2026-09-29 | The Pink and Blue lines open on their real targets, in every game | Player |
| 2026-09-29 | Hosted on the player's own Linode | Player |
| 2026-09-28 | Each player has their own copy of the city | Player |
| 2026-09-28 | Full play on phones from the start, with tap-and-snap placement | Player |
| 2026-09-28 | Peak Ooru replaces NamDaari | Player |
