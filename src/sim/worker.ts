import type { Network, Transit, Zone } from '../data/types'
import { metres, openInto, ROAD_KINDS, withBuilding } from '../game/build'
import { KEEP_VERSION, matches, OLD_KEY, readKept, writeKept, type Kept } from '../game/keep'
import { gameDigest } from '../rules/digest'
import { fromWire } from '../rules/wire'
import type { MonthSent } from '../net/types'
import { spanReport } from '../game/report'
import { standInRouting, standInSimulate } from '../game/standin'
import { STANDIN_SEASON, standInRules } from '../game/standin-rules'
import { trafficView, transferables, type TrafficView } from '../game/traffic'
import { gradeOf, linkDelays, type LinkDelay } from '../game/upkeep'
import { deeds, roadKmOf } from '../game/deeds'
import { servedByZone, standInEvents, standInScore, worstFifth } from '../game/score'
import type { Advice } from '../rules/types'
import { worstRoads } from '../rules/upkeep'
import type { Action, CityData, Done, Entry, Game, GameEvent, Outcome, Plan, Quote, Report, Rules, Score, Season, Stop } from '../rules/types'
import type { LngLat } from '../data/types'
import { PERIODS, type CityState, type Mode, type MonthResult, type Period, type RoutingLink, type RoutingNetwork, type Simulate } from './types'

/*
 * Works out months in a thread of its own, so that the page never freezes (PRD SIM-5). It loads the city's fixed
 * data itself and holds the game: the rules run here, beside the model whose results they need, and the page is
 * sent the game as it stands after each step. Traffic goes back without copying: the arrays of the map's view are
 * transferred. The game is kept in the browser from here, so that keeping it never holds up the page.
 */

/** A month's traffic as the page needs it: the figures and the zones' commutes, without the flows on every road. */
export type Light = Omit<MonthResult, 'flow' | 'speed'>

/** The game as the page sees it: without the last month's traffic, which stays here. */
export interface Seen {
  game: Game
  /** When each month was ended, for the daily allowance. */
  times: number[]
  /** The transit the month is worked out with (the city's, the season's opened, the player's), when it has changed. */
  transit?: Transit
}

/** What a month or a change would come to: the city's figures and the month's books. */
export interface Outlook {
  commute: number
  trips: Record<Mode, number>
  riders: Record<string, number>
  books: Entry[]
  /** Money at the end of the month. */
  money: number
  /** Road deaths a year at the month's rate, where the model gives them. */
  deaths?: number
}

/** What a plan would do once open: the month as it stands, and with the plan built and open. */
export interface Foreseen {
  quote: Quote
  /** Whether it may be ordered now, and if not, why. */
  outcome: Outcome
  before: Outlook | null
  after: Outlook | null
  /** Riders a weekday on the new line (or, for more trains, on the line), before and once open. */
  riders: [number, number] | null
  /** The average commute, in seconds, of the people living near its stations, before and once open. */
  served: { zones: number; people: number; before: number; after: number } | null
  /** Road deaths a year in the zones it serves, before and once open, where the model gives them. */
  servedDeaths?: [number, number] | null
  /** Km an hour through the junctions at its ends (or the junction worked on) at the evening peak, before and once open. */
  through?: [number, number] | null
  /** Why there is no forecast from the model, where there is none by design. */
  unforeseen?: string
  /**
   * For mending roads: the surface of the links chosen (their average condition, by length) and km an hour along them
   * at the evening peak, before and a month on.
   */
  road?: { condition: [number, number]; kmh: [number, number] }
  /**
   * For mending that takes months (resurfacing, concrete): the month as it stands against the same month with the work
   * under way and its lanes shut, km an hour along the road at the evening peak and the city's commute in seconds.
   */
  during?: { months: number; kmh: [number, number]; commute: [number, number] }
  /**
   * For mending: vehicles an hour along the road at the evening peak, and the minutes each takes over its length,
   * before and a month on, so that a road that draws more traffic is not reported only as slower.
   */
  carried?: { vehicles: [number, number]; minutes: [number, number] }
  /** The score a year on with it open (or in force), against the same year without it (PRD UI-5). */
  score?: ScoreAhead
}

/** What a thing would do to the score: the score a year on without it and with it. */
export interface ScoreAhead {
  before: Score
  after: Score
  months: number
}

export interface Forecast {
  outcome: Outcome
  /** The month as it stands, and with the change made; `after` is missing if the change cannot be made. */
  before: Outlook
  after: Outlook | null
  score?: ScoreAhead
}

/** "Why is this bad?" for a zone (PRD SCORE-14): its figures against the city's, and the roads its delay is on. */
export interface ZoneWhy {
  zone: number
  commute: number
  access: number
  /** Road deaths a year per lakh people living there, where the model gives deaths and enough people live there. */
  deaths: number | null
  city: { commute: number; access: number; deaths: number | null }
  /** Whether it is among the worst-served fifth of zones (PRD SCORE-5). */
  worst: boolean
  /** The roads its commuters lose most time on in the morning, largest first, with their share of that time. */
  roads: { link: number; drawn: number[]; share: number }[]
}

/** "Why is this bad?" for a road: its busiest stretch at the evening peak against what it holds. */
export interface RoadWhy {
  vehicles: number
  capacity: number
  kmh: number
  free: number
  signals: number
}

/** The state of the roads as the map shows it. */
export interface SurfaceOut {
  /**
   * For each drawn stretch: its grade (0 good to 3 broken, the worst of its links), plus 4 if laid in concrete, plus 8
   * or 16 if its surface is among those that cost the most time a kilometre (the costliest tenth: 16; the next 30%: 8).
   */
  stretch: Uint8Array
  /** For each routing link by id, its condition 0 to 100. */
  byLink: Uint8Array
  /** For each zone by id, the condition of its minor streets, 0 to 100; absent where the rules keep none. */
  streets: number[] | null
  concrete: number[]
  upkeep: Game['upkeep'] | null
  digOnce: boolean
}

/** A routing link of a road tapped: its condition, and the vehicle-minutes a weekday its surface costs in the month shown. */
export interface RoadOut {
  id: number
  drawn: number[]
  length: number
  condition: number
  minutes: number | null
}

/**
 * A road the player mended, in the month just ended: km an hour along it at the evening peak had it been left as it
 * was, and as it is; and its surface before and after.
 */
export interface Mended {
  links: number[]
  work: 'patch' | 'resurface' | 'concrete'
  month: number
  kmh: [number, number]
  condition: [number, number]
}

/** The report, with what the screen adds to it: the delay each road in poor repair causes, and the roads mended. */
export type ReportOut = Report & { delays?: LinkDelay[]; mended?: Mended[] }

/** The questions the page asks, with what each is answered with. */
/**
 * Which game to begin, and from what. `key` is the game's id, under which it is kept in the browser (none: the one game
 * kept before slice 8). `season` is the season it is played in (none: the one built in). `list` is the server's list
 * of its actions and the month it has reached: the game is played again from it unless the browser's copy agrees with
 * it, or is further on by months still waiting to be sent (`pending`). `view` plays another player's city from `list`,
 * kept nowhere, and refuses every change to it.
 */
export interface Begin {
  fresh: boolean
  key?: string
  season?: Season
  list?: { done: Done[]; month: number } | null
  pending?: number[]
  view?: boolean
  /** Play the game again from `list` whatever the browser holds: the server's figures differed from the browser's. */
  replay?: boolean
  /** With `view`: the finished game as the server keeps it (`toWire`), taken as it is instead of playing it again. */
  state?: unknown
}

