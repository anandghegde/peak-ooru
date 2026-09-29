import { LOWLAND, UNDERPASSES } from '../sim/lowland'
import { HOURS } from '../sim/params'
import { surfaceSpeed } from '../sim/surface'
import type { MonthResult, RoutingNetwork } from '../sim/types'
import { PERIODS } from '../sim/types'
import { nearestArea } from './areas'
import { east, metres, micro, north } from './geo'
import { builtOf } from './lines'
import { costIndex, div } from './money'
import { ROAD_NAMES } from './names'
import { BUS_WEAR, DIG, FLOOD, GRADES, ORDER, RAIN, REPAIR, RUN_DAYS, RUNNING, START, STREETS, UPKEEP, WEAR } from './params'
import { isShut, linkZones, networkOf, onRoadsOf } from './roads'
import type { CityData, Game, Lakh, Plan, Project, Quote, Season, Setup, Upkeep, Wear, WorstRoad } from './types'
import { crore, grouped, monthName } from './words'

/*
 * The state of the roads (slice 6; PRD section 5.4 and 7.3). Every main road (routing link) has a condition, and every
 * zone's minor streets one, kept in thousandths of a point (100,000 is new) so that a month's wear is never lost in
 * rounding; the game shows whole points. Each month the roads wear by what they carried, faster in the monsoon, where
 * drains are poor, and after a utility digs; the upkeep budget slows the wear and mends the worst; the player
 * patches, resurfaces or lays concrete. Everything is whole numbers from the season's seed and the list of actions.
 */

type RepairPlan = Extract<Plan, { kind: 'repair' }>
type StreetsPlan = Extract<Plan, { kind: 'streets' }>

const whole = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 1e9
const NEW = 100_000
const FAIR = GRADES.fair * 1000
const km = (m: number) => `${Math.round(m / 100) / 10} km`
const priced = (game: Game, lakh: number): Lakh => Math.round((lakh * costIndex(game.month)) / 10_000)

/** A whole number from 0 to 2³² − 1 that follows from its inputs alone: the season's chance, the same on every machine. */
export function mix(a: number, b: number, c: number, d = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ (b | 0)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) ^ (c | 0)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) ^ (d | 0)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** Whole points of condition, 0 to 100, from thousandths. */
export const points = (fine: number) => Math.max(0, Math.min(100, Math.floor(fine / 1000)))

/** A grade, from whole points. */
export function grade(c: number): 'good' | 'fair' | 'poor' | 'broken' {
  if (c >= GRADES.good) return 'good'
  if (c >= GRADES.fair) return 'fair'
  if (c >= GRADES.poor) return 'poor'
  return 'broken'
}

/**
 * Thousandths of free speed lost to a surface of `fine` thousandths of a point, by the model's own rule (PRD ROAD-3;
 * `surfaceSpeed` in src/sim/surface.ts), for the quotes' and the report's arithmetic.
 */
export function speedLoss(fine: number): number {
  return Math.round((1 - surfaceSpeed(Math.max(0, Math.min(NEW, fine)) / 1000)) * 1000)
}

// ------------------------------------------------------------------------------------------------ the city's roads

/** The names file is for the real city: used only when the network is the one it was made from. */
function namesFit(roads: RoutingNetwork): boolean {
  if (roads.links.length < ROAD_NAMES.links) return false
  let sum = 0
  for (let i = 0; i < ROAD_NAMES.links; i++) sum += roads.links[i]!.length
  return sum === ROAD_NAMES.length
}
const fits = new WeakMap<RoutingNetwork, boolean>()
function fit(city: CityData): boolean {
  let f = fits.get(city.roads)
  if (f === undefined) fits.set(city.roads, (f = namesFit(city.roads)))
  return f
}

/** The mapped name of a city link, or null. */
export function nameOf(city: CityData, link: number): string | null {
  if (!fit(city) || link >= ROAD_NAMES.links) return null
  const k = ROAD_NAMES.of[link]!
  return k < 0 ? null : ROAD_NAMES.names[k]!
}

interface Named {
  /** For each city link, the road it belongs to. */
  road: Int32Array
  names: string[]
  links: number[][]
}
const namedCache = new WeakMap<RoutingNetwork, Named>()

/**
 * The city's roads by name: links of the same name that meet are one road; a name used for roads that never meet
 * ("80 Feet Road") is told apart by the zone of its longest stretch. Unnamed links are grouped by zone ("Roads in
 * Bellandur").
 */
export function namedRoads(city: CityData): Named {
  const known = namedCache.get(city.roads)
  if (known) return known
  const links = city.roads.links
  const n = links.length
  const zoneOf = linkZones(city, city.roads)
  const parent = Int32Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
    return i
  }
  const join = (a: number, b: number) => {
    const x = find(a)
    const y = find(b)
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y)
  }
  const atNode = new Map<string, number>()
  for (const l of links) {
    const name = nameOf(city, l.id)
    const key = name === null ? `~${zoneOf[l.id]}` : name
    for (const node of [l.from, l.to]) {
      const k = name === null ? key : `${key}|${node}`
      const other = atNode.get(k)
      if (other === undefined) atNode.set(k, l.id)
      else join(l.id, other)
    }
  }
  const roots = new Map<number, number>()
  const road = new Int32Array(n)
  const groups: number[][] = []
  for (let i = 0; i < n; i++) {
    const r = find(i)
    let k = roots.get(r)
    if (k === undefined) {
      k = groups.length
      roots.set(r, k)
      groups.push([])
    }
    road[i] = k
    groups[k]!.push(i)
  }
  const zoneName = (id: number) => city.zones.find((z) => z.id === id)?.name ?? 'the city'
  const base = groups.map((g) => nameOf(city, g[0]!))
  const count = new Map<string, number>()
  for (const b of base) if (b !== null) count.set(b, (count.get(b) ?? 0) + 1)
  const used = new Set<string>()
  // Slice 7: a road is named by places people know: a name used for roads that never meet ("Outer Ring Road", in
  // pieces where flyovers break it) by the places it runs between, or the one it is near; unnamed roads by the place
  // they are near. The ward's name only where that is not enough to tell two apart.
  const names = groups.map((g, k) => {
    const b = base[k] ?? null
    let longest = g[0]!
    for (const id of g) if (links[id]!.length > links[longest]!.length) longest = id
    let name = b === null ? `Roads near ${placesOf(city.roads, g).near}` : count.get(b)! > 1 ? stretchName(city.roads, g, b) : b
    if (used.has(name)) name = `${name} (${zoneName(zoneOf[longest]!)})`
    for (let j = 2; used.has(name); j++) name = `${b ?? 'Roads'}, ${zoneName(zoneOf[longest]!)} ${j}`
    used.add(name)
    return name
  })
  const out = { road, names, links: groups }
  namedCache.set(city.roads, out)
  return out
}

/**
 * The known places at the two ends of a set of links (the two of their junctions farthest apart), and the one nearest
 * their middle (slice 7).
 */
export function placesOf(roads: RoutingNetwork, links: number[]): { from: string; to: string; near: string } {
  const nodes = [...new Set(links.flatMap((id) => [roads.links[id]!.from, roads.links[id]!.to]))].sort((a, b) => a - b)
  const xy = nodes.map((n) => [east(roads.nodes[n]!.at[0]), north(roads.nodes[n]!.at[1])] as const)
  // The two farthest apart: from the first, the farthest; from that, the farthest again (close enough for a name).
  const farthest = (from: number) => {
    let best = from
    let far = -1
    xy.forEach(([x, y], k) => {
      const d = metres(x, y, xy[from]![0], xy[from]![1])
      if (d > far) {
        far = d
        best = k
      }
    })
    return best
  }
  const a = farthest(0)
  const b = farthest(a)
  let mx = 0
  let my = 0
  for (const [x, y] of xy) {
    mx += x
    my += y
  }
  const [ax, ay] = xy[a]!
  const [bx, by] = xy[b]!
  const one = nearestArea(ax, ay).name
  const two = nearestArea(bx, by).name
  // West to east, or south to north, so that a road reads the same way every time.
  const flip = ax > bx || (ax === bx && ay > by)
  return { from: flip ? two : one, to: flip ? one : two, near: nearestArea(Math.round(mx / xy.length), Math.round(my / xy.length)).name }
}

