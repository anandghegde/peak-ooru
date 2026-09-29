import type { LngLat, Station, Transit, TransitLine, Zone } from '../data/types'
import type { CityState, Mode, MonthResult, Prices, RoutingNetwork, Simulate } from '../sim/types'

/** Money is kept in lakh rupees, as whole numbers, and shown in crore. 100 lakh is 1 crore. */
export type Lakh = number

/** What every player of a season starts from. */
export interface Season {
  id: string
  name: string
  seed: number
  /** Money at the start. */
  money: Lakh
  /** The fixed grant from the state each month. */
  grant: Lakh
  /** Months in the game: 120, from January 2026. */
  months: number
  /** The marks each measure is scored against, published with the season. */
  marks?: Marks
  /**
   * Lines under construction at the start that open during the season, in phases: from `month` on, the first
   * `stations` stations of line `line` are open. Omitted: none open.
   */
  openings?: Opening[]
  /** Whether the daily allowance of months applies. Omitted: it does. */
  allowance?: boolean
  /** Slice 7: the months of the city's corporation elections (PRD EVT-7). Omitted: none. */
  elections?: number[]
  /**
   * Slice 7: the seven measures' figures for the city as it starts (January 2026 as the model has it, the money and
   * approval of the start), published with the marks, so that the score can be shown before the first month is worked
   * out. `tools/playthrough.ts opening` prints them; they are set again when the model changes, with the marks.
   */
  opening?: Omit<Measured, 'month'>
  /**
   * Slice 8: how much each year counts in the game's score, in thousandths, 2026 first: ten whole numbers that sum to
   * 1,000. Each year is scored as the score of that December (its last twelve months), and the game's score is their
   * weighted sum (docs/RULES.md, "The score of ten years"). Omitted: the first season's. A season whose weights are all
   * 0 but the last, 1,000, scores the last year alone: the rule before slice 8.
   */
  years?: number[]
}

/** A phase of a line being built when the season starts, opening in a set month. */
export interface Opening {
  line: string
  /** The first month whose traffic has it open. */
  month: number
  /** How many of the line's stations, from its first, are open from then. */
  stations: number
}

/** The city as loaded: what does not change with the player's choices. */
export interface CityData {
  zones: Zone[]
  roads: RoutingNetwork
  transit: Transit
}

export interface Loan {
  id: number
  /** What was borrowed, and what is still owed. */
  amount: Lakh
  owed: Lakh
  /** Yearly interest, in hundredths of a percent: 950 is 9.5%. */
  rate: number
  payment: Lakh
  monthsLeft: number
  taken: number
}

/** What the player can do in slice 3. Each is recorded with the month it was done in. */
export type Action =
  | { kind: 'build'; plan: Plan }
  | { kind: 'cancel'; project: number }
  | { kind: 'vehicles'; line: string; change: number }
  | { kind: 'close'; line: string }
  /** The standing budget for keeping roads up. */
  /**
   * `patchBelow` (optional, slice 6): the standing order to patch the potholes of a zone's main roads and streets when
   * they fall below this condition (10 to 70), or `null` to stop it; absent leaves it as it is.
   */
  | { kind: 'upkeep'; level: Upkeep; patchBelow?: number | null }
  /** Whether utilities may dig a road only in set months, and must restore it. */
  | { kind: 'digOnce'; on: boolean }
  | { kind: 'tax'; rate: number }
  | { kind: 'fare'; mode: 'metro' | 'bus' | 'rail'; perKm: number }
  | { kind: 'borrow'; amount: Lakh }
  | { kind: 'repay'; loan: number }

export type Upkeep = 'bare' | 'steady' | 'generous'

/** The state of a road's surface, from its condition of 0 to 100. */
export type Surface = 'good' | 'fair' | 'poor' | 'broken'

/** A place on a line the player is planning: a new stop where they tapped, or a station that is there already. */
export type Stop = { at: LngLat } | { station: number }