export interface Questions {
  begin: [Begin, Seen & { older: string | null; replayed: boolean; standIn: boolean; digest: string }]
  show: [{}, { result: Light; view: TrafficView }]
  act: [{ action: Action }, Seen & { outcome: Outcome }]
  may: [{ actions: Action[] }, Outcome[]]
  forecast: [{ action: Action }, Forecast]
  /** Ends a month. Its report has no causes yet: they come with `report`, for the whole span ended since the last. */
  end: [{}, Seen & { report: Report; result: Light; view: TrafficView; sent: MonthSent }]
  /**
   * Puts the game back to the start of a month, before anything was done in it, where the browser still holds that
   * moment (the months not yet acknowledged); null where it does not, and the game must be played again from the list.
   */
  undo: [{ month: number }, Seen | null]
  /** One report for the months ended since the last report, with causes (PRD TIME-8, SCORE-13). */
  report: [{}, ReportOut | null]
  /** The books for this month if nothing changes, and money over the next twelve months as things stand. */
  books: [{}, { now: Entry[]; ahead: { month: number; money: number }[] }]
  /** Where a plan would go and what it would cost. Quick: no model run. */
  quote: [{ plan: Plan }, Quote]
  /** The game's suggested routes for a kind of line, best first, each with its quote. */
  suggest: [{ kind: 'metro' | 'busRoute' | 'road' }, { plan: Plan; quote: Quote }[]]
  /** What a plan would do once open: a model run with it open. */
  foresee: [{ plan: Plan }, Foreseen]
  /**
   * Routing links as the map draws them, by the stretches they stand for: those named, all with two lanes or more, or
   * (`twoWay`) all that run both ways and so could be made one-way. A link that stands for no drawn stretch (a road
   * the player built) comes with its own line.
   */
  links: [{ ids?: number[]; twoWay?: boolean; all?: boolean }, DrawnLinkOut[]]
  /** The state of the roads: every stretch's grade, every link's and zone's condition, the budget and dig once. */
  surface: [{}, SurfaceOut]
  /** A road tapped in the road condition view: the links on its stretches, how they stand and what they cost. */
  road: [{ stretches: number[] }, RoadOut[]]
  /** Where one tap would go as the first place of a plan, or why it cannot. */
  snap: [{ kind: 'metro' | 'busRoute'; stop: Stop }, Quote['stations'][number] | { reason: string }]
  /** Junctions that can be worked on: where, whether signalled, how jammed at the evening peak, and work done. */
  nodes: [{}, JunctionOut[]]
  /** The main roads of a zone (by its outline): km of them at each free speed, and the limit set there. */
  zoneRoads: [{ zone: number; rings: number[][][] }, { km: number; bySpeed: [number, number][]; limit: number | null }]
  /** Roads the player may not make one-way again, and those one-way now: for arrows while the tool is chosen. */
  oneWays: [{}, { id: number; drawn: number[]; forward: boolean[]; line?: number[] }[]]
  /** Why a zone is served as it is, in the month shown. */
  whyZone: [{ zone: number }, ZoneWhy]
  /** Why a road is slow, in the month shown. */
  whyRoad: [{ links: number[] }, RoadWhy | null]
  /** What the player did and what came of it, in short lines, for the ending. */
  deeds: [{}, string[]]
  /** The zones of the worst-served fifth in the month shown, by id, for the fairness view. */
  worst: [{}, number[]]
  /** Slice 9: what the introduction has the player do in their first month: a bad road near the middle, a bus route. */
  first: [{}, FirstSteps]
  /** Slice 9: "What could I do now?": up to three things to do now that the city can afford, best first. */
  advise: [{ levers?: string[] }, Advice[]]
}

/** The introduction's two acts, chosen from the city as it stands. */
export interface FirstSteps {
  /** The road in poor repair near the middle of the city whose potholes cost most time, and where to point at it. */
  road: { name: string; links: number[]; hours: number; condition: number; at: LngLat } | null
  /** A bus route along a busy corridor with no bus of the player's: its two ends, for the player to tap. */
  bus: { from: { at: LngLat; name: string }; to: { at: LngLat; name: string }; cost: number } | null
}

/** A routing link for the map. */
export interface DrawnLinkOut {
  id: number
  drawn: number[]
  lanes: number
  /** From and to, as lng, lat, lng, lat, for naming its direction and drawing a link that has no stretch. */
  ends?: number[]
  kind?: string
  /** Metres. */
  length?: number
}

export interface JunctionOut {
  id: number
  at: LngLat
  signal: boolean
  /** 0 moving to 3 jammed, the worst of the roads into it at the evening peak. */
  jam: number
  work: 'signal' | 'redesign' | 'overpass' | null
}
export type Question = keyof Questions

export type Ask =
  | { type: 'load'; base: string; standIn?: boolean }
  | { [Q in Question]: { type: Q; id: number } & Questions[Q][0] }[Question]

export type Answer =
  | {
    type: 'loaded'
    stand: { routing: boolean; model: boolean; rules: boolean; building: boolean }
    /** The version of the rules, to be compared with the season's on the server. */
    rules: number
    links: number
    stretches: number
  }
  | { type: 'reply'; id: number; value: unknown }
  | { type: 'progress'; month: number; of: number }
  | { type: 'error'; id: number | null; message: string }

/** The worker's side of the channel. The page's own types (DOM) are in scope, not the worker's, so it is typed here. */
const port = self as unknown as {
  onmessage: (event: MessageEvent<Ask>) => void
  postMessage(message: Answer, transfer?: Transferable[]): void
}

// B's model, D's rules and season, and A's routing network are used where they exist, and stand-ins where not.
type LinkKmh = (roads: RoutingNetwork, result: MonthResult, period: Period, link: RoutingLink) => number
const models = import.meta.glob<{ simulate?: Simulate; linkKmh?: LinkKmh }>('./index.ts')
type DelayByRoad = (state: CityState, result: MonthResult, zone: number, period: Period, top?: number) => { link: number; seconds: number }[]
const reasonsModules = import.meta.glob<{ delayByRoad?: DelayByRoad }>('./reasons.ts')
const rulesModules = import.meta.glob<{ rules?: Rules; version?: string | number }>('../rules/index.ts')
const seasons = import.meta.glob<Record<string, unknown>>('../seasons/first.ts')
type Forward = (game: Game, city: CityData, months?: number) => { month: number; money: number }[]
type WorstServed = (result: MonthResult, game: Game, city: CityData) => { access: number[]; commute: number[] }
const scoreModules = import.meta.glob<{ worstServed?: WorstServed }>('../rules/score.ts')
const rulesExtras = import.meta.glob<{
  forecast?: Forward
  combine?: (reports: Report[]) => Report
  spanStart?: (game: Game) => unknown
  explain?: (game: Game, city: CityData, simulate: Simulate, start: unknown, report: Report) => Report
}>(['../rules/index.ts', '../rules/report.ts'])

let city: CityData | null = null
let simulate: Simulate = standInSimulate
let linkKmh: LinkKmh | null = null
let delayByRoad: DelayByRoad | null = null
let worstServed: WorstServed | null = null
/** Made-up events, shown while the rules keep none of their own. Display only. */
let fakeEvents: GameEvent[] | null = null
let rules: Rules = standInRules
/** Whether building is the screen's stand-in, until the rules have their own. */
let buildStandIn = false
/** Roads mended since the page last asked for a report, with how they stood before. Not kept with the game. */
let mends: { links: number[]; work: Mended['work']; month: number; before: Record<number, number> }[] = []
/** What decided the month last ended, to work it out again with the roads mended in it left as they were. */
let lastState: CityState | null = null
/** Whether the rules as a whole are the screen's stand-in. */
let standInRulesUsed = true
/** The transit last sent to the page, so that it is sent again only when it changes. */
let sentTransit = ''
let season: Season = STANDIN_SEASON
let version = `${KEEP_VERSION}`
let rulesVersion = 0
let game: Game | null = null
/** The id the game is kept under, or null for a game kept nowhere (another player's city). */
let key: string | null = OLD_KEY
/** Another player's city: nothing in it may change, and nothing of it is kept. */
let viewing = false
/**
 * The game as it stood at the start of recent months, before anything was done in them, by month: so that a month the
 * server refuses can be undone at once, without playing the game again. Only the last few are held.
 */
let starts = new Map<number, Game>()
const STARTS = 14
let times: number[] = []
/** The rules' own ways to look ahead and to explain a span of months, where they exist. */
let extras: {
  forward?: Forward
  combine?: (reports: Report[]) => Report
  start?: (game: Game) => unknown
  explain?: (game: Game, city: CityData, simulate: Simulate, start: unknown, report: Report) => Report
} = {}
/** The months ended since the last report, and the game as it stood before the first of them. */
let span: { start: unknown; reports: Report[] } | null = null

async function json<T>(url: string): Promise<T | null> {
  const response = await fetch(url)
  return response.ok ? ((await response.json()) as T) : null
}

function isSeason(value: unknown): value is Season {
  const s = value as Season
  return !!s && typeof s === 'object' && typeof s.seed === 'number' && typeof s.months === 'number'
}