/** A stretch of a named road by the places it runs between: "Outer Ring Road, Hebbal to KR Puram", or "near Hebbal". */
export function stretchName(roads: RoutingNetwork, links: number[], road: string): string {
  const p = placesOf(roads, links)
  return p.from === p.to ? `${road} near ${p.from}` : `${road}, ${p.from} to ${p.to}`
}

/**
 * The whole of the named road a link is on, for the screen's "all of Hosur Road that is poor": its name and its
 * links, both ways. A road the player built is its own. Links of a city road only; unnamed links give those of their
 * zone.
 */
export function namedRoad(game: Game, city: CityData, link: number): { name: string; links: number[] } | null {
  if (!whole(link) || link < 0) return null
  if (link < city.roads.links.length) {
    const n = namedRoads(city)
    const k = n.road[link]!
    return { name: n.names[k]!, links: n.links[k]! }
  }
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  if (link >= roads.links.length) return null
  const built = builtOf(game).roads ?? []
  // The player's links follow the city's, road by road, a link each way for each stretch between its junctions.
  let next = city.roads.links.length
  for (const r of built) {
    const count = 2 * Math.max(0, (r.nodes?.length ?? 1) - 1)
    if (link < next + count) return { name: r.name, links: Array.from({ length: count }, (_, i) => next + i) }
    next += count
  }
  return null
}

/**
 * Low-lying links, which flood (the model's list, src/sim/lowland.ts: underpasses, and links by drains, streams and
 * lakes where the road dips), and of those the underpasses, which flood first and longest. On a city the list is not
 * for (the tests' small city), one link in fifty, fixed, as a stand-in, and none an underpass.
 */
const lowCache = new WeakMap<RoutingNetwork, { low: Set<number>; under: Set<number> }>()
function lowOf(city: CityData): { low: Set<number>; under: Set<number> } {
  let s = lowCache.get(city.roads)
  if (s) return s
  s = fit(city)
    ? { low: new Set(LOWLAND), under: new Set(UNDERPASSES) }
    : { low: new Set(city.roads.links.filter((l) => mix(0, 7, l.id) % 1000 < 20).map((l) => l.id)), under: new Set<number>() }
  lowCache.set(city.roads, s)
  return s
}
const lowSet = (city: CityData) => lowOf(city).low

/** The link running the other way along the same road, if there is one, for deciding both ways alike. */
const pairs = new WeakMap<RoutingNetwork, Int32Array>()
function pairOf(roads: RoutingNetwork): Int32Array {
  let p = pairs.get(roads)
  if (p) return p
  const n = roads.nodes.length
  const by = new Map<number, number>()
  for (const l of roads.links) if (!by.has(l.from * n + l.to)) by.set(l.from * n + l.to, l.id)
  p = Int32Array.from(roads.links, (l) => Math.min(l.id, by.get(l.to * n + l.from) ?? l.id))
  pairs.set(roads, p)
  return p
}

// ------------------------------------------------------------------------------------------------ the start

/** Metres from the centre of the city. */
const fromCentre = (lng: number, lat: number) =>
  metres(east(lng), north(lat), east(START.centre[0]), north(START.centre[1]))

/** Thousandths taken off for lying out of the centre: nothing within `outerFrom`, all of `outer` beyond `outerTo`. */
const outerPart = (d: number) =>
  d <= START.outerFrom ? 0 : div((Math.min(d, START.outerTo) - START.outerFrom) * START.outer * 1000, START.outerTo - START.outerFrom)

/** A spread of ±`most` points, in thousandths, from the seed. */
const spread = (h: number, most: number) => (h % (2 * most * 1000 + 1)) - most * 1000

const corridors = new Set(START.corridors)

/** Metres of minor street in a zone. */
export function streetMetres(city: CityData, zone: number): number {
  const z = city.zones[zone]
  if (!z || z.people <= 0) return 0
  return Math.max(STREETS.least, div(z.people * STREETS.perThousand, 1000))
}

/**
 * The roads as a season starts (PRD ROAD-8): the same for every player of it. By class, worse out of the centre and on
 * the tech corridors, with a spread by road and by stretch from the seed; streets worse out of the centre and in
 * poorer zones.
 */
export function startWear(season: Season, city: CityData): Wear {
  const links = city.roads.links
  const named = namedRoads(city)
  const pair = pairOf(city.roads)
  const base = links.map((l) => {
    const a = city.roads.nodes[l.from]!.at
    const b = city.roads.nodes[l.to]!.at
    const d = fromCentre(div(a[0] + b[0], 2), div(a[1] + b[1], 2))
    let c = (START.kind[l.kind] ?? 50) * 1000 - outerPart(d)
    const name = nameOf(city, l.id)
    if (name !== null && corridors.has(name)) c -= START.corridor * 1000
    c += spread(mix(season.seed, 1, named.road[l.id]!), START.road)
    c += spread(mix(season.seed, 2, pair[l.id]!), START.stretch)
    return Math.max(START.least * 1000, Math.min(START.most * 1000, c))
  })
  const streets = city.zones.map((z) => {
    const d = fromCentre(micro(z.centre[0]), micro(z.centre[1]))
    const c = START.streets * 1000 - outerPart(d) + (z.income - 3) * START.income * 1000 + spread(mix(season.seed, 6, z.id), START.zone)
    return Math.max(START.least * 1000, Math.min(START.most * 1000, c))
  })
  return {
    base,
    patch: links.map(() => 0),
    left: links.map(() => 0),
    dug: links.map(() => -99),
    mended: links.map(() => -1),
    streets,
    streetsPatch: city.zones.map(() => 0),
    streetsLeft: city.zones.map(() => 0),
    streetsMended: city.zones.map(() => -1),
    acted: 0,
  }
}

/** Sets up the roads of a game that has none (a game from before slice 6 is taken as starting now). */
export function wearOf(game: Game, city: CityData): Wear {
  if (!game.wear) {
    game.wear = startWear(game.season, city)
    game.upkeep ??= 'steady'
    game.digOnce ??= false
    game.concrete ??= []
    show(game, city)
  }
  return game.wear
}

/** The roads of a game, without changing it: those of the season's start if it has none. */
export const wearRead = (game: Game, city: CityData): Wear => game.wear ?? startWear(game.season, city)

/** Condition of a link now, thousandths: the surface and any patch on it; a link the player built and opened is new. */
const fineOf = (w: Wear, id: number) => (id < w.base.length ? Math.min(NEW, w.base[id]! + w.patch[id]!) : NEW)
const streetsOf = (w: Wear, zone: number) => Math.min(NEW, (w.streets[zone] ?? NEW) + (w.streetsPatch[zone] ?? 0))

/** `Game.condition` and `Game.streets`, whole points, from the finer figures; the arrays grown to the network. */
export function show(game: Game, city: CityData): void {
  const w = game.wear!
  const n = networkOf(city, onRoadsOf(builtOf(game))).links.length
  grow(w, n)
  game.condition = w.base.map((_, id) => points(fineOf(w, id)))
  game.streets = w.streets.map((_, z) => points(streetsOf(w, z)))
}

/** New links (roads the player opened) join as new. Changes the arrays given. */
function grow(w: Wear, n: number): void {
  while (w.base.length < n) {
    w.base.push(NEW)
    w.patch.push(0)
    w.left.push(0)
    w.dug.push(-99)
    w.mended.push(-1)
  }
}

/** A copy of the wear, for changing without touching a copy of the game that shares it (forecasts). */
const copyWear = (w: Wear): Wear => ({
  base: [...w.base],
  patch: [...w.patch],
  left: [...w.left],
  dug: [...w.dug],
  mended: [...w.mended],
  streets: [...w.streets],
  streetsPatch: [...w.streetsPatch],
  streetsLeft: [...w.streetsLeft],
  streetsMended: [...w.streetsMended],
  acted: w.acted,
})

// ------------------------------------------------------------------------------------------------ rain, digs, floods

