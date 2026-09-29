import type { LngLat, Station, Transit, TransitLine, Zone } from '../data/types'
import type { Action, Built, CityData, Entry, Game, Outcome, Plan, Project, Quote, Report, Rules, Stop } from '../rules/types'
import type { CityState, RoutingNetwork } from '../sim/types'
import { KNOWN_PLACES } from '../map/places'

/*
 * Building, for the screen: what the page needs to show a plan (its line, once open, for a forecast), and stand-ins
 * for person D's `quote`, `suggest` and the four building actions, used only while the rules still refuse them.
 * The stand-in amounts are plausible, not considered.
 */

/** What the rules say while building is not written. */
export const NOT_YET = 'This cannot be built yet.'

/**
 * Colours for the player's metro lines, in the order they are given: none near the city's own lines (purple, green,
 * yellow, pink, blue) or the traffic (amber, orange, red), and each named as Namma Metro names its lines.
 */
export const LINE_COLOURS: { colour: string; name: string }[] = [
  { colour: '#22336e', name: 'Navy' },
  { colour: '#8e5a39', name: 'Brown' },
  { colour: '#7d8b1f', name: 'Olive' },
  { colour: '#4f7482', name: 'Slate' },
  { colour: '#9b7896', name: 'Mauve' },
  { colour: '#3f3b36', name: 'Grey' },
]
/** Road work under way, in the dark edge colour of the map's roads. */
export const ROAD_WORK = '#6f6656'
/** Everything to do with buses: routes, stops and lanes. */
export const BUS_COLOUR = '#0b8793'

/** Metres between two points: flat, which is close enough across a city. */
export function metres(a: LngLat, b: LngLat): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return Math.hypot((b[0] - a[0]) * 111_320 * k, (b[1] - a[1]) * 110_540)
}

export function nodeAt(roads: RoutingNetwork, id: number): LngLat {
  const n = roads.nodes[id]!
  return [n.at[0] / 1e6, n.at[1] / 1e6]
}

/** The player's lines and the works in hand, by id, whichever rules made them. */
export function builtOf(game: Game): Built {
  return game.built ?? { lines: [], stations: [], busLanes: [], vehicles: {} }
}

/** Metro lines ordered so far, in order: each keeps the colour of its place in this list. */
function metroOrders(game: Game): Plan[] {
  return game.done.flatMap((d) => (d.action.kind === 'build' && d.action.plan.kind === 'metro' ? [d.action.plan] : []))
}

/** The colour and name the next metro line ordered would have. */
export function nextMetro(game: Game): { colour: string; name: string } {
  const pick = LINE_COLOURS[metroOrders(game).length % LINE_COLOURS.length]!
  return { colour: pick.colour, name: `${pick.name} Line` }
}

/** Colours the rules have used for lines, by name, beside the screen's own: work is drawn as the rules name it. */
const NAMED: Record<string, string> = { Indigo: '#4a50c2', Plum: '#b0417a' }

/** The colour of work under way, or of a line the player has ordered: a metro line's by its place among the orders. */
export function projectLook(game: Game, plan: Plan, name?: string): { colour: string; name: string } {
  if (ROAD_KINDS.has(plan.kind)) return { colour: ROAD_WORK, name: '' }
  if (plan.kind !== 'metro') return { colour: plan.kind === 'railService' ? '#9d968b' : BUS_COLOUR, name: '' }
  const said = name && /^(\w+) Line/.exec(name)?.[1]
  const known = said && (LINE_COLOURS.find((l) => l.name === said)?.colour ?? NAMED[said])
  if (said && known) return { colour: known, name: `${said} Line` }
  const key = JSON.stringify(plan)
  const i = Math.max(0, metroOrders(game).findIndex((p) => JSON.stringify(p) === key))
  const pick = LINE_COLOURS[i % LINE_COLOURS.length]!
  return { colour: pick.colour, name: `${pick.name} Line` }
}