async function load(base: string, standIn = false): Promise<Answer> {
  const quietly = <T>(load?: () => Promise<T>) =>
    load?.().catch((error) => {
      console.warn('Could not be loaded:', error)
      return null
    }) ?? Promise.resolve(null)
  const [model, rulesModule, seasonModule, reasons] = await Promise.all([
    standIn ? null : quietly(models['./index.ts']),
    quietly(rulesModules['../rules/index.ts']),
    quietly(seasons['../seasons/first.ts']),
    standIn ? null : quietly(reasonsModules['./reasons.ts']),
  ])
  if (model?.simulate) simulate = model.simulate
  if (model?.simulate && reasons?.delayByRoad) delayByRoad = reasons.delayByRoad
  if (model?.simulate && model.linkKmh) linkKmh = model.linkKmh
  const found = Object.values(seasonModule ?? {}).find(isSeason)
  if (rulesModule?.rules && found) {
    rules = rulesModule.rules
    season = found
    const [index, report] = await Promise.all([
      quietly(rulesExtras['../rules/index.ts']),
      quietly(rulesExtras['../rules/report.ts']),
    ])
    extras = { forward: index?.forecast, combine: report?.combine, start: report?.spanStart, explain: report?.explain }
    worstServed = (await quietly(scoreModules['../rules/score.ts']))?.worstServed ?? null
  }
  standInRulesUsed = rules === standInRules
  const [zones, transit, routing] = await Promise.all([
    json<Zone[]>(`${base}data/zones.json`),
    json<Transit>(`${base}data/transit.json`),
    json<RoutingNetwork>(`${base}data/routing.json`).catch(() => null),
  ])
  if (!zones || !transit) throw new Error('The zones or the transit lines could not be loaded.')
  let roads = routing
  if (!roads) {
    const network = await json<Network>(`${base}data/network.json`)
    if (!network) throw new Error('Neither the routing network nor the road network could be loaded.')
    roads = standInRouting(network, zones)
  }
  city = { zones, transit, roads }
  const built = withBuilding(rules, city, season)
  rules = built
  buildStandIn = built.standIn
  rulesVersion = Number(rulesModule?.version ?? 0)
  // The season is checked apart, since the server says which season a game is in.
  version = `${KEEP_VERSION}.${standInRulesUsed ? 'standin' : (rulesModule?.version ?? 'rules')}` + (buildStandIn ? '.build-standin' : '')
  let stretches = 0
  for (const l of roads.links) for (const d of l.drawn) stretches = Math.max(stretches, d + 1)
  return {
    type: 'loaded',
    stand: { routing: !routing, model: simulate === standInSimulate, rules: standInRulesUsed, building: buildStandIn },
    rules: rulesVersion,
    links: roads.links.length,
    stretches,
  }
}

/*
 * Months worked out, by what decided them, so that a month asked for twice (shown, then ended; or forecast, then
 * chosen) is worked out once. A handful is enough, and each is a few hundred kilobytes.
 */
const worked: { key: string; result: MonthResult }[] = []

function stateKey(state: CityState, data: CityData): string {
  // The fixed data is the same object from month to month; only what the rules change is spelt out.
  return JSON.stringify(state, (_key, value) =>
    value === data.roads ? '=roads' : value === data.transit ? '=transit' : value === data.zones ? '=zones' : value,
  )
}

function work(g: Game, data: CityData): MonthResult {
  return simulateOnce(rules.state(g, data), data)
}

function simulateOnce(state: CityState, data: CityData): MonthResult {
  const key = stateKey(state, data)
  const hit = worked.find((w) => w.key === key)
  if (hit) return hit.result
  const result = simulate(state)
  worked.unshift({ key, result })
  worked.length = Math.min(worked.length, 4)
  return result
}

/** A month's traffic as the map draws it, on the roads it was worked out on, new roads included. */
function viewOf(g: Game, data: CityData, result: MonthResult, roads = roadsNow(g, data), shut = shutOf(g, data)): TrafficView {
  const view = trafficView(roads, result, linkKmh ? (period, link) => linkKmh!(roads, result, period, link) : undefined)
  const flooded: NonNullable<TrafficView['flooded']> = []
  // A road shut by an event (a burst main) is drawn with the event, not as water.
  const closed = new Set(eventsOf(g).flatMap((e) => e.links ?? []))
  for (const [id, share] of Object.entries(shut)) {
    const l = roads.links[Number(id)]
    if (!l || share <= 0 || closed.has(l.id)) continue
    flooded.push({ link: l.id, drawn: l.drawn, days: Math.max(1, Math.round((share * 30) / 1000)), ends: endsOf(roads, l) })
  }
  if (flooded.length) view.flooded = flooded
  // Links that stand for no drawn stretch are roads the player built: their traffic is drawn along their own line.
  const extra: NonNullable<TrafficView['extra']> = []
  for (const l of roads.links) {
    if (l.drawn.length) continue
    const level = PERIODS.map((p) => {
      const share = result.speed[p][l.id] ?? 1000
      return share < 300 ? 3 : share < 450 ? 2 : share < 650 ? 1 : 0
    })
    extra.push({ link: l.id, line: endsOf(roads, l), level })
  }
  if (extra.length) view.extra = extra
  return view
}

/** Roads shut by flooding in a month, with the share of the month each is shut, in thousandths, as the rules pass them to the model. */
function shutOf(g: Game, data: CityData, state = rules.state(g, data)): Record<number, number> {
  return state.shut ?? {}
}

/** Km an hour along some links at the evening peak, by length, and their surface, by length. */
function alongLinks(g: Game, data: CityData, result: MonthResult, links: number[]): { kmh: number; condition: number } {
  const roads = roadsNow(g, data)
  let metres = 0, hours = 0, cond = 0
  for (const id of links) {
    const l = roads.links[id]
    if (!l) continue
    const kmh = Math.max(1, linkKmh ? linkKmh(roads, result, 'evening', l) : (l.speed * (result.speed.evening[id] ?? 1000)) / 1000)
    metres += l.length
    hours += l.length / kmh
    cond += l.length * (g.condition?.[id] ?? 100)
  }
  return metres ? { kmh: metres / hours, condition: cond / metres } : { kmh: 0, condition: 100 }
}

/**
 * What the roads mended since the last report did in the month just ended: the month worked out again with their
 * surfaces as they were before mending, against the month as it was. One more run of the model, only when something
 * was mended; and only where the model was given the surface.
 */
function mendedIn(g: Game, data: CityData, last: MonthResult): Mended[] {
  const state = lastState
  if (!mends.length || !state?.surface) return []
  const surface = [...state.surface]
  for (const m of mends) for (const [id, c] of Object.entries(m.before)) surface[Number(id)] = Math.min(surface[Number(id)] ?? 100, c)
  const left = simulateOnce({ ...state, surface }, data)
  const kmh = (result: MonthResult, links: number[]) => {
    let metres = 0, hours = 0
    for (const id of links) {
      const l = state.roads.links[id]
      if (!l) continue
      const v = Math.max(1, linkKmh ? linkKmh(state.roads, result, 'evening', l) : (l.speed * (result.speed.evening[id] ?? 1000)) / 1000)
      metres += l.length
      hours += l.length / v
    }
    return hours ? metres / hours : 0
  }
  return mends.map((m) => {
    const lengths = m.links.map((id) => state.roads.links[id]?.length ?? 0)
    const total = lengths.reduce((a, b) => a + b, 0) || 1
    const avg = (c: (id: number) => number) => m.links.reduce((sum, id, i) => sum + c(id) * lengths[i]!, 0) / total
    return {
      links: m.links, work: m.work, month: m.month,
      kmh: [kmh(left, m.links), kmh(last, m.links)],
      condition: [avg((id) => m.before[id] ?? 100), avg((id) => state.surface?.[id] ?? 100)],
    }
  })
}

function surfaceOf(g: Game, data: CityData): SurfaceOut {
  const roads = roadsNow(g, data)
  let stretches = 0
  for (const l of roads.links) for (const d of l.drawn) stretches = Math.max(stretches, d + 1)
  const stretch = new Uint8Array(stretches)
  const byLink = new Uint8Array(roads.links.length).fill(100)
  const concrete = new Set(g.concrete ?? [])
  const seen = new Uint8Array(stretches)
  for (const l of roads.links) {
    const c = g.condition?.[l.id] ?? 100
    byLink[l.id] = Math.max(0, Math.min(100, Math.round(c)))
    const grade = gradeOf(c)
    for (const d of l.drawn) {
      // The worst of the links on a stretch, and marked concrete only if every link on it is.
      const was = seen[d] ? stretch[d]! & 3 : 0
      const allConcrete = (seen[d] ? (stretch[d]! & 4) !== 0 : true) && concrete.has(l.id)
      stretch[d] = Math.max(was, grade) | (allConcrete ? 4 : 0)
      seen[d] = 1
    }
  }
  // What each stretch's surface costs in the month shown, by the kilometre, from the model's `surfaceDelay`.
  const delay = (work(g, data) as MonthResult & { surfaceDelay?: ArrayLike<number> }).surfaceDelay
  if (delay) {
    const perKm = new Float64Array(stretches)
    for (const l of roads.links) {
      const d = delay[l.id] ?? 0
      if (d > 0 && l.length > 0) for (const s of l.drawn) perKm[s]! += d / (l.length / 1000)
    }
    const costly = [...perKm.keys()].filter((s) => perKm[s]! > 0).sort((a, b) => perKm[b]! - perKm[a]!)
    costly.forEach((s, i) => {
      if (i < costly.length * 0.1) stretch[s]! |= 16
      else if (i < costly.length * 0.4) stretch[s]! |= 8
    })
  }
  return {
    stretch, byLink, streets: g.streets ?? null, concrete: [...concrete], upkeep: g.upkeep ?? null, digOnce: !!g.digOnce,
  }
}