/** The year from 1996–2025 whose monsoon a year of the game has, by the season's seed. */
export function monsoonYear(season: Season, month: number): number {
  return RAIN[mix(season.seed, 5, Math.floor(month / 12)) % RAIN.length]![0]
}

/** Rain in a month, mm: June to September only (PRD EVT-1). */
export function rainIn(season: Season, month: number): number {
  const k = month % 12
  if (k < 5 || k > 8) return 0
  return RAIN[mix(season.seed, 5, Math.floor(month / 12)) % RAIN.length]![k - 4]!
}

/** Days a low-lying road that floods is shut in a month: an underpass longer (`FLOOD.under`). */
export function floodDays(season: Season, month: number, under = false): number {
  const mm = rainIn(season, month)
  const f = under ? FLOOD.under : FLOOD.low
  return Math.max(1, Math.min(f.most, Math.floor((mm - f.from) / f.per)))
}

/** Links shut by flooding this month, with the share of the month in thousandths (`CityState.shut`). */
export function shutIn(game: Game, city: CityData, month = game.month): Record<number, number> {
  const out: Record<number, number> = {}
  for (const f of floodsIn(game.season, city, month)) out[f.link] = div(f.days * 1000, 30)
  return out
}

/**
 * The links that flood in a month, with their days shut, in order of id: of the low-lying links, by the season's seed,
 * each with a chance that rises with the month's rain, an underpass far likelier; both ways of a road alike.
 */
export function floodsIn(season: Season, city: CityData, month: number): { link: number; days: number }[] {
  const mm = rainIn(season, month)
  if (mm <= 0) return []
  const { low: all, under: passes } = lowOf(city)
  const pair = pairOf(city.roads)
  const out: { link: number; days: number }[] = []
  for (const id of [...all].sort((a, b) => a - b)) {
    const under = passes.has(id)
    const f = under ? FLOOD.under : FLOOD.low
    const chance = (mm - f.above) * f.chance
    if (chance <= 0 || mix(season.seed, 10, month, pair[id]!) % 10_000 >= chance) continue
    out.push({ link: id, days: floodDays(season, month, under) })
  }
  return out
}

/** Whether utilities may dig only in the set months this month. */
const digsSet = (game: Game) => !!game.digOnce

/**
 * The main roads and zones' streets utilities dig up in a month, from the season's seed; both ways of a road alike. With
 * dig once, only in the set months, a half-year's digging at once each, put back as it was.
 */
export function dugIn(game: Game, city: CityData, month = game.month): { links: number[]; zones: number[]; restored: boolean } {
  const restored = digsSet(game)
  if (restored && !DIG.months.includes(month % 12)) return { links: [], zones: [], restored }
  const times = restored ? 12 / DIG.months.length : 1
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const pair = pairOf(roads)
  const concrete = new Set(game.concrete ?? [])
  const links: number[] = []
  for (const l of roads.links) {
    if (isShut(l)) continue
    const p = pair[l.id]!
    let chance = DIG.chance * times
    if (l.kind === 'motorway' || concrete.has(p)) chance = div(chance * DIG.slow, 1000)
    if (mix(game.season.seed, 3, month, p) % 10_000 < chance) links.push(l.id)
  }
  const zones: number[] = []
  for (const z of city.zones) {
    if (z.people > 0 && mix(game.season.seed, 4, month, z.id) % 10_000 < DIG.streets * times) zones.push(z.id)
  }
  return { links, zones, restored }
}

/** Poor drains: every low-lying link, and a share of the rest by the seed. A property of the road, for now. */
const poorDrains = (season: Season, city: CityData, id: number, pair: number) =>
  lowSet(city).has(id) || mix(season.seed, 8, pair) % 1000 < WEAR.poorDrains

// ------------------------------------------------------------------------------------------------ traffic

/** What the model gives beyond the agreed result (`MonthDetail`, slice 6): vehicles a weekday by link, and of those the heavy ones. */
interface Loads {
  vehiclesByLink?: ArrayLike<number>
  heavyByLink?: ArrayLike<number>
  busKmByGrade?: [number, number, number, number]
  surfaceDelay?: ArrayLike<number>
}

/**
 * Load a lane a day on each link, the heavy vehicles weighed `WEAR.heavy` times more: from the model's vehicles and
 * heavy vehicles a day where it gives them, else from car units an hour by period, a fixed share heavy.
 */
function loadsOf(result: MonthResult | null, roads: RoutingNetwork): Int32Array {
  const out = new Int32Array(roads.links.length)
  if (!result) return out
  const extra = result as MonthResult & Loads
  for (const l of roads.links) {
    let all: number
    let heavy: number
    if (extra.vehiclesByLink && extra.heavyByLink) {
      all = Math.round(Number(extra.vehiclesByLink[l.id]) || 0)
      heavy = Math.round(Number(extra.heavyByLink[l.id]) || 0)
    } else {
      let day = 0
      for (const p of PERIODS) day += (Number(result.flow[p][l.id]) || 0) * HOURS[p]
      all = Math.round(day)
      heavy = div(all * WEAR.heavyShare, 1000)
    }
    out[l.id] = div(all + WEAR.heavy * heavy, Math.max(1, l.lanes))
  }
  return out
}

/** A link's wear in a dry month at full condition, thousandths, from its load a lane a day. */
const dryWear = (load: number) => WEAR.base + div(WEAR.traffic * load, 10_000)

/** A month's wear on a link: dry wear, the rain, the drains, the condition, a dig's scar, concrete. */
function wearOn(dry: number, mm: number, drains: boolean, fine: number, scarred: boolean, concrete: boolean): number {
  let w = dry
  if (mm > 0) {
    let wet = div(dry * mm, WEAR.rain)
    if (drains) wet = div(wet * WEAR.drain, 1000)
    w += wet
  }
  if (fine < FAIR) w += div(w * (FAIR - fine) * WEAR.worse, FAIR * 1000)
  if (scarred) w = div(w * WEAR.scar, 1000)
  if (concrete) w = div(w * WEAR.concrete, 1000)
  return w
}

// ------------------------------------------------------------------------------------------------ the figure

/** Thousandths of a percentage point of main-road length in good or fair repair, over the links given. */
function goodShare(w: Wear, roads: RoutingNetwork): number {
  let all = 0
  let good = 0
  for (const l of roads.links) {
    if (isShut(l)) continue
    all += l.length
    if (fineOf(w, l.id) >= FAIR) good += l.length
  }
  return all > 0 ? div(good * 100_000, all) : 0
}

/** The share of main-road length in good or fair repair now, in percent to a tenth (the report's figure). */
export function roadsFigure(game: Game, city: CityData): number {
  const w = wearRead(game, city)
  return Math.round(goodShare(w, networkOf(city, onRoadsOf(builtOf(game)))) / 100) / 10
}

// ------------------------------------------------------------------------------------------------ the month

/** One cause of a change in the roads' figure, in thousandths of a point. */
export interface RoadCause {
  text: string
  amount: number
}

/**
 * The roads at the end of a month (called by `endMonth`): they wear by the month's traffic and rain, patches wear off,
 * utilities dig, works hand roads back, mending finishes, the upkeep budget mends the worst, and the
 * player's standing order patches. Returns the causes of the change in the roads' figure, what the standing order
 * cost, and news.
 */