/** A plan's name for the player: "Navy Line, JP Nagar to Hebbal", "Bus route, Silk Board to KR Puram". */
export function planName(plan: Plan, quote: Quote, game: Game, transit: Transit | null, zones: Zone[] = []): string {
  const ends = quote.stations.length >= 2 ? `${quote.stations[0]!.name} to ${quote.stations.at(-1)!.name}` : ''
  const place = quote.stations[0]?.name ?? ''
  const zone = 'zone' in plan ? (zones.find((z) => z.id === plan.zone)?.name ?? place) : place
  switch (plan.kind) {
    case 'metro':
      return `${nextMetro(game).name}${ends ? `, ${ends}` : ''}`
    case 'busRoute':
      return `Bus route${ends ? `, ${ends}` : ''}`
    case 'busLane':
      return `Bus lanes on ${plan.links.length} stretch${plan.links.length === 1 ? '' : 'es'} of road`
    case 'railService': {
      const line = transit?.lines.find((l) => l.id === plan.line)
      return `${plan.trains} more trains${line ? `, ${line.name}` : ''}`
    }
    case 'road':
      return `${plan.flyover ? 'Flyover' : 'Road'}${ends ? `, ${ends}` : ''}`
    case 'junction':
      return `${JUNCTION_WORK[plan.work]}${place ? ` at ${place}` : ''}`
    case 'footpaths':
      return `Footpaths${zone ? ` in ${zone}` : ''}`
    case 'speedLimit':
      return plan.limit === null ? `No speed limit${zone ? ` in ${zone}` : ''}` : `${plan.limit} km/h limit${zone ? ` in ${zone}` : ''}`
    case 'oneWay':
      return plan.on ? `One-way street${place ? `, ${place}` : ''}` : `Two-way again${place ? `, ${place}` : ''}`
    case 'density':
      return plan.on ? `Taller building${zone ? ` in ${zone}` : ''}` : `No taller building${zone ? ` in ${zone}` : ''}`
    case 'repair':
      return `${REPAIR_WORK[plan.work]}${place ? `, ${place}` : ''}`
    case 'streets':
      return `${plan.work === 'patch' ? 'Patching' : 'Resurfacing'} the streets${zone ? ` of ${zone}` : ''}`
  }
}

/** The three kinds of road repair, as the player reads them. */
export const REPAIR_WORK: Record<'patch' | 'resurface' | 'concrete', string> = {
  patch: 'Patching potholes',
  resurface: 'Resurfacing',
  concrete: 'Concrete',
}

/** The three kinds of junction work, as the player reads them. */
export const JUNCTION_WORK: Record<'signal' | 'redesign' | 'overpass', string> = {
  signal: 'Signals',
  redesign: 'Junction redesign',
  overpass: 'Overpass',
}

/** The plans of slice 5: roads, junctions and the policies by zone or street. */
export const ROAD_KINDS = new Set<Plan['kind']>(['road', 'junction', 'footpaths', 'oneWay', 'speedLimit', 'density', 'repair', 'streets'])

/**
 * The plan as it would stand once open, put into a copy's `built`: its line and new stations, its bus lanes, its
 * vehicles. Used to ask the model what an open line would do, whichever rules are in use.
 */
export function openInto(
  game: Game, city: CityData, plan: Plan, quote: Quote, id?: string, look = plan.kind === 'metro' ? nextMetro(game) : null,
): void {
  const built = (game.built = structuredClone(builtOf(game)))
  if (plan.kind === 'busLane') {
    built.busLanes = [...new Set([...built.busLanes, ...plan.links])]
    return
  }
  if (plan.kind === 'railService') {
    // The rules keep the number of trains added, not the line's total.
    built.vehicles[plan.line] = (built.vehicles[plan.line] ?? 0) + plan.trains
    return
  }
  let next = Math.max(
    ...city.transit.stations.map((s) => s.id),
    ...built.stations.map((s) => s.id),
    0,
  ) + 1
  const kind = plan.kind === 'metro' ? 'metro' : 'bus'
  const stations: number[] = []
  for (const s of quote.stations) {
    if (s.existing !== undefined) stations.push(s.existing)
    else {
      const station: Station = { id: next++, name: s.name, nameKn: s.nameKn, at: s.at, kind }
      built.stations.push(station)
      stations.push(station.id)
    }
  }
  const shown = look ?? { colour: BUS_COLOUR, name: 'Bus route' }
  const lineId = id ?? `player-${kind}-${built.lines.length + (game.projects?.length ?? 0) + 1}`
  const line: TransitLine = { id: lineId, name: shown.name, kind, colour: shown.colour, status: 'open', stations, path: quote.path }
  built.lines.push(line)
  if (plan.kind === 'busRoute') built.vehicles[lineId] = plan.buses
}