/** The links on some drawn stretches, with their condition and the vehicle-minutes a weekday their surface costs. */
function roadOf(g: Game, data: CityData, stretches: number[]): RoadOut[] {
  const on = new Set(stretches)
  const roads = roadsNow(g, data)
  const delay = (work(g, data) as MonthResult & { surfaceDelay?: ArrayLike<number> }).surfaceDelay
  return roads.links.filter((l) => l.drawn.some((d) => on.has(d))).map((l) => ({
    id: l.id, drawn: l.drawn, length: l.length, condition: g.condition?.[l.id] ?? 100, minutes: delay?.[l.id] ?? null,
  }))
}

function light(result: MonthResult): Light {
  const { flow: _flow, speed: _speed, ...rest } = result
  // Copies, since the result stays here as the game's last month and its arrays must not be taken away.
  return { ...rest, commuteByZone: result.commuteByZone.slice(), accessByZone: result.accessByZone.slice() }
}

/** The score as it stands: the rules' own, kept by them; or the screen's stand-in, kept here with the game. */
function scoreOf(g: Game, data: CityData, result: MonthResult | null = g.last): Score | null {
  if (rules.score) {
    try {
      return rules.score(g, data)
    } catch (error) {
      console.warn('The score could not be worked out:', String(error))
      return g.score ?? null
    }
  }
  return standInScore(g, data.zones, result)
}

/** Keeps the stand-in score with the game after a month ends, and the total at each year's end, while the rules keep none. */
function keepScore(g: Game, data: CityData, result: MonthResult): void {
  if (rules.score) return
  g.score = standInScore(g, data.zones, result)
  if (g.month % 12 === 0 && g.month > 0) (g.scores ??= []).push(g.score.total)
}

/** Events in force in a month: the rules' own, or the made-up ones while the rules keep none. */
function eventsOf(g: Game): GameEvent[] {
  if (g.events) return g.events
  return (fakeEvents ?? []).filter((e) => e.started <= g.month && g.month <= e.ends)
}

/**
 * The score a year on as things stand: the game played forward twelve months on a copy, with the month's traffic
 * held as given, so that the score's average of twelve months takes the thing in full. Null if the rules cannot.
 */
function scoreAhead(g: Game, data: CityData, result: MonthResult, months = 12): Score | null {
  try {
    for (let i = 0; i < months && g.status === 'playing'; i++) rules.endMonth(g, data, { ...result, month: g.month })
    return scoreOf(g, data, result)
  } catch (error) {
    console.warn('The score ahead could not be worked out:', String(error))
    return null
  }
}

/** Both sides of a score forecast, or nothing where either could not be worked out. */
function ahead(without: Game, withIt: Game, data: CityData, b: MonthResult, a: MonthResult): ScoreAhead | undefined {
  const before = scoreAhead(without, data, b)
  const after = scoreAhead(withIt, data, a)
  return before && after ? { before, after, months: 12 } : undefined
}

/**
 * Before the first month has ended the rules have nothing to score (they score each month's figures once worked out):
 * the score shown is the month as it would end with nothing done, on a copy. Kept for each state of the first month.
 */
let first: { key: string; score: Score | null } | null = null
function firstScore(g: Game, data: CityData): Score | null {
  const key = `${g.season.id}:${g.done.length}`
  if (first?.key === key) return first.score
  let score: Score | null = null
  try {
    const copy = structuredClone(g)
    const result = work(g, data)
    rules.endMonth(copy, data, result)
    score = scoreOf(copy, data, result)
  } catch (error) {
    console.warn('The first score could not be worked out:', String(error))
  }
  first = { key, score }
  return score
}

function seen(): Seen {
  const out: Seen = { game: { ...game!, last: null }, times: [...times] }
  if (city && !game!.reports.length && game!.month === 0) out.game.score = firstScore(game!, city) ?? out.game.score
  else if (!out.game.score && city) out.game.score = scoreOf(game!, city) ?? undefined
  if (!game!.events && fakeEvents) out.game.events = eventsOf(game!)
  if (city) {
    const transit = rules.state(game!, city).transit
    const key = transit.lines.map((l) => `${l.id}:${l.status}:${l.stations.length}`).join()
    if (key !== sentTransit) {
      sentTransit = key
      out.transit = transit
    }
  }
  return out
}

function keep(): void {
  if (!game || viewing || !key) return
  // Copied now, since the store reads it only later, by when the game may have moved on.
  const kept: Kept = structuredClone({ version, season: game.season, done: game.done, month: game.month, times, game })
  void writeKept(key, kept)
}

/** Holds the game as it stands at the start of a month, before anything is done in it. */
function markStart(): void {
  if (!game || viewing || game.done.some((d) => d.month === game!.month)) return
  starts.set(game.month, structuredClone(game))
  for (const m of [...starts.keys()].sort((a, b) => a - b).slice(0, Math.max(0, starts.size - STARTS))) starts.delete(m)
}

/** The month as it would end: its traffic and books, on a copy of the game. */
function outlook(g: Game, data: CityData): Outlook {
  const result = work(g, data)
  const report = rules.endMonth(g, data, result)
  return { commute: result.commute, trips: result.trips, riders: result.riders, books: report.books, money: g.money, deaths: result.deaths }
}

/** Zones whose centre is within this many metres of a stop are served by it: 1 km, as the model's measures take it. */
const SERVED_M = { metro: 1000, busRoute: 1000 }

function foresee(g: Game, data: CityData, plan: Plan): Foreseen {
  const quote = rules.quote(g, data, plan)
  const outcome = rules.may(g, data, { kind: 'build', plan })
  const empty: Foreseen = { quote, outcome, before: null, after: null, riders: null, served: null }
  if (!quote.ok) return empty
  if (ROAD_KINDS.has(plan.kind)) return foreseeRoad(g, data, plan, quote, outcome)
  const now = structuredClone(g)
  const before = outlook(now, data)
  const opened = structuredClone(g)
  openInto(opened, data, plan, quote, 'planned')
  const beforeResult = work(g, data)
  const afterResult = work(opened, data)
  // Copied before `outlook` ends the month on it, so that both sides of the score start from the same month.
  const paid = structuredClone(opened)
  const after = outlook(opened, data)
  let riders: [number, number] | null = null
  if (plan.kind === 'metro' || plan.kind === 'busRoute') riders = [0, afterResult.riders.planned ?? 0]
  else if (plan.kind === 'railService') riders = [beforeResult.riders[plan.line] ?? 0, afterResult.riders[plan.line] ?? 0]
  let served: Foreseen['served'] = null
  if (plan.kind === 'metro' || plan.kind === 'busRoute') {
    const reach = SERVED_M[plan.kind]
    const zones = data.zones.filter((z) => quote.stations.some((s) => metres(z.centre, s.at) <= reach))
    let people = 0, b = 0, a = 0
    for (const z of zones) {
      people += z.people
      b += z.people * beforeResult.commuteByZone[z.id]!
      a += z.people * afterResult.commuteByZone[z.id]!
    }
    if (people) served = { zones: zones.length, people, before: b / people, after: a / people }
  }
  // The score a year after it opens, paid for, against a year without it.
  paid.money -= quote.cost
  const score = ahead(structuredClone(g), paid, data, beforeResult, afterResult)
  return { quote, outcome, before, after, riders, served, score }
}

/**
 * What a road, a junction or a policy would do once in force: the plan ordered on a copy of the game and opened at the
 * month's end by the rules themselves, against a copy that did not order it, both a month on. The copy is let order
 * it whatever the money and the major works left, since the forecast is of the thing, not of whether it can be paid.
 */