export function roadsMonth(game: Game, city: CityData, result: MonthResult, quiet: boolean): {
  causes: RoadCause[]
  before: number
  order: Lakh
  news: string[]
  flooded: { link: number; days: number }[]
} {
  wearOf(game, city)
  const w = copyWear(game.wear!)
  const month = game.month
  const season = game.season
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  grow(w, roads.links.length)
  const pair = pairOf(roads)
  const concrete = new Set(game.concrete ?? [])
  const causes: RoadCause[] = []
  const news: string[] = []
  const start = goodShare(w, roads)
  const before = start - w.acted
  if (w.acted) causes.push({ text: 'Potholes you patched', amount: w.acted })
  w.acted = 0
  let last = start
  const step = (text: string) => {
    const now = goodShare(w, roads)
    if (now !== last) causes.push({ text, amount: now - last })
    last = now
  }
  const mm = rainIn(season, month)

  // Wear, by the month's traffic and rain, slowed by the upkeep budget's routine care (drains cleared, cracks sealed).
  const level: Upkeep = game.upkeep ?? 'steady'
  const slow = UPKEEP.slow[level]!
  const loads = loadsOf(result, roads)
  for (const l of roads.links) {
    if (isShut(l)) continue
    const id = l.id
    const scarred = month - w.dug[id]! < WEAR.scarMonths
    const worn = wearOn(dryWear(loads[id]!), mm, poorDrains(season, city, id, pair[id]!), fineOf(w, id), scarred, concrete.has(id))
    w.base[id] = Math.max(0, w.base[id]! - div(worn * slow, 1000))
  }
  const busy = streetsBusy(city)
  for (const z of city.zones) {
    const dry = WEAR.streets + busy[z.id]!
    const worn = wearOn(dry, mm, false, streetsOf(w, z.id), false, false)
    w.streets[z.id] = Math.max(0, w.streets[z.id]! - div(worn * slow, 1000))
  }
  step(mm > 0 ? 'Wear, and the monsoon rain' : 'Wear')

  // Patches wear off over their months.
  for (let id = 0; id < w.patch.length; id++) {
    if (w.left[id]! <= 0) continue
    w.patch[id] = w.patch[id]! - Math.floor(w.patch[id]! / w.left[id]!)
    w.left[id] = w.left[id]! - 1
    if (w.left[id] === 0) w.patch[id] = 0
  }
  for (const z of city.zones) {
    if (w.streetsLeft[z.id]! <= 0) continue
    w.streetsPatch[z.id] = w.streetsPatch[z.id]! - Math.floor(w.streetsPatch[z.id]! / w.streetsLeft[z.id]!)
    w.streetsLeft[z.id] = w.streetsLeft[z.id]! - 1
    if (w.streetsLeft[z.id] === 0) w.streetsPatch[z.id] = 0
  }
  step('Patches wearing off')

  // Utilities dig: the road drops to poor, and wears faster for a year; with dig once, it is put back as it was.
  const dug = dugIn(game, city, month)
  let dugM = 0
  for (const id of dug.links) dugM += roads.links[id]!.length
  if (!dug.restored) {
    for (const id of dug.links) {
      if (fineOf(w, id) > DIG.to) {
        w.base[id] = DIG.to
        w.patch[id] = 0
        w.left[id] = 0
      }
      w.dug[id] = month
    }
    for (const z of dug.zones) w.streets[z] = Math.max(0, w.streets[z]! - DIG.streetsLoss)
    step('Utilities digging')
    if (dug.links.length && !quiet) news.push(`Utilities dug up ${km(dugM)} of main road this month. It is left in poor repair.`)
  } else if (dug.links.length && !quiet) {
    news.push(`Utilities dug up ${km(dugM)} of main road this month, as dig once allows, and put it back as it was.`)
  }

  // Works that end this month hand their roads back: poor, unless the project paid to make them good (PRD UPK-12).
  for (const p of game.projects ?? []) {
    if (worksEnd(p) !== month + 1) continue
    const good = handBack(w, p)
    if (!good.length) continue
    step(isGood(p) ? 'Roads made good after works' : 'Roads left poor after works')
    if (!quiet) {
      news.push(isGood(p)
        ? `The roads dug up for ${p.name} are handed back resurfaced, as ordered.`
        : `The roads dug up for ${p.name} are handed back in poor repair: ${km(good.reduce((s, id) => s + roads.links[id]!.length, 0))}.`)
    }
  }

  // Mending finished this month.
  const laid: number[] = []
  for (const p of game.projects ?? []) {
    // Slice 9: resurfacing is done stretch by stretch, each good from the end of the month it was done in.
    if (p.plan.kind === 'repair' && p.plan.work === 'resurface') {
      for (const id of resurfacedIn(p, month)) {
        if (id >= w.base.length) continue
        w.base[id] = REPAIR.resurface.to
        w.patch[id] = 0
        w.left[id] = 0
        w.dug[id] = -99
        w.mended[id] = month
      }
      continue
    }
    if (p.opens !== month + 1) continue
    if (p.plan.kind === 'repair') {
      const to = p.plan.work === 'concrete' ? REPAIR.concrete.to : REPAIR.resurface.to
      for (const id of p.plan.links) {
        if (id >= w.base.length) continue
        w.base[id] = to
        w.patch[id] = 0
        w.left[id] = 0
        w.dug[id] = -99
        w.mended[id] = month
        if (p.plan.work === 'concrete') laid.push(id)
      }
    } else if (p.plan.kind === 'streets') {
      w.streets[p.plan.zone] = REPAIR.resurface.to
      w.streetsPatch[p.plan.zone] = 0
      w.streetsLeft[p.plan.zone] = 0
      w.streetsMended[p.plan.zone] = month
    }
  }
  step('Roads resurfaced or laid in concrete')

  // The upkeep budget mends the worst of itself: each month, the stretches in the worst repair, worst first, up to its
  // share of the network's lane-km, are brought back to fair; and the worst zones' streets likewise.
  const renew = UPKEEP.renew[level]!
  if (renew > 0) {
    let all = 0
    for (const l of roads.links) if (!isShut(l)) all += l.length * l.lanes
    let room = div(all * renew, 10_000)
    const worst = roads.links.filter((l) => !isShut(l) && fineOf(w, l.id) < UPKEEP.to)
      .sort((a, b) => fineOf(w, a.id) - fineOf(w, b.id) || a.id - b.id)
    for (const l of worst) {
      if (room < l.length * l.lanes) break
      room -= l.length * l.lanes
      w.base[l.id] = UPKEEP.to
      w.patch[l.id] = 0
      w.left[l.id] = 0
    }
    let streetsAll = 0
    for (const z of city.zones) streetsAll += streetMetres(city, z.id)
    let streetRoom = div(streetsAll * UPKEEP.renewStreets[level]!, 10_000)
    const worstZones = city.zones.filter((z) => streetMetres(city, z.id) > 0 && streetsOf(w, z.id) < UPKEEP.to)
      .sort((a, b) => streetsOf(w, a.id) - streetsOf(w, b.id) || a.id - b.id)
    for (const z of worstZones) {
      const m = streetMetres(city, z.id)
      if (streetRoom < m) break
      streetRoom -= m
      w.streets[z.id] = UPKEEP.to
      w.streetsPatch[z.id] = 0
      w.streetsLeft[z.id] = 0
    }
  }
  // Said in the figure's causes, not the news: it happens every month.
  step('The upkeep budget mending the worst')

  // The player's standing order: patch a zone's potholes when its roads fall below the condition set (PRD TIME-10).
  let order = 0
  if (game.patchBelow) {
    const found = orderWork(game, city, roads, w, game.patchBelow * 1000)
    if (found.cost > 0 && found.cost <= game.money) {
      for (const id of found.links) {
        patchLink(w, id, month)
        w.mended[id] = month
      }
      for (const z of found.zones) {
        patchStreets(w, z, month)
        w.streetsMended[z] = month
      }
      order = found.cost
      step('Patching by your standing order')
      if (!quiet) {
        news.push(`Your standing order patched potholes in ${found.zoneCount} zone${found.zoneCount === 1 ? '' : 's'}, for ${crore(order)}.`)
      }
    } else if (found.cost > 0 && !quiet) {
      news.push(`Your standing order would patch potholes in ${found.zoneCount} zones for ${crore(found.cost)}, but the money is not there.`)
    }
  }

  // Floods this month (they shut the low roads for the month's traffic; here only told).
  const flooded = floodsIn(season, city, month)
  const days = flooded.reduce((d, f) => Math.max(d, f.days), 0)
  if (mm > 0 && !quiet) {
    let m = 0
    const names = new Set<string>()
    for (const f of flooded) {
      m += city.roads.links[f.link]?.length ?? 0
      const n = nameOf(city, f.link)
      if (n && names.size < 3) names.add(n)
    }
    const where = names.size ? `, among them ${[...names].join(', ')}` : ''
    news.push(`The monsoon brought ${mm} mm of rain in ${monthName(month).split(' ')[0]}.` +
      (days > 0 ? ` Low-lying roads flooded and were shut for up to ${days} day${days === 1 ? '' : 's'}: ${km(m)} of main road${where}.` : ''))
  }

  game.wear = w
  if (laid.length) game.concrete = [...new Set([...(game.concrete ?? []), ...laid])].sort((a, b) => a - b)
  show(game, city)
  return { causes, before, order, news, flooded }
}