/** Something the player may build. */
export type Plan =
  /** `makeGood` (optional, slice 6): pay to resurface the roads dug up for the work, rather than leave them poor. */
  | { kind: 'metro'; stops: Stop[]; makeGood?: boolean }
  | { kind: 'busRoute'; stops: Stop[]; buses: number }
  /** Bus lanes on stretches of road, by the ids of routing links. */
  | { kind: 'busLane'; links: number[] }
  /** More trains on a suburban railway line that is there already. */
  | { kind: 'railService'; line: string; trains: number }
  /** A new road between places on the main roads, on the ground or as a flyover that meets nothing between its ends. */
  | { kind: 'road'; stops: Stop[]; lanes: 1 | 2 | 3; flyover: boolean; makeGood?: boolean }
  /** Work at a junction, by the id of its routing node: signals, a redesign, or lifting the main road over it. */
  | { kind: 'junction'; node: number; work: 'signal' | 'redesign' | 'overpass'; makeGood?: boolean }
  /** Footpaths and crossings through a zone. */
  | { kind: 'footpaths'; zone: number }
  /** Makes a road one-way in the direction of the routing link given, or two-way again. */
  | { kind: 'oneWay'; link: number; on: boolean }
  /** A speed limit on the main roads of a zone, in km/h, or none. */
  | { kind: 'speedLimit'; zone: number; limit: number | null }
  /** Lets people build taller in a zone within reach of a station, or no longer. */
  | { kind: 'density'; zone: number; on: boolean }
  /** Mends the surface of main roads, by the ids of routing links: patching, resurfacing, or laying concrete. */
  | { kind: 'repair'; links: number[]; work: 'patch' | 'resurface' | 'concrete' }
  /** Mends the minor streets of a zone. */
  | { kind: 'streets'; zone: number; work: 'patch' | 'resurface' }

/** What a plan would cost and take, worked out without building it. */
export interface Quote {
  ok: boolean
  /** Why not, in words for the player, when not ok. */
  reason?: string
  cost: Lakh
  months: number
  /** What it will cost to run each month once open. */
  running: Lakh
  /** Metres. */
  length: number
  /**
   * The stations or stops as they would be built, snapped and named; `stop` is the index of the plan's place a
   * station came from (absent for a station the rules put in between).
   */
  stations: { at: LngLat; name: string; nameKn: string | null; existing?: number; stop?: number }[]
  /** The line as it would be drawn, as lng, lat, lng, lat… */
  path: number[]
  /** Routing links that lose a lane while the work is done. */
  disrupted: number[]
  /** A major action, of which the player has three a month, or a minor one. */
  major: boolean
  /** Of `cost`, what is paid for land, for a road on the ground. Optional (slice 5). */
  land?: Lakh
  /**
   * Slice 6, for mending roads: the condition (0 to 100) the roads or streets will have once done; the months it is
   * expected to last before it falls back below fair (a patch: until it has worn off); and what it does, in words for
   * the player, with the warning about patching in the monsoon where it applies. Of `cost`, what making good the
   * roads dug up for a work costs (`makeGood`).
   */
  condition?: number
  lasts?: number
  note?: string
  makeGood?: Lakh
}

/** Work under way. */
export interface Project {
  id: number
  plan: Plan
  name: string
  started: number
  /** The month it opens in. */
  opens: number
  cost: Lakh
  quote: Quote
  /** The id the line will have once open, for a metro line or a bus route. */
  line?: string
}

/** What the player has built and is open. */
export interface Built {
  lines: TransitLine[]
  stations: Station[]
  /** Routing links with a bus lane. */
  busLanes: number[]
  /** Vehicles on each of the player's lines, and extra trains on the city's, by line id. */
  vehicles: Record<string, number>
  /** Roads the player has built, for drawing: the line of each as lng, lat, lng, lat… */
  roads?: { id: number; name: string; path: number[]; lanes: number; flyover: boolean; nodes?: number[] }[]
  /** Junctions the player has worked on, by routing node. */
  junctions?: { node: number; work: 'signal' | 'redesign' | 'overpass' }[]
  /** Zones with footpaths laid, zones with a speed limit, and zones where taller building is allowed. */
  footpaths?: number[]
  limits?: { zone: number; limit: number }[]
  dense?: number[]
  /** Routing links made one-way by the player: the link that stays open. Its opposite is shut. */
  oneWay?: number[]
}