function foreseeRoad(g: Game, data: CityData, plan: Plan, quote: Quote, outcome: Outcome): Foreseen {
  const none: Foreseen = { quote, outcome, before: null, after: null, riders: null, served: null }
  if (plan.kind === 'density') return { ...none, unforeseen: 'Taller building shows over years, as the city grows: more of its growth comes here.' }
  const base = work(g, data)
  const without = structuredClone(g)
  const withIt = structuredClone(g)
  withIt.majors = 0
  withIt.money = Math.max(withIt.money, quote.cost + 100_000)
  const done = rules.act(withIt, data, { kind: 'build', plan })
  if (!done.ok) return { ...none, unforeseen: done.reason }
  const started = (withIt.projects ?? []).filter((p) => p.started === withIt.month && !(g.projects ?? []).some((q) => q.id === p.id))
  for (const p of started) p.opens = withIt.month + 1
  try {
    rules.endMonth(without, data, { ...base, month: without.month })
    rules.endMonth(withIt, data, { ...base, month: withIt.month })
  } catch (error) {
    return { ...none, unforeseen: `The rules could not open it: ${String(error)}` }
  }
  const b = work(without, data)
  const a = work(withIt, data)
  // The copy with it was given money to order it whatever the city has: the score's copy without is given the same.
  const lent = Math.max(0, quote.cost + 100_000 - g.money)
  const plain = structuredClone(without)
  plain.money += lent
  const score = ahead(plain, structuredClone(withIt), data, b, a)
  const pick = (r: MonthResult): Outlook => ({ commute: r.commute, trips: r.trips, riders: r.riders, books: [], money: 0, deaths: r.deaths })
  const zones = servedZones(data, plan, quote, rules.state(g, data).roads)
  let people = 0, cb = 0, ca = 0, db = 0, da = 0
  for (const z of zones) {
    people += z.people
    cb += z.people * b.commuteByZone[z.id]!
    ca += z.people * a.commuteByZone[z.id]!
    db += b.deathsByZone?.[z.id] ?? 0
    da += a.deathsByZone?.[z.id] ?? 0
  }
  const served = people ? { zones: zones.length, people, before: cb / people, after: ca / people } : null
  const ends = junctionsOf(data.roads, plan, quote)
  const through: [number, number] | null = ends.length
    ? [throughKmh(rules.state(without, data).roads, b, ends), throughKmh(rules.state(withIt, data).roads, a, ends)]
    : null
  let road: Foreseen['road']
  let during: Foreseen['during']
  let carried: Foreseen['carried']
  if (plan.kind === 'repair') {
    const x = alongLinks(without, data, b, plan.links)
    const y = alongLinks(withIt, data, a, plan.links)
    road = { condition: [x.condition, y.condition], kmh: [x.kmh, y.kmh] }
    carried = carriedAlong(rules.state(without, data).roads, b, a, plan.links, x.kmh, y.kmh)
    if (quote.months > 0) {
      // The work ordered and not yet done: this month with its lanes shut, against this month as it stands.
      const busy = structuredClone(g)
      busy.majors = 0
      busy.money = Math.max(busy.money, quote.cost + 100_000)
      if (rules.act(busy, data, { kind: 'build', plan }).ok) {
        const r = work(busy, data)
        const now = alongLinks(g, data, base, plan.links)
        const then = alongLinks(busy, data, r, plan.links)
        during = { months: quote.months, kmh: [now.kmh, then.kmh], commute: [base.commute, r.commute] }
      }
    }
  }
  return {
    quote, outcome, before: pick(b), after: pick(a), riders: null, served,
    servedDeaths: b.deathsByZone && a.deathsByZone ? [db, da] : null,
    through, road, during, carried, score,
  }
}

/**
 * Vehicles an hour along some links at the evening peak (the average over their length), before and after, and the
 * minutes one takes over their length at each speed.
 */
function carriedAlong(roads: RoutingNetwork, b: MonthResult, a: MonthResult, links: number[], kmhB: number, kmhA: number): Foreseen['carried'] {
  let metres = 0, fb = 0, fa = 0
  for (const id of links) {
    const l = roads.links[id]
    if (!l) continue
    metres += l.length
    fb += l.length * (b.flow.evening[id] ?? 0)
    fa += l.length * (a.flow.evening[id] ?? 0)
  }
  if (!metres || kmhB <= 0 || kmhA <= 0) return undefined
  // Over the length of the road: a two-way road chosen in both directions is one road, not two.
  const km = roadKmOf(roads, links)
  return { vehicles: [fb / metres, fa / metres], minutes: [(km / kmhB) * 60, (km / kmhA) * 60] }
}

/** The zones a road plan serves: along a road, round a junction, or the zone itself. */
function servedZones(data: CityData, plan: Plan, quote: Quote, roads: RoutingNetwork): CityData['zones'] {
  if (plan.kind === 'footpaths' || plan.kind === 'speedLimit' || plan.kind === 'density' || plan.kind === 'streets') {
    return data.zones.filter((z) => z.id === plan.zone)
  }
  const points: LngLat[] = []
  if (plan.kind === 'repair') {
    // The zones along the roads mended: those within a kilometre of either end of each stretch.
    for (const id of plan.links) {
      const l = roads.links[id]
      if (l) points.push(...(pairsOf(endsOf(roads, l))))
    }
    return data.zones.filter((z) => points.some((p) => metres(z.centre, p) <= 1000))
  }
  const path = quote.path.length >= 2 ? quote.path : quote.stations.flatMap((s) => s.at)
  for (let i = 0; i + 1 < path.length; i += 2) {
    const p: LngLat = [path[i]!, path[i + 1]!]
    const prev = points.at(-1)
    // Points every few hundred metres along the way, so that a long straight road serves the zones in between.
    if (prev) {
      const steps = Math.floor(metres(prev, p) / 400)
      for (let k = 1; k < steps; k++) points.push([prev[0] + ((p[0] - prev[0]) * k) / steps, prev[1] + ((p[1] - prev[1]) * k) / steps])
    }
    points.push(p)
  }
  const reach = plan.kind === 'junction' ? 1500 : 1000
  return data.zones.filter((z) => points.some((p) => metres(z.centre, p) <= reach))
}

/** The routing nodes a plan works on: the junction, or the nodes nearest the ends of a road or a one-way stretch. */
function junctionsOf(roads: RoutingNetwork, plan: Plan, quote: Quote): number[] {
  if (plan.kind === 'junction') return [plan.node]
  if (plan.kind === 'oneWay') {
    const l = roads.links[plan.link]
    return l ? [l.from, l.to] : []
  }
  if (plan.kind !== 'road' || quote.stations.length < 2) return []
  return [quote.stations[0]!.at, quote.stations.at(-1)!.at].map((at) => nearestNode(roads, at))
}

function nearestNode(roads: RoutingNetwork, at: LngLat): number {
  let best = 0
  let bestM = Infinity
  for (const n of roads.nodes) {
    const m = metres(at, [n.at[0] / 1e6, n.at[1] / 1e6])
    if (m < bestM) {
      bestM = m
      best = n.id
    }
  }
  return best
}

/** Km an hour on the roads into some junctions at the evening peak, by the traffic on them. */
function throughKmh(roads: RoutingNetwork, result: MonthResult, nodes: number[]): number {
  const into = new Set(nodes)
  let flow = 0
  let hours = 0
  for (const l of roads.links) {
    if (!into.has(l.to)) continue
    const f = result.flow.evening[l.id] ?? 0
    const kmh = linkKmh ? linkKmh(roads, result, 'evening', l) : (l.speed * (result.speed.evening[l.id] ?? 1000)) / 1000
    if (f <= 0 || kmh <= 0) continue
    flow += f * l.length
    hours += (f * l.length) / kmh
  }
  return hours > 0 ? flow / hours : 0
}

/** The roads the month is worked out on: the city's, with what the player has built, as the rules give them. */
function roadsNow(g: Game, data: CityData): RoutingNetwork {
  return rules.state(g, data).roads
}

/** Junctions that can be worked on: where at least three roads meet and one of them is a main road. */
function junctions(g: Game, data: CityData): JunctionOut[] {
  const roads = roadsNow(g, data)
  const result = work(g, data)
  const neighbours = new Map<number, Set<number>>()
  const main = new Set<number>()
  const jam = new Map<number, number>()
  for (const l of roads.links) {
    for (const [a, b] of [[l.from, l.to], [l.to, l.from]] as const) {
      const set = neighbours.get(a) ?? new Set()
      set.add(b)
      neighbours.set(a, set)
    }
    if (l.kind !== 'tertiary') {
      main.add(l.from)
      main.add(l.to)
    }
    const share = result.speed.evening[l.id] ?? 1000
    const level = share < 300 ? 3 : share < 450 ? 2 : share < 650 ? 1 : 0
    jam.set(l.to, Math.max(jam.get(l.to) ?? 0, level))
  }
  const work_ = new Map((g.built?.junctions ?? []).map((j) => [j.node, j.work]))
  return roads.nodes
    .filter((n) => !n.gateway && (neighbours.get(n.id)?.size ?? 0) >= 3 && main.has(n.id))
    .map((n) => ({
      id: n.id, at: [n.at[0] / 1e6, n.at[1] / 1e6] as LngLat, signal: n.signal, jam: jam.get(n.id) ?? 0,
      work: work_.get(n.id) ?? null,
    }))
}