/** Trains a day on a suburban line as it runs now, for the stand-in. */
function defaultTrains(_city: CityData, _line: string): number {
  return 8
}

// ---------------------------------------------------------------------------------------------------------------
// The stand-in: quote, suggest, and the four actions, until person D's exist.

const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary'])
/** Metres from a tap within which a stop finds a junction. */
const REACH = 1500
const BOUNDS = [77.35, 12.75, 77.85, 13.2]

const nodesFor = new WeakMap<RoutingNetwork, { metro: number[]; bus: number[] }>()
function candidates(roads: RoutingNetwork): { metro: number[]; bus: number[] } {
  let c = nodesFor.get(roads)
  if (!c) {
    const metro = new Set<number>()
    const bus = new Set<number>()
    for (const l of roads.links) {
      if (MAIN.has(l.kind)) for (const n of [l.from, l.to]) metro.add(n)
      for (const n of [l.from, l.to]) bus.add(n)
    }
    c = { metro: [...metro], bus: [...bus] }
    nodesFor.set(roads, c)
  }
  return c
}

function nearestNode(roads: RoutingNetwork, at: LngLat, kind: 'metro' | 'bus'): { node: number; m: number } | null {
  let best: { node: number; m: number } | null = null
  for (const id of candidates(roads)[kind]) {
    const m = metres(at, nodeAt(roads, id))
    if (!best || m < best.m) best = { node: id, m }
  }
  return best && best.m <= REACH ? best : null
}

/** The name of the place nearest a point: an area people know, if one is close, or else the nearest zone. */
function placeName(city: CityData, at: LngLat): { name: string; nameKn: string | null } {
  let known: (typeof KNOWN_PLACES)[number] | null = null
  let knownM = 1500
  for (const p of KNOWN_PLACES) {
    const m = metres(at, p.at)
    if (m < knownM) {
      knownM = m
      known = p
    }
  }
  if (known) return { name: known.en, nameKn: known.kn }
  let best = city.zones[0]!
  let bestM = Infinity
  for (const z of city.zones) {
    const m = metres(at, z.centre)
    if (m < bestM) {
      bestM = m
      best = z
    }
  }
  return { name: best.name, nameKn: best.nameKn }
}

type Snapped = { at: LngLat; name: string; nameKn: string | null; existing?: number; node: number | null }

function snap(city: CityData, stop: Stop, kind: 'metro' | 'bus', built: Built): Snapped | string {
  if ('station' in stop) {
    const s = city.transit.stations.find((x) => x.id === stop.station) ?? built.stations.find((x) => x.id === stop.station)
    if (!s) return 'There is no such station.'
    const near = nearestNode(city.roads, s.at, 'bus')
    return { at: s.at, name: s.name, nameKn: s.nameKn, existing: s.id, node: near?.node ?? null }
  }
  const [lng, lat] = stop.at
  if (!(lng >= BOUNDS[0]! && lng <= BOUNDS[2]! && lat >= BOUNDS[1]! && lat <= BOUNDS[3]!)) {
    return 'That is beyond the city’s reach.'
  }
  const near = nearestNode(city.roads, stop.at, kind)
  if (!near) return kind === 'metro' ? 'A station must be near a main road.' : 'A bus stop must be on a main road.'
  const at = nodeAt(city.roads, near.node)
  return { at, ...placeName(city, at), node: near.node }
}