/**
 * What the season and the player's building have changed in the city's transit and roads, as the model is given it
 * for a month. Kept with `inputs`, so that a report can put each change back and say what it did.
 */
export interface Setup {
  /** Lines open that were not at the start: the season's, as far as they have opened, and the player's. */
  lines: TransitLine[]
  /** Stations the player has built. */
  stations: Station[]
  busLanes: number[]
  /** As `Built.vehicles`. */
  vehicles: Record<string, number>
  /** Routing links losing a lane to works. */
  works: number[]
  /** What the player has built and set on the roads, as `Built` has it: the model's network is made from it. Slice 5. */
  onRoads?: Pick<Built, 'roads' | 'junctions' | 'footpaths' | 'limits' | 'oneWay'>
  /** The state of the roads as the model is given it (slice 6): `CityState.surface`, `streets` and `shut`. */
  surface?: number[]
  streets?: number[]
  shut?: Record<number, number>
  /** What the events in force do to the month (slice 7), so that a report can put each back. */
  events?: EventEffect[]
}

/**
 * What one event in force does to the model's month (slice 7): trips as a share of the usual, the city's buses as a
 * share of the usual, the price of fuel as a share of the usual (all thousandths), jobs added to a zone, roads shut,
 * lines whose vehicles run a share of the month.
 */
export interface EventEffect {
  id: number
  /** For the report's causes: "the festival season". */
  what: string
  surge?: number
  busService?: number
  fuel?: number
  jobs?: { zone: number; jobs: number }
  shut?: number[]
  lines?: { line: string; share: number }
}

/** One month's figures for the seven measures, whole numbers, from which the score's averages are taken (slice 7). */
export interface Measured {
  month: number
  /** Thousandths of the city's jobs within 45 minutes. */
  access: number
  /** Seconds, door to door. */
  commute: number
  /** Thousandths of trips by bus, metro, rail, cycle or on foot. */
  clean: number
  /** Road deaths a year for each ten million people. */
  safety: number
  /** Thousandths: the worst-served fifth's access and commute against the average, the two averaged. */
  fairness: number
  /** Lakh: money less what is owed and what is still to pay on work under way. */
  money: number
  /** Tenths of a point. */
  approval: number
}

/** One thing moving approval this month, in words for the player, with its points. */
export interface Pressure {
  text: string
  points: number
}

export interface Done {
  month: number
  action: Action
}

/** Whether an action went ahead, and if not, why, in words for the player. */
export type Outcome = { ok: true } | { ok: false; reason: string }

/** `replaced`: approval under 30 at two December reviews running (PRD APP-4). */
export type Status = 'playing' | 'finished' | 'default' | 'replaced'

/** One line of the books: a name for the player, and an amount, positive for income. */
export interface Entry {
  key: string
  name: string
  amount: Lakh
}

/** One cause of a change, for the player: "0.7 minutes from higher bus fares". */
export interface Cause {
  text: string
  /** In the units of the figure it explains. */
  amount: number
}

export interface Figure {
  key: 'commute' | 'speed' | 'access' | 'clean' | 'money' | 'approval' | 'safety' | 'roads'
  name: string
  now: number
  before: number
  unit: string
  /** The largest causes of the change, at most three. */
  causes: Cause[]
}

export type MeasureKey = 'access' | 'commute' | 'clean' | 'safety' | 'fairness' | 'money' | 'approval'