/** Whether a point is inside a polygon's outer ring and outside its holes. */
function inside(rings: number[][][], [x, y]: LngLat): boolean {
  let hit = false
  rings.forEach((ring, r) => {
    let within = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number]
      const [xj, yj] = ring[j] as [number, number]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within
    }
    if (r === 0) hit = within
    else if (within) hit = false
  })
  return hit
}

function zoneRoads(g: Game, data: CityData, zone: number, rings: number[][][]): Questions['zoneRoads'][1] {
  const roads = roadsNow(g, data)
  const bySpeed = new Map<number, number>()
  let km = 0
  for (const l of roads.links) {
    if (l.kind === 'tertiary') continue
    const a = roads.nodes[l.from]!.at
    const b = roads.nodes[l.to]!.at
    const mid: LngLat = [(a[0] + b[0]) / 2e6, (a[1] + b[1]) / 2e6]
    if (!inside(rings, mid)) continue
    // Each direction of a two-way road is a link: half each, so that km are km of road.
    const twin = roads.links.some((o) => o.from === l.to && o.to === l.from)
    const k = l.length / 1000 / (twin ? 2 : 1)
    km += k
    bySpeed.set(l.speed, (bySpeed.get(l.speed) ?? 0) + k)
  }
  const limit = g.built?.limits?.find((x) => x.zone === zone)?.limit ?? null
  return { km, bySpeed: [...bySpeed].sort((a, b) => a[0] - b[0]), limit }
}

function pairsOf(flat: number[]): LngLat[] {
  return Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2]!, flat[i * 2 + 1]!])
}

/** A link's ends as lng, lat, lng, lat. */
function endsOf(roads: RoutingNetwork, l: RoutingLink): number[] {
  const a = roads.nodes[l.from]!.at
  const b = roads.nodes[l.to]!.at
  return [a[0] / 1e6, a[1] / 1e6, b[0] / 1e6, b[1] / 1e6]
}

/**
 * The worst-served fifth (PRD SCORE-5): as the rules count it for the score, where they say (the zones holding the
 * worst-served fifth of people by access, and by commute); else the screen's own reckoning.
 */
function worstOf(g: Game, data: CityData, result: MonthResult): Set<number> {
  if (worstServed) {
    try {
      const w = worstServed(result, g, data)
      return new Set([...w.access, ...w.commute])
    } catch (error) {
      console.warn('The worst served could not be found:', String(error))
    }
  }
  return worstFifth(servedByZone(data.zones, result.accessByZone, result.commuteByZone, g.zonePeople))
}

/** A main road near Richmond Circle, for the made-up burst main: its link and its middle. */
function fakeLink(data: CityData): { id: number; at: LngLat } | null {
  let best: { id: number; at: LngLat } | null = null
  let bestM = Infinity
  for (const l of data.roads.links) {
    if (!l.drawn.length || (l.kind !== 'primary' && l.kind !== 'trunk')) continue
    const e = endsOf(data.roads, l)
    const at: LngLat = [(e[0]! + e[2]!) / 2, (e[1]! + e[3]!) / 2]
    const m = metres(at, [77.601, 12.9655])
    if (m < bestM) {
      bestM = m
      best = { id: l.id, at }
    }
  }
  return best
}

function whyZone(g: Game, data: CityData, zone: number): ZoneWhy {
  const result = work(g, data)
  const state = rules.state(g, data)
  const people = (id: number) => g.zonePeople?.[id] ?? data.zones[id]?.people ?? 0
  const all = data.zones.reduce((s, z) => s + people(z.id), 0)
  const rate = (deaths: number, n: number) => (n >= 2000 ? (deaths * 100_000) / n : null)
  let roads: ZoneWhy['roads'] = []
  if (delayByRoad) {
    try {
      const delays = delayByRoad(state, result, zone, 'morning', 6)
      const total = delays.reduce((s, d) => s + d.seconds, 0) || 1
      roads = delays.map((d) => ({ link: d.link, drawn: state.roads.links[d.link]?.drawn ?? [], share: d.seconds / total }))
    } catch (error) {
      console.warn('Its roads could not be found:', String(error))
    }
  }
  return {
    zone,
    commute: result.commuteByZone[zone] ?? 0,
    access: (result.accessByZone[zone] ?? 0) / 10,
    deaths: result.deathsByZone ? rate(result.deathsByZone[zone] ?? 0, people(zone)) : null,
    city: { commute: result.commute, access: result.access / 10, deaths: result.deaths !== undefined ? rate(result.deaths, all) : null },
    worst: worstOf(g, data, result).has(zone),
    roads,
  }
}

function whyRoad(g: Game, data: CityData, links: number[]): RoadWhy | null {
  const result = work(g, data)
  const roads = roadsNow(g, data)
  let best: RoadWhy | null = null
  let worst = -1
  for (const id of links) {
    const l = roads.links[id]
    if (!l || l.capacity <= 0) continue
    const vehicles = result.flow.evening[id] ?? 0
    const ratio = vehicles / l.capacity
    if (ratio <= worst) continue
    worst = ratio
    const kmh = linkKmh ? linkKmh(roads, result, 'evening', l) : (l.speed * (result.speed.evening[id] ?? 1000)) / 1000
    best = { vehicles, capacity: l.capacity, kmh, free: l.speed, signals: l.signals ?? 0 }
  }
  return best
}

/** Plays a kept game again from its season and actions, to the month it had reached. */
function replay(kept: Pick<Kept, 'season' | 'done' | 'month'>, data: CityData): Game {
  const g = rules.start(kept.season, data)
  let i = 0
  while (g.month < kept.month && g.status === 'playing') {
    port.postMessage({ type: 'progress', month: g.month, of: kept.month })
    while (i < kept.done.length && kept.done[i]!.month === g.month) {
      const outcome = rules.act(g, data, kept.done[i++]!.action)
      if (!outcome.ok) throw new Error(`An action could not be played again: ${outcome.reason}`)
    }
    const result = work(g, data)
    rules.endMonth(g, data, result)
    keepScore(g, data, result)
  }
  while (i < kept.done.length && kept.done[i]!.month === g.month) rules.act(g, data, kept.done[i++]!.action)
  if (i < kept.done.length) throw new Error('Some actions were not played again.')
  return g
}

/** Whether the browser's copy of a game can stand for the server's list: the same actions, or more still to send. */
function agrees(kept: Kept, list: NonNullable<Begin['list']>, pending: number[]): boolean {
  const before = (done: Done[]) => JSON.stringify(done.filter((d) => d.month < list.month))
  if (before(kept.done) !== before(list.done)) return false
  // The server hears of a month's actions only when it ends: at the same month, what is done in it is the browser's.
  if (kept.month === list.month) return true
  // Further on here: every month since the server's must be waiting to be sent.
  if (kept.month < list.month) return false
  for (let m = list.month; m < kept.month; m++) if (!pending.includes(m)) return false
  return true
}

async function begin(ask: Begin, data: CityData): Promise<Questions['begin'][1]> {
  const chosen = ask.season ?? season
  key = ask.view ? null : (ask.key ?? OLD_KEY)
  viewing = !!ask.view
  const kept = ask.fresh || ask.replay || !key ? null : await readKept(key)
  let older: string | null = null
  let replayed = false
  game = null
  times = []
  span = null
  mends = []
  lastState = null
  sentTransit = ''
  starts = new Map()
  const list = ask.list ?? null
  if (kept && (kept.version !== version || kept.season.id !== chosen.id) && !list) {
    older =
      'Your last game was kept by an older version of Peak Ooru, whose rules have since changed. It cannot be ' +
      'carried on, so a new game has begun.'
  } else if (kept && kept.version === version && kept.season.id === chosen.id && (!list || agrees(kept, list, ask.pending ?? []))) {
    times = kept.times ?? []
    if (matches(kept)) game = kept.game
    else {
      try {
        game = replay(kept, data)
        replayed = true
      } catch (error) {
        console.warn(String(error))
        older = 'Your last game could not be put back together, so a new game has begun.'
        times = []
      }
    }
  }
  // Another player's city as the server keeps it: nothing to play again.
  if (!game && viewing && ask.state) {
    try {
      game = fromWire(ask.state)
    } catch (error) {
      console.warn('Their city could not be read; it is played again instead:', String(error))
    }
  }
  // The server's list, where the browser's copy does not agree with it: the server's is the truth.
  if (!game && list && (list.month > 0 || list.done.length)) {
    game = replay({ season: chosen, done: list.done, month: list.month }, data)
    replayed = true
    older = null
  }
  if (!game) {
    game = rules.start(chosen, data)
    if (!rules.score) game.score = standInScore(game, data.zones, work(game, data))
    keep()
  } else if (replayed) keep()
  fakeEvents = game.events || rules.score ? null : standInEvents(fakeLink(data))
  markStart()
  return { ...seen(), older, replayed, standIn: standInRulesUsed, digest: gameDigest(game) }
}