/** The quickest way along the roads between two junctions, as a list of junctions, or null. */
function route(roads: RoutingNetwork, from: number, to: number): number[] | null {
  const out = new Map<number, { to: number; cost: number }[]>()
  for (const l of roads.links) {
    const list = out.get(l.from) ?? []
    list.push({ to: l.to, cost: l.length / Math.max(5, l.speed) })
    out.set(l.from, list)
  }
  const dist = new Map<number, number>([[from, 0]])
  const prev = new Map<number, number>()
  const done = new Set<number>()
  // A plain search: the network is small and a route is asked for rarely.
  const queue: [number, number][] = [[0, from]]
  while (queue.length) {
    let i = 0
    for (let k = 1; k < queue.length; k++) if (queue[k]![0] < queue[i]![0]) i = k
    const [d, n] = queue.splice(i, 1)[0]!
    if (done.has(n)) continue
    done.add(n)
    if (n === to) break
    for (const e of out.get(n) ?? []) {
      const nd = d + e.cost
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd)
        prev.set(e.to, n)
        queue.push([nd, e.to])
      }
    }
  }
  if (!done.has(to)) return null
  const path = [to]
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!)
  return path
}

const refuse = (reason: string): Quote => ({
  ok: false, reason, cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major: false,
})

/** Stand-in amounts, in lakh. */
const COST = {
  metroKm: 15_000,
  metroStation: 2_500,
  metroRunKm: 40,
  busEach: 50,
  busRunEach: 4,
  laneKm: 20,
  trainEach: 600,
  trainRunEach: 30,
}

export function standInQuote(game: Game, city: CityData, plan: Plan): Quote {
  const built = builtOf(game)
  if (plan.kind === 'busLane') {
    if (!plan.links.length) return refuse('Choose at least one stretch of road.')
    let length = 0
    const path: number[] = []
    for (const id of plan.links) {
      const l = city.roads.links[id]
      if (!l) return refuse('There is no such road.')
      if (l.lanes < 2) return refuse('A bus lane needs a road with at least two lanes each way.')
      length += l.length
      path.push(...nodeAt(city.roads, l.from), ...nodeAt(city.roads, l.to))
    }
    return {
      ok: true, cost: Math.max(10, Math.round((length / 1000) * COST.laneKm)), months: 1, running: 0, length,
      stations: [], path, disrupted: [], major: length > 5000,
    }
  }
  if (plan.kind === 'railService') {
    const line = city.transit.lines.find((l) => l.id === plan.line && l.kind === 'rail')
    if (!line) return refuse('There is no such railway line.')
    if (plan.trains < 1 || plan.trains > 20) return refuse('Between 1 and 20 more trains a day.')
    let length = 0
    for (let i = 2; i < line.path.length; i += 2) {
      length += metres([line.path[i - 2]!, line.path[i - 1]!], [line.path[i]!, line.path[i + 1]!])
    }
    return {
      ok: true, cost: plan.trains * COST.trainEach, months: 12, running: plan.trains * COST.trainRunEach,
      length: Math.round(length), stations: [], path: line.path, disrupted: [], major: true,
    }
  }
  if (plan.kind !== 'metro' && plan.kind !== 'busRoute') return refuse(NOT_YET)
  const kind = plan.kind === 'metro' ? 'metro' : 'bus'
  if (plan.stops.length < 2) return refuse(kind === 'metro' ? 'A line needs at least two stations.' : 'A route needs at least two stops.')
  const snapped: Snapped[] = []
  for (const stop of plan.stops) {
    const s = snap(city, stop, kind, built)
    if (typeof s === 'string') return refuse(s)
    snapped.push(s)
  }
  let path: number[] = []
  let length = 0
  for (let i = 1; i < snapped.length; i++) {
    const a = snapped[i - 1]!
    const b = snapped[i]!
    const m = metres(a.at, b.at)
    if (kind === 'metro' && m < 600) return refuse(`Stations must be at least 600 m apart: ${a.name} and ${b.name} are ${Math.round(m)} m apart.`)
    if (kind === 'bus' && a.node !== null && b.node !== null) {
      const way = route(city.roads, a.node, b.node)
      if (!way) return refuse(`There is no way by road from ${a.name} to ${b.name}.`)
      const points = way.map((n) => nodeAt(city.roads, n))
      const flat = [a.at, ...points, b.at]
      for (let k = 1; k < flat.length; k++) length += metres(flat[k - 1]!, flat[k]!)
      path.push(...flat.flat())
    } else {
      length += m
      path.push(...a.at, ...b.at)
    }
  }
  path = dedupe(path)
  const km = length / 1000
  if (kind === 'metro') {
    const disrupted = city.roads.links
      .filter((l) => MAIN.has(l.kind) && near(path, nodeAt(city.roads, l.from), 150) && near(path, nodeAt(city.roads, l.to), 150))
      .map((l) => l.id)
    const newStations = snapped.filter((s) => s.existing === undefined).length
    return {
      ok: true,
      cost: Math.round(km * COST.metroKm + newStations * COST.metroStation),
      months: 30 + Math.round(km * 1.2),
      running: Math.round(km * COST.metroRunKm),
      length: Math.round(length),
      stations: snapped.map(({ node: _node, ...s }) => s),
      path,
      disrupted,
      major: true,
    }
  }
  const buses = plan.kind === 'busRoute' ? plan.buses : 0
  if (buses < 1 || buses > 200) return refuse('A route needs between 1 and 200 buses.')
  return {
    ok: true,
    cost: buses * COST.busEach,
    months: 2,
    running: buses * COST.busRunEach,
    length: Math.round(length),
    stations: snapped.map(({ node: _node, ...s }) => s),
    path,
    disrupted: [],
    major: false,
  }
}