/** Streets wear faster where many live and work: thousandths a dry month, by zone. */
const busyCache = new WeakMap<object, Int32Array>()
function streetsBusy(city: CityData): Int32Array {
  let b = busyCache.get(city.zones)
  if (b) return b
  b = Int32Array.from(city.zones, (z) => {
    if (z.area <= 0) return 0
    const dense = Math.round((z.people + z.jobs) / z.area)
    return Math.max(0, Math.min(3 * WEAR.streetsBusy, div((dense - 30_000) * WEAR.streetsBusy, 30_000)))
  })
  busyCache.set(city.zones, b)
  return b
}

/** A patch on a link: up to `REPAIR.patch.to`, wearing off over a year, half that from May to September. */
function patchLink(w: Wear, id: number, month: number): void {
  const now = fineOf(w, id)
  if (now >= REPAIR.patch.to) return
  w.patch[id] = w.patch[id]! + REPAIR.patch.to - now
  w.left[id] = patchMonths(month)
}
function patchStreets(w: Wear, zone: number, month: number): void {
  const now = streetsOf(w, zone)
  if (now >= REPAIR.patch.to) return
  w.streetsPatch[zone] = w.streetsPatch[zone]! + REPAIR.patch.to - now
  w.streetsLeft[zone] = patchMonths(month)
}
/** Months a patch lasts: half as long if done from May to September, in the rains or just before (PRD UPK-11). */
export const patchMonths = (month: number) => (month % 12 >= 4 && month % 12 <= 8 ? REPAIR.patch.monsoon : REPAIR.patch.months)

/** What the standing order would patch now: each zone's main roads below fair, and its streets, where they are below the mark. */
function orderWork(game: Game, city: CityData, roads: RoutingNetwork, w: Wear, mark: number) {
  const zoneOf = linkZones(city, roads)
  const len = new Float64Array(city.zones.length)
  const sum = new Float64Array(city.zones.length)
  for (const l of roads.links) {
    if (isShut(l)) continue
    const z = zoneOf[l.id]!
    len[z] = len[z]! + l.length
    sum[z] = sum[z]! + l.length * fineOf(w, l.id)
  }
  const links: number[] = []
  const zones: number[] = []
  const hit = new Set<number>()
  let laneM = 0
  let streetM = 0
  for (const l of roads.links) {
    const z = zoneOf[l.id]!
    if (isShut(l) || len[z]! <= 0 || sum[z]! / len[z]! >= mark || fineOf(w, l.id) >= REPAIR.patch.to) continue
    links.push(l.id)
    laneM += l.length * l.lanes
    hit.add(z)
  }
  for (const z of city.zones) {
    if (streetsOf(w, z.id) >= mark || streetMetres(city, z.id) <= 0) continue
    zones.push(z.id)
    streetM += streetMetres(city, z.id)
    hit.add(z.id)
  }
  const cost = priced(game, div(laneM * REPAIR.patch.laneKm, 1000) + div(streetM * STREETS.patchKm, 1000))
  return { links, zones, cost, zoneCount: hit.size }
}

// ------------------------------------------------------------------------------------------------ works and making good

const WORKS_KINDS = new Set(['metro', 'road', 'junction'])
/** The month (the first after) in which a work's lanes are given back: half a metro line's months; a road's or junction's end. */
export function worksEnd(p: Project): number | null {
  if (!WORKS_KINDS.has(p.plan.kind) || !p.quote.disrupted.length) return null
  return p.plan.kind === 'metro' ? p.started + Math.floor((p.opens - p.started) / 2) : p.opens
}
const isGood = (p: Project) => 'makeGood' in p.plan && p.plan.makeGood === true

/** Roads a work dug up, as it hands them back: resurfaced if it paid to make good, else poor. Returns the links. */
function handBack(w: Wear, p: Project): number[] {
  const links = [...new Set(p.quote.disrupted)].filter((id) => id < w.base.length)
  for (const id of links) {
    if (isGood(p)) {
      w.base[id] = REPAIR.resurface.to
      w.patch[id] = 0
      w.left[id] = 0
    } else if (fineOf(w, id) > DIG.to) {
      w.base[id] = DIG.to
      w.patch[id] = 0
      w.left[id] = 0
    }
  }
  return links
}

/** A work stopped while its lanes were taken: its roads are handed back as they are, poor unless it paid to make good. */
export function stopWorks(game: Game, city: CityData, p: Project): void {
  const end = worksEnd(p)
  if (end === null || game.month < p.started || game.month >= end) return
  const w = copyWear(wearOf(game, city))
  handBack(w, p)
  game.wear = w
  show(game, city)
}

/** What making good the roads dug up for a work costs: resurfacing each lane of them once, at this month's prices. */
export function makeGoodCost(game: Game, city: CityData, roads: RoutingNetwork, disrupted: number[]): Lakh {
  let laneM = 0
  for (const id of new Set(disrupted)) {
    const l = roads.links[id]
    if (l) laneM += l.length * l.lanes
  }
  return priced(game, div(laneM * REPAIR.resurface.laneKm, 1000))
}

// ------------------------------------------------------------------------------------------------ what it costs

/**
 * What poor roads add to running the buses (PRD ROAD-5): bus-km a weekday on fair, poor and broken roads (the model's
 * `busKmByGrade`), each costing `BUS_WEAR` thousandths more to run, every day of the month, in lakh at this month's
 * prices. Nothing if the model does not say.
 */
export function busWear(game: Game, result: MonthResult | null): Lakh {
  const by = (result as (MonthResult & Loads) | null)?.busKmByGrade
  if (!by) return 0
  let extra = 0
  for (let k = 0; k < 4; k++) extra += Math.round(by[k]!) * BUS_WEAR[k]!
  return div(div(extra * RUNNING.busKm * RUN_DAYS, 1000 * 100_000) * costIndex(game.month), 10_000)
}

/** The upkeep budget a month, in lakh at this month's prices, for a level (PRD UPK-4): main roads by lane-km, and streets. */
export function upkeepCost(game: Game, city: CityData, level: Upkeep = game.upkeep ?? 'steady', laneMetres: number): Lakh {
  let streets = 0
  for (const z of city.zones) streets += streetMetres(city, z.id)
  const rupees = div(laneMetres * UPKEEP.laneKm[level]!, 1000) + div(streets * UPKEEP.streetKm[level]!, 1000)
  return div(div(rupees, 100_000) * costIndex(game.month), 10_000)
}

// ------------------------------------------------------------------------------------------------ approval

/**
 * How well the roads serve each zone: its main roads (by length) and streets, half each, whole points, in the order of
 * the city's zones. A zone with no main road counts its streets for both.
 */
export function roadsByZone(game: Game, city: CityData): number[] {
  const w = wearRead(game, city)
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const zoneOf = linkZones(city, roads)
  const index = new Map(city.zones.map((z, k) => [z.id, k]))
  const len = new Float64Array(city.zones.length)
  const sum = new Float64Array(city.zones.length)
  for (const l of roads.links) {
    if (isShut(l)) continue
    const k = index.get(zoneOf[l.id]!)
    if (k === undefined) continue
    len[k] = len[k]! + l.length
    sum[k] = sum[k]! + l.length * points(fineOf(w, l.id))
  }
  return city.zones.map((z, k) => {
    const street = points(streetsOf(w, z.id))
    const main = len[k]! > 0 ? Math.round(sum[k]! / len[k]!) : street
    return Math.round((main + street) / 2)
  })
}