function answer(data: CityData, ask: Exclude<Ask, { type: 'load' }>): [unknown, Transferable[]] | Promise<[unknown, Transferable[]]> {
  if (ask.type === 'begin') {
    const { type: _type, id: _id, ...question } = ask
    return begin(question, data).then((value) => [value, []])
  }
  if (!game) throw new Error('The game has not begun.')
  if (viewing && (ask.type === 'act' || ask.type === 'end' || ask.type === 'undo')) {
    throw new Error('This is another player’s city: it can be looked round, not changed.')
  }
  switch (ask.type) {
    case 'show': {
      const result = work(game, data)
      const view = viewOf(game, data, result)
      return [{ result: light(result), view }, transferables(null, view)]
    }
    case 'act': {
      const a = ask.action
      const g = game
      const before = a.kind === 'build' && a.plan.kind === 'repair'
        ? Object.fromEntries(a.plan.links.map((id) => [id, g.condition?.[id] ?? 100])) : null
      const outcome = rules.act(game, data, a)
      if (outcome.ok && before && a.kind === 'build' && a.plan.kind === 'repair') {
        mends.push({ links: [...a.plan.links], work: a.plan.work, month: game.month, before })
      }
      if (outcome.ok) keep()
      return [{ ...seen(), outcome }, []]
    }
    case 'may':
      return [ask.actions.map((a) => rules.may(game!, data, a)), []]
    case 'forecast': {
      const before = outlook(structuredClone(game), data)
      const changed = structuredClone(game)
      const outcome = rules.act(changed, data, ask.action)
      // Copied before `outlook` ends the month on it, so that both sides of the score start from the same month.
      const fresh = outcome.ok ? structuredClone(changed) : null
      const value: Forecast = { outcome, before, after: outcome.ok ? outlook(changed, data) : null }
      if (fresh) value.score = ahead(structuredClone(game), fresh, data, work(game, data), work(fresh, data))
      return [value, []]
    }
    case 'end': {
      if (game.status !== 'playing') throw new Error('The game is over.')
      const month = game.month
      const actions = game.done.filter((d) => d.month === month).map((d) => d.action)
      const result = work(game, data)
      span ??= { start: extras.start?.(game) ?? null, reports: [] }
      // The roads the month was worked out on, before the month's end opens anything new.
      const state = rules.state(game, data)
      lastState = state
      const roads = state.roads
      const shut = shutOf(game, data, state)
      const scoreBefore = game.score ?? scoreOf(game, data)
      const report = rules.endMonth(game, data, result)
      keepScore(game, data, result)
      const scoreNow = game.score ?? scoreOf(game, data, result)
      if (!report.score && scoreBefore && scoreNow) report.score = { now: scoreNow, before: scoreBefore }
      // The first month's score before is what was shown for it: the rules have none, having scored nothing yet.
      if (report.score && report.from === 0 && first?.score && !report.score.before.total) report.score.before = first.score
      if (!report.events && fakeEvents) {
        // The made-up events that begin in the month now starting, or ended with the month just ended.
        const events = fakeEvents.filter((e) => e.started === game!.month || e.ends === report.to)
        if (events.length) {
          report.events = events
          report.news.unshift(...events.map((e) => (e.ends === report.to ? `Over: ${e.title.toLowerCase()}.` : `${e.title}.`)))
        }
      }
      span.reports.push(report)
      times.push(Date.now())
      keep()
      markStart()
      const view = viewOf(game, data, result, roads, shut)
      const sent: MonthSent = { month, actions, digest: gameDigest(game) }
      return [{ ...seen(), report, result: light(result), view, sent }, transferables(null, view)]
    }
    case 'undo': {
      const back = starts.get(ask.month)
      if (!back) return [null, []]
      game = structuredClone(back)
      for (const m of [...starts.keys()]) if (m > ask.month) starts.delete(m)
      span = null
      mends = []
      lastState = null
      sentTransit = ''
      keep()
      return [seen(), []]
    }
    case 'report': {
      if (!span) return [null, []]
      const { start, reports } = span
      span = null
      const combined = extras.combine ? extras.combine(reports) : spanReport(reports)
      const g = game
      const report: ReportOut | null = combined && extras.explain
        ? extras.explain(g, data, (state) => simulateOnce(state, data), start, combined)
        : combined
      if (report) {
        // A span's score runs from the first month's before to the last month's now; its events are all of theirs.
        const scored = reports.filter((r) => r.score)
        if (!report.score && scored.length) report.score = { before: scored[0]!.score!.before, now: scored.at(-1)!.score!.now }
        if (!report.events) {
          const events = [...new Map(reports.flatMap((r) => r.events ?? []).map((e) => [e.id, e])).values()]
          if (events.length) report.events = events
        }
        if (!report.review) report.review = reports.find((r) => r.review)?.review
      }
      if (report && g.condition && g.last) {
        const roads = roadsNow(g, data)
        const last = g.last
        report.delays = linkDelays(roads, last, g.condition, linkKmh ? (p, l) => linkKmh!(roads, last, p, l) : undefined)
          .filter((d) => d.condition < 50)
        report.mended = mendedIn(g, data, last)
        mends = []
      }
      return [report, []]
    }
    case 'quote':
      return [rules.quote(game, data, ask.plan), []]
    case 'suggest': {
      // Suggestions for roads are the rules' to give once they have them; the kind is passed as it is.
      let plans: Plan[] = []
      try {
        plans = rules.suggest(game, data, ask.kind as 'metro').filter((p) => ask.kind !== 'road' || p.kind === 'road')
      } catch (error) {
        console.warn(String(error))
      }
      return [plans.map((plan) => ({ plan, quote: rules.quote(game!, data, plan) })), []]
    }
    case 'foresee':
      return [foresee(game, data, ask.plan), []]
    case 'links': {
      const roads = roadsNow(game, data)
      const pairs = new Set(roads.links.map((l) => `${l.from}-${l.to}`))
      const chosen = ask.ids ? ask.ids.map((id) => roads.links[id]).filter((l) => !!l)
        : ask.all ? roads.links
          : ask.twoWay ? roads.links.filter((l) => pairs.has(`${l.to}-${l.from}`))
            : roads.links.filter((l) => l.lanes >= 2)
      return [chosen.map((l): DrawnLinkOut => ({
        id: l.id, drawn: l.drawn, lanes: l.lanes, ends: endsOf(roads, l), kind: l.kind, length: l.length,
      })), []]
    }
    case 'road':
      return [roadOf(game, data, ask.stretches), []]
    case 'surface': {
      const out = surfaceOf(game, data)
      return [out, [out.stretch.buffer as ArrayBuffer, out.byLink.buffer as ArrayBuffer]]
    }
    case 'snap': {
      if (!rules.snap) return [{ reason: 'Nothing to snap to yet.' }, []]
      return [rules.snap(game, data, ask.kind, ask.stop), []]
    }
    case 'nodes':
      return [junctions(game, data), []]
    case 'zoneRoads':
      return [zoneRoads(game, data, ask.zone, ask.rings), []]
    case 'oneWays': {
      const roads = roadsNow(game, data)
      const pairs = new Set(roads.links.map((l) => `${l.from}-${l.to}`))
      const out = roads.links
        .filter((l) => !pairs.has(`${l.to}-${l.from}`))
        .map((l) => ({ id: l.id, drawn: l.drawn, forward: l.forward, ...(l.drawn.length ? {} : { line: endsOf(roads, l) }) }))
      return [out, []]
    }
    case 'whyZone':
      return [whyZone(game, data, ask.zone), []]
    case 'whyRoad':
      return [whyRoad(game, data, ask.links), []]
    case 'deeds':
      return [deeds(game, roadsNow(game, data)), []]
    case 'worst':
      return [[...worstOf(game, data, work(game, data))], []]
    case 'first':
      return [firstSteps(game, data), []]
    case 'advise':
      return [advise(game, data, ask.levers), []]
    case 'books': {
      // The next twelve months as things stand: the rules' own look ahead where there is one, or the rules played
      // forward on a copy with this month's traffic.
      let months: { month: number; money: number }[]
      if (extras.forward) months = extras.forward(game, data, 12)
      else {
        const g = structuredClone(game)
        const result = work(game, data)
        months = []
        for (let i = 0; i < 12 && g.status === 'playing'; i++) {
          rules.endMonth(g, data, { ...result, month: g.month })
          months.push({ month: g.month, money: g.money })
        }
      }
      return [{ now: rules.books(game, data), ahead: months }, []]
    }
    default:
      throw new Error(`Nothing is known of ${(ask as { type: string }).type}.`)
  }
}