/** One of the seven things the player is scored on. */
export interface Measure {
  key: MeasureKey
  name: string
  /** Its share of the score, in thousandths: 250 is a quarter. */
  weight: number
  /** The figure itself, in its own unit, averaged over the last twelve months. */
  value: number
  unit: string
  /** 0 to 100, in tenths: about 40 for the city as it starts, 100 for the best plausible result. */
  points: number
  /** What moved it since the last report, at most three, largest first. */
  causes: Cause[]
}

/** The governance score: 0 to 1,000. */
export interface Score {
  total: number
  measures: Measure[]
  /**
   * Slice 7: a game that ended by default or by being replaced loses part of its score (PRD MONEY-5, APP-4): what was
   * taken off, and why, in words for the player. `total` is after it.
   */
  penalty?: { points: number; text: string }
  /**
   * Slice 8: each year reached, with its own score (the score as that December stood; for the year in hand, as it
   * stands now) and its weight in thousandths; `done` once its December has been worked out. The total and each
   * measure's points are these years weighed together, the weights of years not yet reached left out.
   */
  years?: { year: number; total: number; weight: number; done: boolean }[]
}

/** The marks a season sets for each measure: the figure that scores 0, and the figure that scores 100. */
export type Marks = Record<MeasureKey, { none: number; full: number }>

export type EventKind = 'monsoon' | 'cavein' | 'employer' | 'festival' | 'fuel' | 'opening' | 'election' | 'strike'

/** Something that happens to the city, which the player did not order. */
export interface GameEvent {
  id: number
  kind: EventKind
  /** For the player: "A water main has burst under Old Madras Road." */
  title: string
  text: string
  started: number
  /** The last month it is in force; the same as `started` for a thing of one month. */
  ends: number
  /** Where it is, if it has a place. */
  at?: LngLat
  /** Routing links and zones it touches, for the map. */
  links?: number[]
  zones?: number[]
  /** Slice 7: lines it touches (a strike), by id. */
  lines?: string[]
}

/** What the player is told at the end of a month, or of a span of months skipped. */
export interface Report {
  /** The first and last month covered, counted from January 2026 as 0. */
  from: number
  to: number
  figures: Figure[]
  books: Entry[]
  /** What happened, in sentences, most important first. */
  news: string[]
  /** What needs the player, if anything: why a skip stopped. */
  needs: string[]
  /**
   * Slice 9, optional: of what the report says, only what the player must act on (money below nothing or running out,
   * the roads falling, approval low enough for a warning): for the screen's "Needs you". Good news and the year's end,
   * which stop a skip (`needs`), are in `news`.
   */
  urgent?: string[]
  /** The score now and at the start of the span reported. */
  score?: { now: Score; before: Score }
  /** Events that began or ended in the span. */
  events?: GameEvent[]
  /** The yearly review, in a report that covers a December (PRD APP-4). */
  review?: Review
  /**
   * Slice 7: the seven measures' figures of the month before the span (absent before the first) and of its last
   * month, so that a report for a span can tell a change from the model's noise.
   */
  measured?: { before?: Measured; now: Measured }
  /**
   * Slice 6: the roads whose surface cost the most time in the last month, worst first, at most five (PRD ROAD-6); and
   * the main roads that flooded in it, with the days each was shut.
   */
  worstRoads?: WorstRoad[]
  flooded?: { link: number; days: number }[]
}

/** A road in poor repair and what it costs those who use it. */
export interface WorstRoad {
  /** "Hosur Road", or "80 Feet Road, Koramangala" where the name is used for more than one road. */
  name: string
  /** Its routing links in poor or broken repair, for the map and for a plan to mend them. */
  links: number[]
  /** Metres of road (slice 7: each road counted once, whichever of its directions are poor), and the links' condition, 0 to 100, weighted by length. */
  length: number
  condition: number
  /** Vehicle-hours a weekday lost to its surface, against the same road at 100. */
  hours: number
}

/** The December review of a year. */
export interface Review {
  year: number
  /** Approval at the review, 0 to 100, and a word for it. */
  approval: number
  word: string
  /** Under 30: a warning was given, and how many are running. */
  warning: boolean
  warnings: number
  /** Two warnings running: the state has replaced the player. */
  replaced: boolean
}