/** How well the roads serve where people live: `roadsByZone` weighed by people. Whole points. */
export function roadsWhereLive(game: Game, city: CityData): number {
  const by = roadsByZone(game, city)
  const people = game.zonePeople
  let all = 0
  let score = 0
  city.zones.forEach((z, k) => {
    const p = people ? people[k]! : z.people
    if (p <= 0) return
    all += p
    score += p * by[k]!
  })
  return all > 0 ? Math.round(score / all) : 0
}

// ------------------------------------------------------------------------------------------------ the worst roads

/**
 * Vehicle-hours a weekday lost to each link's surface, against the same road at 100: its traffic, the time it took,
 * and the share of that time the surface added. From the month's traffic and the surface it had.
 */
function lostHours(result: MonthResult, roads: RoutingNetwork, fine: (id: number) => number): Float64Array {
  const out = new Float64Array(roads.links.length)
  for (const l of roads.links) {
    const loss = speedLoss(fine(l.id))
    if (loss <= 0) continue
    let h = 0
    for (const p of PERIODS) {
      const f = Number(result.flow[p][l.id]) || 0
      const s = Number(result.speed[p][l.id]) || 0
      if (f <= 0 || s <= 0 || l.speed <= 0) continue
      // Hours for a vehicle to pass, as it went; of those, the part that the surface added.
      const hours = (l.length * 1000) / (l.speed * 1000 * s)
      h += f * HOURS[p] * hours * (loss / 1000)
    }
    out[l.id] = h
  }
  return out
}

/** The five roads whose surface costs the most time, from the month's traffic and the surface it ran on (PRD ROAD-6). */
export function worstRoads(game: Game, city: CityData, result: MonthResult, surface: number[] | undefined): WorstRoad[] {
  if (!surface) return []
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const fine = (id: number) => (surface[id] ?? 100) * 1000 + 500
  // The model's own vehicle-minutes lost to each surface where it gives them; else the rules' arithmetic.
  const delay = (result as MonthResult & Loads).surfaceDelay
  const lost = delay ? Float64Array.from(roads.links, (l) => (Number(delay[l.id]) || 0) / 60) : lostHours(result, roads, fine)
  const named = namedRoads(city)
  const by = new Map<number, { links: number[]; hours: number; length: number; sum: number }>()
  for (const l of roads.links) {
    if (l.id >= city.roads.links.length || isShut(l) || lost[l.id]! <= 0) continue
    const c = surface[l.id] ?? 100
    if (c >= GRADES.fair) continue
    const k = named.road[l.id]!
    const r = by.get(k) ?? { links: [], hours: 0, length: 0, sum: 0 }
    r.links.push(l.id)
    r.hours += lost[l.id]!
    r.length += l.length
    r.sum += l.length * c
    by.set(k, r)
  }
  // Slice 7: km of road, each road counted once however many of its directions are poor.
  const pair = pairOf(roads)
  const roadLength = (links: number[]) => {
    const by = new Map<number, number>()
    for (const id of links) by.set(pair[id]!, Math.max(by.get(pair[id]!) ?? 0, roads.links[id]!.length))
    let m = 0
    for (const x of by.values()) m += x
    return m
  }
  return [...by]
    .sort((a, b) => b[1].hours - a[1].hours || a[0] - b[0])
    .slice(0, 5)
    .map(([k, r]) => ({
      // Slice 7: the stretch in poor repair, by the places it runs between, or the place it is near.
      name: nameOf(city, r.links[0]!) === null ? named.names[k]! : stretchName(roads, r.links, nameOf(city, r.links[0]!)!),
      links: r.links.sort((a, b) => a - b),
      length: roadLength(r.links),
      condition: Math.round(r.sum / r.length),
      hours: Math.round(r.hours),
    }))
}

/**
 * Minutes of the average commute the surface's change from `was` to `now` is worth, by arithmetic: the vehicle-hours
 * a weekday it adds or saves, over the month's travellers, times `OCCUPANCY` (fitted to the model). Links in `skip` are
 * left out (those the player mended, which the model explains).
 */
export function surfaceMinutes(result: MonthResult, roads: RoutingNetwork, was: number[], now: number[], skip: Set<number>): number {
  let hours = 0
  for (const l of roads.links) {
    if (skip.has(l.id)) continue
    const a = was[l.id] ?? 100
    const b = now[l.id] ?? 100
    if (a === b) continue
    const la = speedLoss(a * 1000 + 500)
    const lb = speedLoss(b * 1000 + 500)
    for (const p of PERIODS) {
      const f = Number(result.flow[p][l.id]) || 0
      const s = Number(result.speed[p][l.id]) || 0
      if (f <= 0 || s <= 0 || l.speed <= 0) continue
      const t = (l.length * 1000) / (l.speed * 1000 * s)
      // The time now, and as it would be with the surface as it was: speed scales by (1 − loss).
      hours += f * HOURS[p] * t * (1 - (1000 - lb) / (1000 - la))
    }
  }
  const t = result.trips
  const travellers = t.car + t.twoWheeler + t.auto + t.bus + t.metro + t.rail + t.cycle + t.walk
  return travellers > 0 ? (hours * 60 * OCCUPANCY) / travellers : 0
}
/**
 * For turning vehicle-hours into minutes of the average commute: people in each car unit, and the congestion that lost
 * capacity adds, which the speed rule alone leaves out. Fitted to the model (28 September 2026): every road's surface
 * 5 and 10 points better or worse, the model's commute against this arithmetic's, within a fifth.
 */
export const OCCUPANCY = 2.6

// ------------------------------------------------------------------------------------------------ planning

const refuse = (reason: string, major = false): Quote => ({
  ok: false, reason, cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major,
})

/** Links being mended by work under way, and zones whose streets are. */
function underRepair(game: Game): { links: Set<number>; zones: Set<number> } {
  const links = new Set<number>()
  const zones = new Set<number>()
  for (const p of game.projects ?? []) {
    if (p.plan.kind === 'repair') for (const id of p.plan.links) links.add(id)
    if (p.plan.kind === 'streets') zones.add(p.plan.zone)
  }
  return { links, zones }
}

/** Checks the shape of a repair or streets plan, which comes from outside. */
export function repairProblem(p: RepairPlan | StreetsPlan): string | null {
  if (p.kind === 'repair') {
    if (!Array.isArray(p.links) || p.links.length < 1) return 'Choose at least one stretch of road.'
    if (p.links.length > REPAIR.links) return `Choose at most ${REPAIR.links} stretches of road at once.`
    if (!p.links.every(whole)) return 'A stretch of road is not a proper one.'
    if (new Set(p.links).size !== p.links.length) return 'A stretch of road is chosen twice.'
    if (p.work !== 'patch' && p.work !== 'resurface' && p.work !== 'concrete') return 'Choose patching, resurfacing or concrete.'
    return null
  }
  if (!whole(p.zone)) return 'Choose a zone.'
  if (p.work !== 'patch' && p.work !== 'resurface') return 'Choose patching or resurfacing.'
  return null
}

/** Average monthly wear of links over a year of the usual monsoon (the 1996–2025 average), at fair condition. */
function yearlyWear(dry: number, concrete: boolean): number {
  let year = 0
  const rain = [0, 0, 0, 0, 0, 104, 115, 162, 201, 0, 0, 0]
  for (const mm of rain) year += wearOn(dry, mm, false, FAIR, false, concrete)
  return Math.max(1, year)
}

/**
 * Months a road at `from` is expected to stay fair or better: until it wears below fair, slowed by the upkeep budget,
 * or a utility digs it up, whichever comes first on average (the two as rates, added). Null if neither is expected
 * within 20 years.
 */
function monthsToFair(from: number, dry: number, concrete: boolean, slow: number, digs = true): number | null {
  const net = div(yearlyWear(dry, concrete) * slow, 1000)
  // Each as a rate a month, in millionths.
  const wearRate = net > 0 ? Math.round((net * 1_000_000) / ((from - FAIR) * 12)) : 0
  const digRate = digs ? Math.round((DIG.chance * (concrete ? DIG.slow : 1000)) / 10) : 0
  const rate = wearRate + digRate
  if (rate <= 0) return null
  const months = Math.max(1, Math.floor(1_000_000 / rate))
  return months >= 240 ? null : months
}