function dedupe(path: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < path.length; i += 2) {
    if (out.length && out[out.length - 2] === path[i] && out[out.length - 1] === path[i + 1]) continue
    out.push(path[i]!, path[i + 1]!)
  }
  return out
}

/** Whether a point is within `m` metres of a line given as lng, lat, lng, lat… */
function near(path: number[], p: LngLat, m: number): boolean {
  for (let i = 2; i < path.length; i += 2) {
    const a: LngLat = [path[i - 2]!, path[i - 1]!]
    const b: LngLat = [path[i]!, path[i + 1]!]
    const k = Math.cos(p[1] * (Math.PI / 180)) * 111_320
    const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * 110_540
    const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * 110_540
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(ax + t * dx, ay + t * dy) <= m) return true
  }
  return false
}

/** Whether a zone has a metro or railway station, open or being built, within a kilometre and a half of its centre. */
export function nearStation(zone: Zone, transit: Transit, built: Built | null): boolean {
  const lines = [...transit.lines, ...(built?.lines ?? [])].filter((l) => l.kind !== 'bus')
  const ids = new Set(lines.flatMap((l) => l.stations))
  return [...transit.stations, ...(built?.stations ?? [])].some((s) => ids.has(s.id) && metres(zone.centre, s.at) <= 1500)
}

/** Corridors the stand-in offers, as places along them: Namma Metro's published next phases, and busy bus roads. */
const CORRIDORS: Record<'metro' | 'busRoute', LngLat[][]> = {
  metro: [
    // Outer Ring Road west: JP Nagar to Hebbal (Namma Metro phase 3).
    [[77.585, 12.906], [77.548, 12.925], [77.52, 12.946], [77.51, 12.97], [77.505, 12.992], [77.53, 13.02], [77.59, 13.036]],
    // Sarjapur Road: Koramangala to Dommasandra.
    [[77.622, 12.935], [77.648, 12.923], [77.68, 12.912], [77.705, 12.905], [77.75, 12.883]],
    // Magadi Road: Hosahalli to Kadabagere (phase 3).
    [[77.543, 12.975], [77.505, 12.984], [77.468, 12.99], [77.44, 12.996]],
  ],
  busRoute: [
    [[77.623, 12.917], [77.678, 12.926], [77.699, 12.956], [77.696, 13.006]],
    [[77.623, 12.917], [77.645, 12.89], [77.668, 12.848]],
    [[77.607, 12.918], [77.599, 12.887], [77.597, 12.857]],
  ],
}