/** A game in progress. Everything in it follows from the season and the list of actions. */
export interface Game {
  season: Season
  /** Months since January 2026: 0 is January 2026. The month the player is acting in. */
  month: number
  status: Status
  money: Lakh
  /** Property tax, in hundredths of a percent of the standard rate: 10000 is the standard rate. */
  taxRate: number
  /** The month the tax rate was last changed in, since it may change once a year. */
  taxChanged: number
  prices: Prices
  loans: Loan[]
  /** People in the city now, as a share of those at the start, in ten-thousandths. */
  people: number
  /** Months running with money below nothing. */
  inTheRed: number
  /** Everything the player has done, in order. */
  done: Done[]
  /** Work under way, and what is built and open. Absent in a game from before building existed. */
  projects?: Project[]
  built?: Built
  /** The condition of each routing link's surface, 0 (broken) to 100 (new), by link id; and of each zone's minor streets, by zone id. */
  condition?: number[]
  streets?: number[]
  /** Routing links laid in concrete, which wear a quarter as fast. */
  concrete?: number[]
  upkeep?: Upkeep
  digOnce?: boolean
  /** The standing order to patch a zone's potholes below this condition (slice 6). Absent: none. */
  patchBelow?: number
  /** The roads' condition in finer units, and what the rules keep to wear them (slice 6). Kept by the rules. */
  wear?: Wear
  /** The score as it stands, and at the end of each year so far. */
  score?: Score
  scores?: number[]
  /** Events in force. */
  events?: GameEvent[]
  /** Major actions started this month. */
  majors?: number
  /** What people think of the player, 0 to 100, in tenths: 550 is 55. */
  approval?: number
  pressures?: Pressure[]
  /** December reviews running with approval under 30. Kept by the rules. */
  warnings?: number
  /** What the player's building actions did this month, in words, for the month's report. Kept by the rules. */
  told?: string[]
  /** The last month's traffic, and the one before, for the report. */
  last: MonthResult | null
  reports: Report[]
  /** What `last` was worked out with: the prices and people, for finding what caused a change. Kept by the rules. */
  inputs?: { prices: Prices; people: number; setup?: Setup }
  /** Seconds of the average commute in the first month, against which growth is judged. Kept by the rules. */
  firstCommute?: number
  /** People gained (+) or lost (−) through the tax rate, in ten-thousandths of those at the start. Kept by the rules. */
  taxPeople?: number
  /** People in each zone, by zone id, once they no longer grow alike (slice 5). Kept by the rules. */
  zonePeople?: number[]
  /** Road deaths a year for each ten million people in the first month (slice 5). Kept by the rules. */
  firstDeaths?: number
  /** The value of property that tax is levied on, in ten-thousandths of the first year's (slice 5). Kept by the rules. */
  value?: number
  /** Slice 7, kept by the rules: each month's figures for the seven measures, for the score's averages. */
  measured?: Measured[]
  /** Slice 7: approval in each zone, tenths, in the order of the city's zones (PRD APP-1). `approval` is their average by people. */
  zoneApproval?: number[]
  /** Slice 7, kept by the rules: each zone's figures in the first month, against which approval judges how lives changed. */
  firstZones?: { commute: number[]; access: number[]; deaths: number[]; roads: number[] }
  /** Slice 7: the state's grant as the last election left it, in ten-thousandths of the season's (PRD EVT-7). */
  grantShare?: number
}

/**
 * The roads as the rules keep them (slice 6), in thousandths of a point of condition: `Game.condition` and
 * `Game.streets` are these shown in whole points. By routing link: the surface itself (`base`), a patch on it that
 * wears off (`patch`, with `left` months to go), the month a utility last dug it, and the month the player last mended
 * it. By zone, the same for its streets.
 */
export interface Wear {
  base: number[]
  patch: number[]
  left: number[]
  dug: number[]
  mended: number[]
  streets: number[]
  streetsPatch: number[]
  streetsLeft: number[]
  streetsMended: number[]
  /** The change this month in the share of main roads in good or fair repair from the player's patching, thousandths of a point. */
  acted: number
}