/** Words for how long something lasts: "about 5 years", "about 8 months", "20 years or more". */
function howLong(months: number | null): string {
  if (months === null || months >= 240) return '20 years or more'
  if (months < 18) return `about ${months} months`
  return `about ${Math.round(months / 12)} years`
}

/** Hours a weekday a change of surface saves on links, from last month's traffic. */
function hoursSaved(game: Game, roads: RoutingNetwork, links: number[], to: number): number {
  const result = game.last
  if (!result) return 0
  const w = game.wear
  if (!w) return 0
  const before = lostHours(result, roads, (id) => fineOf(w, id))
  const after = lostHours(result, roads, () => to)
  let h = 0
  for (const id of links) h += before[id]! - after[id]!
  return Math.round(h)
}

/** Mending main roads (`{ kind: 'repair', links, work }`): cost, time, what it shuts, and what it will do. */
export function repairQuote(game: Game, city: CityData, roads: RoutingNetwork, plan: RepairPlan): Quote {
  const major = plan.work === 'concrete'
  const w = wearRead(game, city)
  const doing = underRepair(game)
  const concrete = new Set(game.concrete ?? [])
  for (const id of plan.links) {
    const l = roads.links[id]
    if (!l) return refuse('One of the stretches chosen is not a main road.', major)
    if (isShut(l)) return refuse('One of the stretches chosen is shut: the road is one-way the other way.', major)
    if (doing.links.has(id)) return refuse('One of the stretches chosen is being mended already.', major)
  }
  const to = plan.work === 'patch' ? REPAIR.patch.to : plan.work === 'resurface' ? REPAIR.resurface.to : REPAIR.concrete.to
  const todo = plan.links.filter((id) => (plan.work === 'concrete' ? !concrete.has(id) : plan.work === 'resurface' ? !concrete.has(id) && fineOf(w, id) < to : fineOf(w, id) < to))
  if (!todo.length) {
    if (plan.work === 'concrete') return refuse('Every stretch chosen is laid in concrete already.', major)
    if (plan.work === 'resurface' && plan.links.every((id) => concrete.has(id))) return refuse('Every stretch chosen is laid in concrete, and needs no resurfacing.')
    return refuse(`Every stretch chosen is ${plan.work === 'patch' ? 'fair' : 'good'} or better already. ${plan.work === 'patch' ? 'A patch' : 'Resurfacing'} would not help.`)
  }
  let length = 0
  let laneM = 0
  const path: number[] = []
  for (const id of todo) {
    const l = roads.links[id]!
    length += l.length
    laneM += l.length * l.lanes
    const a = roads.nodes[l.from]!.at
    const b = roads.nodes[l.to]!.at
    path.push(a[0] / 1e6, a[1] / 1e6, b[0] / 1e6, b[1] / 1e6)
  }
  const rate = plan.work === 'patch' ? REPAIR.patch.laneKm : plan.work === 'resurface' ? REPAIR.resurface.laneKm : REPAIR.concrete.laneKm
  const cost = priced(game, Math.max(1, div(laneM * rate, 1000)))
  let months = 0
  const disrupted: number[] = []
  if (plan.work === 'resurface') {
    months = Math.min(REPAIR.resurface.most, 1 + Math.floor(laneM / REPAIR.resurface.perMonth))
    disrupted.push(...todo)
  } else if (plan.work === 'concrete') {
    months = Math.min(REPAIR.concrete.most, REPAIR.concrete.base + Math.floor(laneM / REPAIR.concrete.perMonth))
    for (const id of todo) for (let k = 0; k < Math.ceil(roads.links[id]!.lanes / 2); k++) disrupted.push(id)
  }
  disrupted.sort((a, b) => a - b)
  // How long it lasts, at the average wear of the stretches at last month's traffic and the budget as set.
  const loads = loadsOf(game.last, roads)
  let dry = 0
  for (const id of todo) dry += dryWear(loads[id]!) * roads.links[id]!.length
  dry = length > 0 ? div(dry, length) : WEAR.base
  const slow = UPKEEP.slow[game.upkeep ?? 'steady']!
  const lasts = plan.work === 'patch' ? patchMonths(game.month) : monthsToFair(to, dry, plan.work === 'concrete', slow)
  const saved = hoursSaved(game, roads, todo, to)
  const skipped = plan.links.length - todo.length
  // Slice 7: km of road, each road counted once however many of its directions are chosen; lane-km only for the price.
  const pair = pairOf(roads)
  const byRoad = new Map<number, number>()
  for (const id of todo) byRoad.set(pair[id]!, Math.max(byRoad.get(pair[id]!) ?? 0, roads.links[id]!.length))
  let road = 0
  for (const m of byRoad.values()) road += m
  const bothWays = todo.length > byRoad.size
  const where = roadWords(city, todo) + (bothWays ? ', both ways' : '')
  const it = where.includes(' other road') || where.startsWith('roads in') ? 'them' : 'it'
  let note: string
  if (plan.work === 'patch') {
    note = `Fills the potholes on ${km(road)} of ${where} this month, raising ${it} to fair. It wears off over ${patchMonths(game.month)} months.`
    if (patchMonths(game.month) < REPAIR.patch.months) note += ' Patching in the rains, or just before, lasts half as long.'
  } else if (plan.work === 'resurface') {
    note = `Resurfaces ${km(road)} of ${where}, raising ${it} to good. ${months === 1 ? 'It takes a month, with a lane shut' : `It is done stretch by stretch over ${months} months, each stretch with a lane shut for the month it is done`}, and should stay fair or better for ${howLong(lasts)}.`
  } else {
    note = `Lays ${km(road)} of ${where} in concrete, as new. It takes ${months} months with half the road shut, and wears a quarter as fast: it should stay fair or better for ${howLong(lasts)}.`
  }
  note += ` It costs ${crore(cost)}: ${grouped(Math.round(laneM / 1000))} lane-km, a km of one lane, at ${crore(priced(game, rate))} each.`
  if (saved > 0) note += ` At last month's traffic it saves about ${grouped(saved)} hours a weekday.`
  if (skipped > 0) note += ` ${skipped} of the stretches chosen ${skipped === 1 ? 'needs' : 'need'} nothing and ${skipped === 1 ? 'is' : 'are'} left out.`
  return {
    ok: true,
    cost,
    months,
    running: 0,
    length: road,
    stations: [],
    path,
    disrupted,
    major,
    condition: points(to),
    lasts: lasts ?? 240,
    note,
  }
}

/** A few words for where some links are: "Hosur Road", "Hosur Road and 2 other roads", "roads in Bellandur". */
export function roadWords(city: CityData, links: number[]): string {
  const named = namedRoads(city)
  const count = new Map<number, number>()
  for (const id of links) {
    if (id >= city.roads.links.length) continue
    const k = named.road[id]!
    count.set(k, (count.get(k) ?? 0) + city.roads.links[id]!.length)
  }
  const order = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  if (!order.length) return 'new road'
  const first = named.names[order[0]![0]]!
  const name = first.startsWith('Roads in') ? `r${first.slice(1)}` : first
  return order.length === 1 ? name : `${name} and ${order.length - 1} other road${order.length === 2 ? '' : 's'}`
}