port.onmessage = async ({ data: ask }: MessageEvent<Ask>) => {
  const id = ask.type === 'load' ? null : ask.id
  try {
    if (ask.type === 'load') {
      port.postMessage(await load(ask.base, ask.standIn))
      return
    }
    if (!city) throw new Error('A question was asked before the city had loaded.')
    const [value, transfer] = await answer(city, ask)
    port.postMessage({ type: 'reply', id: ask.id, value }, transfer)
  } catch (error) {
    port.postMessage({ type: 'error', id, message: String(error) })
  }
}

/** The middle of the city, where the introduction looks for a road to mend: Majestic. */
const MIDDLE: LngLat = [77.5713, 12.9772]

/** The worst road near the middle of the city, and a bus route to lay, for the introduction (UI-11). */
function firstSteps(g: Game, data: CityData): FirstSteps {
  const roads = roadsNow(g, data)
  const middleOf = (links: number[]): LngLat | null => {
    let best: LngLat | null = null
    let bestM = Infinity
    for (const id of links) {
      const l = roads.links[id]
      if (!l) continue
      const e = endsOf(roads, l)
      const at: LngLat = [(e[0]! + e[2]!) / 2, (e[1]! + e[3]!) / 2]
      const m = metres(at, MIDDLE)
      if (m < bestM) {
        bestM = m
        best = at
      }
    }
    return best
  }
  let road: FirstSteps['road'] = null
  try {
    const worst = worstRoads(g, data, work(g, data), g.condition)
    // Of the roads that cost most time, the nearest the middle that can be patched now; within 8 km if one is.
    const ranked = worst
      .map((w) => ({ w, at: middleOf(w.links) }))
      .filter((x): x is { w: typeof x.w; at: LngLat } => !!x.at)
      .map((x) => ({ ...x, far: metres(x.at, MIDDLE) }))
      .sort((a, b) => (a.far <= 8000 ? 0 : 1) - (b.far <= 8000 ? 0 : 1) || b.w.hours - a.w.hours)
    for (const { w, at } of ranked) {
      const q = rules.quote(g, data, { kind: 'repair', links: w.links, work: 'patch' })
      if (!q.ok || q.cost > g.money) continue
      road = { name: w.name, links: w.links, hours: w.hours, condition: w.condition, at }
      break
    }
  } catch (error) {
    console.warn('No road to mend could be found:', String(error))
  }
  let bus: FirstSteps['bus'] = null
  try {
    // Each end is rung where a tap lands as the player sees it named: on a station there already, if one is close,
    // since a tap near a station on the map takes the station; otherwise where the rules would snap the tap.
    // The stations as the map draws them: one for each interchange, the metro's (src/map/transit.ts, stationPoints).
    const shown = new Map<string, (typeof data.transit.stations)[number]>()
    for (const st of data.transit.stations) {
      const key = st.interchange === undefined ? `s${st.id}` : `i${st.interchange}`
      const had = shown.get(key)
      if (!had || (had.kind !== 'metro' && st.kind === 'metro')) shown.set(key, st)
    }
    // The name as the map shows it: the part after the last comma of a long name (src/map/transit.ts, shortName).
    const mapName = (name: string) => {
      if (name === 'Rashtreeya Vidyalaya Road') return 'RV Road'
      const comma = name.lastIndexOf(', ')
      return comma > 0 ? name.slice(comma + 2) : name
    }
    const end = (at: LngLat): { stop: Stop; at: LngLat; name: string } | null => {
      let near: (typeof data.transit.stations)[number] | null = null
      let best = 900
      for (const st of shown.values()) {
        const m = metres(st.at, at)
        if (m < best) {
          best = m
          near = st
        }
      }
      if (near) return { stop: { station: near.id }, at: near.at, name: mapName(near.name) }
      const snapped = rules.snap?.(g, data, 'busRoute', { at })
      if (!snapped || 'reason' in snapped) return null
      return { stop: { at: snapped.at }, at: snapped.at, name: snapped.name }
    }
    for (const plan of rules.suggest(g, data, 'busRoute')) {
      if (plan.kind !== 'busRoute') continue
      const q = rules.quote(g, data, plan)
      if (!q.ok || q.cost > g.money || q.stations.length < 2) continue
      const a = end(q.stations[0]!.at), b = end(q.stations.at(-1)!.at)
      if (!a || !b || metres(a.at, b.at) < 2000) continue
      // Two taps, at the ends, make a route of their own: it must be one the rules take.
      const two = rules.quote(g, data, { kind: 'busRoute', stops: [a.stop, b.stop], buses: plan.buses })
      if (!two.ok || two.cost > g.money) continue
      // A station is named as the map names it; a new stop as the rules name it once placed.
      const named = (e: typeof a, s?: { name: string }) => ('station' in e.stop ? e.name : s?.name ?? e.name)
      bus = { from: { at: a.at, name: named(a, two.stations[0]) }, to: { at: b.at, name: named(b, two.stations.at(-1)) }, cost: two.cost }
      break
    }
  } catch (error) {
    console.warn('No bus route could be suggested:', String(error))
  }
  return { road, bus }
}

/**
 * "What could I do now?": the rules' own advice where they give it; otherwise a few plain candidates (the worst road,
 * the busiest corridor without a bus, footpaths where most people die on the roads, a metro line), each affordable and
 * allowed now, with its score a year on left for the page to ask for (`checked` false, `score` NaN).
 */
function advise(g: Game, data: CityData, levers?: string[]): Advice[] {
  if (rules.advise) {
    try {
      return rules.advise(g, data, { levers, count: 3, simulate: (state) => simulateOnce(state, data), result: work(g, data) })
    } catch (error) {
      console.warn('The rules could not advise:', String(error))
    }
  }
  const allowed = (lever: string) => !levers || levers.includes(lever)
  const out: Advice[] = []
  const offer = (lever: string, plan: Plan, title: string, text: string, where: Partial<Advice> = {}) => {
    if (!allowed(lever) || out.length >= 3) return
    const q = rules.quote(g, data, plan)
    if (!q.ok || q.cost > g.money) return
    if (!rules.may(g, data, { kind: 'build', plan }).ok) return
    out.push({ title, text, lever, actions: [{ kind: 'build', plan }], cost: q.cost, running: q.running, score: NaN, checked: false, ...where })
  }
  const done = new Set(g.done.filter((d) => d.month === g.month && d.action.kind === 'build' && d.action.plan.kind === 'repair')
    .flatMap((d) => (d.action.kind === 'build' && d.action.plan.kind === 'repair' ? d.action.plan.links : [])))
  try {
    const worst = worstRoads(g, data, work(g, data), g.condition).find((w) => !w.links.some((l) => done.has(l)))
    if (worst) {
      offer('repair', { kind: 'repair', links: worst.links, work: 'patch' }, `Patch the potholes on ${worst.name}`,
        `Its potholes cost drivers about ${Math.round(worst.hours).toLocaleString('en-IN')} hours a weekday.`, { links: worst.links })
    }
  } catch (error) {
    console.warn(String(error))
  }
  const line = (kind: 'busRoute' | 'metro') => {
    try {
      const plan = rules.suggest(g, data, kind)[0]
      if (!plan || (plan.kind !== 'busRoute' && plan.kind !== 'metro')) return
      const q = rules.quote(g, data, plan)
      const ends = q.stations.length >= 2 ? `${q.stations[0]!.name} to ${q.stations.at(-1)!.name}` : ''
      offer(kind, plan, kind === 'metro' ? `A metro line from ${ends}` : `A bus route from ${ends}`,
        kind === 'metro' ? 'Along the busiest corridor with no metro. It takes years to build.'
          : 'Along a busy corridor with no bus of yours. It runs within two months.',
        { at: q.stations[0]?.at })
    } catch (error) {
      console.warn(String(error))
    }
  }
  line('busRoute')
  // Footpaths where the most people die on the roads, in a zone without them.
  const deaths = work(g, data).deathsByZone
  if (deaths) {
    const have = new Set(g.built?.footpaths ?? [])
    const zone = data.zones.filter((z) => !have.has(z.id)).sort((a, b) => (deaths[b.id] ?? 0) - (deaths[a.id] ?? 0))[0]
    if (zone) offer('footpaths', { kind: 'footpaths', zone: zone.id }, `Footpaths in ${zone.name}`,
      'More people die on its roads than anywhere else, most of them on foot.', { zone: zone.id, at: zone.centre })
  }
  line('metro')
  return out
}