export function standInSuggest(game: Game, city: CityData, kind: 'metro' | 'busRoute'): Plan[] {
  return (CORRIDORS[kind] ?? [])
    .map((points): Plan => kind === 'metro'
      ? { kind: 'metro', stops: points.map((at) => ({ at })) }
      : { kind: 'busRoute', stops: points.map((at) => ({ at })), buses: 30 })
    .filter((plan) => standInQuote(game, city, plan).ok)
}

/**
 * The rules with building added where they lack it: D's quote, suggest and actions where they are written, these
 * stand-ins where they still refuse. `standIn` says which.
 */
export function withBuilding(
  rules: Rules, city: CityData, season: Parameters<Rules['start']>[0],
): Rules & { standIn: boolean } {
  const probe = rules.start(season, city)
  const dQuote = rules.quote(probe, city, { kind: 'busLane', links: [] })
  const quoteReady = !(dQuote.reason === NOT_YET)
  const building = rules.may(probe, city, { kind: 'cancel', project: -1 })
  const actReady = building.ok || !(building.reason === NOT_YET || /not something the city can do/.test(building.reason))
  if (quoteReady && actReady) return { ...rules, standIn: false }

  const quote = (game: Game, c: CityData, plan: Plan) => {
    if (quoteReady) {
      const q = rules.quote(game, c, plan)
      if (q.reason !== NOT_YET) return q
    }
    return standInQuote(game, c, plan)
  }
  const suggest = (game: Game, c: CityData, kind: 'metro' | 'busRoute') => {
    const plans = rules.suggest(game, c, kind)
    return plans.length ? plans : standInSuggest(game, c, kind)
  }
  if (actReady) return { ...rules, quote, suggest, standIn: true }

  const isBuilding = (a: Action) => a.kind === 'build' || a.kind === 'cancel' || a.kind === 'vehicles' || a.kind === 'close'
  const may = (game: Game, c: CityData, action: Action): Outcome => {
    if (!isBuilding(action)) return rules.may(game, c, action)
    if (game.status !== 'playing') return { ok: false, reason: 'The game is over.' }
    const built = builtOf(game)
    switch (action.kind) {
      case 'build': {
        const q = quote(game, c, action.plan)
        if (!q.ok) return { ok: false, reason: q.reason ?? 'That cannot be built.' }
        if (q.major && (game.majors ?? 0) >= 3) return { ok: false, reason: 'Three major works may be started in a month. Start this next month.' }
        if (q.cost > game.money) {
          return { ok: false, reason: `It costs ${crore(q.cost)} and the city has ${crore(game.money)}.` }
        }
        return { ok: true }
      }
      case 'cancel':
        return (game.projects ?? []).some((p) => p.id === action.project) ? { ok: true } : { ok: false, reason: 'There is no such work.' }
      case 'vehicles': {
        const now = built.vehicles[action.line]
        if (now === undefined) return { ok: false, reason: 'There is no such line of yours.' }
        if (now + action.change < 1) return { ok: false, reason: 'A line needs at least one.' }
        if (now + action.change > 200) return { ok: false, reason: 'That is more than the line can run.' }
        return { ok: true }
      }
      case 'close':
        return built.lines.some((l) => l.id === action.line) ? { ok: true } : { ok: false, reason: 'There is no such line of yours.' }
    }
    return { ok: false, reason: 'That is not something the city can do.' }
  }
  const act = (game: Game, c: CityData, action: Action): Outcome => {
    if (!isBuilding(action)) return rules.act(game, c, action)
    const outcome = may(game, c, action)
    if (!outcome.ok) return outcome
    game.projects ??= []
    game.built = builtOf(game)
    switch (action.kind) {
      case 'build': {
        const q = quote(game, c, action.plan)
        const id = game.done.filter((d) => d.action.kind === 'build').length + 1
        const project: Project = {
          id, plan: action.plan, name: planName(action.plan, q, game, c.transit), started: game.month,
          opens: game.month + q.months, cost: q.cost, quote: q,
        }
        game.projects.push(project)
        if (q.major) game.majors = (game.majors ?? 0) + 1
        break
      }
      case 'cancel':
        game.projects = game.projects.filter((p) => p.id !== action.project)
        break
      case 'vehicles':
        game.built.vehicles[action.line] = game.built.vehicles[action.line]! + action.change
        game.money -= Math.max(0, action.change) * COST.busEach
        break
      case 'close':
        game.built.lines = game.built.lines.filter((l) => l.id !== action.line)
        delete game.built.vehicles[action.line]
        break
    }
    game.done.push({ month: game.month, action: structuredClone(action) })
    return outcome
  }
  const state = (game: Game, c: CityData): CityState => {
    const s = rules.state(game, c)
    const built = builtOf(game)
    const works = (game.projects ?? []).filter((p) => game.month < p.started + Math.ceil((p.opens - p.started) / 2))
    const transit = built.lines.length
      ? { stations: [...s.transit.stations, ...built.stations], lines: [...s.transit.lines, ...built.lines] }
      : s.transit
    let condition = s.condition
    if (works.length) {
      condition = condition ? [...condition] : c.roads.links.map(() => 1)
      for (const p of works) for (const id of p.quote.disrupted) condition[id] = Math.min(condition[id] ?? 1, 0.7)
    }
    const vehicles = Object.keys(built.vehicles).length ? { ...s.vehicles, ...built.vehicles } : s.vehicles
    return {
      ...s, transit, condition,
      busLanes: built.busLanes.length ? [...(s.busLanes ?? []), ...built.busLanes] : s.busLanes,
      vehicles,
    }
  }
  const endMonth = (game: Game, c: CityData, result: Parameters<Rules['endMonth']>[2]): Report => {
    const month = game.month
    const report = rules.endMonth(game, c, result)
    let paid = 0
    let running = 0
    const opened: string[] = []
    for (const p of game.projects ?? []) {
      if (month < p.opens) paid += Math.round(p.cost / Math.max(1, p.opens - p.started))
    }
    for (const l of builtOf(game).lines) {
      running +=l.kind === 'metro' ? 400 : (builtOf(game).vehicles[l.id] ?? 0) * COST.busRunEach
    }
    const still: Project[] = []
    for (const p of game.projects ?? []) {
      if (game.month >= p.opens) {
        openInto(game, c, p.plan, p.quote, `player-${p.id}`, p.plan.kind === 'metro' ? projectLook(game, p.plan) : null)
        const line = game.built!.lines.find((l) => l.id === `player-${p.id}`)
        if (line && p.plan.kind !== 'metro') line.name = p.name.split(',')[0]!
        opened.push(`${p.name} opens.`)
      } else still.push(p)
    }
    if (game.projects) game.projects = still
    game.majors = 0
    const entries: Entry[] = []
    if (paid) entries.push({ key: 'building', name: 'Building', amount: -paid })
    if (running) entries.push({ key: 'run-yours', name: 'Running your lines', amount: -running })
    const spent = paid + running
    if (spent) {
      game.money -= spent
      report.books.push(...entries)
      const money = report.figures.find((f) => f.key === 'money')
      if (money) money.now -= spent / 100
    }
    report.news.unshift(...opened)
    return report
  }
  return { ...rules, quote, suggest, may, act, state, endMonth, standIn: true }
}

function crore(lakh: number): string {
  return `₹${Math.round(lakh / 100).toLocaleString('en-IN')} crore`
}