/** Mending a zone's streets (`{ kind: 'streets', zone, work }`). */
export function streetsQuote(game: Game, city: CityData, plan: StreetsPlan): Quote {
  const zone = city.zones.find((z) => z.id === plan.zone)
  if (!zone) return refuse('There is no such zone.')
  const m = streetMetres(city, zone.id)
  if (m <= 0) return refuse(`No one lives in ${zone.name}: it has no streets to mend.`)
  const w = wearRead(game, city)
  if (underRepair(game).zones.has(zone.id)) return refuse(`The streets of ${zone.name} are being mended already.`)
  const now = streetsOf(w, zone.id)
  const patch = plan.work === 'patch'
  const to = patch ? REPAIR.patch.to : REPAIR.resurface.to
  if (now >= to) return refuse(`The streets of ${zone.name} are ${patch ? 'fair' : 'good'} or better already. ${patch ? 'A patch' : 'Resurfacing'} would not help.`)
  const cost = priced(game, Math.max(1, div(m * (patch ? STREETS.patchKm : STREETS.resurfaceKm), 1000)))
  const months = patch ? 0 : m > STREETS.long ? 2 : 1
  const slow = UPKEEP.slow[game.upkeep ?? 'steady']!
  const lasts = patch ? patchMonths(game.month) : monthsToFair(to, WEAR.streets + streetsBusy(city)[zone.id]!, false, slow, false)
  let note = patch
    ? `Fills the potholes in the ${km(m)} of streets of ${zone.name} this month, raising them to fair. It wears off over ${patchMonths(game.month)} months.`
    : `Resurfaces the ${km(m)} of streets of ${zone.name}, raising them to good, in ${months} month${months === 1 ? '' : 's'}. They should stay fair or better for ${howLong(lasts)}.`
  if (patch && patchMonths(game.month) < REPAIR.patch.months) note += ' Patching in the rains, or just before, lasts half as long.'
  note += ' Every trip that starts or ends there is a little quicker.'
  return {
    ok: true,
    cost,
    months,
    running: 0,
    length: m,
    stations: [{ at: zone.centre, name: zone.name, nameKn: zone.nameKn }],
    path: [],
    disrupted: [],
    major: false,
    condition: points(to),
    lasts: lasts ?? 240,
    note,
  }
}

/** Patches done at once (`months: 0`): the roads or streets raised to fair, the patch to wear off. Returns the news. */
export function patchNow(game: Game, city: CityData, plan: RepairPlan | StreetsPlan, q: Quote): string {
  const w = copyWear(wearOf(game, city))
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  grow(w, roads.links.length)
  const before = goodShare(w, roads)
  const lasts = patchMonths(game.month)
  let news: string
  if (plan.kind === 'repair') {
    const done: number[] = []
    for (const id of plan.links) {
      if (fineOf(w, id) >= REPAIR.patch.to) continue
      patchLink(w, id, game.month)
      w.mended[id] = game.month
      done.push(id)
    }
    news = `You had the potholes on ${km(q.length)} of ${roadWords(city, done)} patched.`
  } else {
    patchStreets(w, plan.zone, game.month)
    w.streetsMended[plan.zone] = game.month
    news = `You had the potholes in the streets of ${q.stations[0]?.name ?? 'the zone'} patched.`
  }
  news += ` It lasts about ${lasts} months${lasts < REPAIR.patch.months ? ', half as long as in the dry months' : ''}.`
  w.acted += goodShare(w, roads) - before
  game.wear = w
  show(game, city)
  return news
}

/**
 * Links losing a lane to mending this month: a lane for resurfacing, half the road for concrete. (Utilities' trenches
 * last days, not a month, and take no lane here: they harm the surface.)
 */
export function roadWorks(game: Game): number[] {
  const out: number[] = []
  for (const p of game.projects ?? []) {
    if (p.plan.kind !== 'repair') continue
    out.push(...(p.plan.work === 'resurface' ? resurfacedIn(p, game.month) : p.quote.disrupted))
  }
  return out
}

/**
 * Slice 9: resurfacing goes stretch by stretch, as the city lets it (the Outer Ring Road relaid a reach at a time): the
 * stretches are done in turn, an equal share of them each month of the work, in the order of their ids, each losing a
 * lane only for the month it is done and good from the end of that month. Before, every stretch lost a lane for all of
 * the work's months and was good only at the end: resurfacing the ten worst roads cost 98 points of the score for three
 * months, and bought nothing until they were done. The stretches done in the month `month` of a resurfacing project.
 */
export function resurfacedIn(p: Project, month: number): number[] {
  const months = Math.max(1, p.opens - p.started)
  const k = month - p.started
  if (k < 0 || k >= months) return []
  const links = p.quote.disrupted
  return links.slice(Math.floor((k * links.length) / months), Math.floor(((k + 1) * links.length) / months))
}

/** Checks a standing order's condition. */
export function orderProblem(x: unknown): string | null {
  if (x === undefined || x === null) return null
  if (!whole(x) || x < ORDER.least || x > ORDER.most) return `A standing order to patch is set at a condition of ${ORDER.least} to ${ORDER.most}.`
  return null
}

/** The shown surface for the model: whole points for every link of the network, 100 for any not yet kept. */
export function surfaceFor(game: Game, city: CityData, links: number): { surface: number[]; streets: number[] } {
  const w = wearRead(game, city)
  const surface: number[] = []
  for (let id = 0; id < links; id++) surface.push(points(fineOf(w, id)))
  return { surface, streets: w.streets.map((_, z) => points(streetsOf(w, z))) }
}

/** Setup's surface with the links and zones the player mended since `from` put back as they were in `was`. */
export function withoutMended(game: Game, now: Setup, was: Setup, from: number): { setup: Setup; links: Set<number> } | null {
  const w = game.wear
  if (!w || !now.surface || !was.surface) return null
  const links = new Set<number>()
  const surface = [...now.surface]
  for (let id = 0; id < surface.length; id++) {
    if (w.mended[id]! >= from && was.surface[id] !== undefined) {
      surface[id] = was.surface[id]!
      links.add(id)
    }
  }
  const streets = now.streets ? [...now.streets] : undefined
  let zones = 0
  if (streets && was.streets) {
    for (let z = 0; z < streets.length; z++) {
      if (w.streetsMended[z]! >= from) {
        streets[z] = was.streets[z]!
        zones++
      }
    }
  }
  if (!links.size && !zones) return null
  return { setup: { ...now, surface, ...(streets ? { streets } : {}) }, links }
}


// ------------------------------------------------------------------------------------------------ warnings (slice 7)

/**
 * What it would cost now to put the main roads right: every poor or broken stretch resurfaced, and every zone's poor
 * streets, at this year's prices. In lakh.
 */
export function putRightCost(game: Game, city: CityData): Lakh {
  const w = wearRead(game, city)
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const concrete = new Set(game.concrete ?? [])
  let laneM = 0
  for (const l of roads.links) if (!isShut(l) && !concrete.has(l.id) && fineOf(w, l.id) < FAIR) laneM += l.length * l.lanes
  let streets = 0
  for (const z of city.zones) if (streetsOf(w, z.id) < FAIR) streets += streetMetres(city, z.id)
  return priced(game, div(laneM * REPAIR.resurface.laneKm, 1000) + div(streets * STREETS.resurfaceKm, 1000))
}

/**
 * A warning about the roads, in plain words, where they are falling (PRD UPK-13; slice 7): the share of main roads in
 * good or fair repair now and a year before, where it is heading at that rate, and what putting them right would cost
 * now. `yearAgo` is the share a year before, in percent. Nothing if the roads are holding.
 */
export function roadsWarning(game: Game, city: CityData, yearAgo: number | undefined): string | null {
  const now = roadsFigure(game, city)
  const bare = (game.upkeep ?? 'steady') === 'bare'
  const falling = yearAgo !== undefined && yearAgo - now >= 3
  if (!bare && !falling) return null
  const parts: string[] = []
  parts.push(yearAgo === undefined
    ? `The roads: ${now}% of main roads are in good or fair repair.`
    : `The roads: ${now}% of main roads are in good or fair repair, ${now < yearAgo ? 'down' : 'up'} from ${yearAgo}% a year ago.`)
  if (falling && yearAgo !== undefined) {
    const years = Math.ceil(now / (yearAgo - now))
    parts.push(now < 5
      ? 'Hardly any are left in good or fair repair: they slow every trip, and kill more riders.'
      : `At this rate hardly any will be in good or fair repair by ${2026 + Math.floor(game.month / 12) + years}.`)
  }
  if (bare) parts.push('The upkeep budget is bare: nothing is mended, and the roads fall about a grade in three years.')
  parts.push(`Resurfacing every poor and broken stretch, and the poor streets, would cost about ${crore(putRightCost(game, city))} now, and more each year it waits.`)
  return parts.join(' ')
}