/**
 * Slice 9: one thing the game suggests the player do now, for "What could I do now?" (`Rules.advise`). Something the
 * city can afford now and the rules allow, chosen from the city's own state (the roads that cost most time, the busiest
 * corridors without a bus, the most dangerous zones, the most jammed junctions), with what it is expected to do to the
 * score. The expectation is an estimate unless `checked`: the screen must say so ("about +4 within a year").
 */
export interface Advice {
  /** For the player, short: "Patch the potholes on Hosur Road, Silk Board to Electronic City". */
  title: string
  /** One or two short sentences: what it does, and why here. */
  text: string
  /** The lever it uses (`src/rules/unlock.ts`), for the screen to open the right page. */
  lever: string
  /** The actions that begin it, to `act` in order: one press. For a build, `actions[0].plan` may be quoted and shown first. */
  actions: Action[]
  /** What it costs now, and each month to run or keep once done (lakh). */
  cost: Lakh
  running: Lakh
  /**
   * The change it is expected to make to the score within a year, in points of 1,000, against not doing it. An
   * estimate from last month's traffic unless `checked` (worked out with a run of the model).
   */
  score: number
  checked: boolean
  /** Where it is, for the map: routing links, a zone, or a place. */
  links?: number[]
  zone?: number
  at?: LngLat
}

/** The rules of the game, as the screen and the server use them. */
export interface Rules {
  start(season: Season, city: CityData): Game
  /** Whether an action may be done now, and what it would cost, without doing it. */
  may(game: Game, city: CityData, action: Action): Outcome
  /** What a plan would cost and take, and where exactly it would go. Changes nothing. */
  quote(game: Game, city: CityData, plan: Plan): Quote
  /** Routes the game suggests for a new line of this kind, best first, for the player to accept and adjust. */
  /**
   * Given `simulate` (slice 5), metro suggestions are checked with a run of the model each (about 0.2 s each, eight at
   * most) and ranked by the riders they would carry, for their cost.
   */
  suggest(game: Game, city: CityData, kind: 'metro' | 'busRoute' | 'road', simulate?: Simulate): Plan[]
  /** Does an action. The game is changed only if the outcome is ok. */
  act(game: Game, city: CityData, action: Action): Outcome
  /** What decides this month's traffic. */
  state(game: Game, city: CityData): CityState
  /** Ends the month: takes its traffic, settles the books, moves to the next month, and reports. */
  endMonth(game: Game, city: CityData, result: MonthResult): Report
  /** The books as they would be at the end of this month if nothing changed. */
  books(game: Game, city: CityData): Entry[]
  /** The score as it stands. */
  score?(game: Game, city: CityData): Score
  /** Plays a whole game again from its season and list of actions. The result must equal the original. */
  replay(season: Season, city: CityData, done: Done[], simulate: Simulate): Game
  /** Where one place would go as a stop of a new line, before there is a line to quote, or why it cannot. */
  snap?(game: Game, city: CityData, kind: 'metro' | 'busRoute' | 'road', stop: Stop): Quote['stations'][number] | { reason: string }
  /**
   * Slice 9: "What could I do now?": up to `count` (3) things the city can afford now that are expected to raise the
   * score most, best first (`Advice`). `levers`, if given, limits them to those levers (in a first game, `unlocked`
   * from `src/rules/unlock.ts`). Given `simulate`, the best that can be checked is checked with two runs of the model
   * (about half a second in a browser); without, estimates only (about 20 to 70 ms). Before the first month there is no
   * last month's traffic: pass this month's as `result` if it has been worked out, else it is worked out once (and
   * then nothing is checked). Changes nothing.
   */
  advise?(game: Game, city: CityData, options?: { levers?: string[]; count?: number; simulate?: Simulate; result?: MonthResult }): Advice[]
}

export type { Mode }
